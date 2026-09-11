import {
  createStableEntityId,
  type EntityId,
  type FormationDefinition,
  type ManagerAttributeSet,
  type Mentality,
  type PlayerAttributeSet,
  type PlayerDuty,
  type TacticalAssignment,
  type TacticalSetup,
  type TacticalSlot,
  type TacticalStyleId,
} from "@nepal-football-sim/shared-types";
import { ManagerRepository, type GameDatabase } from "@nepal-football-sim/database";
import { SeededRandom } from "./rng.js";
import {
  DEFAULT_FAMILIARITY,
  FORMATION_PRESETS,
  calculateRoleFit,
  defaultDutyForRole,
  createTacticalSetup,
  dutyIsLegalForRole,
  familiarityAfterTacticChange,
  normalizeTacticalSetup,
  roleById,
  tacticalPositionToPlayerPosition,
} from "./tactics.js";

/**
 * The full canonical style catalogue IS the tactical archetype set — there is
 * no separate "archetype" enum to keep in sync with it. Each style already
 * bundles a coherent mentality + tempo/directness/pressing/width profile
 * (see TACTICAL_STYLE_PRESETS), so choosing a style already chooses an
 * identity; this module only adds formation, role, duty and set-piece choices
 * on top of it.
 */
const ALL_STYLES: readonly TacticalStyleId[] = [
  "BALANCED",
  "POSSESSION",
  "GEGENPRESS",
  "HIGH_PRESS",
  "COUNTER_ATTACK",
  "DIRECT",
  "LOW_BLOCK",
  "WING_PLAY",
  "VERTICAL",
];

/** 1 (deepest/most cautious) .. 5 (highest-risk/most aggressive). Drives duty bias only. */
const STYLE_AGGRESSION: Record<TacticalStyleId, number> = {
  LOW_BLOCK: 1,
  COUNTER_ATTACK: 2,
  BALANCED: 3,
  POSSESSION: 3,
  WING_PLAY: 4,
  DIRECT: 4,
  VERTICAL: 4,
  HIGH_PRESS: 5,
  GEGENPRESS: 5,
};

/** Preferred formations for a style, first choice first. Every formation can
 * always field a legal XI (replacement players fill any gap), so this is a
 * preference order, never a validity search. */
const STYLE_FORMATIONS: Record<TacticalStyleId, readonly string[]> = {
  POSSESSION: ["4-2-3-1", "4-3-3"],
  GEGENPRESS: ["4-3-3", "4-2-3-1"],
  HIGH_PRESS: ["4-3-3", "4-2-3-1"],
  COUNTER_ATTACK: ["4-1-4-1", "3-5-2"],
  DIRECT: ["4-4-2", "4-1-4-1"],
  VERTICAL: ["4-4-2", "4-3-3"],
  LOW_BLOCK: ["3-5-2", "4-1-4-1"],
  WING_PLAY: ["4-4-2", "3-4-2-1"],
  BALANCED: ["4-3-3"],
};

/** Role shortlists per zone per style — the AI picks whichever of these the
 * assigned player fits best, never an arbitrary/forced choice. */
const ZONE_ROLE_CANDIDATES: Record<TacticalStyleId, Partial<Record<TacticalSlot["zone"], readonly string[]>>> = {
  POSSESSION: {
    goalkeeper: ["SWEEPER_KEEPER", "GOALKEEPER"],
    defense: ["BALL_PLAYING_DEFENDER", "LIBERO"],
    wingback: ["INVERTED_FULL_BACK", "FULL_BACK"],
    defensiveMidfield: ["DEEP_LYING_PLAYMAKER", "CENTRAL_MIDFIELDER"],
    midfield: ["CENTRAL_MIDFIELDER", "DEEP_LYING_PLAYMAKER"],
    attackingMidfield: ["WIDE_PLAYMAKER", "ADVANCED_PLAYMAKER"],
    forward: ["COMPLETE_FORWARD", "ADVANCED_FORWARD"],
  },
  GEGENPRESS: {
    goalkeeper: ["SWEEPER_KEEPER", "GOALKEEPER"],
    defense: ["BALL_PLAYING_DEFENDER", "STOPPER"],
    wingback: ["WING_BACK", "FULL_BACK"],
    defensiveMidfield: ["BOX_TO_BOX_MIDFIELDER", "DEFENSIVE_MIDFIELDER"],
    midfield: ["BOX_TO_BOX_MIDFIELDER", "CENTRAL_MIDFIELDER"],
    attackingMidfield: ["WINGER", "INSIDE_FORWARD"],
    forward: ["PRESSING_FORWARD", "ADVANCED_FORWARD"],
  },
  HIGH_PRESS: {
    defense: ["BALL_PLAYING_DEFENDER", "STOPPER"],
    wingback: ["WING_BACK", "FULL_BACK"],
    defensiveMidfield: ["DEFENSIVE_MIDFIELDER", "BOX_TO_BOX_MIDFIELDER"],
    midfield: ["BOX_TO_BOX_MIDFIELDER", "CENTRAL_MIDFIELDER"],
    attackingMidfield: ["WINGER", "INSIDE_FORWARD"],
    forward: ["PRESSING_FORWARD", "ADVANCED_FORWARD"],
  },
  COUNTER_ATTACK: {
    defense: ["NO_NONSENSE_DEFENDER", "COVER"],
    wingback: ["FULL_BACK", "WIDE_CENTRE_BACK"],
    defensiveMidfield: ["ANCHOR", "DEFENSIVE_MIDFIELDER"],
    midfield: ["CENTRAL_MIDFIELDER", "ANCHOR"],
    attackingMidfield: ["INSIDE_FORWARD", "MEZZALA"],
    forward: ["POACHER", "ADVANCED_FORWARD"],
  },
  DIRECT: {
    defense: ["NO_NONSENSE_DEFENDER", "STOPPER"],
    wingback: ["FULL_BACK", "WING_BACK"],
    defensiveMidfield: ["DEFENSIVE_MIDFIELDER", "BOX_TO_BOX_MIDFIELDER"],
    midfield: ["BOX_TO_BOX_MIDFIELDER", "CENTRAL_MIDFIELDER"],
    attackingMidfield: ["WINGER", "MEZZALA"],
    forward: ["TARGET_FORWARD", "ADVANCED_FORWARD"],
  },
  VERTICAL: {
    defense: ["NO_NONSENSE_DEFENDER", "BALL_PLAYING_DEFENDER"],
    wingback: ["WING_BACK", "FULL_BACK"],
    defensiveMidfield: ["BOX_TO_BOX_MIDFIELDER", "DEFENSIVE_MIDFIELDER"],
    midfield: ["BOX_TO_BOX_MIDFIELDER", "MEZZALA"],
    attackingMidfield: ["INSIDE_FORWARD", "WINGER"],
    forward: ["ADVANCED_FORWARD", "TARGET_FORWARD"],
  },
  LOW_BLOCK: {
    defense: ["NO_NONSENSE_DEFENDER", "COVER"],
    wingback: ["FULL_BACK", "WIDE_CENTRE_BACK"],
    defensiveMidfield: ["ANCHOR", "DEFENSIVE_MIDFIELDER"],
    midfield: ["DEFENSIVE_MIDFIELDER", "CENTRAL_MIDFIELDER"],
    attackingMidfield: ["INSIDE_FORWARD", "WINGER"],
    forward: ["TARGET_FORWARD", "POACHER"],
  },
  WING_PLAY: {
    defense: ["WIDE_CENTRE_BACK", "BALL_PLAYING_DEFENDER"],
    wingback: ["WING_BACK", "FULL_BACK"],
    defensiveMidfield: ["CENTRAL_MIDFIELDER", "DEFENSIVE_MIDFIELDER"],
    midfield: ["MEZZALA", "CENTRAL_MIDFIELDER"],
    attackingMidfield: ["WINGER", "WIDE_PLAYMAKER"],
    forward: ["TARGET_FORWARD", "ADVANCED_FORWARD"],
  },
  BALANCED: {
    defense: ["BALL_PLAYING_DEFENDER", "NO_NONSENSE_DEFENDER"],
    wingback: ["FULL_BACK", "WING_BACK"],
    defensiveMidfield: ["CENTRAL_MIDFIELDER", "DEFENSIVE_MIDFIELDER"],
    midfield: ["CENTRAL_MIDFIELDER", "BOX_TO_BOX_MIDFIELDER"],
    attackingMidfield: ["WINGER", "ADVANCED_PLAYMAKER"],
    forward: ["ADVANCED_FORWARD", "COMPLETE_FORWARD"],
  },
};

const roleCandidatesFor = (style: TacticalStyleId, zone: TacticalSlot["zone"]): readonly string[] => {
  if (zone === "goalkeeper") return ZONE_ROLE_CANDIDATES[style]?.goalkeeper ?? ["GOALKEEPER"];
  return ZONE_ROLE_CANDIDATES[style]?.[zone] ?? ["CENTRAL_MIDFIELDER"];
};

/** Style-biased duty: start from the role's own natural duty, then nudge it
 * toward the style's aggression level for attacking zones (forward / wide /
 * wingback) and away from it for the deepest defensive roles — always
 * clamped to what the role legally allows. Never sets every slot to ATTACK. */
const dutyFor = (roleId: string, zone: TacticalSlot["zone"], style: TacticalStyleId): PlayerDuty => {
  const aggression = STYLE_AGGRESSION[style];
  const base = defaultDutyForRole(roleId);
  const attackingZone = zone === "forward" || zone === "attackingMidfield" || zone === "wingback";
  if (attackingZone && aggression >= 4 && base === "SUPPORT" && dutyIsLegalForRole(roleId, "ATTACK")) {
    return "ATTACK";
  }
  if (attackingZone && aggression <= 2 && base === "ATTACK" && dutyIsLegalForRole(roleId, "SUPPORT")) {
    return "SUPPORT";
  }
  if (zone === "defense" && aggression <= 2 && dutyIsLegalForRole(roleId, "DEFEND")) return "DEFEND";
  return dutyIsLegalForRole(roleId, base) ? base : defaultDutyForRole(roleId);
};

/** Deterministic archetype for a team with no genuine manager preference —
 * derived from the team id alone, never a club/country name. */
const deterministicStyle = (seedKey: string): TacticalStyleId =>
  new SeededRandom(`ai-style:${seedKey}`).pick(ALL_STYLES);

const formationSuitability = (player: PlayerAttributeSet, position: TacticalSlot["position"]): number => {
  const mapped = tacticalPositionToPlayerPosition(position);
  if (player.primaryPosition === mapped) return 100;
  if (player.secondaryPositions.includes(mapped)) return 82;
  return 45;
};

const pickFormation = (style: TacticalStyleId): FormationDefinition => {
  const names = STYLE_FORMATIONS[style] ?? ["4-3-3"];
  for (const name of names) {
    const found = FORMATION_PRESETS.find((formation) => formation.name === name);
    if (found) return found;
  }
  return FORMATION_PRESETS[0]!;
};

/**
 * A club's genuine, held tactical preference. Manager-derived when a real
 * manager profile exists and states one; otherwise a deterministic, seeded
 * fallback so the same team always reaches the same identity without ever
 * hardcoding a club or country.
 */
export const deriveAiStyle = (teamId: EntityId, manager?: { preferredStyle?: TacticalStyleId }): TacticalStyleId =>
  manager?.preferredStyle ?? deterministicStyle(teamId);

/**
 * Builds one full, legal, deterministic TacticalSetup for a team with no
 * persisted tactic yet — the AI equivalent of a manager filling in their own
 * Tactics screen. Uses the same formation presets, role catalogue, duty
 * legality and set-piece assignment surface a human uses; never a parallel
 * model. Reuses the existing suitability-based greedy slot fill (the same
 * approach the human's own initial default setup and season/owner fallbacks
 * already used) so a squad with genuine gaps still yields a full, valid XI.
 */
export const buildAiTacticalSetup = (
  teamId: EntityId,
  players: readonly PlayerAttributeSet[],
  options?: { managerProfileId?: EntityId; manager?: { preferredStyle?: TacticalStyleId } },
): TacticalSetup => {
  const style = deriveAiStyle(teamId, options?.manager);
  const formation = pickFormation(style);
  const taken = new Set<EntityId>();
  const rng = new SeededRandom(`ai-xi:${teamId}:${style}`);

  const assignments: TacticalAssignment[] = formation.slots.map((slot) => {
    const candidate = players
      .filter((player) => !taken.has(player.personId))
      .map((player) => ({ player, score: formationSuitability(player, slot.position) }))
      .sort((a, b) => b.score - a.score)[0]?.player;
    if (candidate) taken.add(candidate.personId);

    const roleCandidates = roleCandidatesFor(style, slot.zone);
    const roleId = candidate
      ? (roleCandidates
          .map((id) => ({
            id,
            fit: calculateRoleFit({ player: candidate, slot, role: roleById(id) }).overall,
          }))
          .sort((a, b) => b.fit - a.fit || rng.next() - 0.5)[0]?.id ?? roleCandidates[0]!)
      : roleCandidates[0]!;

    return {
      slotId: slot.id,
      playerId: candidate?.personId,
      roleId,
      duty: dutyFor(roleId, slot.zone, style),
    };
  });

  const outfield = assignments.flatMap((assignment) =>
    assignment.slotId !== formation.slots.find((slot) => slot.zone === "goalkeeper")?.id && assignment.playerId
      ? [assignment.playerId]
      : [],
  );
  const bench = players
    .filter((player) => !taken.has(player.personId))
    .slice(0, 7)
    .map((player) => player.personId);

  // Set pieces: best dead-ball technique for the takers, best genuine aerial
  // profile for the primary target — no separate AI-only structure.
  const byTechnique = [...players]
    .filter((player) => outfield.includes(player.personId))
    .sort(
      (a, b) =>
        b.technical.setPieces + b.mental.composure - (a.technical.setPieces + a.mental.composure),
    );
  const byAerial = [...players]
    .filter((player) => outfield.includes(player.personId))
    .sort(
      (a, b) =>
        b.technical.heading + b.physical.jumping + b.physical.strength -
        (a.technical.heading + a.physical.jumping + a.physical.strength),
    );
  const taker = byTechnique[0]?.personId;
  const target = byAerial[0]?.personId;
  const secondaryTarget = byAerial[1]?.personId;

  return {
    ...createTacticalSetup({
      teamId,
      managerProfileId: options?.managerProfileId,
      name: `${style} (AI)`,
      formation,
      style,
      assignments,
      bench,
      familiarity: DEFAULT_FAMILIARITY,
    }),
    setPieces: {
      penaltyTaker: taker,
      directFreeKickTaker: taker,
      leftCornerTaker: taker,
      rightCornerTaker: taker,
      cornerPrimaryTarget: target,
      cornerSecondaryTarget: secondaryTarget,
      freeKickTarget: target,
      defensiveCornerScheme: STYLE_AGGRESSION[style] <= 2 ? "MAN_ORIENTED" : "ZONAL",
      defensiveAerialPriority: target ? [target] : [],
    },
  };
};

/**
 * Resolves the tactical setup a team actually plays with: the real persisted
 * one if it exists, reseeded for a genuine manager change (with the same
 * bounded familiarity switch cost a human incurs), or a freshly built and
 * PERSISTED deterministic identity the first time a team is ever seen. Every
 * call site that used to fall back to the fixed default setup should call
 * this instead — human opponents, background world fixtures, everything.
 */
export const resolveTeamTacticalSetup = (
  db: GameDatabase,
  teamId: EntityId,
  players: readonly PlayerAttributeSet[],
): TacticalSetup => {
  const managers = new ManagerRepository(db);
  const existing = managers.tacticalSetups(teamId)[0];
  const currentManager = managers.activeContractForTeam(teamId);
  const currentManagerProfileId = currentManager?.managerProfileId;

  if (existing) {
    const normalized = normalizeTacticalSetup(existing);
    // A genuine manager change reseeds the identity — bounded familiarity
    // cost via the same function a human's own tactic switch incurs, never a
    // hard reset. A vacant club (no manager) keeps its last identity rather
        // than being rebuilt every time it is looked up.
    if (currentManagerProfileId && existing.managerProfileId !== currentManagerProfileId) {
      const managerProfile = managers.getProfile(currentManagerProfileId);
      const rebuilt = buildAiTacticalSetup(teamId, players, {
        managerProfileId: currentManagerProfileId,
        manager: managerProfile,
      });
      const reseeded: TacticalSetup = {
        ...rebuilt,
        id: normalized.id,
        familiarity: familiarityAfterTacticChange(normalized, rebuilt),
      };
      managers.insertTacticalSetup(reseeded);
      return reseeded;
    }
    if (normalized !== existing) managers.insertTacticalSetup(normalized);
    return normalized;
  }

  const managerProfile = currentManagerProfileId ? managers.getProfile(currentManagerProfileId) : undefined;
  const built = buildAiTacticalSetup(teamId, players, {
    managerProfileId: currentManagerProfileId,
    manager: managerProfile,
  });
  managers.insertTacticalSetup(built);
  return built;
};
