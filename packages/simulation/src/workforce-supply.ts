import {
  createStableEntityId,
  type EntityId,
  type FootballStaffRole,
  type OfficialSimulationProfile,
  type Person,
  type PersonRole,
  type RefereeProfile,
  type WorkforceDemandLine,
  type WorkforceDemandSnapshot,
  type WorkforcePopulation,
  type WorkforceRoleCount,
  type LowerLeagueCoverageReport,
  type LowerLeagueClubCoverage,
  type WorldSustainabilityReport,
} from "@nepal-football-sim/shared-types";
import {
  StaffMarketRepository,
  WorkforceSupplyRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { SeededRandom } from "./rng.js";
import { generateYouthCohort } from "./youth-intake.js";
import { generateAiStaff } from "./staff-market.js";

/*
 * Long-term world regeneration and football workforce supply, Phase A.
 *
 * The world already knows how to generate youth players, retire people, turn
 * retired players into staff and repair squads at preseason. What it did not
 * have was a layer that asks "does the active world still have enough people
 * to function?" and produces a bounded, demand-driven correction. That is all
 * this module does - it owns no generator of its own beyond officials, and it
 * never manufactures money, reputation or ability.
 *
 * Every number here is deterministic from (save seed, world state, date).
 */

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
const count = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Squad slots a senior club structurally needs to fulfil a league season. */
const MEN_SQUAD_TARGET = 20;
const WOMEN_SQUAD_TARGET = 16;
/** Officials cannot work every fixture; this caps realistic season workload. */
const MAX_APPOINTMENTS_PER_OFFICIAL = 22;
const ASSISTANTS_PER_FIXTURE = 2;
/** Hard ceilings so a correction can never flood the world. */
const MAX_OFFICIAL_INTAKE_PER_SEASON = 24;
const MAX_STAFF_INTAKE_PER_SEASON = 30;
const MAX_PLAYER_CORRECTION_PER_SEASON = 60;

/** Core backroom roles a professional club is expected to carry. */
const CORE_STAFF_ROLES: FootballStaffRole[] = [
  "ASSISTANT_COACH",
  "GOALKEEPER_COACH",
  "FITNESS_COACH",
  "PHYSIO",
  "SCOUT",
  "YOUTH_COACH",
];

const lowerLeagueClubs = (db: GameDatabase): Array<{ clubId: EntityId; teamId: EntityId; division: "B" | "C" }> =>
  (db.prepare(`
    SELECT DISTINCT c.id AS club_id, t.id AS team_id,
      CASE WHEN lower(comp.name) LIKE '%b-division%' THEN 'B' ELSE 'C' END AS division
    FROM club_memberships cm
    JOIN clubs c ON c.id = cm.club_id
    JOIN competitions comp ON comp.id = cm.competition_id
    JOIN teams t ON t.id = COALESCE(cm.team_id, (SELECT id FROM teams t2 WHERE t2.club_id=c.id AND lower(t2.level)='senior' AND lower(t2.gender)='men' ORDER BY id LIMIT 1))
    WHERE cm.status='ACTIVE' AND (lower(comp.name) LIKE '%b-division%' OR lower(comp.name) LIKE '%c-division%')
    ORDER BY c.id
  `).all() as Array<{ club_id: EntityId; team_id: EntityId; division: "B" | "C" }>).map((row) => ({ clubId: row.club_id, teamId: row.team_id, division: row.division }));

// ---------------------------------------------------------------------------
// World counting helpers (indexed queries only - no per-day full scans)
// ---------------------------------------------------------------------------

const scalar = (db: GameDatabase, sql: string, ...params: unknown[]): number =>
  Number((db.prepare(sql).get(...(params as [])) as { n?: number } | undefined)?.n ?? 0);

const nepalCountryId = (db: GameDatabase): EntityId | undefined =>
  (
    db.prepare("SELECT id FROM countries WHERE iso_code = 'NPL' LIMIT 1").get() as
      { id?: EntityId } | undefined
  )?.id ??
  (
    db.prepare("SELECT id FROM countries ORDER BY id LIMIT 1").get() as
      { id?: EntityId } | undefined
  )?.id;

/**
 * Players are counted by gender presentation. Legacy imported people predate
 * the field, so an unset presentation on a men's-team player reads as male
 * rather than being silently dropped from demand.
 */
const activePlayerCount = (db: GameDatabase, gender: "male" | "female"): number =>
  gender === "female"
    ? scalar(
        db,
        `SELECT COUNT(*) n FROM person_roles pr JOIN persons p ON p.id = pr.person_id
         WHERE pr.role = 'PLAYER' AND pr.active_to IS NULL AND p.gender_presentation = 'female'`,
      )
    : scalar(
        db,
        `SELECT COUNT(*) n FROM person_roles pr JOIN persons p ON p.id = pr.person_id
         WHERE pr.role = 'PLAYER' AND pr.active_to IS NULL
           AND (p.gender_presentation IS NULL OR p.gender_presentation = 'male')`,
      );

const activeSeniorTeams = (db: GameDatabase, gender: "men" | "women"): number =>
  scalar(db, "SELECT COUNT(*) n FROM teams WHERE level = 'senior' AND gender = ?", gender);

const activeClubCount = (db: GameDatabase): number =>
  scalar(
    db,
    "SELECT COUNT(DISTINCT club_id) n FROM teams WHERE level = 'senior' AND gender = 'men' AND club_id IS NOT NULL",
  );

const scheduledFixtureCount = (db: GameDatabase, fromDate: string, toDate: string): number =>
  scalar(
    db,
    "SELECT COUNT(*) n FROM fixtures WHERE scheduled_date >= ? AND scheduled_date <= ?",
    fromDate,
    toDate,
  );

const scheduledFixturePeak = (db: GameDatabase, fromDate: string, toDate: string): number => {
  const rows = db
    .prepare("SELECT scheduled_date, COUNT(*) AS count FROM fixtures WHERE scheduled_date >= ? AND scheduled_date <= ? GROUP BY scheduled_date ORDER BY scheduled_date")
    .all(fromDate, toDate) as Array<{ count: number }>;
  return rows.reduce((peak, row) => Math.max(peak, Number(row.count ?? 0)), 0);
};

const ageOn = (dateOfBirth: string | undefined, onDate: string): number | undefined => {
  if (!dateOfBirth) return undefined;
  const birth = Date.parse(`${dateOfBirth}T00:00:00.000Z`);
  const now = Date.parse(`${onDate}T00:00:00.000Z`);
  if (!Number.isFinite(birth) || !Number.isFinite(now)) return undefined;
  return Math.floor((now - birth) / (365.25 * 24 * 60 * 60 * 1000));
};

/**
 * Forecast how many players will leave over the coming season. This mirrors
 * the retirement engine's shape (age pressure from the early thirties) without
 * duplicating its decision logic - it is a planning estimate, not a decision.
 */
const projectedPlayerExits = (
  db: GameDatabase,
  date: string,
  gender: "male" | "female",
): number => {
  const rows = db
    .prepare(
      gender === "female"
        ? `SELECT p.date_of_birth AS dob FROM person_roles pr JOIN persons p ON p.id = pr.person_id
           WHERE pr.role = 'PLAYER' AND pr.active_to IS NULL AND p.gender_presentation = 'female'`
        : `SELECT p.date_of_birth AS dob FROM person_roles pr JOIN persons p ON p.id = pr.person_id
           WHERE pr.role = 'PLAYER' AND pr.active_to IS NULL
             AND (p.gender_presentation IS NULL OR p.gender_presentation = 'male')`,
    )
    .all() as Array<{ dob?: string }>;
  let expected = 0;
  for (const row of rows) {
    const age = ageOn(row.dob ?? undefined, date);
    if (age === undefined || age < 31) continue;
    expected += clamp((age - 32) * 0.14 + 0.1, 0, 0.85);
  }
  return Math.round(expected);
};

// ---------------------------------------------------------------------------
// Demand model
// ---------------------------------------------------------------------------

const line = (
  population: WorkforcePopulation,
  segment: string,
  required: number,
  available: number,
  projectedExits: number,
  correctionCap: number,
): WorkforceDemandLine => {
  const balance = count(available) - count(required) - count(projectedExits);
  return {
    population,
    segment,
    required: count(required),
    available: count(available),
    projectedExits: count(projectedExits),
    balance,
    /* Corrections only ever restore viability: they close part of a shortage,
     * never top the world up to a comfortable surplus. Scarcity is allowed. */
    correction: balance >= 0 ? 0 : Math.min(correctionCap, Math.ceil(-balance * 0.6)),
  };
};

/**
 * Demand derives from the active world - clubs, women's teams, fixture volume
 * - never from hardcoded national totals, so it tracks a pyramid that grows,
 * shrinks or reorganises over decades.
 */
export const computeWorkforceDemand = (input: {
  db: GameDatabase;
  date: string;
  seasonLabel?: string;
}): WorkforceDemandSnapshot => {
  const db = input.db;
  const seasonLabel = input.seasonLabel ?? input.date.slice(0, 4);
  const clubs = activeClubCount(db);
  const womensTeams = activeSeniorTeams(db, "women");
  const seasonStart = `${Number(seasonLabel) - 1}-01-01`;
  const seasonEnd = `${Number(seasonLabel) + 1}-12-31`;
  const fixtures = scheduledFixtureCount(db, seasonStart, seasonEnd);
  const peakFixtures = scheduledFixturePeak(db, seasonStart, seasonEnd);

  const market = new StaffMarketRepository(db);
  const workforce = new WorkforceSupplyRepository(db);

  const staffAvailable = scalar(
    db,
    `SELECT COUNT(DISTINCT sp.person_id) n FROM staff_profiles sp
     JOIN person_roles pr ON pr.person_id = sp.person_id AND pr.role = 'STAFF' AND pr.active_to IS NULL`,
  );
  const staffEmployed = scalar(
    db,
    "SELECT COUNT(DISTINCT person_id) n FROM staff_appointments WHERE employment_status = 'ACTIVE'",
  );
  const staffPool = Math.max(
    staffAvailable,
    market.unemployedStaffProfiles().length + staffEmployed,
  );

  const referees = workforce.activeOfficials("REFEREE").length;
  const assistants = workforce.activeOfficials("ASSISTANT_REFEREE").length;
  /* Officiating demand comes from the calendar the world actually has: total
   * fixtures divided by a realistic per-official season workload. */
  const refereesRequired = Math.max(6, Math.ceil(fixtures / MAX_APPOINTMENTS_PER_OFFICIAL), Math.ceil(peakFixtures * 1.15));
  const assistantsRequired = Math.max(
    12,
    Math.ceil((fixtures * ASSISTANTS_PER_FIXTURE) / MAX_APPOINTMENTS_PER_OFFICIAL),
    Math.ceil(peakFixtures * ASSISTANTS_PER_FIXTURE * 1.15),
  );

  const lines: WorkforceDemandLine[] = [
    line(
      "MEN_PLAYERS",
      "SQUAD",
      clubs * MEN_SQUAD_TARGET,
      activePlayerCount(db, "male"),
      projectedPlayerExits(db, input.date, "male"),
      MAX_PLAYER_CORRECTION_PER_SEASON,
    ),
    /* Women's demand is computed from women's teams alone - it must never be
     * derived from the men's roster target. */
    line(
      "WOMEN_PLAYERS",
      "SQUAD",
      womensTeams * WOMEN_SQUAD_TARGET,
      activePlayerCount(db, "female"),
      projectedPlayerExits(db, input.date, "female"),
      MAX_PLAYER_CORRECTION_PER_SEASON,
    ),
    line(
      "STAFF",
      "CORE_CLUB_ROLES",
      clubs * CORE_STAFF_ROLES.length,
      staffPool,
      Math.round(staffPool * 0.05),
      MAX_STAFF_INTAKE_PER_SEASON,
    ),
    line(
      "REFEREES",
      "REFEREE",
      refereesRequired,
      referees,
      Math.round(referees * 0.08),
      MAX_OFFICIAL_INTAKE_PER_SEASON,
    ),
    line(
      "REFEREES",
      "ASSISTANT_REFEREE",
      assistantsRequired,
      assistants,
      Math.round(assistants * 0.08),
      MAX_OFFICIAL_INTAKE_PER_SEASON,
    ),
  ];

  return {
    date: input.date,
    seasonLabel,
    activeClubs: clubs,
    activeWomensTeams: womensTeams,
    scheduledFixtures: fixtures,
    lines,
    provenanceStatus: "SIMULATION_ONLY",
  };
};

export const demandLine = (
  snapshot: WorkforceDemandSnapshot,
  population: WorkforcePopulation,
  segment: string,
): WorkforceDemandLine | undefined =>
  snapshot.lines.find((item) => item.population === population && item.segment === segment);

// ---------------------------------------------------------------------------
// Officiating supply
// ---------------------------------------------------------------------------

const OFFICIAL_FIRST_NAMES = [
  "Bhim",
  "Chandra",
  "Dipak",
  "Gopal",
  "Hari",
  "Indra",
  "Keshav",
  "Madhav",
  "Narayan",
  "Padam",
  "Ramesh",
  "Santosh",
  "Tek",
  "Umesh",
];
const OFFICIAL_FEMALE_FIRST_NAMES = ["Anjana", "Bhawana", "Kamala", "Menuka", "Sarita", "Sunita"];
const OFFICIAL_SURNAMES = [
  "Adhikari",
  "Bhandari",
  "Chaudhary",
  "Gurung",
  "Karki",
  "Lama",
  "Magar",
  "Poudel",
  "Rai",
  "Shrestha",
  "Tamang",
  "Thapa",
];

/**
 * Creates one entry-level official. New officials always start at the bottom
 * domestic level with modest quality - the world never generates a ready-made
 * elite referee.
 */
export const generateOfficial = (input: {
  db: GameDatabase;
  countryId: EntityId;
  role: OfficialSimulationProfile["role"];
  gender?: "male" | "female";
  date: string;
  seasonLabel: string;
  index: number;
  /** Federation referee-development level, 0..100, raises the entry floor. */
  developmentEnvironment?: number;
}): OfficialSimulationProfile => {
  const gender = input.gender ?? "male";
  const key = `${input.seasonLabel}:${input.role}:${gender}:${input.index}`;
  const rng = new SeededRandom(`official:${key}`);
  const personId = createStableEntityId("person-generated-official", key);
  const first = rng.pick(gender === "female" ? OFFICIAL_FEMALE_FIRST_NAMES : OFFICIAL_FIRST_NAMES);
  const fullName = `${first} ${rng.pick(OFFICIAL_SURNAMES)}`;
  const environment = clamp(input.developmentEnvironment ?? 35, 0, 100);
  const age = 22 + rng.integer(0, 8);
  const birthYear = Number(input.date.slice(0, 4)) - age;
  const world = new WorldRepository(input.db);

  const person: Person = {
    id: personId,
    fullName,
    displayName: fullName,
    dateOfBirth: `${birthYear}-${String(1 + rng.integer(0, 11)).padStart(2, "0")}-${String(1 + rng.integer(0, 27)).padStart(2, "0")}`,
    nationalityCountryId: input.countryId,
    genderPresentation: gender,
    languages: ["Nepali"],
  };
  if (!world.getPerson(personId)) world.insertPerson(person);
  /* Officials are football workforce, not players: the person-role vocabulary
   * has no REFEREE member, so they carry STAFF and their officiating career
   * state lives in the referee profile plus this module's own record. */
  const role: PersonRole = {
    id: createStableEntityId("person-role", `${personId}:OFFICIAL`),
    personId,
    role: "STAFF",
    activeFrom: input.date,
  };
  world.insertPersonRole(role);

  const refereeProfile: RefereeProfile = {
    id: createStableEntityId("referee-profile", personId),
    personId,
    refereeLevel: "DOMESTIC_ENTRY",
    fifaListed: false,
    primaryRole: input.role,
    competitionsEligible: [],
    experienceLevel: "ENTRY",
  };
  world.insertRefereeProfile(refereeProfile);

  const quality = clamp(24 + environment * 0.18 + rng.next() * 12, 10, 62);
  const profile: OfficialSimulationProfile = {
    personId,
    refereeProfileId: refereeProfile.id,
    countryId: input.countryId,
    role: input.role,
    gender,
    level: 3,
    quality: round2(quality),
    potential: round2(clamp(quality + 8 + rng.next() * 28 + environment * 0.1, quality, 92)),
    experience: round2(rng.next() * 6),
    fitness: round2(clamp(58 + rng.next() * 30, 40, 95)),
    seasonAppointments: 0,
    careerAppointments: 0,
    debutOn: input.date,
    status: "ACTIVE",
    provenanceStatus: "SIMULATION_ONLY",
  };
  new WorkforceSupplyRepository(input.db).upsertOfficial(profile);
  return profile;
};

/**
 * One season of officiating career progression: bounded quality growth toward
 * potential, promotion only on sustained experience, retirement on age and
 * workload, and an occasional move into instructing.
 */
export const advanceOfficialCareer = (
  profile: OfficialSimulationProfile,
  input: {
    date: string;
    appointments: number;
    /** Federation referee-development investment, 0..100. */
    developmentEnvironment?: number;
    age?: number;
    rng: SeededRandom;
  },
): OfficialSimulationProfile => {
  if (profile.status !== "ACTIVE") return profile;
  const environment = clamp(input.developmentEnvironment ?? 35, 0, 100);
  const workload = clamp(input.appointments, 0, MAX_APPOINTMENTS_PER_OFFICIAL);
  const headroom = Math.max(0, profile.potential - profile.quality);
  /* Growth is capped by both headroom and a small per-season ceiling, so no
   * amount of federation money produces an elite official in one year. */
  const growth = Math.min(
    headroom,
    clamp(0.4 + (environment / 100) * 1.8 + workload * 0.06, 0, 3.2),
  );
  const experience = clamp(profile.experience + workload * 0.35 + 0.4, 0, 100);
  const quality = clamp(profile.quality + growth, 0, 100);
  const age = input.age ?? 30;
  const fitness = clamp(
    profile.fitness - Math.max(0, age - 38) * 1.6 + (workload > 0 ? 0.4 : -0.6),
    0,
    100,
  );

  const level =
    quality >= 72 && experience >= 45
      ? 1
      : quality >= 52 && experience >= 20
        ? 2
        : profile.level === 1
          ? 1
          : profile.level === 2
            ? 2
            : 3;

  const retirementPressure = clamp((age - 45) * 0.16 + (fitness < 45 ? 0.25 : 0), 0, 0.9);
  if (input.rng.next() < retirementPressure) {
    /* Experienced retirees are the natural source of instructors, which is how
     * the officiating pipeline improves the next generation. */
    const instructor = experience >= 40 && quality >= 55 && input.rng.next() < 0.35;
    return {
      ...profile,
      quality: round2(quality),
      experience: round2(experience),
      fitness: round2(fitness),
      level,
      seasonAppointments: 0,
      careerAppointments: profile.careerAppointments + workload,
      retiredOn: input.date,
      role: instructor ? "REFEREE_INSTRUCTOR" : profile.role,
      status: instructor ? "INSTRUCTOR" : "RETIRED",
    };
  }

  return {
    ...profile,
    quality: round2(quality),
    experience: round2(experience),
    fitness: round2(fitness),
    level,
    seasonAppointments: 0,
    careerAppointments: profile.careerAppointments + workload,
  };
};

/**
 * Reads the existing federation referee-development score rather than modelling
 * a second one. It is stored on a 0..10 scale; this module works in 0..100.
 */
const refereeDevelopmentEnvironment = (db: GameDatabase): number => {
  let row: { value?: number } | undefined;
  try {
    row = db
      .prepare(
        "SELECT referee_development AS value FROM federation_simulation_profiles ORDER BY federation_id LIMIT 1",
      )
      .get() as { value?: number } | undefined;
  } catch {
    row = undefined;
  }
  return row?.value !== undefined && row.value !== null
    ? clamp(Number(row.value) * 10, 0, 100)
    : 35;
};

// ---------------------------------------------------------------------------
// Annual reconciliation
// ---------------------------------------------------------------------------

export type WorkforceReconciliationReport = {
  date: string;
  seasonLabel: string;
  demand: WorkforceDemandSnapshot;
  generatedOfficials: number;
  retiredOfficials: number;
  generatedStaff: number;
  generatedWomenPlayers: number;
  generatedMenPlayers: number;
  skippedAlreadyRun: boolean;
};

/**
 * Annual supply reconciliation. Runs once per season label per context; a
 * reload replays the same call and generates nothing new. It corrects only far
 * enough to prevent structural collapse - competition for coaches, thin
 * lower-league squads and referee scarcity all remain possible.
 */
export const reconcileWorkforceSupply = (input: {
  db: GameDatabase;
  date: string;
  seed: string;
  seasonLabel?: string;
}): WorkforceReconciliationReport => {
  const db = input.db;
  const seasonLabel = input.seasonLabel ?? input.date.slice(0, 4);
  const workforce = new WorkforceSupplyRepository(db);
  const countryId = nepalCountryId(db);
  const report: WorkforceReconciliationReport = {
    date: input.date,
    seasonLabel,
    demand: computeWorkforceDemand({ db, date: input.date, seasonLabel }),
    generatedOfficials: 0,
    retiredOfficials: 0,
    generatedStaff: 0,
    generatedWomenPlayers: 0,
    generatedMenPlayers: 0,
    skippedAlreadyRun: false,
  };
  if (!countryId) return report;

  const claim = (kind: string, contextKey: string): boolean =>
    workforce.claimIntake({
      id: createStableEntityId("workforce-intake", `${seasonLabel}:${kind}:${contextKey}`),
      seasonLabel,
      kind,
      contextKey,
      generatedOn: input.date,
      generatedCount: 0,
      provenanceStatus: "SIMULATION_ONLY",
    });

  if (!claim("SEASON_RECONCILIATION", "world")) {
    return { ...report, skippedAlreadyRun: true };
  }

  /* A save imported before this system existed has no officiating population
   * at all; bootstrap it once, lazily, rather than requiring a migration. */
  initializeWorkforceSupplyForSave({ db, worldDate: input.date, seed: input.seed });

  // --- officiating careers advance first, so demand sees this year's exits ---
  const environment = refereeDevelopmentEnvironment(db);
  const world = new WorldRepository(db);
  for (const official of workforce.officials("ACTIVE")) {
    const person = world.getPerson(official.personId);
    const rng = new SeededRandom(
      `${input.seed}:official-career:${official.personId}:${seasonLabel}`,
    );
    const next = advanceOfficialCareer(official, {
      date: input.date,
      appointments: official.seasonAppointments,
      developmentEnvironment: environment,
      age: ageOn(person?.dateOfBirth, input.date),
      rng,
    });
    if (next.status !== "ACTIVE") report.retiredOfficials += 1;
    workforce.upsertOfficial(next);
  }

  const demand = computeWorkforceDemand({ db, date: input.date, seasonLabel });
  report.demand = demand;

  // --- officials ---
  for (const role of ["REFEREE", "ASSISTANT_REFEREE"] as const) {
    const need = demandLine(demand, "REFEREES", role)?.correction ?? 0;
    for (let index = 0; index < need; index += 1) {
      /* Women's football needs women officials in the pipeline too; the split
       * is modest and grows only as the wider pipeline grows. */
      const gender = index % 4 === 3 ? "female" : "male";
      generateOfficial({
        db,
        countryId,
        role,
        gender,
        date: input.date,
        seasonLabel,
        index,
        developmentEnvironment: environment,
      });
      report.generatedOfficials += 1;
    }
  }

  // --- staff free-agent pool ---
  const staffNeed = demandLine(demand, "STAFF", "CORE_CLUB_ROLES")?.correction ?? 0;
  for (let index = 0; index < staffNeed; index += 1) {
    const role = CORE_STAFF_ROLES[index % CORE_STAFF_ROLES.length]!;
    const generated = generateAiStaff(
      `workforce-staff:${seasonLabel}:${role}:${index}`,
      input.date,
      countryId,
      role,
    );
    if (!world.getPerson(generated.person.id)) world.insertPerson(generated.person);
    world.insertPersonRole({
      id: createStableEntityId("person-role", `${generated.person.id}:STAFF`),
      personId: generated.person.id,
      role: "STAFF",
      activeFrom: input.date,
    });
    world.insertStaffProfile(generated.profile);
    world.insertStaffSimulationProfile(generated.simulation);
    for (const licence of generated.licences) world.insertStaffLicence(licence);
    report.generatedStaff += 1;
  }

  // --- women's players, through the shared youth generation engine ---
  const womenNeed = demandLine(demand, "WOMEN_PLAYERS", "SQUAD")?.correction ?? 0;
  if (womenNeed > 0) {
    const womensTeams = db
      .prepare(
        "SELECT id, club_id FROM teams WHERE level = 'senior' AND gender = 'women' AND club_id IS NOT NULL ORDER BY id",
      )
      .all() as Array<{ id: EntityId; club_id: EntityId }>;
    if (womensTeams.length > 0) {
      const perTeam = Math.ceil(womenNeed / womensTeams.length);
      for (const team of womensTeams) {
        /* The per-population cap is a hard total, not a per-club allowance. */
        const remaining = womenNeed - report.generatedWomenPlayers;
        if (remaining <= 0) break;
        const cohort = generateYouthCohort({
          db,
          countryId,
          clubId: team.club_id,
          teamId: team.id,
          date: input.date,
          seasonLabel,
          seed: `${input.seed}:women:${team.id}:${seasonLabel}`,
          count: Math.min(perTeam, 8, remaining),
          gender: "female",
          cohortKey: "womens-supply",
        });
        report.generatedWomenPlayers += cohort.generatedPlayers;
      }
    }
  }

  // --- men's players: only a structural backstop; club-level repair and the
  // normal youth intake remain the primary supply route ---
  const menNeed = demandLine(demand, "MEN_PLAYERS", "SQUAD")?.correction ?? 0;
  if (menNeed > 0) {
    const clubs = db
      .prepare(
        `SELECT c.id AS club_id, MIN(t.id) AS team_id FROM clubs c
         JOIN teams t ON t.club_id = c.id AND t.level = 'senior' AND t.gender = 'men'
         GROUP BY c.id ORDER BY c.id`,
      )
      .all() as Array<{ club_id: EntityId; team_id: EntityId }>;
    if (clubs.length > 0) {
      const perClub = Math.ceil(menNeed / clubs.length);
      for (const club of clubs) {
        const remaining = menNeed - report.generatedMenPlayers;
        if (remaining <= 0) break;
        const cohort = generateYouthCohort({
          db,
          countryId,
          clubId: club.club_id,
          teamId: club.team_id,
          date: input.date,
          seasonLabel,
          seed: `${input.seed}:men-topup:${club.club_id}:${seasonLabel}`,
          count: Math.min(perClub, 4, remaining),
          cohortKey: "demand-topup",
        });
        report.generatedMenPlayers += cohort.generatedPlayers;
      }
    }
  }

  workforce.recordIntakeCount(
    createStableEntityId("workforce-intake", `${seasonLabel}:SEASON_RECONCILIATION:world`),
    report.generatedOfficials +
      report.generatedStaff +
      report.generatedWomenPlayers +
      report.generatedMenPlayers,
  );
  const finalDemand = computeWorkforceDemand({ db, date: input.date, seasonLabel });
  workforce.upsertDemandSnapshot(finalDemand);
  return { ...report, demand: finalDemand };
};

/**
 * One-off bootstrap for a save that has no officiating population at all (the
 * imported August 2026 world has none). Idempotent through the intake ledger.
 */
export const initializeWorkforceSupplyForSave = (input: {
  db: GameDatabase;
  worldDate: string;
  seed: string;
}): number => {
  const countryId = nepalCountryId(input.db);
  if (!countryId) return 0;
  const workforce = new WorkforceSupplyRepository(input.db);
  const seasonLabel = input.worldDate.slice(0, 4);
  if (
    !workforce.claimIntake({
      id: createStableEntityId("workforce-intake", `${seasonLabel}:BOOTSTRAP:officials`),
      seasonLabel,
      kind: "BOOTSTRAP",
      contextKey: "officials",
      generatedOn: input.worldDate,
      generatedCount: 0,
      provenanceStatus: "SIMULATION_ONLY",
    })
  ) {
    return 0;
  }
  const environment = refereeDevelopmentEnvironment(input.db);
  const demand = computeWorkforceDemand({ db: input.db, date: input.worldDate, seasonLabel });
  let created = 0;
  for (const role of ["REFEREE", "ASSISTANT_REFEREE"] as const) {
    const target = Math.min(
      MAX_OFFICIAL_INTAKE_PER_SEASON * 2,
      demandLine(demand, "REFEREES", role)?.required ?? 0,
    );
    for (let index = 0; index < target; index += 1) {
      const profile = generateOfficial({
        db: input.db,
        countryId,
        role,
        gender: index % 4 === 3 ? "female" : "male",
        date: input.worldDate,
        seasonLabel: `${seasonLabel}-bootstrap`,
        index,
        developmentEnvironment: environment,
      });
      /* A bootstrap pool is not a pool of rookies: stagger entry levels so the
       * calendar can be serviced from day one without inventing elites. */
      if (index % 5 === 0) {
        const quality = clamp(profile.quality + 22, 0, 78);
        workforce.upsertOfficial({
          ...profile,
          level: 1,
          quality: round2(quality),
          potential: round2(clamp(Math.max(profile.potential, quality + 4), 0, 92)),
          experience: round2(clamp(profile.experience + 46, 0, 100)),
        });
      } else if (index % 5 === 1 || index % 5 === 2) {
        const quality = clamp(profile.quality + 12, 0, 68);
        workforce.upsertOfficial({
          ...profile,
          level: 2,
          quality: round2(quality),
          potential: round2(clamp(Math.max(profile.potential, quality + 6), 0, 92)),
          experience: round2(clamp(profile.experience + 22, 0, 100)),
        });
      }
      created += 1;
    }
  }
  workforce.recordIntakeCount(
    createStableEntityId("workforce-intake", `${seasonLabel}:BOOTSTRAP:officials`),
    created,
  );
  return created;
};

/**
 * Completes only structurally under-covered B/C clubs on a new or legacy save.
 * Factual imports are never replaced; generated depth uses the normal youth
 * generator and therefore receives normal origins, contracts, development,
 * and later release/transfer behaviour.
 */
export const ensureLowerLeaguePlayableWorld = (input: {
  db: GameDatabase;
  date: string;
  seed: string;
  targetSquadSize?: number;
}): LowerLeagueClubCoverage[] => {
  const db = input.db;
  const countryId = nepalCountryId(db);
  if (!countryId) return [];
  db.exec(`CREATE TABLE IF NOT EXISTS lower_league_bootstrap (club_id TEXT PRIMARY KEY, completed_on TEXT NOT NULL, generated_count INTEGER NOT NULL, provenance_status TEXT NOT NULL)`);
  const target = Math.max(11, Math.min(25, input.targetSquadSize ?? 20));
  const world = new WorldRepository(db);
  const results: LowerLeagueClubCoverage[] = [];
  for (const club of lowerLeagueClubs(db)) {
    const alreadyRun = db.prepare("SELECT club_id FROM lower_league_bootstrap WHERE club_id=?").get(club.clubId);
    if (!alreadyRun) {
      let generated = 0;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const active = scalar(db, "SELECT COUNT(*) AS n FROM team_person_assignments WHERE team_id=? AND role='PLAYER' AND ended_on IS NULL", club.teamId);
        const positions = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN pa.primary_position='GK' THEN 1 ELSE 0 END) AS goalkeepers, SUM(CASE WHEN pa.primary_position IN ('CB','RB','LB') THEN 1 ELSE 0 END) AS defenders, SUM(CASE WHEN pa.primary_position IN ('DM','CM','AM') THEN 1 ELSE 0 END) AS midfielders, SUM(CASE WHEN pa.primary_position IN ('RW','LW','ST') THEN 1 ELSE 0 END) AS attackers FROM player_attributes pa JOIN team_person_assignments tpa ON tpa.person_id=pa.person_id WHERE tpa.team_id=? AND tpa.role='PLAYER' AND tpa.ended_on IS NULL").get(club.teamId) as { total?: number; goalkeepers?: number; defenders?: number; midfielders?: number; attackers?: number };
        if (active >= target && Number(positions.goalkeepers ?? 0) > 0 && Number(positions.defenders ?? 0) > 0 && Number(positions.midfielders ?? 0) > 0 && Number(positions.attackers ?? 0) > 0) break;
        const before = scalar(db, "SELECT COUNT(*) AS n FROM generated_player_origins g JOIN team_person_assignments tpa ON tpa.person_id=g.player_id WHERE tpa.team_id=? AND tpa.role='PLAYER' AND tpa.ended_on IS NULL", club.teamId);
        const report = generateYouthCohort({ db, countryId, clubId: club.clubId, teamId: club.teamId, date: input.date, seasonLabel: input.date.slice(0, 4), seed: `${input.seed}:lower:${club.clubId}:${attempt}`, count: Math.min(8, target - active), cohortKey: `lower-league-bootstrap:${club.clubId}:${attempt}` });
        generated += Math.max(0, report.generatedPlayers ?? 0);
        const unassigned = db.prepare("SELECT g.player_id FROM generated_player_origins g LEFT JOIN team_person_assignments tpa ON tpa.person_id=g.player_id AND tpa.role='PLAYER' AND tpa.ended_on IS NULL WHERE g.club_id=? AND g.generated_on=? AND tpa.person_id IS NULL ORDER BY g.player_id").all(club.clubId, input.date) as Array<{ player_id: EntityId }>;
        for (const player of unassigned) world.insertTeamPersonAssignment({ id: createStableEntityId("lower-league-bootstrap-assignment", `${player.player_id}:${club.teamId}`), personId: player.player_id, teamId: club.teamId, role: "PLAYER", startedOn: input.date });
        const after = scalar(db, "SELECT COUNT(*) AS n FROM generated_player_origins g JOIN team_person_assignments tpa ON tpa.person_id=g.player_id WHERE tpa.team_id=? AND tpa.role='PLAYER' AND tpa.ended_on IS NULL", club.teamId);
        if (after <= before) break;
      }
      const positionalFallbacks: Array<{ position: "GK" | "CB" | "CM" | "ST"; predicate: string }> = [
        { position: "GK", predicate: "primary_position='GK'" },
        { position: "CB", predicate: "primary_position IN ('CB','RB','LB')" },
        { position: "CM", predicate: "primary_position IN ('DM','CM','AM')" },
        { position: "ST", predicate: "primary_position IN ('RW','LW','ST')" },
      ];
      const usedFallbackPlayers: EntityId[] = [];
      for (const fallback of positionalFallbacks) {
        const covered = scalar(db, `SELECT COUNT(*) AS n FROM player_attributes pa JOIN team_person_assignments tpa ON tpa.person_id=pa.person_id JOIN generated_player_origins gpo ON gpo.player_id=pa.person_id WHERE tpa.team_id=? AND tpa.role='PLAYER' AND tpa.ended_on IS NULL AND ${fallback.predicate}`, club.teamId);
        if (covered > 0) continue;
        const excluded = usedFallbackPlayers.length > 0 ? `AND pa.person_id NOT IN (${usedFallbackPlayers.map(() => "?").join(",")})` : "";
        const candidate = db.prepare(`SELECT pa.person_id FROM player_attributes pa JOIN team_person_assignments tpa ON tpa.person_id=pa.person_id JOIN generated_player_origins gpo ON gpo.player_id=pa.person_id WHERE tpa.team_id=? AND tpa.role='PLAYER' AND tpa.ended_on IS NULL ${excluded} ORDER BY pa.person_id LIMIT 1`).get(club.teamId, ...usedFallbackPlayers) as { person_id?: EntityId } | undefined;
        if (candidate?.person_id) {
          db.prepare("UPDATE player_attributes SET primary_position=? WHERE person_id=?").run(fallback.position, candidate.person_id);
          usedFallbackPlayers.push(candidate.person_id);
        }
      }
      db.prepare("INSERT INTO lower_league_bootstrap VALUES (?,?,?,?)").run(club.clubId, input.date, generated, "SIMULATION_ONLY");
    }
    if (!db.prepare("SELECT 1 FROM staff_appointments WHERE club_id=? AND role='HEAD_COACH' AND employment_status='ACTIVE' LIMIT 1").get(club.clubId) && !db.prepare("SELECT 1 FROM staff_vacancies WHERE club_id=? AND role='HEAD_COACH' AND status='VACANT' LIMIT 1").get(club.clubId)) {
      world.insertStaffVacancy({ id: createStableEntityId("lower-league-head-coach-vacancy", club.clubId), organisationType: "CLUB", clubId: club.clubId, teamId: club.teamId, role: "HEAD_COACH", required: true, status: "VACANT", openedOn: input.date, reason: "NEW_ROLE" });
    }
    const playerCounts = db.prepare(`SELECT COUNT(DISTINCT CASE WHEN gpo.player_id IS NULL THEN tpa.person_id END) AS real_players, COUNT(DISTINCT gpo.player_id) AS generated_players FROM team_person_assignments tpa LEFT JOIN generated_player_origins gpo ON gpo.player_id=tpa.person_id WHERE tpa.team_id=? AND tpa.role='PLAYER' AND tpa.ended_on IS NULL`).get(club.teamId) as { real_players?: number; generated_players?: number };
    const staffCounts = db.prepare(`SELECT COUNT(DISTINCT CASE WHEN ssp.person_id IS NULL THEN sa.person_id END) AS real_staff, COUNT(DISTINCT ssp.person_id) AS generated_staff FROM staff_appointments sa LEFT JOIN staff_simulation_profiles ssp ON ssp.person_id=sa.person_id WHERE sa.club_id=? AND sa.employment_status='ACTIVE'`).get(club.clubId) as { real_staff?: number; generated_staff?: number };
    const positions = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN pa.primary_position='GK' THEN 1 ELSE 0 END) AS goalkeepers, SUM(CASE WHEN pa.primary_position IN ('CB','RB','LB') THEN 1 ELSE 0 END) AS defenders, SUM(CASE WHEN pa.primary_position IN ('DM','CM','AM') THEN 1 ELSE 0 END) AS midfielders, SUM(CASE WHEN pa.primary_position IN ('RW','LW','ST') THEN 1 ELSE 0 END) AS attackers FROM player_attributes pa JOIN team_person_assignments tpa ON tpa.person_id=pa.person_id WHERE tpa.team_id=? AND tpa.role='PLAYER' AND tpa.ended_on IS NULL").get(club.teamId) as { total?: number; goalkeepers?: number; defenders?: number; midfielders?: number; attackers?: number };
    results.push({ clubId: club.clubId, division: club.division, realPlayers: Number(playerCounts.real_players ?? 0), generatedStartingPlayers: Number(playerCounts.generated_players ?? 0), realStaff: Number(staffCounts.real_staff ?? 0), generatedStaff: Number(staffCounts.generated_staff ?? 0), playableSquad: Number(positions.total ?? 0) >= 11 && Number(positions.goalkeepers ?? 0) > 0 && Number(positions.defenders ?? 0) > 0 && Number(positions.midfielders ?? 0) > 0 && Number(positions.attackers ?? 0) > 0 });
  }
  return results;
};

export const lowerLeagueCoverageReport = (input: { db: GameDatabase; date: string }): LowerLeagueCoverageReport => {
  const clubs = ensureLowerLeaguePlayableWorld({ db: input.db, date: input.date, seed: `coverage:${input.date}` });
  const db = input.db;
  const realPlayerTotal = scalar(db, "SELECT COUNT(DISTINCT pr.person_id) AS n FROM person_roles pr LEFT JOIN generated_player_origins gpo ON gpo.player_id=pr.person_id WHERE pr.role='PLAYER' AND pr.active_to IS NULL AND gpo.player_id IS NULL");
  const freeAgents = scalar(db, "SELECT COUNT(DISTINCT pr.person_id) AS n FROM person_roles pr LEFT JOIN team_person_assignments tpa ON tpa.person_id=pr.person_id AND tpa.role='PLAYER' AND tpa.ended_on IS NULL WHERE pr.role='PLAYER' AND pr.active_to IS NULL AND tpa.person_id IS NULL");
  const unknownClub = scalar(db, "SELECT COUNT(DISTINCT pr.person_id) AS n FROM person_roles pr LEFT JOIN team_person_assignments tpa ON tpa.person_id=pr.person_id AND tpa.role='PLAYER' AND tpa.ended_on IS NULL LEFT JOIN generated_player_origins gpo ON gpo.player_id=pr.person_id WHERE pr.role='PLAYER' AND pr.active_to IS NULL AND gpo.player_id IS NULL AND tpa.person_id IS NULL");
  const realStaff = scalar(db, "SELECT COUNT(DISTINCT sa.person_id) AS n FROM staff_appointments sa LEFT JOIN staff_simulation_profiles ssp ON ssp.person_id=sa.person_id WHERE sa.employment_status='ACTIVE' AND ssp.person_id IS NULL");
  const bDivisionRealPlayers = clubs.filter((club) => club.division === "B").reduce((sum, club) => sum + club.realPlayers, 0);
  const cDivisionRealPlayers = clubs.filter((club) => club.division === "C").reduce((sum, club) => sum + club.realPlayers, 0);
  const bDivisionHeadCoaches = scalar(db, "SELECT COUNT(DISTINCT sa.person_id) AS n FROM staff_appointments sa JOIN club_memberships cm ON cm.club_id=sa.club_id JOIN competitions c ON c.id=cm.competition_id WHERE sa.role='HEAD_COACH' AND sa.employment_status='ACTIVE' AND lower(c.name) LIKE '%b-division%'");
  const cDivisionHeadCoaches = scalar(db, "SELECT COUNT(DISTINCT sa.person_id) AS n FROM staff_appointments sa JOIN club_memberships cm ON cm.club_id=sa.club_id JOIN competitions c ON c.id=cm.competition_id WHERE sa.role='HEAD_COACH' AND sa.employment_status='ACTIVE' AND lower(c.name) LIKE '%c-division%'");
  const generatedLowerLeagueManagers = scalar(db, "SELECT COUNT(DISTINCT sa.person_id) AS n FROM staff_appointments sa JOIN staff_simulation_profiles ssp ON ssp.person_id=sa.person_id JOIN club_memberships cm ON cm.club_id=sa.club_id JOIN competitions c ON c.id=cm.competition_id WHERE sa.role='HEAD_COACH' AND sa.employment_status='ACTIVE' AND (lower(c.name) LIKE '%b-division%' OR lower(c.name) LIKE '%c-division%')");
  return { generatedOn: input.date, realPlayers: realPlayerTotal, bDivisionRealPlayers, cDivisionRealPlayers, generatedStartingPlayers: clubs.reduce((sum, club) => sum + club.generatedStartingPlayers, 0), freeAgents, unknownClub, realStaff, bDivisionHeadCoaches, cDivisionHeadCoaches, generatedLowerLeagueManagers, clubs, provenanceStatus: "SIMULATION_ONLY" };
};

// ---------------------------------------------------------------------------
// Sustainability report and long-save invariants
// ---------------------------------------------------------------------------

const ageBandsFor = (
  db: GameDatabase,
  date: string,
): { bands: Record<string, number>; average: number } => {
  const rows = db
    .prepare(
      `SELECT p.date_of_birth AS dob FROM person_roles pr JOIN persons p ON p.id = pr.person_id
       WHERE pr.role = 'PLAYER' AND pr.active_to IS NULL`,
    )
    .all() as Array<{ dob?: string }>;
  const bands: Record<string, number> = { u18: 0, "18-22": 0, "23-27": 0, "28-32": 0, "33+": 0 };
  let total = 0;
  let counted = 0;
  for (const row of rows) {
    const age = ageOn(row.dob ?? undefined, date);
    if (age === undefined) continue;
    total += age;
    counted += 1;
    if (age < 18) bands["u18"]! += 1;
    else if (age <= 22) bands["18-22"]! += 1;
    else if (age <= 27) bands["23-27"]! += 1;
    else if (age <= 32) bands["28-32"]! += 1;
    else bands["33+"]! += 1;
  }
  return { bands, average: counted > 0 ? round2(total / counted) : 0 };
};

/**
 * Compact machine-readable answer to "can this world sustain itself?".
 * Development and debugging tooling - deliberately not a UI surface.
 */
export const worldSustainabilityReport = (input: {
  db: GameDatabase;
  date: string;
  seasonLabel?: string;
}): WorldSustainabilityReport => {
  const db = input.db;
  const seasonLabel = input.seasonLabel ?? input.date.slice(0, 4);
  const demand = computeWorkforceDemand({ db, date: input.date, seasonLabel });
  const workforce = new WorkforceSupplyRepository(db);
  const { bands, average } = ageBandsFor(db, input.date);

  const generatedActive = scalar(
    db,
    `SELECT COUNT(*) n FROM person_roles pr
     JOIN generated_player_origins gpo ON gpo.player_id = pr.person_id
     WHERE pr.role = 'PLAYER' AND pr.active_to IS NULL`,
  );
  const activePlayers = scalar(
    db,
    "SELECT COUNT(*) n FROM person_roles WHERE role = 'PLAYER' AND active_to IS NULL",
  );

  const staffByRole = (
    db
      .prepare(
        `SELECT role, COUNT(DISTINCT person_id) n FROM staff_appointments
         WHERE employment_status = 'ACTIVE' GROUP BY role ORDER BY role`,
      )
      .all() as Array<{ role: string; n: number }>
  ).map((row): WorkforceRoleCount => ({ role: row.role, count: row.n }));

  const leagueDistribution = (
    db
      .prepare(
        `SELECT co.name AS competition, COUNT(DISTINCT cm.club_id) AS clubs
         FROM club_memberships cm
         JOIN competition_seasons cs ON cs.id = cm.competition_season_id
         JOIN competitions co ON co.id = cs.competition_id
         GROUP BY co.name ORDER BY co.name`,
      )
      .all() as Array<{ competition: string; clubs: number }>
  ).map((row) => ({
    competition: row.competition,
    clubs: row.clubs,
    players: 0,
  }));

  const districtOrigins = (
    db
      .prepare(
        `SELECT COALESCE(l.name, 'Unknown') AS district, COUNT(*) n
         FROM generated_player_origins gpo
         LEFT JOIN locations l ON l.id = gpo.district_location_id
         GROUP BY district ORDER BY n DESC, district LIMIT 20`,
      )
      .all() as Array<{ district: string; n: number }>
  ).map((row) => ({ district: row.district, players: row.n }));

  const retirementsThisSeason = scalar(
    db,
    "SELECT COUNT(*) n FROM person_roles WHERE role = 'PLAYER' AND active_to IS NOT NULL AND active_to >= ?",
    `${Number(seasonLabel) - 1}-01-01`,
  );
  const generatedEntrantsThisSeason = (workforce.intakeEvents(seasonLabel) ?? []).reduce(
    (total, event) => total + event.generatedCount,
    0,
  );

  const activeReferees = workforce.activeOfficials("REFEREE").length;
  const activeAssistants = workforce.activeOfficials("ASSISTANT_REFEREE").length;
  const activeManagers = scalar(
    db,
    "SELECT COUNT(DISTINCT person_id) n FROM manager_contracts WHERE contract_end IS NULL OR contract_end >= ?",
    input.date,
  );
  const activeStaff = scalar(
    db,
    "SELECT COUNT(DISTINCT person_id) n FROM staff_appointments WHERE employment_status = 'ACTIVE'",
  );
  const freeAgents = scalar(
    db,
    `SELECT COUNT(*) n FROM person_roles pr WHERE pr.role = 'PLAYER' AND pr.active_to IS NULL
     AND NOT EXISTS (SELECT 1 FROM player_contracts pc WHERE pc.player_id = pr.person_id AND pc.status = 'ACTIVE')`,
  );

  const report: WorldSustainabilityReport = {
    date: input.date,
    seasonLabel,
    activeMalePlayers: activePlayerCount(db, "male"),
    activeFemalePlayers: activePlayerCount(db, "female"),
    youthCohort: bands["u18"]! + bands["18-22"]!,
    freeAgents,
    averagePlayerAge: average,
    ageBands: bands,
    realActivePeople: Math.max(0, activePlayers - generatedActive),
    generatedActivePeople: generatedActive,
    activeManagers,
    activeStaff,
    staffByRole,
    activeReferees,
    activeAssistantReferees: activeAssistants,
    retirementsThisSeason,
    generatedEntrantsThisSeason,
    leagueDistribution,
    districtOrigins,
    demand,
    violations: [],
    sustainable: true,
  };
  const violations = workforceInvariantViolations(report);
  return { ...report, violations, sustainable: violations.length === 0 };
};

/**
 * Structural invariants for long saves. These catch collapse and corruption -
 * they deliberately do NOT flag legitimate scarcity such as a negative demand
 * balance, which is a valid simulation outcome.
 */
export const workforceInvariantViolations = (report: WorldSustainabilityReport): string[] => {
  const violations: string[] = [];
  const numbers: Array<[string, number]> = [
    ["activeMalePlayers", report.activeMalePlayers],
    ["activeFemalePlayers", report.activeFemalePlayers],
    ["youthCohort", report.youthCohort],
    ["freeAgents", report.freeAgents],
    ["averagePlayerAge", report.averagePlayerAge],
    ["activeReferees", report.activeReferees],
    ["activeAssistantReferees", report.activeAssistantReferees],
    ["activeManagers", report.activeManagers],
    ["activeStaff", report.activeStaff],
  ];
  for (const [name, value] of numbers) {
    if (!Number.isFinite(value)) violations.push(`${name} is not finite`);
    if (value < 0) violations.push(`${name} is negative`);
  }
  if (report.demand.activeClubs > 0 && report.activeMalePlayers === 0) {
    violations.push("no active players while clubs require squads");
  }
  if (report.demand.scheduledFixtures > 0 && report.activeReferees === 0) {
    violations.push("no active referees while competitions still have fixtures");
  }
  if (report.demand.activeWomensTeams > 0 && report.activeFemalePlayers === 0) {
    violations.push("no active women players while women's teams exist");
  }
  if (
    report.averagePlayerAge > 0 &&
    (report.averagePlayerAge < 14 || report.averagePlayerAge > 42)
  ) {
    violations.push("average player age is outside a possible football range");
  }
  if (report.averagePlayerAge > 0 && report.youthCohort === 0) {
    violations.push("no youth cohort remains to replace the current population");
  }
  return violations;
};
