import {
  createStableEntityId,
  type EntityId,
  type FootballStaffRole,
} from "@nepal-football-sim/shared-types";
import {
  WorkforceSupplyRepository,
  GlobalFootballContextRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { generateAiStaff } from "./staff-market.js";
import { initializeTransferMarketForSave } from "./transfer-market.js";
import { generateYouthCohort } from "./youth-intake.js";
import { SeededRandom } from "./rng.js";

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
  }
};

export const processForeignFootballWorldSeason = (input: {
  db: GameDatabase;
  seasonEndDate: string;
  seed: string;
}): void => {
  initializeExternalLeagueSeasons(input.db, input.seasonEndDate, input.seed);
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
  }
  updateForeignScoutingInterest(input.db, { date: input.seasonEndDate, seed: input.seed });
};

/** Runs a coarse external league update: one seeded table outcome per league, no fixtures or match events. */
export const initializeExternalLeagueSeasons = (db: GameDatabase, seasonEndDate: string, seed: string): void => {
  const year = seasonEndDate.slice(0, 4);
  const contexts = new GlobalFootballContextRepository(db);
  for (const league of contexts.leagues()) {
    if (contexts.seasons(league.leagueId).some((season) => season.seasonLabel === year)) continue;
    const clubs = contexts.clubs().filter((club) => club.leagueId === league.leagueId).sort((a, b) => a.clubId.localeCompare(b.clubId));
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

/** Records bounded foreign-club awareness of high-signal Nepal players without exposing hidden ability. */
export const updateForeignScoutingInterest = (db: GameDatabase, input: { date: string; seed: string }): void => {
  const contexts = new GlobalFootballContextRepository(db);
  const foreignPlayers = db.prepare(`SELECT DISTINCT a.person_id AS player_id, c.id AS club_id FROM team_person_assignments a JOIN teams t ON t.id = a.team_id JOIN clubs c ON c.id = t.club_id WHERE a.role = 'PLAYER' AND a.ended_on IS NULL AND c.canonical_external_id LIKE 'SIM-FOREIGN-%'`).all() as Array<{ player_id: EntityId; club_id: EntityId }>;
  for (const player of foreignPlayers) {
    const club = contexts.clubs().find((item) => item.clubId === player.club_id);
    if (club) contexts.upsertPlayer({ playerId: player.player_id, clubId: player.club_id, region: club.recruitmentRegions[0] ?? "WIDER_ASIA", reputation: club.reputation, interestLevel: "UNKNOWN", careerState: "ACTIVE", updatedOn: input.date });
  }
  const targets = db.prepare(`SELECT p.player_id AS player_id, p.current_club_id AS club_id FROM player_factual_profiles p JOIN clubs c ON c.id = p.current_club_id WHERE c.canonical_external_id NOT LIKE 'SIM-FOREIGN-%' ORDER BY p.player_id LIMIT 12`).all() as Array<{ player_id: EntityId; club_id: EntityId }>;
  for (const club of contexts.clubs().filter((item) => item.scoutingReach >= 40)) {
    for (const target of targets.slice(0, club.scoutingReach >= 60 ? 2 : 1)) {
      const score = Math.max(0, Math.min(100, club.scoutingReach * 0.45 + 35));
      contexts.upsertInterest({ id: createStableEntityId("foreign-scouting-interest", `${club.clubId}:${target.player_id}`), externalClubId: club.clubId, targetPlayerId: target.player_id, level: score >= 70 ? "INTERESTED" : "MONITORING", score, firstObservedOn: input.date, lastObservedOn: input.date, provenanceStatus: "SIMULATION_ONLY" });
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
