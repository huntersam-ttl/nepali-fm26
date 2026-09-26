import {
  ClubEconomyRepository,
  ClubNetworkRepository,
  PeopleFoundationRepository,
  StaffMarketRepository,
  TransferMarketRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { countryEconomicProfile, scaleAmount, scalePrice, scaleWage } from "./economic-profile.js";
import {
  createEntityId,
  createStableEntityId,
  type EntityId,
  type FootballStaffRole,
  type Person,
  type SaveMetadata,
  type StaffApplication,
  type StaffApplicationStatus,
  type StaffApproach,
  type StaffAppointment,
  type StaffDevelopmentPlan,
  type StaffEmploymentContract,
  type StaffHistoryEvent,
  type StaffLicence,
  type StaffLicenceCourse,
  type StaffPerformanceRecord,
  type StaffProfile,
  type StaffRenewalOffer,
  type StaffRenewalOfferStatus,
  type StaffResponsibility,
  type StaffResponsibilityDomain,
  type StaffResponsibilityOwnerType,
  type StaffSimulationProfile,
  type StaffTechnicalPlacement,
  type StaffSuccessionPlan,
  type StaffVacancy,
  type StaffVacancyReason,
  type StaffWorkloadLevel,
  type Team,
} from "@nepal-football-sim/shared-types";
import { SeededRandom } from "./rng.js";
import type { NamePool } from "./country-pack.js";
import { homeCountryId, homeFederationAbbreviation, homeNamePool, homeCurrency, requireHomeCountryId } from "./home-context.js";
import {
  assessStaffCooperation,
  assessStaffDeparture,
  assessStaffDevelopmentWillingness,
} from "./career-market-deepening.js";

type SqlRow = Record<string, any>;

const daysBetween = (from: string, to: string): number =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );

const addDays = (date: string, days: number): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const currentSeasonId = (db: GameDatabase, worldDate: string): EntityId | undefined => {
  const row = db
    .prepare(
      "SELECT id FROM competition_seasons WHERE start_date <= ? ORDER BY start_date DESC LIMIT 1",
    )
    .get(worldDate) as SqlRow | undefined;
  return row?.id;
};

const seniorTeams = (db: GameDatabase, worldDate: string): Team[] => {
  const seasonId = currentSeasonId(db, worldDate);
  if (!seasonId) return [];
  return new WorldRepository(db).teamsForCompetitionSeason(seasonId);
};

/** Domestic vs foreign availability: unknown nationality is treated as domestic (never blocks a candidate we can't classify). */
export const isDomesticPerson = (db: GameDatabase, personId: EntityId): boolean => {
  const nepal = homeCountryId(db);
  if (!nepal) return true;
  const row = db
    .prepare("SELECT nationality_country_id FROM persons WHERE id = ?")
    .get(personId) as SqlRow | undefined;
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
  UEFA_C: 2,
  UEFA_B: 3,
  UEFA_A: 4,
  UEFA_PRO: 5,
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
  // Same coaching domain as HEAD_COACH — appointNationalTeamHeadCoachForPresident
  // checks eligibility for this role, and candidates are licensed as
  // HEAD_COACH, not a national-team-specific variant.
  NATIONAL_TEAM_HEAD_COACH: 3,
};

/** The highest-ranked recognised licence a person holds, if any. */
export const highestLicence = (licences: StaffLicence[]): { type: string; rank: number } | undefined =>
  licences
    .map((licence) => ({ type: licence.licenceType, rank: LICENCE_RANK[licence.licenceType] ?? 0 }))
    .filter((licence) => licence.rank > 0)
    .sort((a, b) => b.rank - a.rank)[0];

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
    // Licensed coaching roles flex across each other once the badge clears —
    // a qualified coach can reasonably cover an adjacent coaching vacancy.
    if (profile?.preferredRole && profile.preferredRole !== role) {
      return {
        eligible: true,
        note: `Prefers ${profile.preferredRole.replace(/_/g, " ").toLowerCase()}, but can cover this role.`,
      };
    }
    return { eligible: true };
  }
  // Roles with no licence tier (scouting, medical, analysis, and every
  // executive/administrative role including CEO) have nothing else to gate
  // on, so specialisation must match the vacancy exactly. Without this,
  // every candidate — regardless of preferredRole — was "eligible" for
  // every unlicensed vacancy, which is how a physio or fitness coach ended
  // up shown as eligible to be hired as club CEO.
  if (profile?.preferredRole === role) return { eligible: true };
  return {
    eligible: false,
    note: profile?.preferredRole
      ? `Specialises in ${profile.preferredRole.replace(/_/g, " ").toLowerCase()}, not ${role.replace(/_/g, " ").toLowerCase()}.`
      : `No recorded specialisation for ${role.replace(/_/g, " ").toLowerCase()}.`,
  };
};

// ---------------------------------------------------------------------------
// Salary expectations
// ---------------------------------------------------------------------------

const ROLE_SALARY_BASE_MINOR: Partial<Record<FootballStaffRole, number>> = {
  HEAD_COACH: 260_000,
  ASSISTANT_COACH: 150_000,
  FIRST_TEAM_COACH: 135_000,
  GOALKEEPER_COACH: 120_000,
  FITNESS_COACH: 110_000,
  SET_PIECE_COACH: 105_000,
  YOUTH_COACH: 80_000,
  ACADEMY_DIRECTOR: 160_000,
  SCOUT: 90_000,
  CHIEF_SCOUT: 150_000,
  ANALYST: 110_000,
  PHYSIO: 120_000,
  DOCTOR: 180_000,
  SPORTS_SCIENTIST: 130_000,
  PSYCHOLOGIST: 120_000,
  SPORTING_DIRECTOR: 240_000,
  TECHNICAL_DIRECTOR: 220_000,
};
const DEFAULT_ROLE_SALARY_MINOR = 80_000;

/** A candidate's minimum wage ask: role baseline scaled by licence rank and reputation band. */
export const estimateSalaryExpectation = (
  role: FootballStaffRole,
  licences: StaffLicence[],
  reputation: string | undefined,
  wageLevel = 1,
): number => {
  const base = scaleAmount(wageLevel, ROLE_SALARY_BASE_MINOR[role] ?? DEFAULT_ROLE_SALARY_MINOR);
  const licenceMultiplier = 1 + licenceRankOf(licences) * 0.15;
  const reputationMultiplier = reputation === "HIGH" ? 1.4 : reputation === "LOW" ? 0.8 : 1;
  return Math.round(base * licenceMultiplier * reputationMultiplier);
};

/** Whether the club's wage budget can absorb one more contract at this salary. */
export const clubCanAffordSalary = (
  db: GameDatabase,
  clubId: EntityId,
  salaryAmountMinor: number,
): boolean => {
  const finances = new TransferMarketRepository(db).clubFinancialProfile(clubId);
  if (!finances) return true; // No modelled budget: don't block hiring on missing data.
  return finances.wageBudget - finances.currentWageSpend >= salaryAmountMinor;
};

/** The domestic finance ledger is authoritative; CONTEXT_ONLY clubs have no full payroll model. */
const adjustClubWageSpend = (
  db: GameDatabase,
  clubId: EntityId | undefined,
  deltaMinor: number,
): void => {
  if (!clubId || deltaMinor === 0) return;
  const finances = new TransferMarketRepository(db);
  const profile = finances.clubFinancialProfile(clubId);
  if (!profile) return;
  finances.upsertClubFinancialProfile({
    ...profile,
    currentWageSpend: Math.max(0, profile.currentWageSpend + deltaMinor),
  });
};

// ---------------------------------------------------------------------------
// AI candidate generation — deterministic, SIMULATION_ONLY
// ---------------------------------------------------------------------------

/**
 * Bounded generated staff person. Exported so the workforce-supply layer can
 * replenish the domestic staff market through this one generator rather than
 * standing up a second staff-generation engine.
 */
export const generateAiStaff = (
  seedKey: string,
  worldDate: string,
  countryId: EntityId,
  role: FootballStaffRole,
  namePool: NamePool,
  issuer: string,
): {
  person: Person;
  profile: StaffProfile;
  simulation: StaffSimulationProfile;
  licences: StaffLicence[];
} => {
  const rng = new SeededRandom(seedKey);
  const fullName = rng.pick(namePool.staffFullNames);
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
              Object.entries(LICENCE_RANK).find(([, rank]) => rank === requiredRank)?.[0] ??
              "AFC_C",
            issuer,
            status: "UNKNOWN",
          },
        ]
      : [];
  return {
    person: { id: personId, fullName, nationalityCountryId: countryId, languages: [...namePool.languageCodes] },
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
  extra: {
    appointmentId?: EntityId;
    clubId?: EntityId;
    teamId?: EntityId;
    description?: string;
  } = {},
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
    readonly code:
      | "NOT_ELIGIBLE"
      | "CANNOT_AFFORD"
      | "ALREADY_EMPLOYED"
      | "RETIRED"
      | "APPOINTMENT_NOT_FOUND"
      | "VACANCY_NOT_FOUND",
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
  if (profile?.availability === "RETIRED") {
    throw new StaffActionError("RETIRED", "Retired staff cannot be hired.");
  }
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
    currency: homeCurrency(db),
    status: "ACTIVE",
  };
  appointment.contractId = contract.id;

  const world = new WorldRepository(db);
  world.insertStaffAppointment(appointment);
  market.upsertEmploymentContract(contract);
  adjustClubWageSpend(db, clubId, salaryAmountMinor);
  if (profile && profile.availability !== "EMPLOYED") {
    world.insertStaffProfile({ ...profile, availability: "EMPLOYED" });
  }

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

/**
 * Closes the one active job before a staff member takes another.  Moves use
 * this shared transition whether the destination is Nepal or CONTEXT_ONLY,
 * so an employment history is never forked and wage spend cannot linger.
 */
const releaseStaffForMove = (
  db: GameDatabase,
  save: SaveMetadata,
  appointment: StaffAppointment,
  description: string,
): void => {
  const market = new StaffMarketRepository(db);
  const worldDate = save.worldDate;
  market.updateAppointmentStatus(appointment.id, "FORMER", worldDate);
  if (appointment.contractId) {
    const contract = market.employmentContractById(appointment.contractId);
    if (contract?.status === "ACTIVE") {
      market.upsertEmploymentContract({ ...contract, status: "RESIGNED", contractEnd: worldDate });
      adjustClubWageSpend(db, contract.clubId, -contract.salaryAmountMinor);
    }
  }
  if (appointment.clubId) {
    openStaffVacancy(db, appointment.clubId, appointment.role, "RESIGNED", worldDate);
  }
  const profile = market.staffProfile(appointment.personId);
  if (profile && profile.availability !== "RETIRED") {
    new WorldRepository(db).insertStaffProfile({ ...profile, availability: "AVAILABLE" });
  }
  logStaffHistory(db, appointment.personId, "STAFF_LEFT", worldDate, {
    appointmentId: appointment.id,
    clubId: appointment.clubId,
    teamId: appointment.teamId,
    description,
  });
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
    if (contract?.status === "ACTIVE") {
      market.upsertEmploymentContract({
        ...contract,
        status: "TERMINATED",
        contractEnd: worldDate,
      });
      adjustClubWageSpend(db, contract.clubId, -contract.salaryAmountMinor);
    }
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
  const profile = market.staffProfile(appointment.personId);
  if (profile && profile.availability !== "RETIRED") {
    new WorldRepository(db).insertStaffProfile({ ...profile, availability: "AVAILABLE" });
  }
  return { ...appointment, employmentStatus: "FORMER", endDate: worldDate };
};

/** Retires a staff person, preserving the closed employment and refillable vacancy. */
export const retireStaff = (db: GameDatabase, save: SaveMetadata, personId: EntityId): void => {
  const market = new StaffMarketRepository(db);
  const appointment = market.activeAppointment(personId);
  const worldDate = save.worldDate;
  if (appointment) {
    market.updateAppointmentStatus(appointment.id, "FORMER", worldDate);
    if (appointment.contractId) {
      const contract = market.employmentContractById(appointment.contractId);
      if (contract?.status === "ACTIVE") {
        market.upsertEmploymentContract({ ...contract, status: "RETIRED", contractEnd: worldDate });
        adjustClubWageSpend(db, contract.clubId, -contract.salaryAmountMinor);
      }
    }
    if (appointment.clubId)
      openStaffVacancy(db, appointment.clubId, appointment.role, "RESIGNED", worldDate);
    logStaffHistory(db, personId, "STAFF_LEFT", worldDate, {
      appointmentId: appointment.id,
      clubId: appointment.clubId,
      teamId: appointment.teamId,
      description: `Retired from ${appointment.role.replace(/_/g, " ").toLowerCase()}.`,
    });
  }
  const profile = market.staffProfile(personId);
  if (profile) new WorldRepository(db).insertStaffProfile({ ...profile, availability: "RETIRED" });
  db.prepare(
    "UPDATE person_roles SET active_to = ? WHERE person_id = ? AND role = 'STAFF' AND active_to IS NULL",
  ).run(worldDate, personId);
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
    const renewChance =
      profile?.reputation === "HIGH" ? 0.75 : profile?.reputation === "LOW" ? 0.35 : 0.55;
    if (rng.next() < renewChance) {
      const renewed: StaffEmploymentContract = {
        ...contract,
        contractEnd: addDays(contract.contractEnd, 24 * 30),
      };
      market.upsertEmploymentContract(renewed);
      outcome.renewed.push(renewed);
    } else {
      market.upsertEmploymentContract({ ...contract, status: "EXPIRED" });
      adjustClubWageSpend(db, contract.clubId, -contract.salaryAmountMinor);
      const appointment = market.activeAppointment(contract.personId);
      if (appointment) {
        market.updateAppointmentStatus(appointment.id, "CONTRACT_EXPIRED", contract.contractEnd);
        if (appointment.clubId) {
          openStaffVacancy(
            db,
            appointment.clubId,
            appointment.role,
            "EXPIRED",
            contract.contractEnd,
          );
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

/** Runs the expiry/renewal check across every senior club, not just the player's — this is
 * what makes contract expiry and free-agent movement a world-wide fact, not a player-only one. */
export const evaluateAllStaffContracts = (
  db: GameDatabase,
  save: SaveMetadata,
): StaffContractTickOutcome => {
  const market = new StaffMarketRepository(db);
  const clubIds = new Set(
    market
      .activeEmploymentContracts()
      .map((contract) => contract.clubId)
      .filter((id): id is EntityId => Boolean(id)),
  );
  const combined: StaffContractTickOutcome = { renewed: [], expired: [] };
  for (const clubId of clubIds) {
    const outcome = evaluateStaffContracts(db, save, clubId);
    combined.renewed.push(...outcome.renewed);
    combined.expired.push(...outcome.expired);
  }
  return combined;
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

  const clubIds = new Set(
    teams.map((team) => team.clubId).filter((id): id is EntityId => Boolean(id)),
  );
  for (const clubId of clubIds) {
    if (clubId === playerClubId) continue;
    const team = teams.find((entry) => entry.clubId === clubId);

    for (const role of CORE_CLUB_ROLES) {
      const alreadyStaffed = market
        .activeAppointmentsForClub(clubId)
        .some((appointment) => appointment.role === role);
      if (alreadyStaffed) continue;

      const openVacancy = market.openVacancyForRole(clubId, role);
      if (
        openVacancy?.openedOn &&
        daysBetween(openVacancy.openedOn, worldDate) < VACANCY_GRACE_DAYS
      ) {
        continue;
      }

      const salary = scaleWage(db, ROLE_SALARY_BASE_MINOR[role] ?? DEFAULT_ROLE_SALARY_MINOR);
      if (!clubCanAffordSalary(db, clubId, salary)) continue;

      // Only reuse a free agent who actually specialises in this role (or has
      // no stated preference) — a scout should not get swept into fitness
      // coaching just because nothing stops them technically holding it.
      const freeAgent = market
        .unemployedStaffProfiles()
        .find(
          (profile) =>
            (profile.preferredRole === role || !profile.preferredRole) &&
            staffEligibility(role, profile, market.staffLicencesForPerson(profile.personId))
              .eligible,
        );

      let personId: EntityId;
      let salaryAmountMinor = salary;
      if (freeAgent) {
        personId = freeAgent.personId;
        salaryAmountMinor = estimateSalaryExpectation(
          role,
          market.staffLicencesForPerson(personId),
          freeAgent.reputation, countryEconomicProfile(db).wageLevel,
      );
      } else {
        countryId ??= requireHomeCountryId(db);
        const generated = generateAiStaff(
          `ai-staff:${clubId}:${role}:${worldDate}`,
          worldDate,
          countryId,
          role,
          homeNamePool(db),
          homeFederationAbbreviation(db),
        );
        if (!world.getPerson(generated.person.id)) world.insertPerson(generated.person);
        world.insertStaffProfile(generated.profile);
        world.insertStaffSimulationProfile(generated.simulation);
        for (const licence of generated.licences) world.insertStaffLicence(licence);
        personId = generated.person.id;
        salaryAmountMinor = estimateSalaryExpectation(
          role,
          generated.licences,
          generated.profile.reputation, countryEconomicProfile(db).wageLevel,
      );
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

const TECHNICAL_PLACEMENT_ROLES = new Set<FootballStaffRole>([
  "HEAD_COACH",
  "ASSISTANT_COACH",
  "FIRST_TEAM_COACH",
  "GOALKEEPER_COACH",
  "FITNESS_COACH",
  "SET_PIECE_COACH",
  "YOUTH_COACH",
  "ACADEMY_DIRECTOR",
  "SCOUT",
  "CHIEF_SCOUT",
  "ANALYST",
  "HEAD_ANALYST",
  "SPORTING_DIRECTOR",
  "TECHNICAL_DIRECTOR",
  "DIRECTOR_OF_FOOTBALL",
]);
const TECHNICAL_PLACEMENT_DAYS = 30;
const MAX_TECHNICAL_PLACEMENTS_PER_CLUB_SEASON = 2;

const technicalPartnerCountry = (db: GameDatabase, partnerClubId: EntityId): EntityId | undefined =>
  (
    db.prepare("SELECT country_id FROM clubs WHERE id=? LIMIT 1").get(partnerClubId) as
      { country_id?: EntityId } | undefined
  )?.country_id;

/** Plans at most two partner-club placements per home club and season. */
export const planTechnicalPartnershipPlacements = (
  db: GameDatabase,
  save: SaveMetadata,
  clubId: EntityId,
  maxPlacements = MAX_TECHNICAL_PLACEMENTS_PER_CLUB_SEASON,
): StaffTechnicalPlacement[] => {
  const networks = new ClubNetworkRepository(db);
  const partnerships = networks.activeTechnicalPartnerships(clubId, save.worldDate);
  if (partnerships.length === 0) return [];
  const market = new StaffMarketRepository(db);
  const year = save.worldDate.slice(0, 4);
  const seasonCount = market
    .technicalPlacementsForClub(clubId)
    .filter((item) => item.startDate.startsWith(year)).length;
  const remaining = Math.max(
    0,
    Math.min(maxPlacements, MAX_TECHNICAL_PLACEMENTS_PER_CLUB_SEASON) - seasonCount,
  );
  if (remaining === 0) return [];
  const planned: StaffTechnicalPlacement[] = [];
  for (const appointment of market.activeAppointmentsForClub(clubId)) {
    if (planned.length >= remaining || !TECHNICAL_PLACEMENT_ROLES.has(appointment.role)) continue;
    if (market.activeTechnicalPlacementForPerson(appointment.personId)) continue;
    const partnership = partnerships[planned.length % partnerships.length]!;
    if (!technicalPartnerCountry(db, partnership.toClubId)) continue;
    const placement: StaffTechnicalPlacement = {
      id: createStableEntityId(
        "staff-technical-placement",
        `${clubId}:${appointment.personId}:${partnership.id}:${save.worldDate}`,
      ),
      personId: appointment.personId,
      homeClubId: clubId,
      partnerClubId: partnership.toClubId,
      partnershipId: partnership.id,
      programmeType: "INTERNATIONAL_PLACEMENT",
      startDate: save.worldDate,
      endDate: addDays(save.worldDate, TECHNICAL_PLACEMENT_DAYS),
      status: "ACTIVE",
      developmentApplied: false,
    };
    market.upsertTechnicalPlacement(placement);
    planned.push(placement);
  }
  return planned;
};

/** Completes due placements once, improving an existing staff profile in place. */
export const completeTechnicalPartnershipPlacements = (
  db: GameDatabase,
  save: SaveMetadata,
): StaffTechnicalPlacement[] => {
  const market = new StaffMarketRepository(db);
  const completed: StaffTechnicalPlacement[] = [];
  for (const placement of market.dueTechnicalPlacements(save.worldDate)) {
    if (placement.developmentApplied) continue;
    const profile = market.staffProfile(placement.personId);
    const appointment = market.activeAppointment(placement.personId);
    const countryId = technicalPartnerCountry(db, placement.partnerClubId);
    if (!profile || !appointment || appointment.clubId !== placement.homeClubId || !countryId)
      continue;
    const nextCountries = profile.countryKnowledge.includes(countryId)
      ? profile.countryKnowledge
      : [...profile.countryKnowledge, countryId];
    new WorldRepository(db).insertStaffProfile({ ...profile, countryKnowledge: nextCountries });
    const simulation = market.staffSimulationProfile(placement.personId);
    if (simulation)
      market.updateStaffSimulationProfile({
        ...simulation,
        coachingTechnical: Math.min(20, simulation.coachingTechnical + 1),
      });
    const finished: StaffTechnicalPlacement = {
      ...placement,
      status: "COMPLETED",
      developmentApplied: true,
      completedOn: save.worldDate,
    };
    market.upsertTechnicalPlacement(finished);
    logStaffHistory(db, placement.personId, "INTERNATIONAL_PLACEMENT_COMPLETED", save.worldDate, {
      clubId: placement.homeClubId,
      appointmentId: appointment.id,
      description: `Completed technical placement with partner club ${placement.partnerClubId}.`,
    });
    completed.push(finished);
  }
  return completed;
};

// ---------------------------------------------------------------------------
// CONTEXT_ONLY club mobility and replenishment
// ---------------------------------------------------------------------------

/** Hard bounds keep external personnel context lightweight and deterministic. */
export const MAX_STAFF_CANDIDATES_PER_VACANCY = 8;
export const MAX_EXTERNAL_STAFF_VACANCIES_PER_CADENCE = 8;

/**
 * Returns the existing staff-market shortlist for one vacancy.  It is capped
 * in SQL and filtered through the same eligibility gate used by hiring; no
 * club-by-club scan of the global staff population is performed.
 */
export const shortlistStaffCandidates = (
  db: GameDatabase,
  clubId: EntityId,
  role: FootballStaffRole,
  maxCandidates = MAX_STAFF_CANDIDATES_PER_VACANCY,
): StaffProfile[] => {
  const market = new StaffMarketRepository(db);
  return market
    .staffCandidatesForClub(clubId, role, Math.min(MAX_STAFF_CANDIDATES_PER_VACANCY, maxCandidates))
    .filter(
      (profile) =>
        staffEligibility(role, profile, market.staffLicencesForPerson(profile.personId)).eligible,
    );
};

/** Opens only a genuine CONTEXT_ONLY staffing need; callers never pre-fill all global clubs. */
export const ensureExternalStaffVacancies = (
  db: GameDatabase,
  clubId: EntityId,
  roles: FootballStaffRole[],
  worldDate: string,
): StaffVacancy[] => {
  const isExternal = Boolean(
    db.prepare("SELECT 1 FROM external_club_context WHERE club_id = ? LIMIT 1").get(clubId),
  );
  if (!isExternal) return [];
  const market = new StaffMarketRepository(db);
  const team = db
    .prepare("SELECT id FROM teams WHERE club_id = ? AND level = 'senior' ORDER BY id LIMIT 1")
    .get(clubId) as { id?: EntityId } | undefined;
  const vacancies: StaffVacancy[] = [];
  for (const role of roles) {
    if (market.activeAppointmentsForClub(clubId).some((appointment) => appointment.role === role))
      continue;
    if (market.openVacancyForRole(clubId, role)) continue;
    vacancies.push(openStaffVacancy(db, clubId, role, "NEW_ROLE", worldDate));
    const vacancy = vacancies[vacancies.length - 1]!;
    if (!vacancy.teamId && team?.id) {
      market.upsertVacancy({ ...vacancy, teamId: team.id });
    }
  }
  return vacancies;
};

const externalOfferMultiplier = (db: GameDatabase, clubId: EntityId): number => {
  const row = db
    .prepare("SELECT financial_band FROM external_club_context WHERE club_id = ?")
    .get(clubId) as { financial_band?: string } | undefined;
  return row?.financial_band === "ELITE"
    ? 1.9
    : row?.financial_band === "HIGH"
      ? 1.65
      : row?.financial_band === "LOW"
        ? 1.25
        : 1.45;
};

const generateExternalStaffCandidate = (
  db: GameDatabase,
  vacancy: StaffVacancy,
  worldDate: string,
): StaffProfile | undefined => {
  if (!vacancy.clubId) return undefined;
  const club = db
    .prepare("SELECT country_id FROM external_club_context WHERE club_id = ?")
    .get(vacancy.clubId) as { country_id?: EntityId } | undefined;
  if (!club?.country_id) return undefined;
  const generated = generateAiStaff(
    `external-staff-replacement:${vacancy.id}:${vacancy.role}`,
    worldDate,
    club.country_id,
    vacancy.role,
    homeNamePool(db),
          homeFederationAbbreviation(db),
  );
  const world = new WorldRepository(db);
  if (!world.getPerson(generated.person.id)) {
    world.insertPerson(generated.person);
    world.insertPersonRole({
      id: createStableEntityId("person-role", `${generated.person.id}:STAFF`),
      personId: generated.person.id,
      role: "STAFF",
      activeFrom: worldDate,
    });
    world.insertStaffProfile(generated.profile);
    world.insertStaffSimulationProfile(generated.simulation);
    for (const licence of generated.licences) world.insertStaffLicence(licence);
  }
  return new StaffMarketRepository(db).staffProfile(generated.person.id);
};

export type ExternalStaffVacancyOutcome = {
  vacancyId: EntityId;
  personId?: EntityId;
  applicationStatus?: StaffApplicationStatus;
  generatedReplacement: boolean;
};

/**
 * One deterministic shortlist and one staff decision per genuine external
 * vacancy.  The appointment is still created by apply/accept/hire, so Nepal
 * departures, rejections, contracts and history all share the domestic path.
 */
export const processExternalStaffVacancies = (
  db: GameDatabase,
  save: SaveMetadata,
  maxVacancies = MAX_EXTERNAL_STAFF_VACANCIES_PER_CADENCE,
): ExternalStaffVacancyOutcome[] => {
  const market = new StaffMarketRepository(db);
  const vacancies = db
    .prepare(
      `SELECT sv.id FROM staff_vacancies sv
       JOIN external_club_context ecc ON ecc.club_id = sv.club_id
       WHERE sv.status = 'VACANT'
       ORDER BY sv.opened_on, sv.id
       LIMIT ?`,
    )
    .all(Math.max(1, Math.min(MAX_EXTERNAL_STAFF_VACANCIES_PER_CADENCE, maxVacancies))) as Array<{
    id: EntityId;
  }>;
  const outcomes: ExternalStaffVacancyOutcome[] = [];
  for (const { id } of vacancies) {
    const vacancy = market.vacancyById(id);
    if (!vacancy?.clubId) continue;
    let candidates = shortlistStaffCandidates(
      db,
      vacancy.clubId,
      vacancy.role,
      MAX_STAFF_CANDIDATES_PER_VACANCY,
    );
    let generatedReplacement = false;
    if (candidates.length === 0) {
      const generated = generateExternalStaffCandidate(db, vacancy, save.worldDate);
      if (generated) {
        candidates = [generated];
        generatedReplacement = true;
      }
    }
    const candidate = candidates[0];
    if (!candidate) {
      outcomes.push({ vacancyId: vacancy.id, generatedReplacement });
      continue;
    }
    const salary = Math.round(
      estimateSalaryExpectation(
        vacancy.role,
        market.staffLicencesForPerson(candidate.personId),
        candidate.reputation, countryEconomicProfile(db).wageLevel,
    ) * externalOfferMultiplier(db, vacancy.clubId),
    );
    const { application } = applyForStaffVacancy(db, save, vacancy.id, candidate.personId, salary);
    if (application.status === "OFFERED" || application.status === "COUNTERED") {
      acceptStaffApplication(db, save, application.id);
    }
    outcomes.push({
      vacancyId: vacancy.id,
      personId: candidate.personId,
      applicationStatus: application.status,
      generatedReplacement,
    });
  }
  return outcomes;
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
  performance: StaffPerformanceRecord[];
};

export const staffCareerHistory = (
  db: GameDatabase,
  personId: EntityId,
): StaffCareerHistoryView => {
  const market = new StaffMarketRepository(db);
  return {
    history: market.staffHistoryForPerson(personId),
    contracts: market.employmentContractsForPerson(personId),
    performance: market.performanceHistoryForPerson(personId),
  };
};

// ===========================================================================
// Phase B — negotiation, interest, performance, licence pathway, poaching
// ===========================================================================

// ---------------------------------------------------------------------------
// Club reputation and staff interest
// ---------------------------------------------------------------------------

/** How prestigious a club looks to a prospective employee — board ambition plus league standing. */
export const clubReputationScore = (
  db: GameDatabase,
  clubId: EntityId,
  worldDate: string,
): number => {
  const external = db
    .prepare("SELECT reputation FROM external_club_context WHERE club_id = ? LIMIT 1")
    .get(clubId) as { reputation?: number } | undefined;
  if (external?.reputation !== undefined) return clamp(Number(external.reputation), 0, 100);
  let score = 50;
  const policy = new ClubEconomyRepository(db).boardPolicy(clubId);
  if (policy) {
    const bump: Partial<Record<typeof policy.strategicObjective, number>> = {
      TITLE_CHALLENGE: 25,
      PROMOTION: 12,
      COMMERCIAL_GROWTH: 5,
      SURVIVE: -15,
    };
    score += bump[policy.strategicObjective] ?? 0;
  }
  const seasonId = currentSeasonId(db, worldDate);
  if (seasonId) {
    // league_standings carries no explicit position column — rank by points,
    // then goal difference, same tiebreak order the league table itself uses.
    const row = db
      .prepare(
        `SELECT ls.points AS points, ls.goal_difference AS gd,
          1 + (
            SELECT COUNT(*) FROM league_standings other
            WHERE other.competition_season_id = ls.competition_season_id
              AND (other.points > ls.points OR (other.points = ls.points AND other.goal_difference > ls.goal_difference))
          ) AS position
        FROM league_standings ls
        JOIN club_memberships cm ON cm.team_id = ls.team_id AND cm.competition_season_id = ls.competition_season_id
        WHERE cm.club_id = ? AND ls.competition_season_id = ?`,
      )
      .get(clubId, seasonId) as SqlRow | undefined;
    if (row?.position) score += clamp((10 - row.position) * 2, -15, 15);
  }
  return clamp(score, 0, 100);
};

const ROLE_SENIORITY_RANK: Partial<Record<FootballStaffRole, number>> = {
  SPORTING_DIRECTOR: 9,
  TECHNICAL_DIRECTOR: 9,
  HEAD_COACH: 8,
  CHIEF_SCOUT: 6,
  ACADEMY_DIRECTOR: 6,
  ASSISTANT_COACH: 5,
  FIRST_TEAM_COACH: 5,
  DOCTOR: 5,
  HEAD_PHYSIO: 5,
  HEAD_ANALYST: 4,
  GOALKEEPER_COACH: 4,
  FITNESS_COACH: 4,
  SPORTS_SCIENTIST: 4,
  PSYCHOLOGIST: 4,
  SET_PIECE_COACH: 3,
  YOUTH_COACH: 3,
  ANALYST: 3,
  PHYSIO: 3,
  SCOUT: 2,
  NUTRITIONIST: 2,
};
const seniorityRankOf = (role: FootballStaffRole): number => ROLE_SENIORITY_RANK[role] ?? 3;

export type StaffInterestFactors = {
  score: number;
  reasons: string[];
};

/**
 * How keen a candidate is on one specific offer, from real inputs only: the
 * hiring club's reputation, whether the role is a step up or down for them,
 * how the salary compares to what they'd expect, their licence/role fit, and
 * — for a foreign candidate — whether the money is worth relocating for.
 */
export const staffInterestScore = (
  db: GameDatabase,
  personId: EntityId,
  clubId: EntityId,
  role: FootballStaffRole,
  offeredSalaryMinor: number,
  worldDate: string,
): StaffInterestFactors => {
  const market = new StaffMarketRepository(db);
  const profile = market.staffProfile(personId);
  const licences = market.staffLicencesForPerson(personId);
  const reasons: string[] = [];
  let score = 50;

  const reputation = clubReputationScore(db, clubId, worldDate);
  score += (reputation - 50) * 0.3;
  if (reputation >= 70) reasons.push("Club reputation is a strong draw.");
  else if (reputation <= 30) reasons.push("Club reputation is unappealing.");

  const eligibility = staffEligibility(role, profile, licences);
  if (!eligibility.eligible) {
    score -= 40;
    reasons.push(eligibility.note ?? "Not qualified for the role.");
  } else if (profile?.preferredRole === role) {
    score += 10;
    reasons.push("Exactly the role they specialise in.");
  }

  const expectation = estimateSalaryExpectation(role, licences, profile?.reputation, countryEconomicProfile(db).wageLevel);
  const salaryRatio = expectation > 0 ? offeredSalaryMinor / expectation : 1;
  score += clamp((salaryRatio - 1) * 60, -30, 30);
  if (salaryRatio >= 1.1) reasons.push("Salary comfortably beats their expectation.");
  else if (salaryRatio < 0.9) reasons.push("Salary falls short of their expectation.");

  const currentAppointment = market.activeAppointment(personId);
  if (currentAppointment) {
    const currentRank = seniorityRankOf(currentAppointment.role);
    const offeredRank = seniorityRankOf(role);
    if (offeredRank > currentRank) {
      score += 15;
      reasons.push("A genuine step up in their career.");
    } else if (offeredRank < currentRank) {
      score -= 15;
      reasons.push("A step down from their current role.");
    }
  }

  const managerRelationship = new PeopleFoundationRepository(db)
    .relationshipsForPerson(personId)
    .filter((relationship) => relationship.kind === "STAFF_MANAGER")
    .sort((a, b) => b.updatedOn.localeCompare(a.updatedOn))[0];
  if (managerRelationship) {
    const cooperation = assessStaffCooperation({
      trust: managerRelationship.trust,
      respect: managerRelationship.respect,
      tension: managerRelationship.tension,
    });
    score += cooperation.recruitmentModifier;
    if (cooperation.label === "CONFLICT" || cooperation.label === "STRAINED") {
      reasons.push("The manager relationship makes the move less attractive.");
    }
  }

  const personCountry = db
    .prepare("SELECT nationality_country_id FROM persons WHERE id = ?")
    .get(personId) as { nationality_country_id?: EntityId } | undefined;
  const clubCountry = db.prepare("SELECT country_id FROM clubs WHERE id = ?").get(clubId) as
    { country_id?: EntityId } | undefined;
  if (
    personCountry?.nationality_country_id &&
    clubCountry?.country_id &&
    personCountry.nationality_country_id !== clubCountry.country_id
  ) {
    // Relocation is symmetric: a foreign coach moving to Nepal and a Nepali
    // coach moving abroad both need a materially better offer.
    // Relocation remains a meaningful hurdle even when the salary is strong;
    // a premium can reduce the reluctance, but must not turn an otherwise
    // identical foreign offer into a higher-interest result than a domestic
    // one at the same salary.
    score += salaryRatio >= 1.3 ? -5 : -20;
    reasons.push(
      salaryRatio >= 1.3
        ? "Salary partly offsets the relocation hurdle."
        : "Not enough on offer to relocate abroad.",
    );
  }

  const externalReach = db
    .prepare("SELECT recruitment_regions_json FROM external_club_context WHERE club_id = ? LIMIT 1")
    .get(clubId) as { recruitment_regions_json?: string } | undefined;
  if (externalReach && isDomesticPerson(db, personId)) {
    const regions = JSON.parse(externalReach.recruitment_regions_json ?? "[]") as string[];
    if (regions.includes("SOUTH_ASIA")) {
      score += 12;
      reasons.push("The club has established South Asian recruitment reach.");
    } else {
      score -= 12;
      reasons.push("The club has limited recruitment reach in the staff member's region.");
    }
  }

  return { score: clamp(Math.round(score), 0, 100), reasons };
};

// ---------------------------------------------------------------------------
// Hire negotiation (against an open vacancy)
// ---------------------------------------------------------------------------

export class StaffNegotiationError extends Error {
  constructor(
    readonly code:
      | "APPLICATION_NOT_FOUND"
      | "APPLICATION_NOT_ACTIONABLE"
      | "VACANCY_NOT_FOUND"
      | "OFFER_NOT_FOUND"
      | "OFFER_NOT_ACTIONABLE"
      | "ROLE_NOT_AUTHORIZED",
    message: string,
  ) {
    super(message);
  }
}

export type StaffHireAttemptResult = { application: StaffApplication; reason?: string };

/**
 * The club proposes terms for one candidate against one open vacancy;
 * resolves immediately. A REJECTED outcome is a normal, well-formed business
 * result (unaffordable, unqualified, uninterested) — it is always returned
 * with a real `reason`, never silently. `callerClubId`, when supplied,
 * confines the vacancy to that club; AI/external callers that already only
 * ever operate on their own vacancy's clubId may omit it.
 */
export const applyForStaffVacancy = (
  db: GameDatabase,
  save: SaveMetadata,
  vacancyId: EntityId,
  personId: EntityId,
  proposedSalaryMinor: number,
  proposedContractMonths = 24,
  callerClubId?: EntityId,
): StaffHireAttemptResult => {
  const market = new StaffMarketRepository(db);
  const vacancy = market.vacancyById(vacancyId);
  if (!vacancy || vacancy.status !== "VACANT" || !vacancy.clubId) {
    throw new StaffNegotiationError("VACANCY_NOT_FOUND", "That vacancy is no longer open.");
  }
  if (callerClubId && vacancy.clubId !== callerClubId) {
    throw new StaffNegotiationError("ROLE_NOT_AUTHORIZED", "You do not manage that club.");
  }
  // Deliberately no "already employed elsewhere" guard here: staff mobility
  // (a candidate currently active at one club moving to another) is an
  // existing, tested feature — acceptStaffApplication already retires the
  // prior appointment to FORMER when a new one is accepted. A stale-candidate
  // race (someone else hires them between the client's list load and this
  // call) resolves the same honest way: whichever application is accepted
  // first wins, the other club's earlier appointment ends cleanly.
  const worldDate = save.worldDate;
  const profile = market.staffProfile(personId);
  const licences = market.staffLicencesForPerson(personId);
  const eligibility = staffEligibility(vacancy.role, profile, licences);
  const canAfford = clubCanAffordSalary(db, vacancy.clubId, proposedSalaryMinor);
  const interest = staffInterestScore(
    db,
    personId,
    vacancy.clubId,
    vacancy.role,
    proposedSalaryMinor,
    worldDate,
  );
  const rng = new SeededRandom(`staff-application:${vacancyId}:${personId}:${worldDate}`);
  const roll = rng.next() * 100;

  let status: StaffApplicationStatus;
  let counterSalaryMinor: number | undefined;
  let reason: string | undefined;
  if (profile?.availability === "RETIRED") {
    status = "REJECTED";
    reason = "This candidate has retired.";
  } else if (!eligibility.eligible) {
    status = "REJECTED";
    reason = eligibility.note ?? "Not qualified for this role.";
  } else if (!canAfford) {
    status = "REJECTED";
    reason = "Your club cannot afford this salary.";
  } else if (interest.score - roll * 0.3 >= 60) {
    status = "OFFERED";
  } else if (interest.score - roll * 0.3 >= 35) {
    status = "COUNTERED";
    counterSalaryMinor = Math.round(
      Math.max(
        proposedSalaryMinor,
        estimateSalaryExpectation(vacancy.role, licences, profile?.reputation, countryEconomicProfile(db).wageLevel),
      ) * 1.12,
    );
    reason = "The candidate wants a higher salary.";
  } else {
    status = "REJECTED";
    reason = "The candidate was not interested at these terms.";
  }

  const application: StaffApplication = {
    id: createEntityId(),
    vacancyId,
    personId,
    status,
    createdOn: worldDate,
    decidedOn: worldDate,
    offeredSalaryMinor: status === "OFFERED" ? proposedSalaryMinor : undefined,
    offeredContractEnd:
      status === "OFFERED" ? addDays(worldDate, proposedContractMonths * 30) : undefined,
    counterSalaryMinor,
  };
  market.insertApplication(application);
  return { application, reason };
};

/** Finalizes an OFFERED or COUNTERED application into a real hire, at whichever terms are pending. */
export const acceptStaffApplication = (
  db: GameDatabase,
  save: SaveMetadata,
  applicationId: EntityId,
  contractMonths = 24,
): StaffAppointment => {
  const market = new StaffMarketRepository(db);
  const application = market.applicationById(applicationId);
  if (!application)
    throw new StaffNegotiationError("APPLICATION_NOT_FOUND", "That application no longer exists.");
  if (application.status !== "OFFERED" && application.status !== "COUNTERED") {
    throw new StaffNegotiationError(
      "APPLICATION_NOT_ACTIONABLE",
      "That application is no longer open to accept.",
    );
  }
  const vacancy = market.vacancyById(application.vacancyId);
  if (!vacancy || !vacancy.clubId) {
    throw new StaffNegotiationError("VACANCY_NOT_FOUND", "That vacancy is no longer open.");
  }
  const salary =
    application.status === "COUNTERED"
      ? application.counterSalaryMinor!
      : application.offeredSalaryMinor!;
  const previous = market.activeAppointment(application.personId);
  if (previous && previous.clubId !== vacancy.clubId) {
    releaseStaffForMove(
      db,
      save,
      previous,
      `Resigned to join ${vacancy.role.replace(/_/g, " ").toLowerCase()} employment at another club.`,
    );
  }
  const appointment = hireStaff(
    db,
    save,
    vacancy.clubId,
    vacancy.teamId,
    application.personId,
    vacancy.role,
    salary,
    contractMonths,
  );
  market.insertApplication({ ...application, status: "ACCEPTED", decidedOn: save.worldDate });
  return appointment;
};

export const declineStaffApplication = (
  db: GameDatabase,
  save: SaveMetadata,
  applicationId: EntityId,
): void => {
  const market = new StaffMarketRepository(db);
  const application = market.applicationById(applicationId);
  if (!application)
    throw new StaffNegotiationError("APPLICATION_NOT_FOUND", "That application no longer exists.");
  market.insertApplication({ ...application, status: "DECLINED", decidedOn: save.worldDate });
};

// ---------------------------------------------------------------------------
// Renewal negotiation (against an existing appointment)
// ---------------------------------------------------------------------------

/** The club proposes new terms to keep an existing staff member; resolves immediately. */
export const offerStaffRenewal = (
  db: GameDatabase,
  save: SaveMetadata,
  appointmentId: EntityId,
  proposedSalaryMinor: number,
  proposedContractMonths = 24,
): StaffRenewalOffer => {
  const market = new StaffMarketRepository(db);
  const appointment = market.appointmentById(appointmentId);
  if (!appointment || appointment.employmentStatus !== "ACTIVE" || !appointment.clubId) {
    throw new StaffNegotiationError("APPLICATION_NOT_FOUND", "That appointment is not active.");
  }
  const worldDate = save.worldDate;
  const interest = staffInterestScore(
    db,
    appointment.personId,
    appointment.clubId,
    appointment.role,
    proposedSalaryMinor,
    worldDate,
  );
  const rng = new SeededRandom(`staff-renewal-offer:${appointmentId}:${worldDate}`);
  const roll = rng.next() * 100;

  let status: StaffRenewalOfferStatus;
  let counterSalaryMinor: number | undefined;
  if (interest.score - roll * 0.3 >= 55) {
    status = "ACCEPTED";
  } else if (interest.score - roll * 0.3 >= 30) {
    status = "COUNTERED";
    const licences = market.staffLicencesForPerson(appointment.personId);
    counterSalaryMinor = Math.round(
      Math.max(
        proposedSalaryMinor,
        estimateSalaryExpectation(
          appointment.role,
          licences,
          market.staffProfile(appointment.personId)?.reputation, countryEconomicProfile(db).wageLevel,
      ),
      ) * 1.1,
    );
  } else {
    status = "REJECTED";
  }

  const offer: StaffRenewalOffer = {
    id: createEntityId(),
    appointmentId,
    personId: appointment.personId,
    clubId: appointment.clubId,
    proposedSalaryMinor,
    proposedContractEnd: addDays(worldDate, proposedContractMonths * 30),
    counterSalaryMinor,
    status,
    createdOn: worldDate,
    decidedOn: worldDate,
  };
  market.upsertRenewalOffer(offer);

  if (status === "ACCEPTED") {
    finalizeRenewal(db, appointment, proposedSalaryMinor, offer.proposedContractEnd, worldDate);
  }
  return offer;
};

const finalizeRenewal = (
  db: GameDatabase,
  appointment: StaffAppointment,
  salaryAmountMinor: number,
  contractEnd: string,
  worldDate: string,
): void => {
  const market = new StaffMarketRepository(db);
  if (appointment.contractId) {
    const contract = market.employmentContractById(appointment.contractId);
    if (contract) {
      adjustClubWageSpend(db, contract.clubId, salaryAmountMinor - contract.salaryAmountMinor);
      market.upsertEmploymentContract({
        ...contract,
        salaryAmountMinor,
        contractEnd,
        status: "ACTIVE",
      });
    }
  }
  logStaffHistory(db, appointment.personId, "STAFF_JOINED", worldDate, {
    appointmentId: appointment.id,
    clubId: appointment.clubId,
    teamId: appointment.teamId,
    description: "Contract renewed.",
  });
};

/** Accepts the candidate's counter — the manager blinks first, on their terms. */
export const acceptStaffRenewalCounter = (
  db: GameDatabase,
  save: SaveMetadata,
  offerId: EntityId,
): StaffRenewalOffer => {
  const market = new StaffMarketRepository(db);
  const offer = market.renewalOfferById(offerId);
  if (!offer)
    throw new StaffNegotiationError("OFFER_NOT_FOUND", "That renewal offer no longer exists.");
  if (offer.status !== "COUNTERED") {
    throw new StaffNegotiationError(
      "OFFER_NOT_ACTIONABLE",
      "That offer has no pending counter to accept.",
    );
  }
  const appointment = market.appointmentById(offer.appointmentId);
  if (!appointment)
    throw new StaffNegotiationError("APPLICATION_NOT_FOUND", "That appointment is not active.");

  const accepted: StaffRenewalOffer = { ...offer, status: "ACCEPTED", decidedOn: save.worldDate };
  market.upsertRenewalOffer(accepted);
  finalizeRenewal(
    db,
    appointment,
    offer.counterSalaryMinor!,
    offer.proposedContractEnd,
    save.worldDate,
  );
  return accepted;
};

export const declineStaffRenewalOffer = (
  db: GameDatabase,
  save: SaveMetadata,
  offerId: EntityId,
): void => {
  const market = new StaffMarketRepository(db);
  const offer = market.renewalOfferById(offerId);
  if (!offer)
    throw new StaffNegotiationError("OFFER_NOT_FOUND", "That renewal offer no longer exists.");
  market.upsertRenewalOffer({ ...offer, status: "DECLINED", decidedOn: save.worldDate });
};

// ---------------------------------------------------------------------------
// Performance tracking and reputation progression
// ---------------------------------------------------------------------------

const REPUTATION_LADDER = ["LOW", "MEDIUM", "HIGH"];

const stepReputation = (current: string | undefined, direction: 1 | -1): string => {
  const index = REPUTATION_LADDER.indexOf(current ?? "MEDIUM");
  const base = index === -1 ? 1 : index;
  return REPUTATION_LADDER[clamp(base + direction, 0, REPUTATION_LADDER.length - 1)]!;
};

const COACHING_ROLES = new Set<FootballStaffRole>([
  "ASSISTANT_COACH",
  "FIRST_TEAM_COACH",
  "GOALKEEPER_COACH",
  "FITNESS_COACH",
  "SET_PIECE_COACH",
  "YOUTH_COACH",
]);
const SCOUTING_ROLES = new Set<FootballStaffRole>([
  "SCOUT",
  "CHIEF_SCOUT",
  "ANALYST",
  "HEAD_ANALYST",
]);
const MEDICAL_ROLES = new Set<FootballStaffRole>([
  "PHYSIO",
  "HEAD_PHYSIO",
  "DOCTOR",
  "SPORTS_SCIENTIST",
]);

const rolePerformanceScore = (
  db: GameDatabase,
  appointment: StaffAppointment,
  worldDate: string,
): { score: number; note: string } => {
  if (appointment.teamId && COACHING_ROLES.has(appointment.role)) {
    const seasonId = currentSeasonId(db, worldDate);
    const row = seasonId
      ? (db
          .prepare(
            "SELECT played, points FROM league_standings WHERE team_id = ? AND competition_season_id = ?",
          )
          .get(appointment.teamId, seasonId) as SqlRow | undefined)
      : undefined;
    if (row?.played) {
      const ppg = row.points / row.played;
      return {
        score: clamp(Math.round(ppg * 33.3), 0, 100),
        note: `Team averaging ${ppg.toFixed(2)} points/game.`,
      };
    }
    return { score: 50, note: "No results yet this season." };
  }
  if (appointment.teamId && SCOUTING_ROLES.has(appointment.role)) {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS total FROM scouting_assignments WHERE scout_person_id = ? AND status = 'COMPLETED'",
      )
      .get(appointment.personId) as SqlRow | undefined;
    const completed = row?.total ?? 0;
    return {
      score: clamp(40 + completed * 5, 0, 100),
      note: `${completed} completed scouting assignment(s).`,
    };
  }
  if (appointment.teamId && MEDICAL_ROLES.has(appointment.role)) {
    const row = db
      .prepare(
        "SELECT AVG(fitness) AS avg_fitness FROM player_availability_states WHERE team_id = ?",
      )
      .get(appointment.teamId) as SqlRow | undefined;
    const avgFitness = row?.avg_fitness ?? 75;
    return {
      score: clamp(Math.round(avgFitness), 0, 100),
      note: `Squad averaging ${Math.round(avgFitness)} fitness.`,
    };
  }
  return { score: 50, note: "No role-specific performance signal available." };
};

const PERFORMANCE_REVIEW_INTERVAL_DAYS = 30;

/** Reviews every active appointment at the club once per interval, from real proxies, and drifts reputation accordingly. */
export const evaluateStaffPerformance = (
  db: GameDatabase,
  save: SaveMetadata,
  clubId: EntityId,
): StaffPerformanceRecord[] => {
  const market = new StaffMarketRepository(db);
  const worldDate = save.worldDate;
  const records: StaffPerformanceRecord[] = [];

  for (const appointment of market.activeAppointmentsForClub(clubId)) {
    const history = market.performanceHistoryForPerson(appointment.personId);
    const last = history[history.length - 1];
    if (last && daysBetween(last.periodEnd, worldDate) < PERFORMANCE_REVIEW_INTERVAL_DAYS) continue;

    const { score, note } = rolePerformanceScore(db, appointment, worldDate);
    const record: StaffPerformanceRecord = {
      id: createEntityId(),
      personId: appointment.personId,
      appointmentId: appointment.id,
      clubId,
      periodEnd: worldDate,
      score,
      note,
    };
    market.insertPerformanceRecord(record);
    records.push(record);

    const profile = market.staffProfile(appointment.personId);
    if (profile) {
      const nextReputation =
        score >= 70
          ? stepReputation(profile.reputation, 1)
          : score <= 30
            ? stepReputation(profile.reputation, -1)
            : profile.reputation;
      if (nextReputation !== profile.reputation) {
        new WorldRepository(db).insertStaffProfile({ ...profile, reputation: nextReputation });
      }
    }
  }
  return records;
};

// ---------------------------------------------------------------------------
// Coaching licence progression pathway
// ---------------------------------------------------------------------------

const LICENCE_COURSE_MONTHS = 6;
const LICENCE_COURSE_COST_MINOR = 300_000;

const nextLicenceType = (currentRank: number): string | undefined =>
  Object.entries(LICENCE_RANK).find(([, rank]) => rank === currentRank + 1)?.[0];

export class LicenceCourseError extends Error {
  constructor(
    readonly code: "ALREADY_ENROLLED" | "MAX_LICENCE" | "CANNOT_AFFORD" | "NOT_WILLING",
    message: string,
  ) {
    super(message);
  }
}

/** Enrols a staff member in the next coaching-licence level up, club-funded when budget allows. */
export const enrolInLicenceCourse = (
  db: GameDatabase,
  save: SaveMetadata,
  personId: EntityId,
  fundedByClubId?: EntityId,
): StaffLicenceCourse => {
  const market = new StaffMarketRepository(db);
  if (market.activeLicenceCourseForPerson(personId)) {
    throw new LicenceCourseError("ALREADY_ENROLLED", "Already enrolled in a licence course.");
  }
  const currentRank = licenceRankOf(market.staffLicencesForPerson(personId));
  const target = nextLicenceType(currentRank);
  if (!target)
    throw new LicenceCourseError("MAX_LICENCE", "Already holds the highest coaching licence.");
  if (fundedByClubId && !clubCanAffordSalary(db, fundedByClubId, scalePrice(db, LICENCE_COURSE_COST_MINOR))) {
    throw new LicenceCourseError("CANNOT_AFFORD", "The club cannot fund this course right now.");
  }
  const personality = new PeopleFoundationRepository(db).personality(personId);
  const managerRelationship = new PeopleFoundationRepository(db)
    .relationshipsForPerson(personId)
    .filter((relationship) => relationship.kind === "STAFF_MANAGER")
    .sort((a, b) => b.updatedOn.localeCompare(a.updatedOn))[0];
  const willingness = assessStaffDevelopmentWillingness({
    professionalism: personality?.traits.professionalism,
    ambition: personality?.traits.ambition,
    adaptability: personality?.traits.adaptability,
    currentQualification: currentRank,
    clubSupport: fundedByClubId ? 8 : 5,
    managerTrust: managerRelationship?.trust,
  });
  if (personality && willingness.decision === "DECLINE") {
    throw new LicenceCourseError(
      "NOT_WILLING",
      "The staff member is not willing to prioritise this course now.",
    );
  }
  const worldDate = save.worldDate;
  const course: StaffLicenceCourse = {
    id: createEntityId(),
    personId,
    fundedByClubId,
    targetLicenceType: target,
    startedOn: worldDate,
    completesOn: addDays(worldDate, LICENCE_COURSE_MONTHS * 30),
    status: "IN_PROGRESS",
  };
  market.upsertLicenceCourse(course);
  return course;
};

/** Completes any licence course whose date has arrived, issuing the new licence. */
export const evaluateLicenceCourses = (
  db: GameDatabase,
  save: SaveMetadata,
): StaffLicenceCourse[] => {
  const market = new StaffMarketRepository(db);
  const worldDate = save.worldDate;
  const completed: StaffLicenceCourse[] = [];
  for (const course of market.allInProgressLicenceCourses()) {
    if (worldDate < course.completesOn) continue;
    const finished: StaffLicenceCourse = { ...course, status: "COMPLETED" };
    market.upsertLicenceCourse(finished);
    new WorldRepository(db).insertStaffLicence({
      id: createEntityId(),
      personId: course.personId,
      licenceType: course.targetLicenceType,
      issuer: homeFederationAbbreviation(db),
      issueDate: worldDate,
      status: "VERIFIED",
    });
    logStaffHistory(db, course.personId, "STAFF_LICENCE_UPGRADED", worldDate, {
      description: `Qualified for ${course.targetLicenceType.replace(/_/g, " ")}.`,
    });
    completed.push(finished);
  }
  return completed;
};

const AI_COURSE_ENROLMENT_CHANCE_PER_TICK = 12;

/**
 * AI clubs occasionally send an eligible staff member on the same
 * licence-course pipeline the human path uses (`enrolInLicenceCourse`) — no
 * separate course system, no instant upgrades. A deterministic, seeded
 * per-appointment roll each tick keeps this bounded (not every eligible
 * AI staff member enrols the moment they qualify), and every rejection
 * reason `enrolInLicenceCourse` already enforces (already enrolled, max
 * licence, cannot afford, not personally willing) applies exactly as it
 * does for the human path.
 */
export const evaluateAiStaffDevelopment = (
  db: GameDatabase,
  save: SaveMetadata,
  playerClubId: EntityId | undefined,
): StaffLicenceCourse[] => {
  const market = new StaffMarketRepository(db);
  const worldDate = save.worldDate;
  const clubIds = new Set(
    seniorTeams(db, worldDate)
      .map((team) => team.clubId)
      .filter((id): id is EntityId => Boolean(id)),
  );
  const started: StaffLicenceCourse[] = [];
  for (const clubId of clubIds) {
    if (clubId === playerClubId) continue;
    for (const appointment of market.activeAppointmentsForClub(clubId)) {
      if (market.activeLicenceCourseForPerson(appointment.personId)) continue;
      const rng = new SeededRandom(`ai-staff-course:${appointment.id}:${worldDate}`);
      if (rng.next() * 100 >= AI_COURSE_ENROLMENT_CHANCE_PER_TICK) continue;
      try {
        started.push(enrolInLicenceCourse(db, save, appointment.personId, clubId));
      } catch (error) {
        if (error instanceof LicenceCourseError) continue;
        throw error;
      }
    }
  }
  return started;
};

// ---------------------------------------------------------------------------
// Poaching and resignations
// ---------------------------------------------------------------------------

const POACH_SALARY_PREMIUM = 1.2;
const POACH_INTEREST_THRESHOLD = 70;

/**
 * Rival clubs occasionally approach *employed* staff elsewhere for their own
 * open core roles, at a premium over the target's current salary. Outside
 * the player's own club this resolves silently; against the player's own
 * staff it can end in a real resignation — the only real defence is having
 * renewed them onto a competitive contract already.
 */
export const evaluateStaffPoaching = (
  db: GameDatabase,
  save: SaveMetadata,
  playerClubId: EntityId | undefined,
): StaffApproach[] => {
  const market = new StaffMarketRepository(db);
  const worldDate = save.worldDate;
  const teams = seniorTeams(db, worldDate);
  const clubIds = new Set(
    teams.map((team) => team.clubId).filter((id): id is EntityId => Boolean(id)),
  );
  const approaches: StaffApproach[] = [];

  for (const clubId of clubIds) {
    for (const role of CORE_CLUB_ROLES) {
      if (market.activeAppointmentsForClub(clubId).some((appointment) => appointment.role === role))
        continue;
      const vacancy = market.openVacancyForRole(clubId, role);
      if (!vacancy?.openedOn || daysBetween(vacancy.openedOn, worldDate) < VACANCY_GRACE_DAYS)
        continue;

      const target = findPoachTarget(db, clubId, role);
      if (!target) continue;
      const contract = target.contractId
        ? market.employmentContractById(target.contractId)
        : undefined;
      const offeredSalaryMinor = Math.round(
        (contract?.salaryAmountMinor ?? estimateSalaryExpectation(role, [], undefined, countryEconomicProfile(db).wageLevel)) *
          POACH_SALARY_PREMIUM,
      );
      const interest = staffInterestScore(
        db,
        target.personId,
        clubId,
        role,
        offeredSalaryMinor,
        worldDate,
      );
      if (interest.score < POACH_INTEREST_THRESHOLD) continue;
      const personality = new PeopleFoundationRepository(db).personality(target.personId);
      const managerRelationship = new PeopleFoundationRepository(db)
        .relationshipsForPerson(target.personId)
        .filter((relationship) => relationship.kind === "STAFF_MANAGER")
        .sort((a, b) => b.updatedOn.localeCompare(a.updatedOn))[0];
      const departure = assessStaffDeparture({
        ambition: personality?.traits.ambition,
        loyalty: personality?.traits.loyalty,
        clubReputation: 50,
        wageStatus: 50,
        managerTrust: managerRelationship?.trust,
        tension: managerRelationship?.tension,
        opportunity: clamp(Math.round((interest.score - 50) * 1.5), 0, 50),
        tenureMonths: target.startDate
          ? Math.max(0, Math.round(daysBetween(target.startDate, worldDate) / 30))
          : 12,
      });
      if (departure.decision !== "LEAVE") continue;
      if (!clubCanAffordSalary(db, clubId, offeredSalaryMinor)) continue;

      const approach: StaffApproach = {
        id: createEntityId(),
        personId: target.personId,
        fromClubId: clubId,
        currentClubId: target.clubId,
        role,
        offeredSalaryMinor,
        status: "PENDING",
        createdOn: worldDate,
      };
      market.insertApproach(approach);
      approaches.push(approach);

      const rng = new SeededRandom(`staff-poach:${approach.id}:${worldDate}`);
      if (target.clubId === playerClubId) {
        // The player's own staff: give it a beat before resolving, so a
        // renewal offered right after can still save the situation.
        continue;
      }
      if (rng.next() * 100 < interest.score) {
        resolvePoach(db, save, approach, target);
      } else {
        market.insertApproach({ ...approach, status: "DECLINED", decidedOn: worldDate });
      }
    }
  }

  // Give any pending approach against the player's own staff a fair chance
  // to resolve on a later tick, once the grace window has passed.
  if (playerClubId) {
    for (const approach of market.approachesForClub(playerClubId)) {
      if (approach.status !== "PENDING") continue;
      if (daysBetween(approach.createdOn, worldDate) < VACANCY_GRACE_DAYS) continue;
      const target = market.activeAppointment(approach.personId);
      if (!target || target.clubId !== playerClubId) continue;
      const interest = staffInterestScore(
        db,
        approach.personId,
        approach.fromClubId,
        approach.role,
        approach.offeredSalaryMinor,
        worldDate,
      );
      const rng = new SeededRandom(`staff-poach-resolve:${approach.id}:${worldDate}`);
      if (rng.next() * 100 < interest.score) {
        resolvePoach(db, save, approach, target);
      } else {
        market.insertApproach({ ...approach, status: "DECLINED", decidedOn: worldDate });
      }
    }
  }

  return approaches;
};

const findPoachTarget = (
  db: GameDatabase,
  excludeClubId: EntityId,
  role: FootballStaffRole,
): StaffAppointment | undefined => {
  const row = db
    .prepare(
      `SELECT sa.* FROM staff_appointments sa
      LEFT JOIN external_club_context ecc ON ecc.club_id = sa.club_id
      WHERE sa.role = ? AND sa.employment_status = 'ACTIVE' AND (sa.club_id IS NULL OR sa.club_id != ?)
      ORDER BY CASE WHEN ecc.club_id IS NOT NULL THEN 0 ELSE 1 END, sa.person_id
      LIMIT 1`,
    )
    .get(role, excludeClubId) as SqlRow | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    personId: row.person_id,
    organisationType: row.organisation_type,
    clubId: row.club_id ?? undefined,
    teamId: row.team_id ?? undefined,
    role: row.role,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    employmentStatus: row.employment_status,
    contractId: row.contract_id ?? undefined,
    serviceRankTitle: row.service_rank_title ?? undefined,
  };
};

const resolvePoach = (
  db: GameDatabase,
  save: SaveMetadata,
  approach: StaffApproach,
  target: StaffAppointment,
): void => {
  const market = new StaffMarketRepository(db);
  const worldDate = save.worldDate;
  market.insertApproach({ ...approach, status: "ACCEPTED", decidedOn: worldDate });

  if (target.employmentStatus === "ACTIVE") {
    releaseStaffForMove(
      db,
      save,
      target,
      "Resigned to join another club for a better opportunity.",
    );
  }
  hireStaff(
    db,
    save,
    approach.fromClubId,
    undefined,
    approach.personId,
    approach.role,
    approach.offeredSalaryMinor,
  );
};

// ===========================================================================
// Phase C — hierarchy, delegation, workload, development, succession
// ===========================================================================

// ---------------------------------------------------------------------------
// Responsibility domains and delegation
// ---------------------------------------------------------------------------

/** Which roles are actually qualified to own each responsibility domain. */
const DOMAIN_ELIGIBLE_ROLES: Record<StaffResponsibilityDomain, FootballStaffRole[]> = {
  TRANSFERS: ["SPORTING_DIRECTOR", "TECHNICAL_DIRECTOR", "DIRECTOR_OF_FOOTBALL"],
  SCOUTING: ["CHIEF_SCOUT", "SCOUT"],
  CONTRACTS: ["SPORTING_DIRECTOR", "TECHNICAL_DIRECTOR", "DIRECTOR_OF_FOOTBALL"],
  YOUTH: ["ACADEMY_DIRECTOR", "YOUTH_COACH"],
  TRAINING: ["HEAD_COACH", "ASSISTANT_COACH", "FIRST_TEAM_COACH", "FITNESS_COACH"],
  MEDICAL: ["HEAD_PHYSIO", "DOCTOR", "PHYSIO", "SPORTS_SCIENTIST"],
};

export const RESPONSIBILITY_DOMAINS: StaffResponsibilityDomain[] = [
  "TRANSFERS",
  "SCOUTING",
  "CONTRACTS",
  "YOUTH",
  "TRAINING",
  "MEDICAL",
];

/**
 * The real, active staff members whose role qualifies them to own one
 * responsibility domain. Derived from DOMAIN_ELIGIBLE_ROLES against the club's
 * actual active appointments — never a fabricated person or role. The Manager
 * and Board are always valid assignees on top of these (they are added by the
 * Club Responsibilities read model, not here).
 */
export const eligibleStaffForResponsibilityDomain = (
  db: GameDatabase,
  clubId: EntityId,
  domain: StaffResponsibilityDomain,
): Array<{ appointmentId: EntityId; personId: EntityId; role: FootballStaffRole }> => {
  const market = new StaffMarketRepository(db);
  return market
    .activeAppointmentsForClub(clubId)
    .filter((appointment) => DOMAIN_ELIGIBLE_ROLES[domain].includes(appointment.role))
    .map((appointment) => ({
      appointmentId: appointment.id,
      personId: appointment.personId,
      role: appointment.role,
    }));
};

const BOARD_APPROVAL_WINDOW_DAYS = 7;

export class ResponsibilityError extends Error {
  constructor(
    readonly code:
      "INVALID_OWNER" | "NOT_ELIGIBLE" | "APPOINTMENT_NOT_FOUND" | "BOARD_APPROVAL_REQUIRED",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Assigns who owns one responsibility domain at a club. Exactly one row per
 * (club, domain) — reassigning always replaces the prior owner outright, so
 * two staff members can never simultaneously own the same responsibility.
 */
export const assignResponsibility = (
  db: GameDatabase,
  save: SaveMetadata,
  clubId: EntityId,
  domain: StaffResponsibilityDomain,
  ownerType: StaffResponsibilityOwnerType,
  ownerAppointmentId?: EntityId,
): StaffResponsibility => {
  const market = new StaffMarketRepository(db);
  if (ownerType === "STAFF") {
    if (!ownerAppointmentId) {
      throw new ResponsibilityError("INVALID_OWNER", "Select a staff member to delegate to.");
    }
    const appointment = market.appointmentById(ownerAppointmentId);
    if (
      !appointment ||
      appointment.employmentStatus !== "ACTIVE" ||
      appointment.clubId !== clubId
    ) {
      throw new ResponsibilityError(
        "APPOINTMENT_NOT_FOUND",
        "That staff member is not active at this club.",
      );
    }
    if (!DOMAIN_ELIGIBLE_ROLES[domain].includes(appointment.role)) {
      throw new ResponsibilityError(
        "NOT_ELIGIBLE",
        `${appointment.role.replace(/_/g, " ").toLowerCase()} cannot take responsibility for ${domain.toLowerCase()}.`,
      );
    }
  }
  const existing = market.responsibility(clubId, domain);
  const responsibility: StaffResponsibility = {
    id: existing?.id ?? createEntityId(),
    clubId,
    domain,
    ownerType,
    ownerAppointmentId: ownerType === "STAFF" ? ownerAppointmentId : undefined,
    boardApprovalGrantedUntil:
      ownerType === "BOARD" ? existing?.boardApprovalGrantedUntil : undefined,
    updatedOn: save.worldDate,
  };
  market.upsertResponsibility(responsibility);
  return responsibility;
};

/** Reads who owns a domain, defaulting to MANAGER when nothing has been assigned yet. */
export const responsibilityOwner = (
  db: GameDatabase,
  clubId: EntityId,
  domain: StaffResponsibilityDomain,
): StaffResponsibility => {
  const existing = new StaffMarketRepository(db).responsibility(clubId, domain);
  return (
    existing ?? {
      id: createEntityId(),
      clubId,
      domain,
      ownerType: "MANAGER",
      updatedOn: "1970-01-01",
    }
  );
};

/**
 * Seeds sensible defaults from the club's *real* roster: a domain is
 * delegated to a specialist only if one actually exists at the club, so a
 * small club (no such specialist) naturally keeps everything with the
 * manager, and a larger, well-staffed club specialises on its own.
 */
export const defaultResponsibilitiesForClub = (
  db: GameDatabase,
  save: SaveMetadata,
  clubId: EntityId,
): StaffResponsibility[] => {
  const market = new StaffMarketRepository(db);
  const staff = market.activeAppointmentsForClub(clubId);
  return RESPONSIBILITY_DOMAINS.map((domain) => {
    if (market.responsibility(clubId, domain)) return responsibilityOwner(db, clubId, domain);
    const specialist = staff.find((appointment) =>
      DOMAIN_ELIGIBLE_ROLES[domain].includes(appointment.role),
    );
    return assignResponsibility(
      db,
      save,
      clubId,
      domain,
      specialist ? "STAFF" : "MANAGER",
      specialist?.id,
    );
  });
};

/**
 * The board grants (or refuses) approval to act in a domain for a window,
 * from the club's own real financial standing — not a coin flip.
 */
export const requestBoardApproval = (
  db: GameDatabase,
  save: SaveMetadata,
  clubId: EntityId,
  domain: StaffResponsibilityDomain,
): { granted: boolean; responsibility: StaffResponsibility } => {
  const finances = new TransferMarketRepository(db).clubFinancialProfile(clubId);
  const granted = !finances || finances.financialHealth !== "POOR";
  const existing = responsibilityOwner(db, clubId, domain);
  const responsibility: StaffResponsibility = {
    ...existing,
    id: existing.id,
    clubId,
    domain,
    ownerType: "BOARD",
    boardApprovalGrantedUntil: granted
      ? addDays(save.worldDate, BOARD_APPROVAL_WINDOW_DAYS)
      : undefined,
    updatedOn: save.worldDate,
  };
  new StaffMarketRepository(db).upsertResponsibility(responsibility);
  return { granted, responsibility };
};

/**
 * The gate that gives delegation real teeth: BOARD domains require a live
 * approval window, and every check is logged against whoever actually holds
 * the domain — the same existing transfer/scouting/contract/training
 * functions still do the work, this only decides whether they may run and
 * who gets the credit.
 */
export const assertResponsibilityPermits = (
  db: GameDatabase,
  save: SaveMetadata,
  clubId: EntityId,
  domain: StaffResponsibilityDomain,
  action: string,
  actor: "SYSTEM" | "MANAGER" = "SYSTEM",
): StaffResponsibility => {
  const owner = responsibilityOwner(db, clubId, domain);
  if (actor === "MANAGER" && owner.ownerType === "STAFF") {
    throw new ResponsibilityError(
      "BOARD_APPROVAL_REQUIRED",
      `This ${domain.toLowerCase()} responsibility is delegated to an executive or specialist.`,
    );
  }
  if (owner.ownerType === "BOARD") {
    const stillValid =
      owner.boardApprovalGrantedUntil && owner.boardApprovalGrantedUntil >= save.worldDate;
    if (!stillValid) {
      throw new ResponsibilityError(
        "BOARD_APPROVAL_REQUIRED",
        `Board approval is required for ${domain.toLowerCase()} decisions and none is currently in place.`,
      );
    }
  }
  new StaffMarketRepository(db).insertResponsibilityLog({
    id: createEntityId(),
    clubId,
    domain,
    ownerType: owner.ownerType,
    ownerAppointmentId: owner.ownerAppointmentId,
    action,
    occurredOn: save.worldDate,
  });
  return owner;
};

// ---------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------

export type StaffWorkload = {
  personId: EntityId;
  appointmentId: EntityId;
  domainsCovered: number;
  level: StaffWorkloadLevel;
};

const workloadLevelFor = (domainsCovered: number): StaffWorkloadLevel =>
  domainsCovered === 0
    ? "LIGHT"
    : domainsCovered === 1
      ? "NORMAL"
      : domainsCovered === 2
        ? "HEAVY"
        : "OVERLOADED";

/** Workload is derived, not stored: how many domains each staff member currently owns. */
export const staffWorkloadForClub = (db: GameDatabase, clubId: EntityId): StaffWorkload[] => {
  const market = new StaffMarketRepository(db);
  const counts = new Map<EntityId, number>();
  for (const responsibility of market.responsibilitiesForClub(clubId)) {
    if (responsibility.ownerType !== "STAFF" || !responsibility.ownerAppointmentId) continue;
    counts.set(
      responsibility.ownerAppointmentId,
      (counts.get(responsibility.ownerAppointmentId) ?? 0) + 1,
    );
  }
  return market
    .activeAppointmentsForClub(clubId)
    .map((appointment) => {
      const domainsCovered = counts.get(appointment.id) ?? 0;
      return {
        personId: appointment.personId,
        appointmentId: appointment.id,
        domainsCovered,
        level: workloadLevelFor(domainsCovered),
      };
    })
    .filter((entry) => entry.domainsCovered > 0);
};

// ---------------------------------------------------------------------------
// Development plans (wraps the existing Phase B licence-course pipeline)
// ---------------------------------------------------------------------------

const DEVELOPMENT_PLAN_DEFAULT_MONTHS = 6;

/**
 * Records the club's intent to develop someone. When it targets a licence,
 * this drives the existing `enrolInLicenceCourse` pipeline rather than
 * tracking course progress a second time — the plan is a label over real state.
 */
export const createStaffDevelopmentPlan = (
  db: GameDatabase,
  save: SaveMetadata,
  clubId: EntityId,
  personId: EntityId,
  focus: string,
  targetLicenceType?: string,
  clubFunded = true,
): StaffDevelopmentPlan => {
  const market = new StaffMarketRepository(db);
  let licenceCourseId: EntityId | undefined;
  let targetDate = addDays(save.worldDate, DEVELOPMENT_PLAN_DEFAULT_MONTHS * 30);
  if (targetLicenceType) {
    const course = enrolInLicenceCourse(db, save, personId, clubFunded ? clubId : undefined);
    licenceCourseId = course.id;
    targetDate = course.completesOn;
  }
  const plan: StaffDevelopmentPlan = {
    id: createEntityId(),
    personId,
    clubId,
    focus,
    targetLicenceType,
    licenceCourseId,
    createdOn: save.worldDate,
    targetDate,
    status: "ACTIVE",
  };
  market.upsertDevelopmentPlan(plan);
  return plan;
};

/** Keeps development plans in sync with whatever the underlying licence course actually did. */
export const evaluateStaffDevelopmentPlans = (
  db: GameDatabase,
  clubId: EntityId,
): StaffDevelopmentPlan[] => {
  const market = new StaffMarketRepository(db);
  const updated: StaffDevelopmentPlan[] = [];
  for (const plan of market.developmentPlansForClub(clubId).filter((p) => p.status === "ACTIVE")) {
    if (!plan.licenceCourseId) continue;
    const course = market
      .staffLicencesForPerson(plan.personId)
      .find((licence) => licence.licenceType === plan.targetLicenceType);
    if (course) {
      const completed: StaffDevelopmentPlan = { ...plan, status: "COMPLETED" };
      market.upsertDevelopmentPlan(completed);
      updated.push(completed);
    }
  }
  return updated;
};

// ---------------------------------------------------------------------------
// Succession planning
// ---------------------------------------------------------------------------

const SUCCESSION_WINDOW_DAYS = 60;

/** Roles a club would genuinely miss losing without warning. */
const KEY_ROLES = new Set<FootballStaffRole>([
  "HEAD_COACH",
  "ASSISTANT_COACH",
  "SPORTING_DIRECTOR",
  "TECHNICAL_DIRECTOR",
  "CHIEF_SCOUT",
  "ACADEMY_DIRECTOR",
  "HEAD_PHYSIO",
]);

/**
 * Flags key appointments at real risk of ending soon — contract expiring
 * within the window, or an active poaching approach against them — and
 * looks for an internal successor already eligible for the role.
 */
export const evaluateSuccessionNeeds = (
  db: GameDatabase,
  save: SaveMetadata,
  clubId: EntityId,
): StaffSuccessionPlan[] => {
  const market = new StaffMarketRepository(db);
  const worldDate = save.worldDate;
  const plans: StaffSuccessionPlan[] = [];

  for (const appointment of market.activeAppointmentsForClub(clubId)) {
    if (!KEY_ROLES.has(appointment.role)) continue;
    if (market.activeSuccessionPlanFor(appointment.id)) continue;

    const contract = appointment.contractId
      ? market.employmentContractById(appointment.contractId)
      : undefined;
    const contractExpiring =
      contract?.contractEnd !== undefined &&
      daysBetween(worldDate, contract.contractEnd) <= SUCCESSION_WINDOW_DAYS;
    const poachingRisk = market
      .approachesForClub(clubId)
      .some(
        (approach) => approach.personId === appointment.personId && approach.status === "PENDING",
      );
    if (!contractExpiring && !poachingRisk) continue;

    const candidate = market
      .activeAppointmentsForClub(clubId)
      .find(
        (other) =>
          other.id !== appointment.id &&
          staffEligibility(
            appointment.role,
            market.staffProfile(other.personId),
            market.staffLicencesForPerson(other.personId),
          ).eligible,
      );

    const plan: StaffSuccessionPlan = {
      id: createEntityId(),
      clubId,
      outgoingAppointmentId: appointment.id,
      outgoingPersonId: appointment.personId,
      role: appointment.role,
      candidatePersonId: candidate?.personId,
      reason: contractExpiring ? "CONTRACT_EXPIRING" : "POACHING_RISK",
      createdOn: worldDate,
      status: "ACTIVE",
    };
    market.upsertSuccessionPlan(plan);
    plans.push(plan);
  }
  return plans;
};

// ---------------------------------------------------------------------------
// Hierarchy read model
// ---------------------------------------------------------------------------

export type StaffHierarchyEntry = {
  appointmentId: EntityId;
  personId: EntityId;
  role: FootballStaffRole;
  seniorityRank: number;
  domains: StaffResponsibilityDomain[];
  workload: StaffWorkloadLevel;
};

/** The club's org chart: every active appointment, ranked by seniority, with the domains they own. */
export const staffHierarchyForClub = (
  db: GameDatabase,
  clubId: EntityId,
): StaffHierarchyEntry[] => {
  const market = new StaffMarketRepository(db);
  const responsibilities = market.responsibilitiesForClub(clubId);
  const workload = new Map(
    staffWorkloadForClub(db, clubId).map((entry) => [entry.appointmentId, entry.level]),
  );

  return market
    .activeAppointmentsForClub(clubId)
    .map((appointment) => ({
      appointmentId: appointment.id,
      personId: appointment.personId,
      role: appointment.role,
      seniorityRank: seniorityRankOf(appointment.role),
      domains: responsibilities
        .filter((r) => r.ownerType === "STAFF" && r.ownerAppointmentId === appointment.id)
        .map((r) => r.domain),
      workload: workload.get(appointment.id) ?? "LIGHT",
    }))
    .sort((a, b) => b.seniorityRank - a.seniorityRank);
};
