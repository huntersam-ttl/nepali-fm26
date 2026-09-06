import type { CareerRole, EntityId, PlayerPathway, PlayerPathwayStage } from "@nepal-football-sim/shared-types";
import { FederationGovernanceRepository, type GameDatabase } from "@nepal-football-sim/database";
import { buildEntityReference } from "./entity-reference.js";

/** Real pathway order for men's football; Women & Girls is tracked as its
 * own separate programme (never a renamed men's flow) since the women's
 * senior team and any girls' youth teams are entirely distinct team rows. */
const LEVEL_ORDER: Record<string, number> = { u17: 0, u20: 1, u23: 2, senior: 3 };

/**
 * A per-player national-team pathway timeline, built entirely from real
 * call-up and appearance history (NationalTeamCallup/NationalTeamAppearance)
 * — never a fabricated selection guarantee. Women & Girls call-ups form
 * their own stage sequence, distinct from the men's youth-to-senior order.
 */
export const buildPlayerPathway = (db: GameDatabase, playerId: EntityId, role: CareerRole): PlayerPathway | undefined => {
  const governance = new FederationGovernanceRepository(db);
  const callups = governance.nationalTeamCallups().filter((callup) => callup.playerId === playerId);
  if (callups.length === 0) return undefined;
  const appearances = governance.nationalTeamAppearances().filter((appearance) => appearance.playerId === playerId);
  const teamIds = [...new Set(callups.map((callup) => callup.nationalTeamId))];
  const teams = teamIds.map((teamId) => {
    const team = db.prepare("SELECT id, name, level, gender FROM teams WHERE id=?").get(teamId) as
      | { id: EntityId; name: string; level: string; gender: string }
      | undefined;
    return team;
  }).filter((team): team is NonNullable<typeof team> => Boolean(team));
  const stages: PlayerPathwayStage[] = teams
    .map((team) => {
      const teamCallups = callups
        .filter((callup) => callup.nationalTeamId === team.id)
        .sort((a, b) => a.callupDate.localeCompare(b.callupDate));
      const teamAppearances = appearances.filter((appearance) => appearance.nationalTeamId === team.id);
      return {
        team: buildEntityReference(db, "NATIONAL_TEAM", team.id, role),
        level: team.level,
        gender: team.gender,
        programme: team.gender === "women" ? ("WOMENS_GIRLS" as const) : team.level === "senior" ? ("SENIOR_MENS" as const) : ("YOUTH" as const),
        firstCallup: teamCallups[0]!.callupDate,
        lastCallup: teamCallups[teamCallups.length - 1]!.callupDate,
        appearances: teamAppearances.length,
        firstAppearance: [...teamAppearances].sort((a, b) => a.matchDate.localeCompare(b.matchDate))[0]?.matchDate,
      };
    })
    .sort((a, b) => a.firstCallup.localeCompare(b.firstCallup));
  const menStages = stages.filter((stage) => stage.gender !== "women");
  const womenStages = stages.filter((stage) => stage.gender === "women");
  const currentStage = [...stages].sort((a, b) => b.lastCallup.localeCompare(a.lastCallup))[0];
  const highestMenLevel = menStages.reduce<string | undefined>(
    (highest, stage) => (!highest || (LEVEL_ORDER[stage.level] ?? -1) > (LEVEL_ORDER[highest] ?? -1) ? stage.level : highest),
    undefined,
  );
  const nextPlausibleStage =
    womenStages.length > 0
      ? undefined // Women & Girls pathway has no further defined stage beyond senior in this model.
      : highestMenLevel && highestMenLevel !== "senior"
        ? Object.keys(LEVEL_ORDER).find((level) => LEVEL_ORDER[level] === (LEVEL_ORDER[highestMenLevel] ?? 0) + 1)
        : undefined;
  return {
    playerId,
    stages,
    currentStage: currentStage ? `${currentStage.team.label}` : undefined,
    nextPlausibleStage,
    provenanceStatus: "SIMULATION_ONLY",
  };
};
