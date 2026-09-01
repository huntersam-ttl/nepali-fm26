import {
  CareerWorldRepository,
  ClubEconomyRepository,
  CompetitionRepository,
  EventRepository,
  ManagerRepository,
  SupporterCultureRepository,
  TransferMarketRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createEntityId,
  createStableEntityId,
  type EntityId,
  type JobApplication,
  type JobApplicationStatus,
  type ManagerJobNegotiation,
  type JobVacancy,
  type JobVacancyReason,
  type ManagerAttributeSet,
  type ManagerContract,
  type ManagerProfile,
  type Person,
  type SaveMetadata,
  type Team,
} from "@nepal-football-sim/shared-types";
import { createManagerContract } from "./manager-career.js";
import { supporterBoardPressureModifier } from "./supporter-culture.js";
import { interviewManagerForApplication } from "./manager-interviews.js";
import { SeededRandom } from "./rng.js";
import { isContextOnlyClub } from "./foreign-football-world.js";
import { refreshManagerBoardRelationship } from "./club-vision-politics.js";
import { publishMediaForDate } from "./media.js";

type SqlRow = Record<string, any>;

/**
 * Every senior team that is not the player's own is a candidate for an AI
 * manager. Kept separate from `ManagerContext` so unemployment (player has no
 * `ManagerContext`) never blocks these world-level ticks.
 */
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

const getClubRow = (db: GameDatabase, clubId: EntityId): SqlRow | undefined =>
  db.prepare("SELECT * FROM clubs WHERE id = ?").get(clubId) as SqlRow | undefined;

const NAME_POOL = [
  "Bikash Thapa",
  "Suman Gurung",
  "Nirajan Rai",
  "Sagar Khadka",
  "Prakash Basnet",
  "Rohit Chettri",
  "Deepak Shrestha",
  "Milan Tamang",
  "Kiran Magar",
  "Anup Karki",
  "Bishal Lama",
  "Ramesh Bhandari",
];

const REPUTATION_PROFILES = [
  "LOCAL_UNKNOWN",
  "LOCAL_RESPECTED",
  "FORMER_PLAYER",
  "EDUCATED_COACH",
] as const;

const firstCountryId = (db: GameDatabase): EntityId => {
  const row = db.prepare("SELECT id FROM countries ORDER BY name LIMIT 1").get() as
    SqlRow | undefined;
  if (!row) throw new Error("The world has no country records.");
  return row.id;
};

/** Deterministic, lightweight AI manager. Not a full career character. */
export const generateAiManager = (
  seedKey: string,
  worldDate: string,
  countryId: EntityId,
): { person: Person; profile: ManagerProfile } => {
  const rng = new SeededRandom(seedKey);
  const fullName = rng.pick(NAME_POOL);
  const reputationProfile = rng.pick(REPUTATION_PROFILES);
  const personId = createStableEntityId("ai-manager-person", seedKey);
  const profileId = createStableEntityId("ai-manager-profile", seedKey);
  const base = 5 + rng.integer(0, 4);
  const attributes: ManagerAttributeSet = {
    tactical: {
      tacticalKnowledge: base,
      adaptability: base,
      matchManagement: base,
      setPieceKnowledge: base,
    },
    coaching: {
      attackingCoaching: base,
      defensiveCoaching: base,
      technicalCoaching: base,
      mentalCoaching: base,
      fitnessUnderstanding: base,
      youthDevelopment: base,
    },
    people: {
      manManagement: base,
      motivation: base,
      discipline: base,
      communication: base,
    },
    recruitment: {
      playerJudgement: base,
      potentialJudgement: base,
    },
    personality: {
      reputation: base,
      mediaHandling: base,
      pressureHandling: base,
      professionalism: base,
      ambition: base,
      loyalty: base,
    },
  };
  return {
    person: {
      id: personId,
      fullName,
      nationalityCountryId: countryId,
      languages: ["ne"],
    },
    profile: {
      id: profileId,
      personId,
      attributes,
      reputationProfile,
      createdOn: worldDate,
    },
  };
};

/** Keep a small, deterministic free-agent pool available to owner careers. */
export const ensureOwnerManagerCandidateSupply = (
  db: GameDatabase,
  input: { date: string; seed: string; countryId: EntityId; minimum?: number },
): void => {
  const managers = new ManagerRepository(db);
  const minimum = input.minimum ?? 4;
  const available = managers.unemployedManagerProfiles();
  for (let index = available.length; index < minimum; index += 1) {
    const generated = generateAiManager(
      `${input.seed}:owner-candidate:${index}`,
      input.date,
      input.countryId,
    );
    if (!new WorldRepository(db).getPerson(generated.person.id))
      new WorldRepository(db).insertPerson(generated.person);
    managers.insertProfile(generated.profile);
  }
};

/**
 * Ensures every senior team not managed by the player has an active manager
 * contract. Reuses free-agent AI managers before generating a new one, which
 * is what makes AI managers appear to move between clubs over time instead of
 * being replaced wholesale every tick.
 */
export const ensureAiManagersAssigned = (
  db: GameDatabase,
  save: SaveMetadata,
  playerTeamId: EntityId | undefined,
): void => {
  const managers = new ManagerRepository(db);
  const careerWorld = new CareerWorldRepository(db);
  const teams = seniorTeams(db, save.worldDate);
  const world = new WorldRepository(db);
  let countryId: EntityId | undefined;

  // The player is never a candidate for the AI free-agent pool — being
  // unemployed must never silently auto-hire them at some other club.
  const playerCharacter = save.playerCharacterId
    ? world.getCareerCharacter(save.playerCharacterId)
    : undefined;
  const playerManagerProfileId = playerCharacter
    ? managers.getProfileByPerson(playerCharacter.personId)?.id
    : undefined;

  for (const team of teams) {
    if (team.id === playerTeamId) continue;
    if (managers.activeContractForTeam(team.id)) continue;

    // A freshly opened vacancy stays open for a while so the player gets a
    // real chance to apply before the board appoints an AI replacement.
    const openVacancy = careerWorld.openVacancyForTeam(team.id);
    if (openVacancy && daysBetween(openVacancy.openedOn, save.worldDate) < VACANCY_GRACE_DAYS) {
      continue;
    }
    const vacancy = openVacancy ?? {
      id: createStableEntityId("manager-job-vacancy", `${team.id}:${save.worldDate}`),
      clubId: team.clubId,
      teamId: team.id,
      countryId: countryId ?? firstCountryId(db),
      openedOn: save.worldDate,
      reason: "NEW_CLUB" as const,
      boardExpectation: team.clubId ? expectationForClub(db, team.clubId) : "SURVIVE",
      status: "OPEN" as const,
    };
    if (!openVacancy) careerWorld.insertVacancy(vacancy);

    const available = managers
      .managerProfiles(64)
      .filter((profile) => profile.id !== playerManagerProfileId)
      .filter((profile) => {
        const current = managers.activeContract(profile.id);
        if (!current) return true;
        // Only approach employed managers who have a deterministic reason to
        // consider moving; there is no silent universal poaching.
        const personality = profile.attributes.personality;
        return personality.ambition >= 9 || personality.loyalty <= 5;
      })
      .sort(
        (left, right) =>
          managerPoolScore(right, vacancy) - managerPoolScore(left, vacancy) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, 4);
    if (available.length === 0) {
      countryId ??= firstCountryId(db);
      const generated = generateAiManager(
        `ai-manager:${team.id}:${save.worldDate}`,
        save.worldDate,
        countryId,
      );
      if (!world.getPerson(generated.person.id)) {
        world.insertPerson(generated.person);
      }
      managers.insertProfile(generated.profile);
      available.push(generated.profile);
    }
    for (const profile of available) {
      if (careerWorld.vacancy(vacancy.id)?.status !== "OPEN") break;
      const application = applyForJob(db, save, profile, vacancy.id);
      if (application.status !== "OFFERED") continue;
      const negotiation = negotiateManagerJobOfferAsAi({
        db,
        save,
        managerProfile: profile,
        applicationId: application.id,
        seed: `${save.randomSeed}:${vacancy.id}:${profile.id}`,
      });
      if (negotiation.stage !== "ACCEPTED") continue;
      try {
        const currentContract = managers.activeContract(profile.id);
        if (currentContract && currentContract.teamId !== vacancy.teamId) {
          // An employed candidate only reaches this point when the bounded
          // approach rule says a move is plausible. End the old employment
          // through the canonical resignation path before appointing them.
          resignFromClub(db, save, currentContract);
        }
        acceptJobOffer(db, save, profile, application.id);
      } catch (error) {
        // A stronger concurrent candidate may have closed the vacancy. The
        // next vacancy tick will discover another candidate if still needed.
        if (!(error instanceof JobOfferError)) throw error;
      }
    }
  }
};

const managerPoolScore = (profile: ManagerProfile, vacancy: JobVacancy): number => {
  const a = profile.attributes;
  const expectationFit =
    vacancy.boardExpectation === "YOUTH_DEVELOPMENT"
      ? a.coaching.youthDevelopment * 3
      : vacancy.boardExpectation === "TITLE_CHALLENGE"
        ? a.tactical.matchManagement * 3
        : a.people.manManagement * 2;
  return (
    expectationFit +
    a.coaching.technicalCoaching +
    a.tactical.adaptability +
    a.personality.reputation * 4 +
    a.personality.ambition
  );
};

const expectationForClub = (db: GameDatabase, clubId: EntityId): string => {
  const policy = new ClubEconomyRepository(db).boardPolicy(clubId);
  return policy?.strategicObjective ?? "SURVIVE";
};

const positionTertile = (position: number, total: number): "TOP" | "MIDDLE" | "BOTTOM" => {
  if (total <= 0) return "MIDDLE";
  const ratio = position / total;
  if (ratio <= 1 / 3) return "TOP";
  if (ratio >= 2 / 3) return "BOTTOM";
  return "MIDDLE";
};

const confidenceDelta = (expectation: string, tertile: "TOP" | "MIDDLE" | "BOTTOM"): number => {
  const wantsTop = expectation === "TITLE_CHALLENGE" || expectation === "PROMOTION";
  const wantsMidOrBetter = expectation !== "SURVIVE" && !wantsTop;
  if (tertile === "TOP") return wantsTop ? 6 : 3;
  if (tertile === "MIDDLE") return wantsTop ? -2 : wantsMidOrBetter ? 3 : 2;
  return wantsTop ? -10 : wantsMidOrBetter ? -6 : -2;
};

const MIN_TENURE_DAYS_BEFORE_SACKING = 60;
const VACANCY_GRACE_DAYS = 30;

const daysBetween = (from: string, to: string): number =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );

export type BoardEvaluationOutcome = {
  sackedContracts: ManagerContract[];
};

/**
 * Runs one board-confidence tick across every club with an active manager
 * contract, including the player's own club. A club whose confidence falls to
 * zero sacks its manager and opens a vacancy — this is the only place a
 * manager (player or AI) loses their job for poor performance.
 */
export const evaluateBoardConfidence = (
  db: GameDatabase,
  save: SaveMetadata,
): BoardEvaluationOutcome => {
  const managers = new ManagerRepository(db);
  const careerWorld = new CareerWorldRepository(db);
  const competitions = new CompetitionRepository(db);
  const seasonId = currentSeasonId(db, save.worldDate);
  const standings = seasonId ? competitions.standings(seasonId) : [];
  const totalTeams = standings.length;
  const sacked: ManagerContract[] = [];

  for (const contract of managers.allActiveContracts()) {
    if (!contract.clubId || !contract.teamId) continue;
    const tenureDays = daysBetween(contract.contractStart, save.worldDate);
    const expectation = expectationForClub(db, contract.clubId);
    const position = standings.findIndex((row) => row.teamId === contract.teamId) + 1;
    const tertile = position > 0 ? positionTertile(position, totalTeams) : "MIDDLE";
    const existing = careerWorld.boardConfidence(contract.clubId);
    const baseline = existing && existing.contractId === contract.id ? existing.confidence : 60;
    /* Supporter sentiment is one contextual factor only: finances and club
     * objectives stay authoritative, and supporters never sack anyone alone. */
    const supporters = new SupporterCultureRepository(db).profile(contract.clubId, "men");
    const supporterPressure = supporters ? supporterBoardPressureModifier(supporters) : 0;
    const next = Math.max(
      0,
      Math.min(100, baseline + confidenceDelta(expectation, tertile) + supporterPressure),
    );

    careerWorld.upsertBoardConfidence({
      clubId: contract.clubId,
      contractId: contract.id,
      confidence: next,
      expectation,
      lastEvaluatedOn: save.worldDate,
    });
    const managerProfile = managers.getProfile(contract.managerProfileId);
    if (managerProfile) {
      refreshManagerBoardRelationship(db, contract.clubId, managerProfile, save.worldDate);
    }

    if (next <= 0 && tenureDays >= MIN_TENURE_DAYS_BEFORE_SACKING) {
      sackManager(db, save, contract, "SACKED");
      sacked.push(contract);
    }
  }

  return { sackedContracts: sacked };
};

const clubName = (db: GameDatabase, clubId?: EntityId): string | undefined =>
  clubId ? (getClubRow(db, clubId)?.name as string | undefined) : undefined;

const teamName = (db: GameDatabase, teamId: EntityId): string =>
  (db.prepare("SELECT name FROM teams WHERE id = ?").get(teamId) as SqlRow | undefined)?.name ??
  "Unknown team";

/** Ends a manager contract and opens the resulting vacancy. */
export const sackManager = (
  db: GameDatabase,
  save: SaveMetadata,
  contract: ManagerContract,
  reason: Extract<JobVacancyReason, "SACKED" | "RESIGNED" | "EXPIRED">,
): void => {
  const managers = new ManagerRepository(db);
  const careerWorld = new CareerWorldRepository(db);
  managers.insertContract({
    ...contract,
    contractEnd: save.worldDate,
    status: reason,
  });
  if (contract.teamId) {
    careerWorld.insertVacancy({
      id: createEntityId(),
      clubId: contract.clubId,
      teamId: contract.teamId,
      openedOn: save.worldDate,
      reason,
      boardExpectation: contract.clubId ? expectationForClub(db, contract.clubId) : "SURVIVE",
      status: "OPEN",
    });
  }
  const eventType =
    reason === "SACKED"
      ? "MANAGER_DISMISSED"
      : reason === "RESIGNED"
        ? "MANAGER_RESIGNED"
        : "MANAGER_CONTRACT_EXPIRED";
  const eventId = createStableEntityId(
    "history",
    `MANAGER_LIFECYCLE:${contract.id}:${eventType}:${save.worldDate}`,
  );
  if (!db.prepare("SELECT 1 FROM historical_events WHERE id=?").get(eventId)) {
    new EventRepository(db).insertHistoricalEvent({
      id: eventId,
      occurredOn: save.worldDate,
      eventType,
      involvedEntities: [
        ...(contract.clubId ? [{ id: contract.clubId, type: "club" as const }] : []),
        { id: contract.personId, type: "person" },
      ],
      title:
        reason === "SACKED"
          ? "Manager dismissed"
          : reason === "RESIGNED"
            ? "Manager resigned"
            : "Manager contract ended",
      data: { contractId: contract.id, reason },
      importance: reason === "SACKED" ? "high" : "medium",
      scope: "club",
    });
  }
  publishMediaForDate(db, { date: save.worldDate, minimumImportance: 6 });
  if (save.playerCharacterId) {
    const character = new WorldRepository(db).getCareerCharacter(save.playerCharacterId);
    if (character) {
      const managerProfile = managers.getProfileByPerson(character.personId);
      if (managerProfile?.id === contract.managerProfileId) {
        const title =
          reason === "SACKED"
            ? `You have been sacked by ${clubName(db, contract.clubId) ?? teamName(db, contract.teamId!)}`
            : `You resigned from ${clubName(db, contract.clubId) ?? teamName(db, contract.teamId!)}`;
        managers.insertInboxItem({
          id: createEntityId(),
          createdOn: save.worldDate,
          type: "COMPETITION_UPDATE",
          title,
          body:
            reason === "SACKED"
              ? "The board has lost confidence in your management. You are now unemployed."
              : "You have left the club and are now unemployed.",
          read: false,
        });
      }
    }
  }
};

/** Player-triggered resignation. Distinct entry point from board-driven sacking. */
export const resignFromClub = (
  db: GameDatabase,
  save: SaveMetadata,
  contract: ManagerContract,
): void => {
  sackManager(db, save, contract, "RESIGNED");
};

const eligibility = (
  profile: ManagerProfile,
  vacancy: JobVacancy,
): { eligible: boolean; note?: string } => {
  const demanding =
    vacancy.boardExpectation === "TITLE_CHALLENGE" || vacancy.boardExpectation === "PROMOTION";
  if (!demanding) return { eligible: true };
  const reputable =
    profile.reputationProfile === "LOCAL_RESPECTED" ||
    profile.reputationProfile === "FORMER_PLAYER" ||
    profile.reputationProfile === "EDUCATED_COACH";
  const seasoned = profile.attributes.personality.reputation >= 8;
  if (reputable || seasoned) return { eligible: true };
  return {
    eligible: false,
    note: "This club expects a manager with an established reputation.",
  };
};

export type VacancyListing = {
  vacancy: JobVacancy;
  clubName: string;
  teamName: string;
  competitionName: string;
  eligible: boolean;
  eligibilityNote?: string;
};

export const listVacancies = (
  db: GameDatabase,
  managerProfile: ManagerProfile,
): VacancyListing[] => {
  const careerWorld = new CareerWorldRepository(db);
  return careerWorld.openVacancies().map((vacancy) => {
    const check = eligibility(managerProfile, vacancy);
    const club = vacancy.clubId ? getClubRow(db, vacancy.clubId) : undefined;
    const competitionRow = db
      .prepare(
        `SELECT c.name FROM club_memberships cm
        JOIN competition_seasons cs ON cs.id = cm.competition_season_id
        JOIN competitions c ON c.id = cs.competition_id
        WHERE cm.team_id = ? AND cm.status = 'ACTIVE' LIMIT 1`,
      )
      .get(vacancy.teamId) as SqlRow | undefined;
    return {
      vacancy,
      clubName: club?.name ?? teamName(db, vacancy.teamId),
      teamName: teamName(db, vacancy.teamId),
      competitionName: competitionRow?.name ?? "Nepal football",
      eligible: check.eligible,
      eligibilityNote: check.note,
    };
  });
};

const offeredSalaryFor = (vacancy: JobVacancy): number => {
  const scale: Record<string, number> = {
    TITLE_CHALLENGE: 8_000_000,
    PROMOTION: 6_000_000,
    YOUTH_DEVELOPMENT: 4_000_000,
    COMMERCIAL_GROWTH: 4_500_000,
    INFRASTRUCTURE: 4_000_000,
    FINANCIAL_STABILITY: 3_500_000,
    PLAYER_TRADING: 4_000_000,
    SURVIVE: 3_000_000,
  };
  return scale[vacancy.boardExpectation] ?? 3_000_000;
};

const candidateStandingScore = (
  db: GameDatabase,
  application: JobApplication,
  vacancy: JobVacancy,
): number => {
  const profile = new ManagerRepository(db).getProfile(application.managerProfileId);
  if (!profile) return -1;
  const attributes = profile.attributes;
  const coaching =
    attributes.coaching.youthDevelopment +
    attributes.coaching.technicalCoaching +
    attributes.tactical.matchManagement;
  const fit =
    vacancy.boardExpectation === "YOUTH_DEVELOPMENT"
      ? attributes.coaching.youthDevelopment * 3
      : vacancy.boardExpectation === "TITLE_CHALLENGE"
        ? attributes.tactical.matchManagement * 3
        : attributes.people.manManagement * 2;
  const reputation = profile.attributes.personality.reputation * 4;
  const terms = application.offeredSalaryMinor
    ? Math.min(20, application.offeredSalaryMinor / 500_000)
    : 0;
  return coaching + fit + reputation + terms;
};

const addYears = (date: string, years: number): string => {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + years);
  return parsed.toISOString().slice(0, 10);
};

export class JobApplicationError extends Error {
  constructor(
    readonly code:
      | "VACANCY_NOT_OPEN"
      | "NOT_ELIGIBLE"
      | "ALREADY_APPLIED"
      | "APPLICATION_NOT_FOUND"
      | "APPLICATION_NOT_WITHDRAWABLE",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Applying resolves immediately into an interview outcome (offered or
 * rejected); AI callers may repeat this through the bounded vacancy pool.
 */
export const applyForJob = (
  db: GameDatabase,
  save: SaveMetadata,
  managerProfile: ManagerProfile,
  vacancyId: EntityId,
): JobApplication => {
  const careerWorld = new CareerWorldRepository(db);
  const vacancy = careerWorld.vacancy(vacancyId);
  if (!vacancy || vacancy.status !== "OPEN") {
    throw new JobApplicationError("VACANCY_NOT_OPEN", "That vacancy is no longer open.");
  }
  if (vacancy.clubId && isContextOnlyClub(db, vacancy.clubId)) {
    throw new JobApplicationError(
      "NOT_ELIGIBLE",
      "Context-only external clubs cannot become player-managed careers.",
    );
  }

  const alreadyApplied = careerWorld
    .applicationsForManager(managerProfile.id)
    .some(
      (application) =>
        application.vacancyId === vacancyId &&
        (application.status === "OFFERED" || application.status === "ACCEPTED"),
    );
  if (alreadyApplied) {
    throw new JobApplicationError("ALREADY_APPLIED", "You already have an offer for this job.");
  }
  const check = eligibility(managerProfile, vacancy);
  if (!check.eligible) {
    throw new JobApplicationError(
      "NOT_ELIGIBLE",
      check.note ?? "You are not eligible for this role.",
    );
  }

  const interview = interviewManagerForApplication(db, {
    vacancy,
    profile: managerProfile,
    date: save.worldDate,
  });
  const offered = interview.successful;

  const application: JobApplication = {
    id: createStableEntityId(
      "manager-job-application",
      `${vacancyId}:${managerProfile.id}:${save.worldDate}`,
    ),
    vacancyId,
    managerProfileId: managerProfile.id,
    personId: managerProfile.personId,
    status: offered ? "OFFERED" : "REJECTED",
    createdOn: save.worldDate,
    decidedOn: save.worldDate,
    offeredSalaryMinor: offered ? offeredSalaryFor(vacancy) : undefined,
    offeredContractEnd: offered ? addYears(save.worldDate, 2) : undefined,
  };
  careerWorld.insertApplication(application);
  if (offered) {
    careerWorld.upsertManagerJobNegotiation({
      id: createStableEntityId("manager-job-negotiation", application.id),
      applicationId: application.id,
      vacancyId,
      stage: "OFFERED",
      round: 0,
      maxRounds: 2,
      offeredSalaryMinor: application.offeredSalaryMinor!,
      offeredContractEnd: application.offeredContractEnd,
      updatedOn: save.worldDate,
      provenanceStatus: "SIMULATION_ONLY",
    });
  }
  return application;
};

export type ManagerJobNegotiationAction = "ACCEPT" | "REJECT" | "COUNTER" | "WITHDRAW";

/**
 * Deterministic AI action selection over the same persisted negotiation used
 * by human managers. It returns no hidden score; the persisted reason is the
 * broad demand that drove the decision.
 */
export const negotiateManagerJobOfferAsAi = (input: {
  db: GameDatabase;
  save: SaveMetadata;
  managerProfile: ManagerProfile;
  applicationId: EntityId;
  seed: string;
}): ManagerJobNegotiation => {
  const careerWorld = new CareerWorldRepository(input.db);
  const application = careerWorld.application(input.applicationId);
  if (!application || application.managerProfileId !== input.managerProfile.id)
    throw new JobApplicationError("APPLICATION_NOT_FOUND", "That job application does not exist.");
  const current = careerWorld.managerJobNegotiation(application.id);
  const vacancy = application ? careerWorld.vacancy(application.vacancyId) : undefined;
  if (!current || !vacancy || application.status !== "OFFERED")
    throw new JobApplicationError(
      "APPLICATION_NOT_WITHDRAWABLE",
      "That offer is no longer negotiable.",
    );

  const personality = input.managerProfile.attributes.personality;
  const clubFinance = vacancy.clubId
    ? new TransferMarketRepository(input.db).clubFinancialProfile(vacancy.clubId)
    : undefined;
  const currentContract = new ManagerRepository(input.db).activeContract(input.managerProfile.id);
  const currentSalary = currentContract?.salaryAmountMinor ?? 0;
  const offered = current.offeredSalaryMinor;
  const maxAffordable = clubFinance
    ? Math.max(offered, clubFinance.wageBudget - clubFinance.currentWageSpend + offered)
    : offered;
  const ambitionPremium = Math.min(0.24, 0.04 + personality.ambition * 0.02);
  const loyaltyDiscount = personality.loyalty >= 8 ? 0.04 : 0;
  const negotiationCeiling = 0.08 + personality.ambition * 0.01;
  const desired = Math.round(
    Math.min(
      maxAffordable,
      offered * (1 + negotiationCeiling),
      Math.max(offered, currentSalary * (1 + 0.05 + ambitionPremium - loyaltyDiscount)),
    ),
  );
  const fit = managerPoolScore(input.managerProfile, vacancy);
  const strongFit = fit >= 65;
  const moveIsWorthwhile =
    !currentContract || desired >= currentSalary * 1.08 || personality.ambition >= 9;
  let action: ManagerJobNegotiationAction;
  if (current.round >= current.maxRounds) action = "REJECT";
  else if (!moveIsWorthwhile && personality.loyalty >= 7) action = "WITHDRAW";
  else if (strongFit && desired <= offered * 1.05) action = "ACCEPT";
  else if (desired > offered && desired <= maxAffordable) action = "COUNTER";
  else action = strongFit ? "ACCEPT" : "REJECT";
  const result = negotiateManagerJobOffer({
    db: input.db,
    save: input.save,
    managerProfile: input.managerProfile,
    applicationId: input.applicationId,
    action,
    requestedSalaryMinor: desired,
    requestedContractEnd: current.offeredContractEnd,
  });
  return result;
};

export const negotiateManagerJobOffer = (input: {
  db: GameDatabase;
  save: SaveMetadata;
  managerProfile: ManagerProfile;
  applicationId: EntityId;
  action: ManagerJobNegotiationAction;
  requestedSalaryMinor?: number;
  requestedContractEnd?: string;
}): ManagerJobNegotiation => {
  const careerWorld = new CareerWorldRepository(input.db);
  const application = careerWorld.application(input.applicationId);
  if (!application || application.managerProfileId !== input.managerProfile.id) {
    throw new JobApplicationError("APPLICATION_NOT_FOUND", "That job application does not exist.");
  }
  const current = careerWorld.managerJobNegotiation(application.id);
  if (!current || application.status !== "OFFERED") {
    throw new JobApplicationError(
      "APPLICATION_NOT_WITHDRAWABLE",
      "That offer is no longer negotiable.",
    );
  }
  if (current.stage === "REJECTED" || current.stage === "WITHDRAWN") {
    throw new JobApplicationError(
      "APPLICATION_NOT_WITHDRAWABLE",
      "That negotiation is already closed.",
    );
  }
  if (input.action === "WITHDRAW") {
    withdrawJobApplication(input.db, input.save, input.managerProfile, application.id);
    const next = {
      ...current,
      stage: "WITHDRAWN" as const,
      decisionReason: "Candidate withdrew",
      updatedOn: input.save.worldDate,
    };
    careerWorld.upsertManagerJobNegotiation(next);
    return next;
  }
  if (input.action === "REJECT") {
    careerWorld.insertApplication({
      ...application,
      status: "DECLINED",
      decidedOn: input.save.worldDate,
    });
    const next = {
      ...current,
      stage: "REJECTED" as const,
      decisionReason: "Candidate rejected the offer",
      updatedOn: input.save.worldDate,
    };
    careerWorld.upsertManagerJobNegotiation(next);
    return next;
  }
  if (input.action === "ACCEPT") {
    const next = {
      ...current,
      stage: "ACCEPTED" as const,
      decisionReason: "Terms accepted; appointment remains a separate explicit action",
      updatedOn: input.save.worldDate,
    };
    careerWorld.upsertManagerJobNegotiation(next);
    return next;
  }
  const requestedSalary = Math.max(
    0,
    Math.round(input.requestedSalaryMinor ?? current.offeredSalaryMinor),
  );
  const round = current.round + 1;
  const ambition = input.managerProfile.attributes.personality.ambition;
  const acceptablePremium = 0.08 + ambition * 0.01;
  const accepted =
    requestedSalary <= current.offeredSalaryMinor * (1 + acceptablePremium) &&
    round <= current.maxRounds;
  if (accepted) {
    const updatedApplication = {
      ...application,
      offeredSalaryMinor: requestedSalary,
      offeredContractEnd: input.requestedContractEnd ?? application.offeredContractEnd,
    };
    careerWorld.insertApplication(updatedApplication);
    const next = {
      ...current,
      stage: "ACCEPTED" as const,
      round,
      requestedSalaryMinor: requestedSalary,
      requestedContractEnd: input.requestedContractEnd,
      offeredSalaryMinor: requestedSalary,
      offeredContractEnd: updatedApplication.offeredContractEnd,
      decisionReason: "Club accepted the counter",
      updatedOn: input.save.worldDate,
    };
    careerWorld.upsertManagerJobNegotiation(next);
    return next;
  }
  const terminal = round >= current.maxRounds;
  if (terminal) {
    careerWorld.insertApplication({
      ...application,
      status: "DECLINED",
      decidedOn: input.save.worldDate,
    });
  }
  const next = {
    ...current,
    stage: terminal ? ("REJECTED" as const) : ("COUNTERED" as const),
    round,
    requestedSalaryMinor: requestedSalary,
    requestedContractEnd: input.requestedContractEnd,
    decisionReason: terminal ? "Negotiation limit reached" : "Club requested more reasonable terms",
    updatedOn: input.save.worldDate,
  };
  careerWorld.upsertManagerJobNegotiation(next);
  return next;
};

/** Withdraws a human manager's pending or offered application without touching the vacancy. */
export const withdrawJobApplication = (
  db: GameDatabase,
  save: SaveMetadata,
  managerProfile: ManagerProfile,
  applicationId: EntityId,
): JobApplication => {
  const careerWorld = new CareerWorldRepository(db);
  const application = careerWorld.application(applicationId);
  if (!application || application.managerProfileId !== managerProfile.id) {
    throw new JobApplicationError("APPLICATION_NOT_FOUND", "That job application does not exist.");
  }
  if (application.status !== "PENDING" && application.status !== "OFFERED") {
    throw new JobApplicationError(
      "APPLICATION_NOT_WITHDRAWABLE",
      "That job application can no longer be withdrawn.",
    );
  }
  const withdrawn = { ...application, status: "WITHDRAWN" as const, decidedOn: save.worldDate };
  careerWorld.insertApplication(withdrawn);
  return withdrawn;
};

export class JobOfferError extends Error {
  constructor(
    readonly code: "OFFER_NOT_FOUND" | "OFFER_NOT_PENDING",
    message: string,
  ) {
    super(message);
  }
}

/** Accepts a job offer, creating the new contract and filling the vacancy. */
export const acceptJobOffer = (
  db: GameDatabase,
  save: SaveMetadata,
  managerProfile: ManagerProfile,
  applicationId: EntityId,
): ManagerContract => {
  const careerWorld = new CareerWorldRepository(db);
  const managers = new ManagerRepository(db);
  const application = careerWorld.application(applicationId);
  if (!application || application.managerProfileId !== managerProfile.id) {
    throw new JobOfferError("OFFER_NOT_FOUND", "That job offer does not exist.");
  }
  if (application.status !== "OFFERED") {
    throw new JobOfferError("OFFER_NOT_PENDING", "That offer is no longer available.");
  }
  const vacancy = careerWorld.vacancy(application.vacancyId);
  if (!vacancy || vacancy.status !== "OPEN") {
    throw new JobOfferError("OFFER_NOT_PENDING", "That job has already been filled.");
  }
  if (vacancy.clubId && isContextOnlyClub(db, vacancy.clubId)) {
    throw new JobOfferError(
      "OFFER_NOT_PENDING",
      "Context-only external clubs cannot become player-managed careers.",
    );
  }

  // Resolve all active offers together at appointment time. The score is a
  // bounded fit ordering over existing manager attributes and offered terms;
  // application order is never used as the deciding factor.
  const competing = careerWorld
    .applicationsForVacancy(vacancy.id)
    .filter((item) => item.id !== application.id && item.status === "OFFERED")
    .map((item) => ({ item, score: candidateStandingScore(db, item, vacancy) }))
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  const currentScore = candidateStandingScore(db, application, vacancy);
  if (competing[0] && competing[0].score > currentScore) {
    careerWorld.insertApplication({
      ...application,
      status: "REJECTED",
      decidedOn: save.worldDate,
    });
    const negotiation = careerWorld.managerJobNegotiation(application.id);
    if (negotiation)
      careerWorld.upsertManagerJobNegotiation({
        ...negotiation,
        stage: "REJECTED",
        decisionReason: "A stronger competing candidate was selected",
        updatedOn: save.worldDate,
      });
    throw new JobOfferError(
      "OFFER_NOT_PENDING",
      "A stronger competing candidate has been selected.",
    );
  }

  const contract = createManagerContract({
    managerProfileId: managerProfile.id,
    personId: managerProfile.personId,
    teamId: vacancy.teamId,
    clubId: vacancy.clubId,
    contractStart: save.worldDate,
    contractEnd: application.offeredContractEnd,
    salaryAmountMinor: application.offeredSalaryMinor,
  });
  managers.insertContract(contract);
  careerWorld.fillVacancy(vacancy.id, save.worldDate, contract.id);
  careerWorld.insertApplication({ ...application, status: "ACCEPTED", decidedOn: save.worldDate });

  for (const other of careerWorld.applicationsForManager(managerProfile.id)) {
    if (other.id !== application.id && other.status === "OFFERED") {
      careerWorld.insertApplication({ ...other, status: "WITHDRAWN", decidedOn: save.worldDate });
    }
  }
  for (const other of careerWorld.applicationsForVacancy(vacancy.id)) {
    if (other.id === application.id || other.status !== "OFFERED") continue;
    careerWorld.insertApplication({ ...other, status: "REJECTED", decidedOn: save.worldDate });
    const negotiation = careerWorld.managerJobNegotiation(other.id);
    if (negotiation)
      careerWorld.upsertManagerJobNegotiation({
        ...negotiation,
        stage: "REJECTED",
        decisionReason: "Vacancy filled by a stronger appointed candidate",
        updatedOn: save.worldDate,
      });
  }

  managers.insertInboxItem({
    id: createEntityId(),
    createdOn: save.worldDate,
    type: "COMPETITION_UPDATE",
    title: `Welcome to ${clubName(db, vacancy.clubId) ?? teamName(db, vacancy.teamId)}`,
    body: "You have been appointed manager.",
    relatedEntity: { type: "team", id: vacancy.teamId },
    read: false,
  });

  return contract;
};

export class ChairmanManagerError extends Error {
  constructor(
    readonly code: "NOT_AUTHORIZED" | "INVALID_TARGET" | "MANAGER_UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

/** Bounded owner authority: appoint an available manager to a controlled Nepal club. */
export const appointManagerForChairman = (
  db: GameDatabase,
  input: { ownerPersonId: EntityId; vacancyId: EntityId; managerProfileId: EntityId; date: string },
): ManagerContract => {
  const careerWorld = new CareerWorldRepository(db);
  const managers = new ManagerRepository(db);
  const vacancy = careerWorld.vacancy(input.vacancyId);
  if (!vacancy || vacancy.status !== "OPEN" || !vacancy.clubId) {
    throw new ChairmanManagerError("INVALID_TARGET", "That manager vacancy is not open.");
  }
  const club = db
    .prepare(
      `
    SELECT c.id FROM clubs c JOIN countries co ON co.id = c.country_id
    WHERE c.id = ? AND co.iso_code IN ('NP', 'NPL')
  `,
    )
    .get(vacancy.clubId) as { id?: EntityId } | undefined;
  if (!club || isContextOnlyClub(db, vacancy.clubId)) {
    throw new ChairmanManagerError(
      "NOT_AUTHORIZED",
      "Only a Nepal playable club can be controlled.",
    );
  }
  const stake = db
    .prepare(
      `
    SELECT 1 FROM club_ownership_stakes
    WHERE club_id = ? AND holder_type = 'PERSON' AND holder_id = ?
      AND status = 'ACTIVE' AND percentage >= 51
  `,
    )
    .get(vacancy.clubId, input.ownerPersonId);
  if (!stake)
    throw new ChairmanManagerError("NOT_AUTHORIZED", "The chairman does not control this club.");
  const profile = managers.getProfile(input.managerProfileId);
  if (!profile || managers.activeContract(profile.id)) {
    throw new ChairmanManagerError("MANAGER_UNAVAILABLE", "That manager is already employed.");
  }
  const check = eligibility(profile, vacancy);
  if (!check.eligible)
    throw new ChairmanManagerError(
      "MANAGER_UNAVAILABLE",
      check.note ?? "The manager is not eligible.",
    );
  const contract = {
    ...createManagerContract({
      managerProfileId: profile.id,
      personId: profile.personId,
      teamId: vacancy.teamId,
      clubId: vacancy.clubId,
      contractStart: input.date,
      contractEnd: addYears(input.date, 2),
      salaryAmountMinor: offeredSalaryFor(vacancy),
    }),
    id: createStableEntityId("chairman-manager-contract", `${vacancy.id}:${profile.id}`),
  };
  managers.insertContract(contract);
  careerWorld.fillVacancy(vacancy.id, input.date, contract.id);
  new EventRepository(db).insertHistoricalEvent({
    id: createStableEntityId("history", `CHAIRMAN_MANAGER_APPOINTED:${contract.id}`),
    occurredOn: input.date,
    eventType: "STAFF_APPOINTED",
    involvedEntities: [
      { id: vacancy.clubId, type: "club" },
      { id: profile.personId, type: "person" },
    ],
    title: "Chairman appointed a manager",
    data: { contractId: contract.id, vacancyId: vacancy.id },
    importance: "medium",
    scope: "club",
  });
  return contract;
};

export const declineJobOffer = (
  db: GameDatabase,
  save: SaveMetadata,
  applicationId: EntityId,
): void => {
  const careerWorld = new CareerWorldRepository(db);
  const application = careerWorld.application(applicationId);
  if (!application || application.status !== "OFFERED") {
    throw new JobOfferError("OFFER_NOT_PENDING", "That offer is no longer available.");
  }
  careerWorld.insertApplication({ ...application, status: "DECLINED", decidedOn: save.worldDate });
};

export type CareerHistoryEntry = {
  contract: ManagerContract;
  clubName?: string;
  teamName?: string;
};

export type TrophyEntry = {
  competitionName: string;
  teamName: string;
  wonOn: string;
};

/** Full employment record plus trophies won while managing each team. */
export const careerHistory = (
  db: GameDatabase,
  personId: EntityId,
): { history: CareerHistoryEntry[]; trophies: TrophyEntry[] } => {
  const managers = new ManagerRepository(db);
  const competitions = new CompetitionRepository(db);
  const contracts = managers.contractsForPerson(personId);
  const history = contracts.map((contract) => ({
    contract,
    clubName: contract.clubId ? clubName(db, contract.clubId) : undefined,
    teamName: contract.teamId ? teamName(db, contract.teamId) : undefined,
  }));

  const trophies: TrophyEntry[] = [];
  for (const contract of contracts) {
    if (!contract.teamId) continue;
    const end = contract.contractEnd ?? "9999-12-31";
    for (const winner of competitions.winnersForTeam(contract.teamId)) {
      if (winner.decidedOn < contract.contractStart || winner.decidedOn > end) continue;
      const row = db
        .prepare(
          `SELECT c.name FROM competition_seasons cs
          JOIN competitions c ON c.id = cs.competition_id
          WHERE cs.id = ?`,
        )
        .get(winner.competitionSeasonId) as SqlRow | undefined;
      trophies.push({
        competitionName: row?.name ?? "Competition",
        teamName: teamName(db, contract.teamId),
        wonOn: winner.decidedOn,
      });
    }
  }

  return { history, trophies };
};

export type UnemployedCareerAdvanceOutcome = {
  worldDate: string;
  daysAdvanced: number;
  newVacancies: number;
  message: string;
};

/**
 * The unemployed equivalent of `advanceManagerCareer`: there is no fixture or
 * squad to tend to, so this simply lets the world (AI managers, board
 * confidence, vacancies) move forward and stops once something new has
 * appeared for the player to react to.
 */
export const advanceUnemployedCareer = (
  db: GameDatabase,
  save: SaveMetadata,
  maxDays = 5,
): UnemployedCareerAdvanceOutcome => {
  const careerWorld = new CareerWorldRepository(db);
  const before = careerWorld.openVacancies().length;
  let date = save.worldDate;

  for (let day = 0; day < maxDays; day += 1) {
    date = addDays(date, 1);
    const tick: SaveMetadata = { ...save, worldDate: date };
    ensureAiManagersAssigned(db, tick, undefined);
    evaluateBoardConfidence(db, tick);
    const after = careerWorld.openVacancies().length;
    if (after > before) break;
  }

  const after = careerWorld.openVacancies().length;
  const newVacancies = Math.max(0, after - before);
  return {
    worldDate: date,
    daysAdvanced: maxDays,
    newVacancies,
    message:
      newVacancies > 0
        ? `${newVacancies} new manager vacanc${newVacancies === 1 ? "y has" : "ies have"} opened up.`
        : "No new opportunities yet. Keep waiting or check back on the job centre.",
  };
};

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};
