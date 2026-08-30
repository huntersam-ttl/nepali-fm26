import {
  RefereeAssignmentRepository,
  WorkforceSupplyRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type EntityId,
  type FixtureOfficialAssignment,
  type FixtureRecord,
  type OfficialSimulationProfile,
} from "@nepal-football-sim/shared-types";
import { initializeWorkforceSupplyForSave } from "./workforce-supply.js";

export type RefereeAssignmentOptions = {
  seed?: string;
  competitionLevel?: string;
  usesVar?: boolean;
};

type Candidate = OfficialSimulationProfile & { eligible: boolean };

const jsonArray = (value: unknown): string[] => {
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const usedOnDate = (db: GameDatabase, date: string): Set<string> => {
  const rows = db
    .prepare(
      `
    SELECT referee_person_id, assistant_referee_1_person_id, assistant_referee_2_person_id,
           fourth_official_person_id, var_person_id
    FROM fixture_official_assignments
    WHERE assigned_on = ? AND status = 'ASSIGNED'
  `,
    )
    .all(date) as any[];
  return new Set(
    rows.flatMap((row) =>
      [
        row.referee_person_id,
        row.assistant_referee_1_person_id,
        row.assistant_referee_2_person_id,
        row.fourth_official_person_id,
        row.var_person_id,
      ].filter(Boolean),
    ),
  );
};

/*
 * Officials are filtered per role and there are five roles per fixture, so a
 * statement compiled inside this loop is compiled once per official per role per
 * fixture — hundreds of thousands of times across a season. The profile lookup is
 * one query for the whole role instead of one per official, the conflict check is
 * compiled once and reused, and it runs last because it is the only test that
 * still touches the database per candidate. The predicate is a conjunction, so
 * reordering it changes cost and not which officials qualify.
 */
const candidatesFor = (
  db: GameDatabase,
  fixture: FixtureRecord,
  role: OfficialSimulationProfile["role"],
  used: Set<string>,
): Candidate[] => {
  const workforce = new WorkforceSupplyRepository(db);
  const officials = workforce.activeOfficials(role);
  if (officials.length === 0) return [];
  const profiles = new Map<string, any>();
  for (const row of db
    .prepare("SELECT * FROM referee_profiles WHERE primary_role = ?")
    .all(role) as any[]) {
    profiles.set(`${row.id}:${row.person_id}`, row);
  }
  const conflict = db.prepare(
    `
    SELECT 1 FROM team_person_assignments
    WHERE person_id = ? AND team_id IN (?, ?)
      AND (ended_on IS NULL OR ended_on >= ?)
      AND (started_on IS NULL OR started_on <= ?)
    LIMIT 1
  `,
  );
  return officials
    .filter((official) => {
      if (used.has(official.personId)) return false;
      const profile = profiles.get(`${official.refereeProfileId}:${official.personId}`);
      if (!profile) return false;
      const eligible = jsonArray(profile.competitions_eligible_json);
      if (eligible.length > 0 && !eligible.includes(fixture.competitionSeasonId ?? "")) return false;
      return !conflict.get(
        official.personId,
        fixture.homeTeamId,
        fixture.awayTeamId,
        fixture.scheduledDate,
        fixture.scheduledDate,
      );
    })
    .map((official) => ({ ...official, eligible: true }));
};

const choose = (pool: Candidate[]): Candidate | undefined =>
  [...pool].sort(
    (a, b) =>
      a.level - b.level ||
      b.quality - a.quality ||
      b.fitness - a.fitness ||
      b.experience - a.experience ||
      a.personId.localeCompare(b.personId),
  )[0];

const failed = (
  fixture: FixtureRecord,
  reason: string,
  options: RefereeAssignmentOptions,
): FixtureOfficialAssignment => ({
  id: createStableEntityId("fixture-official-assignment", fixture.id),
  fixtureId: fixture.id,
  assignedOn: fixture.scheduledDate,
  status: "FAILED",
  competitionLevel: options.competitionLevel,
  failureReason: reason,
  provenanceStatus: "SIMULATION_ONLY",
});

/** Resolve and persist the only officiating assignment for a fixture. */
export const assignOfficialsToFixture = (
  db: GameDatabase,
  fixture: FixtureRecord,
  options: RefereeAssignmentOptions = {},
): FixtureOfficialAssignment => {
  const repository = new RefereeAssignmentRepository(db);
  const existing = repository.forFixture(fixture.id);
  if (existing?.status === "ASSIGNED") return existing;

  // The existing workforce bootstrap is idempotent and supplies imported saves
  // that predate officiating population generation.
  initializeWorkforceSupplyForSave({
    db,
    worldDate: fixture.scheduledDate,
    seed: options.seed ?? fixture.id,
  });
  const used = usedOnDate(db, fixture.scheduledDate);
  const referee = choose(candidatesFor(db, fixture, "REFEREE", used));
  if (!referee) {
    const result = failed(fixture, "No eligible referee is available.", options);
    repository.upsert(result);
    return result;
  }
  used.add(referee.personId);
  const assistant1 = choose(candidatesFor(db, fixture, "ASSISTANT_REFEREE", used));
  if (!assistant1) {
    const result = failed(fixture, "Two eligible assistant referees are required.", options);
    repository.upsert(result);
    return result;
  }
  used.add(assistant1.personId);
  const assistant2 = choose(candidatesFor(db, fixture, "ASSISTANT_REFEREE", used));
  if (!assistant2) {
    const result = failed(fixture, "Two eligible assistant referees are required.", options);
    repository.upsert(result);
    return result;
  }
  used.add(assistant2.personId);
  const fourth = choose(candidatesFor(db, fixture, "FOURTH_OFFICIAL", used));
  if (fourth) used.add(fourth.personId);
  const video = options.usesVar
    ? choose(candidatesFor(db, fixture, "VAR_OFFICIAL", used))
    : undefined;
  if (options.usesVar && !video) {
    const result = failed(
      fixture,
      "VAR is configured but no eligible VAR official is available.",
      options,
    );
    repository.upsert(result);
    return result;
  }
  const result: FixtureOfficialAssignment = {
    id: createStableEntityId("fixture-official-assignment", fixture.id),
    fixtureId: fixture.id,
    refereePersonId: referee.personId,
    assistantReferee1PersonId: assistant1.personId,
    assistantReferee2PersonId: assistant2.personId,
    fourthOfficialPersonId: fourth?.personId,
    varPersonId: video?.personId,
    assignedOn: fixture.scheduledDate,
    status: "ASSIGNED",
    competitionLevel: options.competitionLevel,
    refereeQuality: referee.quality,
    provenanceStatus: "SIMULATION_ONLY",
  };
  repository.upsert(result);
  return result;
};

export const requireFixtureOfficials = (
  db: GameDatabase,
  fixture: FixtureRecord,
  options?: RefereeAssignmentOptions,
): FixtureOfficialAssignment => {
  const assignment = assignOfficialsToFixture(db, fixture, options);
  if (assignment.status !== "ASSIGNED") {
    throw new Error(
      `Fixture ${fixture.id} cannot start: ${assignment.failureReason ?? "official assignment failed"}`,
    );
  }
  return assignment;
};
