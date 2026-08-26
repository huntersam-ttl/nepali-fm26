import {
  StaffMarketRepository,
  TransferMarketRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createEntityId,
  createStableEntityId,
  type EntityId,
  type FootballStaffRole,
  type Person,
  type SaveMetadata,
  type StaffApplication,
  type StaffAppointment,
  type StaffEmploymentContract,
  type StaffHistoryEvent,
  type StaffLicence,
  type StaffProfile,
  type StaffSimulationProfile,
  type StaffVacancy,
  type StaffVacancyReason,
  type Team,
} from "@nepal-football-sim/shared-types";
import { SeededRandom } from "./rng.js";

type SqlRow = Record<string, any>;

const daysBetween = (from: string, to: string): number =>
  Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);

const addDays = (date: string, days: number): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const currentSeasonId = (db: GameDatabase, worldDate: string): EntityId | undefined => {
  const row = db
    .prepare("SELECT id FROM competition_seasons WHERE start_date <= ? ORDER BY start_date DESC LIMIT 1")
    .get(worldDate) as SqlRow | undefined;
  return row?.id;
};

const seniorTeams = (db: GameDatabase, worldDate: string): Team[] => {
  const seasonId = currentSeasonId(db, worldDate);
  if (!seasonId) return [];
  return new WorldRepository(db).teamsForCompetitionSeason(seasonId);
};

const firstCountryId = (db: GameDatabase): EntityId => {
  const row = db.prepare("SELECT id FROM countries ORDER BY name LIMIT 1").get() as SqlRow | undefined;
  if (!row) throw new Error("The world has no country records.");
  return row.id;
};

const nepalCountryId = (db: GameDatabase): EntityId | undefined => {
  const row = db.prepare("SELECT id FROM countries WHERE iso_code IN ('NP','NPL')").get() as
    | SqlRow
    | undefined;
  return row?.id;
};

/** Domestic vs foreign availability: unknown nationality is treated as domestic (never blocks a candidate we can't classify). */
export const isDomesticPerson = (db: GameDatabase, personId: EntityId): boolean => {
  const nepal = nepalCountryId(db);
  if (!nepal) return true;
  const row = db.prepare("SELECT nationality_country_id FROM persons WHERE id = ?").get(personId) as
    | SqlRow
    | undefined;
  return !row?.nationality_country_id || row.nationality_country_id === nepal;
};

// ---------------------------------------------------------------------------
// Coaching licence requirements and role fit
// ---------------------------------------------------------------------------

/** Higher rank = more advanced badge. 0 means "no licence held". */
const LICENCE_RANK: Record<string, number> = {
  AFC_D: 1,
  AFC_C: 2,
  AFC_B: 3,
  AFC_A: 4,
  AFC_PRO: 5,
};

/** Roles with no entry require no licence at all (medical/recruitment/analysis staff). */
const ROLE_LICENCE_REQUIREMENT: Partial<Record<FootballStaffRole, number>> = {
  HEAD_COACH: 3,
  ASSISTANT_COACH: 2,
  FIRST_TEAM_COACH: 2,
  GOALKEEPER_COACH: 1,
  FITNESS_COACH: 1,
  SET_PIECE_COACH: 1,
  YOUTH_COACH: 1,
  ACADEMY_DIRECTOR: 2,
};

const licenceRankOf = (licences: StaffLicence[]): number =>
  licences.reduce((max, licence) => Math.max(max, LICENCE_RANK[licence.licenceType] ?? 0), 0);

export type StaffEligibility = { eligible: boolean; note?: string };

/** Checks licence level and (if the candidate specialises) role preference. Never checks anything invented. */
export const staffEligibility = (
  role: FootballStaffRole,
  profile: StaffProfile | undefined,
  licences: StaffLicence[],
): StaffEligibility => {
  const requiredRank = ROLE_LICENCE_REQUIREMENT[role];
  if (requiredRank !== undefined) {
    const heldRank = licenceRankOf(licences);
    if (heldRank < requiredRank) {
      return {
        eligible: false,
        note: `Requires at least a rank-${requiredRank} coaching licence for ${role.replace(/_/g, " ").toLowerCase()}.`,
      };
    }
  }
  if (profile?.preferredRole && profile.preferredRole !== role) {
    return { eligible: true, note: `Prefers ${profile.preferredRole.replace(/_/g, " ").toLowerCase()}, but can cover this role.` };
  }
  return { eligible: true };
};

// ---------------------------------------------------------------------------
// Salary expectations
// ---------------------------------------------------------------------------

const ROLE_SALARY_BASE_MINOR: Partial<Record<FootballStaffRole, number>> = {
  HEAD_COACH: 1_500_000,
  ASSISTANT_COACH: 900_000,
  FIRST_TEAM_COACH: 800_000,
  GOALKEEPER_COACH: 700_000,
  FITNESS_COACH: 650_000,
  SET_PIECE_COACH: 600_000,
  YOUTH_COACH: 500_000,
  ACADEMY_DIRECTOR: 850_000,
  SCOUT: 450_000,
  CHIEF_SCOUT: 700_000,
  ANALYST: 550_000,
  PHYSIO: 600_000,
  DOCTOR: 800_000,
  SPORTS_SCIENTIST: 650_000,
  PSYCHOLOGIST: 600_000,
  SPORTING_DIRECTOR: 1_200_000,
  TECHNICAL_DIRECTOR: 1_100_000,
};
const DEFAULT_ROLE_SALARY_MINOR = 400_000;

/** A candidate's minimum wage ask: role baseline scaled by licence rank and reputation band. */
export const estimateSalaryExpectation = (
  role: FootballStaffRole,
  licences: StaffLicence[],
  reputation: string | undefined,
): number => {
  const base = ROLE_SALARY_BASE_MINOR[role] ?? DEFAULT_ROLE_SALARY_MINOR;
  const licenceMultiplier = 1 + licenceRankOf(licences) * 0.15;
  const reputationMultiplier = reputation === "HIGH" ? 1.4 : reputation === "LOW" ? 0.8 : 1;
  return Math.round(base * licenceMultiplier * reputationMultiplier);
};

/** Whether the club's wage budget can absorb one more contract at this salary. */
export const clubCanAffordSalary = (db: GameDatabase, clubId: EntityId, salaryAmountMinor: number): boolean => {
  const finances = new TransferMarketRepository(db).clubFinancialProfile(clubId);
  if (!finances) return true; // No modelled budget: don't block hiring on missing data.
  return finances.wageBudget - finances.currentWageSpend >= salaryAmountMinor;
};

// ---------------------------------------------------------------------------
// AI candidate generation — deterministic, SIMULATION_ONLY
// ---------------------------------------------------------------------------

const NAME_POOL = [
  "Suresh Thapa", "Bikash Gurung", "Anil Rai", "Dipesh Shrestha", "Nabin Magar",
  "Ramesh Tamang", "Kiran Bhandari", "Sujan Karki", "Prakash Lama", "Rajan Basnet",
];

const generateAiStaff = (
  seedKey: string,
  worldDate: string,
  countryId: EntityId,
  role: FootballStaffRole,
): { person: Person; profile: StaffProfile; simulation: StaffSimulationProfile; licences: StaffLicence[] } => {
  const rng = new SeededRandom(seedKey);
  const fullName = rng.pick(NAME_POOL);
  const personId = createStableEntityId("ai-staff-person", seedKey);
  const profileId = createStableEntityId("ai-staff-profile", seedKey);
  const base = 5 + rng.integer(0, 4);
  const requiredRank = ROLE_LICENCE_REQUIREMENT[role];
  const licences: StaffLicence[] =
    requiredRank !== undefined
      ? [
          {
            id: createStableEntityId("ai-staff-licence", seedKey),
            personId,
            licenceType:
              Object.entries(LICENCE_RANK).find(([, rank]) => rank === requiredRank)?.[0] ?? "AFC_C",
            issuer: "ANFA",
            status: "UNKNOWN",
          },
        ]
      : [];
  return {
    person: { id: personId, fullName, nationalityCountryId: countryId, languages: ["ne"] },
    profile: {
      id: profileId,
      personId,
      preferredRole: role,
      salaryExpectation: base >= 8 ? "HIGH" : base <= 5 ? "LOW" : "MEDIUM",
      reputation: base >= 8 ? "HIGH" : base <= 5 ? "LOW" : "MEDIUM",
      countryKnowledge: [countryId],
      clubKnowledge: [],
      availability: "AVAILABLE",
      workEligibilityStatus: "ELIGIBLE",
    },
    simulation: {
      id: createStableEntityId("ai-staff-simulation", seedKey),
      personId,
      coachingTechnical: base,
      coachingTactical: base,
      coachingPhysical: base,
      coachingMental: base,
      goalkeeping: role === "GOALKEEPER_COACH" ? base + 2 : Math.max(1, base - 2),
      youthDevelopment: role === "YOUTH_COACH" || role === "ACADEMY_DIRECTOR" ? base + 2 : base,
      manManagement: base,
      status: "SIMULATION_ONLY",
    },
    licences,
  };
};

// ---------------------------------------------------------------------------
// Vacancies, hiring, dismissal
// ---------------------------------------------------------------------------

const CORE_CLUB_ROLES: FootballStaffRole[] = [
  "ASSISTANT_COACH",
  "GOALKEEPER_COACH",
  "FITNESS_COACH",
  "PHYSIO",
  "SCOUT",
  "YOUTH_COACH",
];

const VACANCY_GRACE_DAYS = 14;
const CONTRACT_RENEWAL_WINDOW_DAYS = 30;

export const openStaffVacancy = (
  db: GameDatabase,
  clubId: EntityId,
  role: FootballStaffRole,
  reason: StaffVacancyReason,
  worldDate: string,
): StaffVacancy => {
  const market = new StaffMarketRepository(db);
  const existing = market.openVacancyForRole(clubId, role);
  if (existing) return existing;
  const vacancy: StaffVacancy = {
    id: createEntityId(),
    organisationType: "CLUB",
    clubId,
    role,
    required: false,
    status: "VACANT",
    openedOn: worldDate,
    reason,
  };
  market.upsertVacancy(vacancy);
  return vacancy;
};

const logStaffHistory = (
  db: GameDatabase,
  personId: EntityId,
  eventType: StaffHistoryEvent["eventType"],
  worldDate: string,
  extra: { appointmentId?: EntityId; clubId?: EntityId; teamId?: EntityId; description?: string } = {},
): void => {
  new WorldRepository(db).insertStaffHistoryEvent({
    id: createEntityId(),
    personId,
    eventType,
    occurredOn: worldDate,
    ...extra,
  });
};

export class StaffActionError extends Error {
  constructor(
    readonly code: "NOT_ELIGIBLE" | "CANNOT_AFFORD" | "ALREADY_EMPLOYED" | "APPOINTMENT_NOT_FOUND" | "VACANCY_NOT_FOUND",
    message: string,
  ) {
    super(message);
  }
}

/** Manager-initiated hire: creates the appointment and its backing contract, filling any open vacancy for the role. */
export const hireStaff = (
  db: GameDatabase,
  save: SaveMetadata,
  clubId: EntityId,
  teamId: EntityId | undefined,
  personId: EntityId,
  role: FootballStaffRole,
  salaryAmountMinor: number,
  contractMonths = 24,
): StaffAppointment => {
  const market = new StaffMarketRepository(db);
  if (market.activeAppointment(personId)) {
    throw new StaffActionError("ALREADY_EMPLOYED", "That person is already employed elsewhere.");
  }
  const profile = market.staffProfile(personId);
  const licences = market.staffLicencesForPerson(personId);
  const eligibility = staffEligibility(role, profile, licences);
  if (!eligibility.eligible) {
    throw new StaffActionError("NOT_ELIGIBLE", eligibility.note ?? "Not eligible for this role.");
  }
  if (!clubCanAffordSalary(db, clubId, salaryAmountMinor)) {
    throw new StaffActionError("CANNOT_AFFORD", "The wage budget cannot absorb this salary.");
  }

  const worldDate = save.worldDate;
  const appointment: StaffAppointment = {
    id: createEntityId(),
    personId,
    organisationType: "CLUB",
    clubId,
    teamId,
    role,
    startDate: worldDate,
    employmentStatus: "ACTIVE",
  };
  const contract: StaffEmploymentContract = {
    id: createEntityId(),
    personId,
    appointmentId: appointment.id,
    clubId,
    teamId,
    role,
    contractStart: worldDate,
    contractEnd: addDays(worldDate, contractMonths * 30),
    salaryAmountMinor,
    currency: "NPR",
    status: "ACTIVE",
  };
  appointment.contractId = contract.id;

  const world = new WorldRepository(db);
  world.insertStaffAppointment(appointment);
  market.upsertEmploymentContract(contract);

  const vacancy = market.openVacancyForRole(clubId, role);
  if (vacancy) {
    market.upsertVacancy({ ...vacancy, status: "FILLED", assignedPersonId: personId });
  }
  logStaffHistory(db, personId, "STAFF_JOINED", worldDate, {
    appointmentId: appointment.id,
    clubId,
    teamId,
    description: `Joined as ${role.replace(/_/g, " ").toLowerCase()}.`,
  });
  return appointment;
};

/** Manager-initiated dismissal: ends the appointment and contract, and reopens the role as a vacancy. */
export const dismissStaff = (
  db: GameDatabase,
  save: SaveMetadata,
  appointmentId: EntityId,
): StaffAppointment => {
  const market = new StaffMarketRepository(db);
  const appointment = market.appointmentById(appointmentId);
  if (!appointment || appointment.employmentStatus !== "ACTIVE") {
    throw new StaffActionError("APPOINTMENT_NOT_FOUND", "That appointment is not active.");
  }
  const worldDate = save.worldDate;
  market.updateAppointmentStatus(appointmentId, "FORMER", worldDate);
  if (appointment.contractId) {
    const contract = market.employmentContractById(appointment.contractId);
    if (contract) market.upsertEmploymentContract({ ...contract, status: "TERMINATED", contractEnd: worldDate });
  }
  if (appointment.clubId) {
    openStaffVacancy(db, appointment.clubId, appointment.role, "DISMISSED", worldDate);
  }
  logStaffHistory(db, appointment.personId, "STAFF_LEFT", worldDate, {
    appointmentId,
    clubId: appointment.clubId,
    teamId: appointment.teamId,
    description: `Dismissed from ${appointment.role.replace(/_/g, " ").toLowerCase()}.`,
  });
  return { ...appointment, employmentStatus: "FORMER", endDate: worldDate };
};

// ---------------------------------------------------------------------------
// Contract expiry / renewal
// ---------------------------------------------------------------------------

export type StaffContractTickOutcome = {
  renewed: StaffEmploymentContract[];
  expired: StaffAppointment[];
};

/**
 * Renews or lets lapse every active contract at the club within the renewal
 * window of its end date. Renewal odds scale with reputation — nothing here
 * is a coin flip disconnected from who the person actually is.
 */
export const evaluateStaffContracts = (
  db: GameDatabase,
  save: SaveMetadata,
  clubId: EntityId,
): StaffContractTickOutcome => {
  const market = new StaffMarketRepository(db);
  const worldDate = save.worldDate;
  const outcome: StaffContractTickOutcome = { renewed: [], expired: [] };

  for (const contract of market.activeEmploymentContractsForClub(clubId)) {
    if (!contract.contractEnd) continue;
    const daysToEnd = daysBetween(worldDate, contract.contractEnd);
    if (daysToEnd > CONTRACT_RENEWAL_WINDOW_DAYS || daysToEnd < 0) continue;

    const profile = market.staffProfile(contract.personId);
    const rng = new SeededRandom(`staff-renewal:${contract.id}:${worldDate}`);
    const renewChance = profile?.reputation === "HIGH" ? 0.75 : profile?.reputation === "LOW" ? 0.35 : 0.55;
    if (rng.next() < renewChance) {
      const renewed: StaffEmploymentContract = {
        ...contract,
        contractEnd: addDays(contract.contractEnd, 24 * 30),
      };
      market.upsertEmploymentContract(renewed);
      outcome.renewed.push(renewed);
    } else {
      market.upsertEmploymentContract({ ...contract, status: "EXPIRED" });
      const appointment = market.activeAppointment(contract.personId);
      if (appointment) {
        market.updateAppointmentStatus(appointment.id, "CONTRACT_EXPIRED", contract.contractEnd);
        if (appointment.clubId) {
          openStaffVacancy(db, appointment.clubId, appointment.role, "EXPIRED", contract.contractEnd);
        }
        logStaffHistory(db, contract.personId, "STAFF_LEFT", contract.contractEnd, {
          appointmentId: appointment.id,
          clubId: appointment.clubId,
          teamId: appointment.teamId,
          description: "Contract expired and was not renewed.",
        });
        outcome.expired.push({ ...appointment, employmentStatus: "CONTRACT_EXPIRED" });
      }
    }
  }
  return outcome;
};

// ---------------------------------------------------------------------------
// AI recruitment
// ---------------------------------------------------------------------------

/**
 * Fills open core support-staff roles across every senior club (skipping the
 * player's own, which the manager fills by hand) using free agents first,
 * then a generated candidate, gated by the club's own wage budget — the same
 * "reuse before generate" shape as `ensureAiManagersAssigned`.
 */
export const ensureAiStaffAssigned = (
  db: GameDatabase,
  save: SaveMetadata,
  playerClubId: EntityId | undefined,
): void => {
  const market = new StaffMarketRepository(db);
  const world = new WorldRepository(db);
  const teams = seniorTeams(db, save.worldDate);
  const worldDate = save.worldDate;
  let countryId: EntityId | undefined;

  const clubIds = new Set(teams.map((team) => team.clubId).filter((id): id is EntityId => Boolean(id)));
  for (const clubId of clubIds) {
    if (clubId === playerClubId) continue;
    const team = teams.find((entry) => entry.clubId === clubId);

    for (const role of CORE_CLUB_ROLES) {
      const alreadyStaffed = market
        .activeAppointmentsForClub(clubId)
        .some((appointment) => appointment.role === role);
      if (alreadyStaffed) continue;

      const openVacancy = market.openVacancyForRole(clubId, role);
      if (openVacancy?.openedOn && daysBetween(openVacancy.openedOn, worldDate) < VACANCY_GRACE_DAYS) {
        continue;
      }

      const salary = ROLE_SALARY_BASE_MINOR[role] ?? DEFAULT_ROLE_SALARY_MINOR;
      if (!clubCanAffordSalary(db, clubId, salary)) continue;

      // Only reuse a free agent who actually specialises in this role (or has
      // no stated preference) — a scout should not get swept into fitness
      // coaching just because nothing stops them technically holding it.
      const freeAgent = market
        .unemployedStaffProfiles()
        .find(
          (profile) =>
            (profile.preferredRole === role || !profile.preferredRole) &&
            staffEligibility(role, profile, market.staffLicencesForPerson(profile.personId)).eligible,
        );

      let personId: EntityId;
      let salaryAmountMinor = salary;
      if (freeAgent) {
        personId = freeAgent.personId;
        salaryAmountMinor = estimateSalaryExpectation(
          role,
          market.staffLicencesForPerson(personId),
          freeAgent.reputation,
        );
      } else {
        countryId ??= firstCountryId(db);
        const generated = generateAiStaff(`ai-staff:${clubId}:${role}:${worldDate}`, worldDate, countryId, role);
        if (!world.getPerson(generated.person.id)) world.insertPerson(generated.person);
        world.insertStaffProfile(generated.profile);
        world.insertStaffSimulationProfile(generated.simulation);
        for (const licence of generated.licences) world.insertStaffLicence(licence);
        personId = generated.person.id;
        salaryAmountMinor = estimateSalaryExpectation(role, generated.licences, generated.profile.reputation);
      }

      if (!clubCanAffordSalary(db, clubId, salaryAmountMinor)) continue;
      try {
        hireStaff(db, save, clubId, team?.id, personId, role, salaryAmountMinor);
      } catch {
        // A rare double-booking or budget edge case: skip this role this tick.
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Player -> staff career-transition compatibility
// ---------------------------------------------------------------------------

const RETIRED_ROLE_TO_STAFF_ROLE: Record<string, FootballStaffRole> = {
  COACH: "FIRST_TEAM_COACH",
  ASSISTANT_COACH: "ASSISTANT_COACH",
  MANAGER: "HEAD_COACH",
  SCOUT: "SCOUT",
  ACADEMY_COACH: "YOUTH_COACH",
  DIRECTOR: "TECHNICAL_DIRECTOR",
};

/**
 * Bridges a retired player's `RetiredStaffTransition` marker into the real
 * staff-employment world: gives them a `StaffProfile` (idempotent) so they
 * show up as a hireable free agent, without inventing an identity — the
 * person record already exists from their playing career.
 */
export const ensureStaffProfileForRetiree = (
  db: GameDatabase,
  playerId: EntityId,
  staffRole: string,
): StaffProfile => {
  const market = new StaffMarketRepository(db);
  const existing = market.staffProfile(playerId);
  if (existing) return existing;
  const profile: StaffProfile = {
    id: createEntityId(),
    personId: playerId,
    preferredRole: RETIRED_ROLE_TO_STAFF_ROLE[staffRole] ?? "FIRST_TEAM_COACH",
    salaryExpectation: "LOW",
    reputation: "LOW",
    countryKnowledge: [],
    clubKnowledge: [],
    availability: "AVAILABLE",
    workEligibilityStatus: "ELIGIBLE",
  };
  new WorldRepository(db).insertStaffProfile(profile);
  return profile;
};

// ---------------------------------------------------------------------------
// Career history
// ---------------------------------------------------------------------------

export type StaffCareerHistoryView = {
  history: StaffHistoryEvent[];
  contracts: StaffEmploymentContract[];
};

export const staffCareerHistory = (db: GameDatabase, personId: EntityId): StaffCareerHistoryView => {
  const market = new StaffMarketRepository(db);
  return {
    history: market.staffHistoryForPerson(personId),
    contracts: market.employmentContractsForPerson(personId),
  };
};
