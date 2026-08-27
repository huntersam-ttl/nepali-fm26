import {
  createStableEntityId,
  type EntityId,
  type FootballStaffRole,
} from "@nepal-football-sim/shared-types";
import { WorldRepository, type GameDatabase } from "@nepal-football-sim/database";
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
    const playerCount = Number(
      (input.db
        .prepare(
          `SELECT COUNT(*) AS count FROM team_person_assignments
           WHERE team_id = ? AND role = 'PLAYER' AND ended_on IS NULL`,
        )
        .get(club.teamId) as { count: number } | undefined)?.count ?? 0,
    );
    if (playerCount < 12) {
      generateYouthCohort({
        db: input.db,
        countryId: club.countryId,
        clubId: club.clubId,
        teamId: club.teamId,
        date: input.worldDate,
        seasonLabel: input.worldDate.slice(0, 4),
        seed: `${input.seed}:foreign:${club.clubId}:initial`,
        count: Math.min(12 - playerCount, 12),
        cohortKey: "foreign-market",
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
    const players = Number(
      (input.db
        .prepare(
          `SELECT COUNT(*) AS count FROM team_person_assignments
           WHERE team_id = ? AND role = 'PLAYER' AND ended_on IS NULL`,
        )
        .get(club.team_id) as { count: number } | undefined)?.count ?? 0,
    );
    if (players < 16) {
      generateYouthCohort({
        db: input.db,
        countryId: club.country_id,
        clubId: club.club_id,
        teamId: club.team_id,
        date: input.seasonEndDate,
        seasonLabel: year,
        seed: `${input.seed}:foreign:${club.club_id}:${year}`,
        count: Math.min(16 - players, 3),
        cohortKey: "foreign-market",
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
  const existing = db.prepare("SELECT id FROM countries WHERE iso_code = ? LIMIT 1").get(isoCode) as
    | { id: EntityId }
    | undefined;
  if (existing) return existing.id;
  const id = createStableEntityId("country", isoCode);
  new WorldRepository(db).insertCountry({ id, name, isoCode });
  return id;
};
