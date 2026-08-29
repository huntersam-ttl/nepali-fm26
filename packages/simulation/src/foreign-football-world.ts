import {
  createStableEntityId,
  type EntityId,
  type FootballStaffRole,
} from "@nepal-football-sim/shared-types";
import {
  WorkforceSupplyRepository,
  GlobalFootballContextRepository,
  PlayerRepository,
  EventRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  ensureAiStaffAssigned,
  ensureExternalStaffVacancies,
  evaluateAllStaffContracts,
  generateAiStaff,
  processExternalStaffVacancies,
} from "./staff-market.js";
import { initializeTransferMarketForSave } from "./transfer-market.js";
import { generateYouthCohort } from "./youth-intake.js";
import { SeededRandom } from "./rng.js";
import { considerForeignInternationalTrials } from "./international-trials.js";
import { createInitialDevelopmentState, updatePlayerDevelopment } from "./player-development.js";
import { generateSimulationPlayerProfile } from "./player-profile-generation.js";

/**
 * A deliberately small foreign layer. Nepal gets the detailed simulation;
 * these clubs exist to make its transfer, scouting and staff pathways real
 * without pretending to model every domestic league in the world.
 */
const FOREIGN_MARKETS = [
  ["IN", "India"],
  ["BD", "Bangladesh"],
  ["BT", "Bhutan"],
  ["MV", "Maldives"],
  ["PK", "Pakistan"],
  ["LK", "Sri Lanka"],
  ["AF", "Afghanistan"],
  ["NG", "Nigeria"],
  ["GH", "Ghana"],
  ["JP", "Japan"],
  ["AE", "United Arab Emirates"],
] as const;

const FOREIGN_ROLES: FootballStaffRole[] = ["HEAD_COACH", "SCOUT"];

/** Squad the bootstrap aims for, and the floor seasonal replenishment defends. */
const FOREIGN_SQUAD_TARGET = 12;
const FOREIGN_SQUAD_FLOOR = 16;
const FOREIGN_REPLENISHMENT_BATCH = 3;

/**
 * Bootstrap and seasonal replenishment must never share a cohort key: a
 * replacement signed in 2031 has to be a different person from the club's
 * founding intake, and both identities must stay deterministic.
 */
const FOREIGN_BOOTSTRAP_LABEL = "foreign-world-bootstrap";
const FOREIGN_BOOTSTRAP_KIND = "FOREIGN_WORLD_BOOTSTRAP";
const FOREIGN_BOOTSTRAP_COHORT = "foreign-market";
const FOREIGN_REPLENISHMENT_KIND = "FOREIGN_WORLD_REPLENISHMENT";
const FOREIGN_SEASON_KIND = "FOREIGN_WORLD_SEASON";

const confederationFor = (isoCode: string): "AFC" | "CAF" | "CONCACAF" | "CONMEBOL" | "OFC" | "UEFA" =>
  ["NG", "GH"].includes(isoCode) ? "CAF" : ["IN", "BD", "BT", "MV", "PK", "LK", "AF", "JP", "AE"].includes(isoCode) ? "AFC" : "UEFA";

const contextForClub = (db: GameDatabase, clubId: EntityId) =>
  new GlobalFootballContextRepository(db).clubs().find((club) => club.clubId === clubId);

export const isContextOnlyClub = (db: GameDatabase, clubId: EntityId): boolean =>
  Boolean(contextForClub(db, clubId) ?? (db.prepare("SELECT canonical_external_id AS id FROM clubs WHERE id = ?").get(clubId) as { id?: string } | undefined)?.id?.startsWith("SIM-FOREIGN-"));

const ensureExternalLeagueContext = (db: GameDatabase, input: { isoCode: string; countryId: EntityId; countryName: string; date: string }): { federationId: EntityId; leagueId: EntityId } => {
  const world = new WorldRepository(db);
  const contexts = new GlobalFootballContextRepository(db);
  const federationId = createStableEntityId("external-federation", input.isoCode);
  if (!db.prepare("SELECT 1 FROM federations WHERE id = ?").get(federationId)) {
    world.insertFederation({ id: federationId, countryId: input.countryId, name: `${input.countryName} Football Association` });
  }
  contexts.upsertFederation({ federationId, countryId: input.countryId, confederation: confederationFor(input.isoCode), reputation: input.isoCode === "JP" ? 7 : 4, simulationDepth: "CONTEXT_ONLY", updatedOn: input.date });
  const leagueId = createStableEntityId("external-league", input.isoCode);
  if (!db.prepare("SELECT 1 FROM competitions WHERE id = ?").get(leagueId)) {
    world.insertCompetition({ id: leagueId, federationId, name: `${input.countryName} Context League`, scope: "domestic", category: "PYRAMID_LEAGUE" });
  }
  contexts.upsertLeague({ leagueId, federationId, countryId: input.countryId, tier: 1, reputation: input.isoCode === "JP" ? 7 : 4, simulationDepth: "CONTEXT_ONLY", continentalQualification: true });
  return { federationId, leagueId };
};

/**
 * Authoritative squad size for a foreign club.
 *
 * The previous count looked only at active senior team assignments, which is
 * not what generation produces: `createGeneratedYouth` deliberately leaves
 * academy-candidate players unassigned, so a club could hold twelve generated
 * players and still report one. The top-up gate therefore never closed, and on
 * the next call the same deterministic identities were regenerated. Counting
 * contracted players as well as assigned players makes the measurement match
 * what generation actually persisted.
 */
const foreignSquadSize = (db: GameDatabase, clubId: EntityId, teamId: EntityId): number =>
  Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM (
             SELECT person_id AS player_id FROM team_person_assignments
              WHERE team_id = ? AND role = 'PLAYER' AND ended_on IS NULL
             UNION
             SELECT player_id FROM player_contracts
              WHERE club_id = ? AND status = 'ACTIVE'
           )`,
        )
        .get(teamId, clubId) as { count?: number } | undefined
    )?.count ?? 0,
  );

/**
 * Claims a one-shot generation cycle through the existing workforce intake
 * ledger. Returns false when this exact cycle already ran for this save, which
 * is what makes repeated career entry and save reload safe without a new
 * schema or a blind INSERT OR IGNORE.
 */
const claimForeignCycle = (
  db: GameDatabase,
  input: { seasonLabel: string; kind: string; contextKey: string; date: string },
): boolean =>
  new WorkforceSupplyRepository(db).claimIntake({
    id: createStableEntityId(
      "workforce-intake",
      `${input.seasonLabel}:${input.kind}:${input.contextKey}`,
    ),
    seasonLabel: input.seasonLabel,
    kind: input.kind,
    contextKey: input.contextKey,
    generatedOn: input.date,
    generatedCount: 0,
    provenanceStatus: "SIMULATION_ONLY",
  });

export const initializeForeignFootballWorldForSave = (input: {
  db: GameDatabase;
  worldDate: string;
  seed: string;
}): void => {
  const world = new WorldRepository(input.db);
  const foreignClubs: Array<{ clubId: EntityId; teamId: EntityId; countryId: EntityId; federationId: EntityId; leagueId: EntityId }> = [];

  for (const [isoCode, countryName] of FOREIGN_MARKETS) {
    const countryId = countryIdFor(input.db, isoCode, countryName);
    const externalLeague = ensureExternalLeagueContext(input.db, { isoCode, countryId, countryName, date: input.worldDate });
    const canonicalExternalId = `SIM-FOREIGN-${isoCode}`;
    let club = input.db
      .prepare("SELECT id FROM clubs WHERE canonical_external_id = ? LIMIT 1")
      .get(canonicalExternalId) as { id: EntityId } | undefined;
    if (!club) {
      const clubId = createStableEntityId("foreign-simulation-club", isoCode);
      const teamId = createStableEntityId("foreign-simulation-team", isoCode);
      world.insertClub({
        id: clubId,
        name: `${countryName} Regional Football Club`,
        officialName: `${countryName} Regional Football Club`,
        shortName: `${isoCode} Regional`,
        canonicalExternalId,
        countryId,
        ownershipType: "PRIVATE",
        organisationType: "CLUB",
      });
      world.insertTeam({
        id: teamId,
        clubId,
        name: `${countryName} Regional Senior Men`,
        canonicalExternalId: `${canonicalExternalId}-MEN`,
        level: "senior",
        gender: "men",
      });
      club = { id: clubId };
    }
    const team = input.db
      .prepare("SELECT id FROM teams WHERE club_id = ? AND level = 'senior' ORDER BY id LIMIT 1")
      .get(club.id) as { id: EntityId } | undefined;
    if (!team) continue;
    new GlobalFootballContextRepository(input.db).upsertClub({ clubId: club.id, leagueId: externalLeague.leagueId, federationId: externalLeague.federationId, countryId, reputation: isoCode === "JP" ? 70 : 45, financialBand: isoCode === "JP" ? "HIGH" : "MEDIUM", academyStrength: isoCode === "JP" ? 70 : 45, scoutingReach: isoCode === "JP" ? 65 : 40, recruitmentRegions: ["SOUTH_ASIA", "WIDER_ASIA"], simulationDepth: "CONTEXT_ONLY" });
    foreignClubs.push({ clubId: club.id, teamId: team.id, countryId, federationId: externalLeague.federationId, leagueId: externalLeague.leagueId });
  }

  // The transfer repository is initialized before generated players add
  // their contracts, so later calls remain idempotent and fully wired.
  initializeTransferMarketForSave(input);
  for (const club of foreignClubs) {
    /*
     * Bootstrap is a one-time world event, not a recurring top-up. Claiming the
     * cycle first means a reloaded save, or a defensive second call to this
     * initializer, does nothing rather than re-deriving the same deterministic
     * person identities and colliding on persons.id. Later squad shortfalls are
     * the seasonal replenishment path's job, not this one's.
     */
    if (
      !claimForeignCycle(input.db, {
        seasonLabel: FOREIGN_BOOTSTRAP_LABEL,
        kind: FOREIGN_BOOTSTRAP_KIND,
        contextKey: club.clubId,
        date: input.worldDate,
      })
    ) {
      seedForeignStaff(input.db, club.countryId, club.clubId, input.worldDate, input.seed);
      ensureExternalStaffVacancies(input.db, club.clubId, FOREIGN_ROLES, input.worldDate);
      continue;
    }
    /*
     * A save created before this marker existed already has its foreign squad.
     * Claiming the cycle above records that fact; generating again here would
     * duplicate it, so only a genuinely empty club is populated.
     */
    const existing = foreignSquadSize(input.db, club.clubId, club.teamId);
    if (existing < FOREIGN_SQUAD_TARGET) {
      generateYouthCohort({
        db: input.db,
        countryId: club.countryId,
        clubId: club.clubId,
        teamId: club.teamId,
        date: input.worldDate,
        seasonLabel: input.worldDate.slice(0, 4),
        seed: `${input.seed}:foreign:${club.clubId}:initial`,
        count: FOREIGN_SQUAD_TARGET - existing,
        cohortKey: FOREIGN_BOOTSTRAP_COHORT,
      });
    }
    seedForeignStaff(input.db, club.countryId, club.clubId, input.worldDate, input.seed);
    ensureExternalStaffVacancies(input.db, club.clubId, FOREIGN_ROLES, input.worldDate);
  }
  // Context is created with the people, not only after the first seasonal
  // update, so a freshly opened save already has a continuous external pool.
  synchronizeExternalPlayerContexts(input.db, input.worldDate);
  // Context clubs get only their actual bootstrap vacancies processed.  The
  // capped staff-market worker supplies the decision and contract path.
  processExternalStaffVacancies(input.db, {
    id: createStableEntityId("foreign-staff-bootstrap-save", input.seed),
    name: "Foreign staff bootstrap",
    worldDate: input.worldDate,
    databaseVersion: 64,
    gameVersion: "simulation",
    randomSeed: input.seed,
    createdAt: `${input.worldDate}T00:00:00.000Z`,
    lastSavedAt: `${input.worldDate}T00:00:00.000Z`,
  });
};

export const processForeignFootballWorldSeason = (input: {
  db: GameDatabase;
  seasonEndDate: string;
  seed: string;
}): void => {
  // The career rollover is a once-per-season boundary. Claim it before any
  // downstream reputation, lifecycle, staff, or scouting writes so a retry
  // after reload cannot advance the same outside season twice.
  if (
    !claimForeignCycle(input.db, {
      seasonLabel: input.seasonEndDate.slice(0, 4),
      kind: FOREIGN_SEASON_KIND,
      contextKey: "global-external-world",
      date: input.seasonEndDate,
    })
  ) {
    return;
  }
  const staffSave = {
    id: createStableEntityId("foreign-staff-season-save", `${input.seed}:${input.seasonEndDate}`),
    name: "Foreign staff season",
    worldDate: input.seasonEndDate,
    databaseVersion: 64,
    gameVersion: "simulation",
    randomSeed: input.seed,
    createdAt: `${input.seasonEndDate}T00:00:00.000Z`,
    lastSavedAt: `${input.seasonEndDate}T00:00:00.000Z`,
  };
  initializeExternalLeagueSeasons(input.db, input.seasonEndDate, input.seed);
  processExternalContinentalContexts(input.db, input.seasonEndDate, input.seed);
  const refillDomesticStaff = claimForeignCycle(input.db, {
    seasonLabel: input.seasonEndDate.slice(0, 4),
    kind: "FOREIGN_WORLD_DOMESTIC_STAFF_REFILL",
    contextKey: "domestic-ai-staff",
    date: input.seasonEndDate,
  });
  synchronizeExternalPlayerContexts(input.db, input.seasonEndDate);
  advanceExternalPlayerLifecycles(input.db, {
    date: input.seasonEndDate,
    seed: input.seed,
  });
  const clubs = input.db
    .prepare(
      `SELECT c.id AS club_id, c.country_id, t.id AS team_id
       FROM clubs c JOIN teams t ON t.club_id = c.id AND t.level = 'senior'
       WHERE c.canonical_external_id LIKE 'SIM-FOREIGN-%'
       ORDER BY c.id`,
    )
    .all() as Array<{ club_id: EntityId; country_id: EntityId; team_id: EntityId }>;
  for (const club of clubs) {
    const year = input.seasonEndDate.slice(0, 4);
    const players = foreignSquadSize(input.db, club.club_id, club.team_id);
    /*
     * One replenishment cycle per club per season. Re-entering the same season
     * is a no-op, while a later season is a genuinely new cycle with its own
     * cohort key — so a 2031 replacement can never collide with, or be mistaken
     * for, the club's founding intake.
     */
    if (
      players < FOREIGN_SQUAD_FLOOR &&
      claimForeignCycle(input.db, {
        seasonLabel: year,
        kind: FOREIGN_REPLENISHMENT_KIND,
        contextKey: club.club_id,
        date: input.seasonEndDate,
      })
    ) {
      generateYouthCohort({
        db: input.db,
        countryId: club.country_id,
        clubId: club.club_id,
        teamId: club.team_id,
        date: input.seasonEndDate,
        seasonLabel: year,
        seed: `${input.seed}:foreign:${club.club_id}:${year}`,
        count: Math.min(FOREIGN_SQUAD_FLOOR - players, FOREIGN_REPLENISHMENT_BATCH),
        cohortKey: `foreign-replenishment-${year}`,
      });
    }
    seedForeignStaff(input.db, club.country_id, club.club_id, input.seasonEndDate, input.seed);
    ensureExternalStaffVacancies(input.db, club.club_id, FOREIGN_ROLES, input.seasonEndDate);
  }
  evaluateAllStaffContracts(input.db, staffSave);
  processExternalStaffVacancies(input.db, staffSave);
  // If an external move vacated a Nepal support role, the normal domestic AI
  // refill runs on the same seasonal cadence rather than leaving it empty.
  if (refillDomesticStaff) ensureAiStaffAssigned(input.db, staffSave, undefined);
  updateForeignScoutingInterest(input.db, { date: input.seasonEndDate, seed: input.seed });
  considerForeignInternationalTrials(input.db, {
    worldDate: input.seasonEndDate,
    seed: `${input.seed}:foreign-trials`,
    maxCandidates: 2,
  });
};

/**
 * Makes the deliberately light external world continuous without fabricating
 * foreign fixtures.  Every active player attached to a context-only club gets
 * the same persisted attributes, potential and development-state model used
 * by the playable world; retired players are reconciled from the canonical
 * person role exactly once.  The small monthly steps preserve a visible
 * youth-to-prime-to-decline curve while keeping the external layer bounded.
 */
export const advanceExternalPlayerLifecycles = (
  db: GameDatabase,
  input: { date: string; seed: string },
): { developed: number; retired: number } => {
  const contexts = new GlobalFootballContextRepository(db);
  const players = new PlayerRepository(db);
  const clubs = new Map(contexts.clubs().map((club) => [club.clubId, club]));
  let developed = 0;
  let retired = 0;

  for (const context of contexts.players()) {
    const role = db
      .prepare("SELECT active_to FROM person_roles WHERE person_id = ? AND role = 'PLAYER' ORDER BY active_from DESC LIMIT 1")
      .get(context.playerId) as { active_to?: string | null } | undefined;
    if (role?.active_to && role.active_to <= input.date) {
      if (context.careerState !== "RETIRED") retired += 1;
      contexts.upsertPlayer({
        ...context,
        clubId: undefined,
        careerState: "RETIRED",
        availableOn: undefined,
        updatedOn: input.date,
      });
      continue;
    }
    if (!role) continue;
    /*
     * One advance per player per season. Development and the reputation blend
     * are both relative to current state, so calling this twice for the same
     * date moved every player a second time — a resumed or replayed season
     * would quietly compound it. Retirement above is reconciled from the
     * person role and is already idempotent, so it stays outside this guard.
     */
    if (context.updatedOn >= input.date) continue;

    const activeClubId = activeClubForPlayer(db, context.playerId);
    const currentContext = {
      ...context,
      clubId: activeClubId,
      careerState: activeClubId ? ("ACTIVE" as const) : ("FREE_AGENT" as const),
      availableOn: activeClubId ? undefined : context.availableOn ?? input.date,
    };

    const person = new WorldRepository(db).getPerson(context.playerId);
    let attributes = players.getAttributes(context.playerId);
    if (!attributes && person) {
      // Imported external records intentionally retain factual identity and
      // provenance.  This creates only their missing simulation adjunct, using
      // the canonical generated-profile calibration rather than inventing a
      // parallel rating model.
      const generated = generateSimulationPlayerProfile(
        {
          playerKey: context.playerId,
          clubKey: currentContext.clubId ?? "external-free-agent",
          fullName: person.fullName,
          dateOfBirth: person.dateOfBirth,
          age: person.dateOfBirth ? ageOn(person.dateOfBirth, input.date) : undefined,
        },
        `${input.seed}:external-imported-profile`,
      );
      attributes = {
        ...generated.attributes,
        id: createStableEntityId("external-player-attribute", context.playerId),
        personId: context.playerId,
      };
      players.insertAttributes(attributes);
      players.insertPotential({
        ...generated.hiddenTraits,
        id: createStableEntityId("external-player-potential", context.playerId),
        playerId: context.playerId,
      });
    }
    if (!attributes) continue;
    const age = person?.dateOfBirth ? ageOn(person.dateOfBirth, input.date) : 24;
    let state = players.developmentState(context.playerId) ?? createInitialDevelopmentState(attributes, age, input.date);
    let potential = players.potential(context.playerId);
    if (!potential) {
      const ability = averageAttributes(attributes);
      const rng = new SeededRandom(`${input.seed}:external-potential:${context.playerId}`);
      potential = {
        id: createStableEntityId("external-player-potential", context.playerId),
        playerId: context.playerId,
        potentialCeiling: round(clamp(ability + 1.5 + rng.next() * 4.5, ability, 20)),
        developmentRate: round(0.7 + rng.next() * 0.7),
        volatility: round(0.45 + rng.next() * 0.65),
        professionalism: round(0.65 + rng.next() * 0.65),
        status: "SIMULATION_ONLY",
      };
      players.insertPotential(potential);
    }

    let currentAttributes = attributes;
    let cursor = state.lastDevelopmentUpdate ?? input.date;
    while (cursor < input.date) {
      const nextDate = addDays(cursor, 28) > input.date ? input.date : addDays(cursor, 28);
      const club = currentContext.clubId ? clubs.get(currentContext.clubId) : undefined;
      const environment = club
        ? {
            trainingQuality: 0.82 + club.academyStrength / 500,
            coachingQuality: 0.86 + club.reputation / 550,
            facilitiesEffect: 0.84 + club.academyStrength / 600,
            moraleModifier: 0.96,
            competitionMultiplier: 0.93 + club.reputation / 900,
          }
        : { trainingQuality: 0.9, coachingQuality: 0.9, facilitiesEffect: 0.9, moraleModifier: 0.94, competitionMultiplier: 0.92 };
      const result = updatePlayerDevelopment({
        attributes: currentAttributes,
        state,
        potential,
        age: person?.dateOfBirth ? ageOn(person.dateOfBirth, nextDate) : age,
        date: nextDate,
        seed: `${input.seed}:external-lifecycle`,
        historyScope: `external:${context.playerId}`,
        environment,
        periodDays: 28,
      });
      currentAttributes = result.updatedAttributes;
      state = result.updatedState;
      players.upsertAttributes(currentAttributes);
      players.upsertDevelopmentState(state);
      for (const event of result.historyEvents) players.insertTrainingHistoryEvent(event);
      cursor = nextDate;
    }
    const clubReputation = currentContext.clubId ? clubs.get(currentContext.clubId)?.reputation ?? 35 : 20;
    const abilityReputation = averageAttributes(currentAttributes) * 6;
    contexts.upsertPlayer({
      ...currentContext,
      reputation: round(clamp(context.reputation * 0.55 + abilityReputation * 0.3 + clubReputation * 0.15, 0, 100)),
      updatedOn: input.date,
    });
    if (shouldRetireExternalPlayer({ playerId: context.playerId, age, position: attributes.primaryPosition, date: input.date, seed: input.seed })) {
      retireExternalPlayer(db, context, input.date);
      retired += 1;
      continue;
    }
    if (cursor === input.date && state.lastDevelopmentUpdate === input.date) developed += 1;
  }
  return { developed, retired };
};

const activeClubForPlayer = (db: GameDatabase, playerId: EntityId): EntityId | undefined => {
  const assignment = db
    .prepare(
      `SELECT t.club_id AS club_id FROM team_person_assignments a
       JOIN teams t ON t.id = a.team_id
       WHERE a.person_id = ? AND a.role = 'PLAYER' AND a.ended_on IS NULL
       ORDER BY a.started_on DESC LIMIT 1`,
    )
    .get(playerId) as { club_id?: EntityId } | undefined;
  if (assignment?.club_id) return assignment.club_id;
  return (db
    .prepare("SELECT club_id FROM player_contracts WHERE player_id = ? AND status = 'ACTIVE' ORDER BY start_date DESC LIMIT 1")
    .get(playerId) as { club_id?: EntityId } | undefined)?.club_id;
};

const shouldRetireExternalPlayer = (input: {
  playerId: EntityId;
  age: number;
  position: string;
  date: string;
  seed: string;
}): boolean => {
  if (input.age < 31) return false;
  const threshold = input.position === "GK" ? 35 : 32;
  const probability = clamp((input.age - threshold + 1) * 0.18, 0, 0.88);
  return new SeededRandom(`${input.seed}:external-retirement:${input.playerId}:${input.date}`).next() < probability;
};

const retireExternalPlayer = (
  db: GameDatabase,
  context: ReturnType<GlobalFootballContextRepository["players"]>[number],
  date: string,
): void => {
  db.prepare(
    "UPDATE person_roles SET active_to = ? WHERE person_id = ? AND role = 'PLAYER' AND active_to IS NULL",
  ).run(date, context.playerId);
  db.prepare("UPDATE team_person_assignments SET ended_on = ? WHERE person_id = ? AND ended_on IS NULL").run(date, context.playerId);
  db.prepare("UPDATE player_contracts SET status = 'TERMINATED' WHERE player_id = ? AND status = 'ACTIVE'").run(context.playerId);
  new GlobalFootballContextRepository(db).upsertPlayer({
    ...context,
    clubId: undefined,
    careerState: "RETIRED",
    availableOn: undefined,
    updatedOn: date,
  });
};

/** Registers all current context-club players before lifecycle processing. */
const synchronizeExternalPlayerContexts = (db: GameDatabase, date: string): void => {
  const contexts = new GlobalFootballContextRepository(db);
  const clubs = new Map(contexts.clubs().map((club) => [club.clubId, club]));
  const assigned = db
    .prepare(
      `SELECT person_id AS player_id, club_id FROM (
         SELECT a.person_id, t.club_id
         FROM team_person_assignments a
         JOIN teams t ON t.id = a.team_id
         WHERE a.role = 'PLAYER' AND a.ended_on IS NULL
         UNION
         SELECT player_id AS person_id, club_id
         FROM player_contracts
         WHERE status = 'ACTIVE'
       )`,
    )
    .all() as Array<{ player_id: EntityId; club_id: EntityId }>;
  const known = new Map(contexts.players().map((player) => [player.playerId, player]));
  const players = new PlayerRepository(db);
  const world = new WorldRepository(db);
  for (const player of assigned) {
    const club = clubs.get(player.club_id);
    if (!club) continue;
    const current = known.get(player.player_id);
    contexts.upsertPlayer({
      playerId: player.player_id,
      clubId: player.club_id,
      region: current?.region ?? club.recruitmentRegions[0] ?? "WIDER_ASIA",
      /* An already-registered player keeps the standing they have earned; only
       * a first registration is initialized. */
      reputation:
        current?.reputation ??
        startingReputationFor(db, players, world, player.player_id, club.reputation, date),
      interestLevel: current?.interestLevel ?? "UNKNOWN",
      careerState: "ACTIVE",
      updatedOn: date,
    });
  }
};

/**
 * Standing a newly registered external player starts with.
 *
 * Registration previously copied the club's reputation onto the player, so
 * every fifteen-year-old at a strong context club began as famous as the club
 * itself — above the world median before kicking a ball, with nothing left to
 * earn.
 *
 * Reputation is now the player's own: ability carries it, career stage damps it
 * so a teenager starts obscure, and the club contributes a bounded share of
 * visibility rather than the whole value. A prospect at a famous club is better
 * known than the same prospect at a modest one, and an exceptional player at a
 * modest club still outranks their peers.
 */
const CLUB_VISIBILITY_SHARE = 0.2;

export const initialExternalPlayerReputation = (input: {
  ability: number;
  age: number;
  clubReputation: number;
  seedKey: string;
}): number => {
  const quality = Math.max(0, input.ability) * 5;
  /* Recognition arrives with a career, not with a birthday: a 15-year-old
   * carries a third of what ability alone would suggest, reaching full weight
   * in the mid-twenties. */
  const careerStage = Math.max(0.35, Math.min(1, (input.age - 14) / 10));
  const clubVisibility = Math.max(0, input.clubReputation) * CLUB_VISIBILITY_SHARE;
  const variance = (new SeededRandom(`external-reputation:${input.seedKey}`).next() - 0.5) * 4;
  return round(clamp(quality * careerStage + clubVisibility + variance, 5, 95));
};

/** Resolves a player's own ability and age, then asks the initializer. */
const startingReputationFor = (
  db: GameDatabase,
  players: PlayerRepository,
  world: WorldRepository,
  playerId: EntityId,
  clubReputation: number,
  date: string,
): number => {
  const attributes = players.getAttributes(playerId);
  const person = world.getPerson(playerId);
  return initialExternalPlayerReputation({
    ability: attributes ? averageAttributes(attributes) : 7,
    age: person?.dateOfBirth ? ageOn(person.dateOfBirth, date) : 24,
    clubReputation,
    seedKey: playerId,
  });
};

const averageAttributes = (attributes: NonNullable<ReturnType<PlayerRepository["getAttributes"]>>): number => {
  const values = [
    ...Object.values(attributes.technical),
    ...Object.values(attributes.mental),
    ...Object.values(attributes.physical),
    ...(attributes.primaryPosition === "GK" ? Object.values(attributes.goalkeeping) : []),
  ];
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const round = (value: number): number => Math.round(value * 100) / 100;
const addDays = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const ageOn = (dateOfBirth: string, date: string): number => {
  const birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  const on = new Date(`${date}T00:00:00.000Z`);
  let age = on.getUTCFullYear() - birth.getUTCFullYear();
  if (on.getUTCMonth() < birth.getUTCMonth() || (on.getUTCMonth() === birth.getUTCMonth() && on.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
};

/** Runs a coarse external league update: one seeded table outcome per league, no fixtures or match events. */
export const initializeExternalLeagueSeasons = (db: GameDatabase, seasonEndDate: string, seed: string): void => {
  const year = seasonEndDate.slice(0, 4);
  const contexts = new GlobalFootballContextRepository(db);
  const leagues = contexts.leagues();
  const clubsByLeague = new Map<EntityId, ReturnType<GlobalFootballContextRepository["clubs"]>>();
  for (const club of contexts.clubs()) clubsByLeague.set(club.leagueId, [...(clubsByLeague.get(club.leagueId) ?? []), club]);
  const completedSeasons = new Set(contexts.seasons().filter((season) => season.seasonLabel === year).map((season) => season.leagueId));
  for (const league of leagues) {
    if (completedSeasons.has(league.leagueId)) continue;
    const clubs = (clubsByLeague.get(league.leagueId) ?? []).sort((a, b) => a.clubId.localeCompare(b.clubId));
    if (clubs.length === 0) continue;
    const rng = new SeededRandom(`${seed}:external-league:${league.leagueId}:${year}`);
    const ordered = [...clubs].sort((a, b) => (b.reputation + rng.next() * 8) - (a.reputation + rng.next() * 8) || a.clubId.localeCompare(b.clubId));
    contexts.upsertSeason({ id: createStableEntityId("external-league-season", `${league.leagueId}:${year}`), leagueId: league.leagueId, seasonLabel: year, championClubId: ordered[0]?.clubId, continentalQualifierClubIds: ordered.slice(0, 2).map((club) => club.clubId), relegatedClubIds: ordered.length > 2 ? ordered.slice(-1).map((club) => club.clubId) : [], completedOn: seasonEndDate, status: "COMPLETED", provenanceStatus: "SIMULATION_ONLY" });
    for (const club of clubs) {
      const movement = club.clubId === ordered[0]?.clubId ? 0.6 : club.clubId === ordered.at(-1)?.clubId ? -0.4 : 0.1;
      contexts.upsertClub({ ...club, reputation: Math.max(0, Math.min(100, club.reputation + movement)) });
    }
  }
};

/**
 * One deterministic continental context outcome per confederation/season.
 * Participants come only from persisted domestic qualifier slots: no foreign
 * fixtures, lineups or match events are created.  Historical events are the
 * durable result key, so reopening a save cannot reroll reputation awards.
 */
export const processExternalContinentalContexts = (db: GameDatabase, date: string, seed: string): void => {
  const contexts = new GlobalFootballContextRepository(db);
  const year = date.slice(0, 4);
  const federationById = new Map(contexts.federations().map((federation) => [federation.federationId, federation]));
  const clubById = new Map(contexts.clubs().map((club) => [club.clubId, club]));
  const qualifiers = new Map<string, EntityId[]>();
  for (const season of contexts.seasons().filter((season) => season.seasonLabel === year)) {
    const league = contexts.leagues().find((item) => item.leagueId === season.leagueId);
    const federation = league ? federationById.get(league.federationId) : undefined;
    if (!league?.continentalQualification || !federation) continue;
    const bucket = qualifiers.get(federation.confederation) ?? [];
    bucket.push(...season.continentalQualifierClubIds);
    qualifiers.set(federation.confederation, bucket);
  }
  const events = new EventRepository(db);
  for (const [confederation, ids] of qualifiers) {
    const participants = [...new Set(ids)].filter((id) => clubById.has(id)).sort();
    if (participants.length < 2) continue;
    const eventId = createStableEntityId("history", `EXTERNAL_CONTINENTAL_CONTEXT:${confederation}:${year}`);
    if (db.prepare("SELECT 1 FROM historical_events WHERE id = ?").get(eventId)) continue;
    const rng = new SeededRandom(`${seed}:external-continental:${confederation}:${year}`);
    const ordered = [...participants].sort((a, b) => {
      const left = clubById.get(a)!, right = clubById.get(b)!;
      return (right.reputation + rng.next() * 5) - (left.reputation + rng.next() * 5) || a.localeCompare(b);
    });
    const champion = ordered[0]!;
    const runnerUp = ordered[1];
    for (const clubId of ordered) {
      const club = clubById.get(clubId)!;
      const delta = clubId === champion ? 2.4 : clubId === runnerUp ? 0.9 : 0.2;
      contexts.upsertClub({ ...club, reputation: round(clamp(club.reputation + delta, 0, 100)) });
      for (const player of contexts.players().filter((player) => player.clubId === clubId && player.careerState === "ACTIVE")) {
        contexts.upsertPlayer({ ...player, reputation: round(clamp(player.reputation + (clubId === champion ? 0.7 : 0.15), 0, 100)), updatedOn: date });
      }
    }
    events.insertHistoricalEvent({ id: eventId, occurredOn: date, eventType: "EXTERNAL_CONTINENTAL_CONTEXT", involvedEntities: [
      { id: champion, type: "club" }, ...(runnerUp ? [{ id: runnerUp, type: "club" as const }] : []),
    ], title: `${confederation} context champion`, data: { season: year, confederation, championClubId: champion, runnerUpClubId: runnerUp, participantClubIds: ordered }, importance: "medium", scope: "world" });
  }
};

/** Records bounded foreign-club awareness of high-signal Nepal players without exposing hidden ability. */
export const updateForeignScoutingInterest = (db: GameDatabase, input: { date: string; seed: string }): void => {
  const contexts = new GlobalFootballContextRepository(db);
  const knownPlayers = new Map(contexts.players().map((player) => [player.playerId, player]));
  const foreignPlayers = db.prepare(`SELECT DISTINCT a.person_id AS player_id, c.id AS club_id FROM team_person_assignments a JOIN teams t ON t.id = a.team_id JOIN clubs c ON c.id = t.club_id WHERE a.role = 'PLAYER' AND a.ended_on IS NULL AND c.canonical_external_id LIKE 'SIM-FOREIGN-%'`).all() as Array<{ player_id: EntityId; club_id: EntityId }>;
  for (const player of foreignPlayers) {
    const club = contexts.clubs().find((item) => item.clubId === player.club_id);
    const existing = knownPlayers.get(player.player_id);
    if (club) contexts.upsertPlayer({ playerId: player.player_id, clubId: player.club_id, region: existing?.region ?? club.recruitmentRegions[0] ?? "WIDER_ASIA", reputation: existing?.reputation ?? startingReputationFor(db, new PlayerRepository(db), new WorldRepository(db), player.player_id, club.reputation, input.date), interestLevel: existing?.interestLevel ?? "UNKNOWN", careerState: "ACTIVE", updatedOn: input.date });
  }
  const targets = db.prepare(`SELECT p.player_id AS player_id, p.current_club_id AS club_id FROM player_factual_profiles p JOIN clubs c ON c.id = p.current_club_id JOIN countries country ON country.id = c.country_id WHERE country.iso_code IN ('NPL','NP') ORDER BY p.player_id LIMIT 12`).all() as Array<{ player_id: EntityId; club_id: EntityId }>;
  for (const club of contexts.clubs().filter((item) => item.scoutingReach >= 40)) {
    for (const target of targets.slice(0, club.scoutingReach >= 60 ? 2 : 1)) {
      const score = Math.max(0, Math.min(100, club.scoutingReach * 0.45 + 35));
      contexts.upsertInterest({ id: createStableEntityId("foreign-scouting-interest", `${club.clubId}:${target.player_id}`), externalClubId: club.clubId, targetPlayerId: target.player_id, level: score >= 60 ? "INTERESTED" : "MONITORING", score, firstObservedOn: input.date, lastObservedOn: input.date, provenanceStatus: "SIMULATION_ONLY" });
    }
  }
};

export const evaluateForeignRecruitmentCorridor = (input: { sourceRegion: string; destinationRegion: string; playerReputation: number; clubReputation: number; scoutingReach: number; partnershipStrength?: number }): { eligible: boolean; score: number; corridor: "AFRICA_TO_NEPAL" | "SOUTH_ASIA_REGIONAL" | "NEPAL_TO_ASIA" | "GENERAL" } => {
  const regional = input.sourceRegion === "AFRICA" && input.destinationRegion === "NEPAL" ? 16 : input.sourceRegion === "SOUTH_ASIA" || input.destinationRegion === "SOUTH_ASIA" ? 12 : 0;
  const score = Math.max(0, Math.min(100, input.playerReputation * 0.35 + input.clubReputation * 0.25 + input.scoutingReach * 0.25 + (input.partnershipStrength ?? 0) * 0.15 + regional));
  const corridor = input.sourceRegion === "AFRICA" && input.destinationRegion === "NEPAL" ? "AFRICA_TO_NEPAL" : input.sourceRegion === "SOUTH_ASIA" || input.destinationRegion === "SOUTH_ASIA" ? "SOUTH_ASIA_REGIONAL" : input.destinationRegion === "WIDER_ASIA" ? "NEPAL_TO_ASIA" : "GENERAL";
  return { eligible: score >= 45, score, corridor };
};

const seedForeignStaff = (
  db: GameDatabase,
  countryId: EntityId,
  clubId: EntityId,
  date: string,
  seed: string,
): void => {
  const world = new WorldRepository(db);
  for (const role of FOREIGN_ROLES) {
    const key = `${seed}:foreign-staff:${clubId}:${role}`;
    const generated = generateAiStaff(key, date, countryId, role);
    if (!world.getPerson(generated.person.id)) {
      world.insertPerson(generated.person);
      world.insertPersonRole({
        id: createStableEntityId("person-role", `${generated.person.id}:${role}`),
        personId: generated.person.id,
        role: "STAFF",
        activeFrom: date,
      });
      world.insertStaffProfile(generated.profile);
      world.insertStaffSimulationProfile(generated.simulation);
      for (const licence of generated.licences) world.insertStaffLicence(licence);
    }
  }
};

const countryIdFor = (db: GameDatabase, isoCode: string, name: string): EntityId => {
  const existing = db
    .prepare("SELECT id FROM countries WHERE iso_code = ? LIMIT 1")
    .get(isoCode) as { id: EntityId } | undefined;
  if (existing) return existing.id;
  const id = createStableEntityId("country", isoCode);
  new WorldRepository(db).insertCountry({ id, name, isoCode });
  return id;
};
