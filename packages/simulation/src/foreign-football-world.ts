import {
  createStableEntityId,
  type EntityId,
  type FootballStaffRole,
} from "@nepal-football-sim/shared-types";
import {
  WorkforceSupplyRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { generateAiStaff } from "./staff-market.js";
import { initializeTransferMarketForSave } from "./transfer-market.js";
import { generateYouthCohort } from "./youth-intake.js";

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
  const foreignClubs: Array<{ clubId: EntityId; teamId: EntityId; countryId: EntityId }> = [];

  for (const [isoCode, countryName] of FOREIGN_MARKETS) {
    const countryId = countryIdFor(input.db, isoCode, countryName);
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
    foreignClubs.push({ clubId: club.id, teamId: team.id, countryId });
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
