import {
  createStableEntityId,
  type AcademySimulationProfile,
  type CountryDevelopmentProfile,
  type EntityId,
  type GeneratedPlayerOrigin,
  type HistoricalEvent,
  type Person,
  type PersonRole,
  type PlayerArchetype,
  type PlayerAttributeSet,
  type PlayerContractRecord,
  type PlayerKnowledge,
  type PlayerOriginType,
  type PlayerPosition,
  type PlayerPotential,
  type RetiredStaffTransition,
  type StaffAppointment,
  type TeamPersonAssignment,
  type YouthPlayerStatus,
  type YouthIntakeSource,
} from "@nepal-football-sim/shared-types";
import {
  EventRepository,
  ClubNetworkRepository,
  PlayerRepository,
  RecruitmentRepository,
  TransferMarketRepository,
  WorldRepository,
  YouthRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { createInitialDevelopmentState } from "./player-development.js";
import { PLAYABLE_CLUB_PREDICATE } from "./playable-world.js";
import { SeededRandom } from "./rng.js";
import { initializeTransferMarketForSave } from "./transfer-market.js";

type YouthClub = {
  id: EntityId;
  name: string;
  countryId: EntityId;
  locationId?: EntityId;
  canonicalExternalId?: string;
  ownershipType: string;
  teamId?: EntityId;
};

type YouthAcademy = {
  id: EntityId;
  name: string;
  countryId: EntityId;
  locationId?: EntityId;
  parentClubId?: EntityId;
  linkedClubId?: EntityId;
  federationId?: EntityId;
  academyType: string;
};

export type YouthAnnualReport = {
  intakeDate: string;
  seasonLabel: string;
  intakeEvents: number;
  generatedPlayers: number;
  academyLinkedPlayers: number;
  districtPlayers: number;
  grassrootsPlayers: number;
  diasporaPlayers: number;
  youthContracts: number;
  promotedPlayers: number;
  releasedYouth: number;
  retirementsAnnounced: number;
  retiredPlayers: number;
  staffTransitions: number;
  averageCurrentAbility: number;
  averagePotential: number;
  highestPotential: number;
  positionsGenerated: Record<string, number>;
  academySources: Record<string, number>;
  districtSources: Record<string, number>;
};

export type YouthDiagnosticReport = {
  seasons: YouthAnnualReport[];
  populationBySeason: Array<{
    seasonLabel: string;
    totalPlayers: number;
    realImportedPlayers: number;
    generatedPlayers: number;
    retiredPlayers: number;
    averageAge: number;
    freeAgents: number;
    clubSquadSizes: Array<{ clubId: EntityId; clubName: string; players: number }>;
  }>;
  totals: {
    generatedPlayers: number;
    retirements: number;
    staffTransitions: number;
    highestPotential: number;
  };
};

const currency = "NPR";

export const initializeYouthSystemForSave = (input: {
  db: GameDatabase;
  worldDate: string;
  seed: string;
}): void => {
  const youth = new YouthRepository(input.db);
  const country = nepalCountry(input.db);
  if (!country) return;
  /* The profile id is keyed by year while the conflict target is
   * (country, effective_from), so re-initialising on a different date in the
   * same year would collide on the primary key. One profile per year is the
   * intended shape, so skip when this year is already seeded. */
  const developmentProfile = nepalDevelopmentProfile(country.id, input.worldDate);
  const seededYear = input.db
    .prepare("SELECT id FROM country_development_profiles WHERE id = ?")
    .get(developmentProfile.id) as { id?: string } | undefined;
  if (!seededYear) youth.upsertCountryDevelopmentProfile(developmentProfile);
  for (const academy of academies(input.db)) {
    youth.upsertAcademySimulationProfile(academyProfile(academy, input.seed));
  }
  /*
   * The set of clubs that already have a profile is read once. Re-reading every
   * academy profile inside the loop made this quadratic in club count, which
   * only became visible when the canonical global dataset raised that count
   * from tens to hundreds — and this runs on every youth cohort generated.
   */
  const profiledClubs = new Set(
    youth.academyProfiles().map((profile) => profile.clubId).filter(Boolean),
  );
  for (const club of youthClubs(input.db)) {
    if (!profiledClubs.has(club.id)) {
      profiledClubs.add(club.id);
      youth.upsertAcademySimulationProfile(clubFallbackProfile(club, input.seed));
    }
  }
};

export const runAnnualYouthAndRetirementCycle = (input: {
  db: GameDatabase;
  worldDate: string;
  seed: string;
  seasonLabel?: string;
}): YouthAnnualReport => {
  initializeYouthSystemForSave(input);
  initializeTransferMarketForSave(input);
  const seasonLabel = input.seasonLabel ?? input.worldDate.slice(0, 4);
  const youth = new YouthRepository(input.db);
  if (youth.hasIntakeForSeason(seasonLabel)) {
    return summarizeExistingSeason(input.db, seasonLabel, input.worldDate);
  }
  const intakeDate = nepalIntakeDateFor(input.worldDate);
  const country = nepalCountry(input.db);
  if (!country) {
    return blankAnnualReport(intakeDate, seasonLabel);
  }
  const profiles = youth.academyProfiles();
  const clubs = youthClubs(input.db);
  const academyRows = academies(input.db);
  const report = blankAnnualReport(intakeDate, seasonLabel);
  const seenNames = existingNames(input.db);

  for (const club of clubs) {
    const baseProfile = profileForClub(profiles, club, academyRows);
    const academyContext = academyPartnershipDevelopmentContext(input.db, club.id, input.worldDate);
    const profile = { ...baseProfile, regionalReach: Math.min(10, baseProfile.regionalReach + academyContext.regionalReachBonus) };
    const linkedAcademy = academyForClub(academyRows, club.id);
    const needBoost = squadNeedBoost(input.db, club.id);
    const volume = clamp(
      Math.round(
        0.5 + profile.youthRecruitmentQuality / 8 + profile.regionalReach / 18 + needBoost,
      ),
      activeSeniorPlayers(input.db, club.id) >= 11 ? 1 : 0,
      activeSeniorPlayers(input.db, club.id) >= 11 ? 4 : 1,
    );
    const generated = generateIntakeForSource({
      db: input.db,
      countryId: country.id,
      club,
      academy: linkedAcademy,
      profile,
      date: intakeDate,
      seasonLabel,
      seed: `${input.seed}:${club.id}:${seasonLabel}`,
      count: volume,
      seenNames,
    });
    accumulate(report, generated);
  }

  const nationalAcademies = academyRows.filter(
    (academy) => !academy.linkedClubId && !academy.parentClubId,
  );
  for (const academy of nationalAcademies.slice(0, 4)) {
    const profile =
      profiles.find((candidate) => candidate.academyId === academy.id) ??
      academyProfile(academy, input.seed);
    const generated = generateIntakeForSource({
      db: input.db,
      countryId: country.id,
      academy,
      profile,
      date: intakeDate,
      seasonLabel,
      seed: `${input.seed}:academy:${academy.id}:${seasonLabel}`,
      count: academy.academyType === "NATIONAL_ACADEMY" ? 3 : 1,
      seenNames,
    });
    accumulate(report, generated);
  }

  const youthDecisions = processYouthDecisions(input.db, intakeDate, input.seed);
  report.promotedPlayers += youthDecisions.promoted;
  report.releasedYouth += youthDecisions.released;
  const retirement = processRetirements(input.db, intakeDate, input.seed);
  report.retirementsAnnounced = retirement.announced;
  report.retiredPlayers = retirement.retired;
  report.staffTransitions = retirement.staffTransitions;
  return normalizeAnnualReport(report);
};

/** Derived intake context; never accumulates a permanent academy bonus. */
export const academyPartnershipDevelopmentContext = (
  db: GameDatabase,
  clubId: EntityId,
  worldDate: string,
): { active: boolean; regionalReachBonus: number } => {
  const active = new ClubNetworkRepository(db).activeAcademyPartnerships(clubId, worldDate).length > 0;
  return { active, regionalReachBonus: active ? 0.6 : 0 };
};

/**
 * Reusable single-source intake cohort, used by the workforce-supply layer so
 * women's football and demand-driven top-ups run through this same generation
 * engine rather than a second one. Idempotent per (season, club, academy,
 * gender) through the underlying youth intake event key.
 */
export const generateYouthCohort = (input: {
  db: GameDatabase;
  countryId: EntityId;
  clubId?: EntityId;
  teamId?: EntityId;
  academyId?: EntityId;
  date: string;
  seasonLabel: string;
  seed: string;
  count: number;
  gender?: GeneratedYouthGender;
  cohortKey?: string;
  source?: YouthIntakeSource;
}): YouthAnnualReport => {
  initializeYouthSystemForSave({ db: input.db, worldDate: input.date, seed: input.seed });
  const youth = new YouthRepository(input.db);
  const academyRows = academies(input.db);
  /*
   * Resolved by ID rather than from the playable-world list: the foreign world
   * generates cohorts for CONTEXT_ONLY clubs, which that list deliberately omits.
   * Scope belongs to the annual cycle's club iteration, not to a targeted lookup.
   */
  const club = input.clubId ? youthClubById(input.db, input.clubId, input.teamId) : undefined;
  const academy = input.academyId
    ? academyRows.find((row) => row.id === input.academyId)
    : club
      ? academyForClub(academyRows, club.id)
      : undefined;
  const profile = club
    ? profileForClub(youth.academyProfiles(), club, academyRows)
    : academy
      ? (youth.academyProfiles().find((row) => row.academyId === academy.id) ??
        academyProfile(academy, input.seed))
      : undefined;
  if (!profile) return blankAnnualReport(input.date, input.seasonLabel);
  return generateIntakeForSource({
    db: input.db,
    countryId: input.countryId,
    club,
    academy,
    profile,
    date: input.date,
    seasonLabel: input.seasonLabel,
    seed: input.seed,
    count: Math.max(0, Math.round(input.count)),
    seenNames: existingNames(input.db),
    gender: input.gender,
    cohortKey: input.cohortKey,
    source: input.source,
  });
};

export const runYouthDiagnostic = (input: {
  db: GameDatabase;
  startDate: string;
  seasons: number;
  seed: string;
}): YouthDiagnosticReport => {
  const seasons: YouthAnnualReport[] = [];
  const populationBySeason: YouthDiagnosticReport["populationBySeason"] = [];
  for (let index = 0; index < input.seasons; index += 1) {
    const date = addYears(input.startDate, index);
    const report = runAnnualYouthAndRetirementCycle({
      db: input.db,
      worldDate: date,
      seed: `${input.seed}:diagnostic:${index}`,
      seasonLabel: String(new Date(`${date}T00:00:00.000Z`).getUTCFullYear()),
    });
    seasons.push(report);
    populationBySeason.push({
      seasonLabel: report.seasonLabel,
      ...populationSnapshot(input.db, date),
    });
  }
  return {
    seasons,
    populationBySeason,
    totals: {
      generatedPlayers: seasons.reduce((total, season) => total + season.generatedPlayers, 0),
      retirements: seasons.reduce((total, season) => total + season.retiredPlayers, 0),
      staffTransitions: seasons.reduce((total, season) => total + season.staffTransitions, 0),
      highestPotential: round(Math.max(0, ...seasons.map((season) => season.highestPotential))),
    },
  };
};

const generateIntakeForSource = (input: {
  db: GameDatabase;
  countryId: EntityId;
  club?: YouthClub;
  academy?: YouthAcademy;
  profile: AcademySimulationProfile;
  date: string;
  seasonLabel: string;
  seed: string;
  count: number;
  seenNames: Set<string>;
  gender?: GeneratedYouthGender;
  /**
   * Distinguishes two cohorts drawn from the same club in the same season (the
   * regular academy intake and a demand-driven top-up), so their generated
   * person IDs and intake events never collide.
   */
  cohortKey?: string;
  /** Which event this cohort belongs to; defaults to the club's annual intake. */
  source?: YouthIntakeSource;
}): YouthAnnualReport => {
  const youth = new YouthRepository(input.db);
  const rng = new SeededRandom(input.seed);
  const report = blankAnnualReport(input.date, input.seasonLabel);
  const generated: Array<{ ability: number; potential: number }> = [];
  const intakeType = originTypeFor(input.academy, input.club, rng);
  const gender = input.gender ?? "male";
  const cohortKey = input.cohortKey ?? "academy";
  const eventId = createStableEntityId(
    "youth-intake-event",
    `${input.seasonLabel}:${input.club?.id ?? "none"}:${input.academy?.id ?? "none"}:${gender}:${cohortKey}`,
  );
  youth.insertYouthIntakeEvent({
    id: eventId,
    countryId: input.countryId,
    clubId: input.club?.id,
    academyId: input.academy?.id,
    intakeDate: input.date,
    seasonLabel: input.seasonLabel,
    intakeType,
    source: input.source ?? "ANNUAL_INTAKE",
    playersGenerated: 0,
    averageCurrentAbility: 0,
    averagePotential: 0,
    highestPotential: 0,
    status: "SIMULATION_ONLY",
    seedKey: input.seed,
    data: { pending: true },
  });
  for (let index = 0; index < input.count; index += 1) {
    const origin = originTypeFor(input.academy, input.club, rng);
    const player = createGeneratedYouth({
      ...input,
      index,
      origin,
      intakeEventId: eventId,
      rng: new SeededRandom(`${input.seed}:player:${index}`),
      seenNames: input.seenNames,
      gender,
      cohortKey,
    });
    generated.push({ ability: player.currentAbility, potential: player.potentialAbility });
    report.generatedPlayers += 1;
    report.positionsGenerated[player.position] =
      (report.positionsGenerated[player.position] ?? 0) + 1;
    if (player.origin.originType.includes("ACADEMY")) report.academyLinkedPlayers += 1;
    if (player.origin.originType === "DISTRICT_FOOTBALL") report.districtPlayers += 1;
    if (player.origin.originType === "GRASSROOTS") report.grassrootsPlayers += 1;
    if (player.origin.originType === "DIASPORA_YOUTH") report.diasporaPlayers += 1;
    if (input.club) report.youthContracts += 1;
    if (input.academy) {
      report.academySources[input.academy.name] =
        (report.academySources[input.academy.name] ?? 0) + 1;
    }
    const district = districtName(
      input.db,
      player.origin.districtLocationId ?? player.origin.locationId,
    );
    report.districtSources[district] = (report.districtSources[district] ?? 0) + 1;
  }
  const averageCurrentAbility = average(generated.map((item) => item.ability));
  const averagePotential = average(generated.map((item) => item.potential));
  const highestPotential = Math.max(0, ...generated.map((item) => item.potential));
  report.averageCurrentAbility = averageCurrentAbility * report.generatedPlayers;
  report.averagePotential = averagePotential * report.generatedPlayers;
  report.highestPotential = highestPotential;
  youth.insertYouthIntakeEvent({
    id: eventId,
    countryId: input.countryId,
    clubId: input.club?.id,
    academyId: input.academy?.id,
    intakeDate: input.date,
    seasonLabel: input.seasonLabel,
    intakeType,
    source: input.source ?? "ANNUAL_INTAKE",
    playersGenerated: generated.length,
    averageCurrentAbility,
    averagePotential,
    highestPotential,
    status: "SIMULATION_ONLY",
    seedKey: input.seed,
    data: {
      model: "nepal-simulation-youth-v1",
      profile: input.profile,
      note: "Generated youth are simulation-only people, not real researched players.",
    },
  });
  new EventRepository(input.db).insertHistoricalEvent({
    id: createStableEntityId("history", `YOUTH_INTAKE_HELD:${eventId}`),
    occurredOn: input.date,
    eventType: "YOUTH_INTAKE_HELD",
    involvedEntities: [
      ...(input.club ? [{ id: input.club.id, type: "club" as const }] : []),
      ...(input.academy ? [{ id: input.academy.id, type: "club" as const }] : []),
    ],
    title: "Youth intake held",
    data: { playersGenerated: generated.length, intakeType },
    importance: "low",
    scope: input.club ? "club" : "country",
  });
  return normalizeAnnualReport(report);
};

const createGeneratedYouth = (input: {
  db: GameDatabase;
  countryId: EntityId;
  club?: YouthClub;
  academy?: YouthAcademy;
  profile: AcademySimulationProfile;
  date: string;
  seasonLabel: string;
  seed: string;
  index: number;
  origin: PlayerOriginType;
  intakeEventId: EntityId;
  rng: SeededRandom;
  seenNames: Set<string>;
  gender?: GeneratedYouthGender;
  cohortKey?: string;
}): {
  position: PlayerPosition;
  currentAbility: number;
  potentialAbility: number;
  origin: GeneratedPlayerOrigin;
} => {
  const gender = input.gender ?? "male";
  const key = `${input.seasonLabel}:${input.club?.id ?? "free"}:${input.academy?.id ?? "district"}:${gender}:${input.cohortKey ?? "academy"}:${input.index}`;
  const personId = createStableEntityId("person-generated-youth", key);
  const name = generatedNepaliName(input.rng, input.seenNames, gender);
  const age = weightedAge(input.rng);
  const position = generatedPosition(input.rng);
  const archetype = archetypeFor(position, input.rng);
  const currentAbility = currentAbilityFor(input.profile, age, input.rng);
  const potentialAbility = potentialFor(input.profile, currentAbility, input.rng);
  const dob = birthDateForAge(input.date, age, input.rng);
  const locationId = originLocation(input.db, input.club, input.academy, input.rng);
  const youthStatus = statusFor(currentAbility, potentialAbility, age);
  const person: Person = {
    id: personId,
    fullName: name.fullName,
    displayName: name.fullName,
    dateOfBirth: dob,
    nationalityCountryId: input.countryId,
    genderPresentation: gender,
    placeOfBirthLocationId: locationId,
    hometownLocationId: locationId,
    languages: ["Nepali"],
  };
  const world = new WorldRepository(input.db);
  world.insertPerson(person);
  world.insertPersonRole({
    id: createStableEntityId("person-role", `${personId}:PLAYER`),
    personId,
    role: "PLAYER",
    activeFrom: input.date,
  });
  const attributes = attributesFor(position, currentAbility, personId, key, input.rng);
  const playerRepo = new PlayerRepository(input.db);
  playerRepo.insertAttributes(attributes);
  const potential: PlayerPotential = {
    id: createStableEntityId("player-potential", personId),
    playerId: personId,
    potentialCeiling: potentialAbility,
    developmentRate: round(
      clamp(0.65 + input.rng.next() * 0.65 + (potentialAbility - currentAbility) / 18, 0.45, 1.75),
    ),
    volatility: round(0.45 + input.rng.next() * 0.9),
    professionalism: round(clamp(0.55 + input.rng.next() * 0.85, 0.35, 1.65)),
    status: "SIMULATION_ONLY",
  };
  playerRepo.insertPotential(potential);
  playerRepo.upsertDevelopmentState(createInitialDevelopmentState(attributes, age, input.date));
  const youth = new YouthRepository(input.db);
  const origin: GeneratedPlayerOrigin = {
    id: createStableEntityId("generated-player-origin", personId),
    playerId: personId,
    originType: input.origin,
    originDataType: "SIMULATION_ONLY",
    countryId: input.countryId,
    clubId: input.club?.id,
    academyId: input.academy?.id,
    locationId,
    districtLocationId: locationId,
    intakeEventId: input.intakeEventId,
    generatedOn: input.date,
    nameGenerationKey: key,
    archetype,
    youthStatus,
    eligibility: {
      nationalityCountryId: input.countryId,
      ageGroupEligible: age <= 18,
      diaspora: input.origin === "DIASPORA_YOUTH",
    },
    sourceNotes:
      gender === "female"
        ? "Generated simulation-only Nepal women's youth player"
        : "Generated simulation-only Nepal youth player",
  };
  youth.insertGeneratedPlayerOrigin(origin);
  youth.upsertYouthStatus({
    playerId: personId,
    youthStatus,
    clubId: input.club?.id,
    academyId: input.academy?.id,
    statusSince: input.date,
    pathway: { originType: input.origin, archetype },
  });
  youth.insertYouthDevelopmentActivity({
    id: createStableEntityId("youth-activity", `${personId}:${input.date}:initial`),
    playerId: personId,
    clubId: input.club?.id,
    academyId: input.academy?.id,
    activityDate: input.date,
    activityType: input.club ? "ACADEMY_TRAINING" : "LOCAL_COMPETITION",
    developmentMinutes: 360 + input.rng.integer(0, 360),
    exposureLevel: round(clamp((currentAbility + potentialAbility) / 28, 0.2, 0.95)),
    data: { abstract: true },
  });
  if (
    input.club?.teamId &&
    youthStatus !== "ACADEMY_CANDIDATE" &&
    (activeSeniorPlayers(input.db, input.club.id) < 42 ||
      (youthStatus === "FIRST_TEAM_PROSPECT" && activeSeniorPlayers(input.db, input.club.id) < 50))
  ) {
    assignYouthToClub(input.db, personId, input.club, youthStatus, input.date);
  }
  if (input.club) {
    const contract = youthContract(personId, input.club.id, input.date, age, youthStatus);
    new TransferMarketRepository(input.db).upsertPlayerContract(contract);
    seedOwnClubKnowledge(
      input.db,
      input.club.id,
      personId,
      name.fullName,
      position,
      currentAbility,
      potentialAbility,
      input.date,
    );
  }
  new EventRepository(input.db).insertHistoricalEvent({
    id: createStableEntityId("history", `YOUTH_PLAYER_GENERATED:${personId}`),
    occurredOn: input.date,
    eventType: "YOUTH_PLAYER_GENERATED",
    involvedEntities: [{ id: personId, type: "person" }],
    title: `${name.fullName} entered the football world`,
    data: { originDataType: "SIMULATION_ONLY", originType: input.origin, youthStatus },
    importance: "low",
    scope: input.club ? "club" : "country",
  });
  return { position, currentAbility, potentialAbility, origin };
};

const processYouthDecisions = (
  db: GameDatabase,
  date: string,
  seed: string,
): { promoted: number; released: number } => {
  const youth = new YouthRepository(db);
  let promoted = 0;
  let released = 0;
  for (const status of youth.youthStatuses()) {
    const attributes = new PlayerRepository(db).getAttributes(status.playerId);
    const potential = new PlayerRepository(db).potential(status.playerId);
    if (!attributes || !potential || !status.clubId) continue;
    const age = ageForPlayer(db, status.playerId, date);
    const ability = averageAttributes(attributes);
    const rng = new SeededRandom(`${seed}:youth-decision:${status.playerId}:${date}`);
    if (
      status.youthStatus !== "FIRST_TEAM_PLAYER" &&
      (ability >= 7.1 || potential.potentialCeiling >= 11.2 || age >= 18) &&
      rng.next() < 0.35
    ) {
      youth.updateYouthStatus(status.playerId, "FIRST_TEAM_PROSPECT", date);
      promoted += 1;
      insertSimpleHistory(db, "YOUTH_PLAYER_PROMOTED", status.playerId, date, {
        clubId: status.clubId,
        ability,
      });
    } else if (
      age >= 18 &&
      ability < 5.3 &&
      potential.potentialCeiling < 7.4 &&
      rng.next() < 0.28
    ) {
      youth.updateYouthStatus(status.playerId, "ACADEMY_CANDIDATE", date);
      new TransferMarketRepository(db).markContractStatus(
        createStableEntityId("player-contract", `${status.playerId}:${status.clubId}:youth`),
        "TERMINATED",
      );
      new TransferMarketRepository(db).endActiveTeamAssignments(status.playerId, date);
      released += 1;
      insertSimpleHistory(db, "YOUTH_PLAYER_RELEASED", status.playerId, date, {
        clubId: status.clubId,
      });
    }
  }
  return { promoted, released };
};

const processRetirements = (
  db: GameDatabase,
  date: string,
  seed: string,
): { announced: number; retired: number; staffTransitions: number } => {
  const youth = new YouthRepository(db);
  const market = new TransferMarketRepository(db);
  let announced = 0;
  let retired = 0;
  let staffTransitions = 0;
  const existing = new Set(
    youth
      .retirementStates()
      .filter((row) => row.state === "RETIRED")
      .map((row) => row.playerId),
  );
  for (const player of allPlayersForRetirement(db, date)) {
    if (existing.has(player.playerId) || player.age < 31) continue;
    const rng = new SeededRandom(`${seed}:retirement:${player.playerId}:${date}`);
    const gkModifier = player.position === "GK" ? -0.18 : 0;
    const contract = market.activeContract(player.playerId, date);
    const contractModifier = contract ? -0.08 : 0.12;
    const agePressure = clamp((player.age - (player.position === "GK" ? 36 : 34)) * 0.11, 0, 0.9);
    const abilityProtection = clamp((8.5 - player.ability) * 0.045, -0.18, 0.2);
    const probability = clamp(
      agePressure + abilityProtection + contractModifier + gkModifier,
      0,
      0.86,
    );
    if (rng.next() > probability) continue;
    const announce = player.age < 39 && rng.next() < 0.45;
    const retirementDate = announce ? addDays(date, 120 + rng.integer(0, 120)) : date;
    youth.upsertRetirementState({
      playerId: player.playerId,
      state: announce ? "RETIREMENT_ANNOUNCED" : "RETIRED",
      decidedOn: date,
      announcedOn: announce ? date : undefined,
      retirementDate,
      reason: player.age >= 38 ? "Age and physical decline" : "Career transition",
      staffInterest: round(
        clamp(player.leadership / 20 + player.professionalism / 28 + rng.next() * 0.35, 0, 1),
      ),
      data: { age: player.age, ability: player.ability, position: player.position },
    });
    if (announce) {
      announced += 1;
      insertSimpleHistory(db, "PLAYER_RETIREMENT_ANNOUNCED", player.playerId, date, {
        retirementDate,
      });
      continue;
    }
    retirePlayer(db, player.playerId, date);
    retired += 1;
    if (maybeConvertToStaff(db, player, date, rng)) staffTransitions += 1;
  }
  for (const record of youth
    .retirementStates()
    .filter(
      (item) =>
        item.state === "RETIREMENT_ANNOUNCED" && item.retirementDate && item.retirementDate <= date,
    )) {
    youth.upsertRetirementState({ ...record, state: "RETIRED", decidedOn: date });
    retirePlayer(db, record.playerId, date);
    retired += 1;
    const player = allPlayersForRetirement(db, date).find(
      (candidate) => candidate.playerId === record.playerId,
    );
    if (
      player &&
      maybeConvertToStaff(db, player, date, new SeededRandom(`${seed}:staff:${record.playerId}`))
    ) {
      staffTransitions += 1;
    }
  }
  return { announced, retired, staffTransitions };
};

const retirePlayer = (db: GameDatabase, playerId: EntityId, date: string): void => {
  db.prepare(
    "UPDATE person_roles SET active_to = ? WHERE person_id = ? AND role = 'PLAYER' AND active_to IS NULL",
  ).run(date, playerId);
  new TransferMarketRepository(db).endActiveTeamAssignments(playerId, date);
  db.prepare(
    "UPDATE player_contracts SET status = 'TERMINATED' WHERE player_id = ? AND status = 'ACTIVE'",
  ).run(playerId);
  insertSimpleHistory(db, "PLAYER_RETIRED", playerId, date, {});
};

const maybeConvertToStaff = (
  db: GameDatabase,
  player: { playerId: EntityId; clubId?: EntityId; leadership: number; professionalism: number },
  date: string,
  rng: SeededRandom,
): boolean => {
  const probability = clamp(
    player.leadership / 42 + player.professionalism / 48 + rng.next() * 0.12,
    0,
    0.42,
  );
  if (rng.next() > probability) return false;
  const role = rng.next() < 0.55 ? "YOUTH_COACH" : rng.next() < 0.75 ? "SCOUT" : "ASSISTANT_COACH";
  const world = new WorldRepository(db);
  const roleId: PersonRole = {
    id: createStableEntityId("person-role", `${player.playerId}:STAFF:${date}`),
    personId: player.playerId,
    role: "STAFF",
    activeFrom: date,
  };
  world.insertPersonRole(roleId);
  const appointment: StaffAppointment = {
    id: createStableEntityId("staff-appointment", `${player.playerId}:${role}:${date}`),
    personId: player.playerId,
    organisationType: player.clubId ? "CLUB" : "UNKNOWN",
    clubId: player.clubId,
    organisationName: player.clubId ? undefined : "Independent football staff market",
    role,
    startDate: date,
    employmentStatus: "ACTIVE",
  };
  world.insertStaffAppointment(appointment);
  const transition: RetiredStaffTransition = {
    id: createStableEntityId("retired-staff-transition", `${player.playerId}:${date}`),
    playerId: player.playerId,
    staffRole:
      role === "SCOUT" ? "SCOUT" : role === "ASSISTANT_COACH" ? "ASSISTANT_COACH" : "ACADEMY_COACH",
    clubId: player.clubId,
    transitionedOn: date,
    status: "SIMULATION_ONLY",
    data: { role },
  };
  new YouthRepository(db).insertRetiredStaffTransition(transition);
  insertSimpleHistory(db, "RETIRED_PLAYER_BECAME_STAFF", player.playerId, date, { role });
  return true;
};

const assignYouthToClub = (
  db: GameDatabase,
  personId: EntityId,
  club: YouthClub,
  youthStatus: YouthPlayerStatus,
  date: string,
): void => {
  if (!club.teamId) return;
  const assignment: TeamPersonAssignment = {
    id: createStableEntityId("team-person-assignment", `${personId}:${club.teamId}:${date}`),
    personId,
    teamId: club.teamId,
    role: "PLAYER",
    startedOn: date,
  };
  new TransferMarketRepository(db).insertTeamAssignment(assignment);
  if (youthStatus === "FIRST_TEAM_PROSPECT" || youthStatus === "FIRST_TEAM_PLAYER") {
    new YouthRepository(db).updateYouthStatus(personId, youthStatus, date);
  }
};

const youthContract = (
  playerId: EntityId,
  clubId: EntityId,
  date: string,
  age: number,
  status: YouthPlayerStatus,
): PlayerContractRecord => ({
  id: createStableEntityId("player-contract", `${playerId}:${clubId}:youth`),
  playerId,
  clubId,
  startDate: date,
  endDate: addYears(date, age <= 16 ? 2 : 1),
  contractType: age <= 16 ? "YOUTH" : status === "FIRST_TEAM_PROSPECT" ? "SEMI_PRO" : "AMATEUR",
  salary: age <= 16 ? 0 : 4000,
  appearanceFee: 0,
  goalBonus: 0,
  cleanSheetBonus: 0,
  signingBonus: 0,
  loyaltyBonus: 0,
  currency,
  squadRole: status === "FIRST_TEAM_PROSPECT" ? "PROSPECT" : "YOUTH",
  status: "ACTIVE",
  provenance: {
    sourceName: "Nepal youth intake simulation",
    confidence: 1,
    confidenceLevel: "HIGH",
    status: "SIMULATION_ONLY",
    notes: "Generated youth contract terms for gameplay only",
  },
});

const seedOwnClubKnowledge = (
  db: GameDatabase,
  clubId: EntityId,
  playerId: EntityId,
  name: string,
  position: PlayerPosition,
  ability: number,
  potential: number,
  date: string,
): void => {
  const knowledge: PlayerKnowledge = {
    id: createStableEntityId("player-knowledge", `CLUB:${clubId}:${playerId}`),
    observerType: "CLUB",
    observerOrganisationId: clubId,
    playerId,
    discoveryStatus: "KNOWN",
    knowledgeLevel: "GOOD",
    confidence: "HIGH",
    sourceType: "OWN_PLAYER",
    identityKnowledge: { name, generatedPlayer: true },
    positionKnowledge: { exactPosition: position, positionGroup: positionGroup(position) },
    abilityKnowledge: {
      estimatedAbility: { min: Math.max(1, ability - 0.6), max: ability + 0.6 },
      rangeOnly: true,
    },
    potentialKnowledge: {
      estimatedPotential: potential >= 12 ? "High domestic potential" : "Domestic potential",
      rangeOnly: true,
    },
    contractKnowledge: { status: "Youth terms known", exactDetailsVisible: true },
    personalityKnowledge: { summary: "Known through academy" },
    medicalKnowledge: { concern: "No known concern" },
    careerKnowledge: { youthIntake: true },
    observations: 4,
    lastObservedAt: date,
    updatedAt: date,
  };
  new RecruitmentRepository(db).upsertPlayerKnowledge(knowledge);
};

const nepalDevelopmentProfile = (countryId: EntityId, date: string): CountryDevelopmentProfile => ({
  id: createStableEntityId("country-development-profile", `${countryId}:${date.slice(0, 4)}`),
  countryId,
  effectiveFrom: date,
  footballPopularity: 0.58,
  grassrootsReach: 0.42,
  coachingQuality: 0.36,
  youthInfrastructure: 0.32,
  talentConversion: 0.34,
  status: "SIMULATION_ONLY",
  notes: "Calibrated Nepal youth environment for gameplay; not a researched score.",
});

const academyProfile = (academy: YouthAcademy, seed: string): AcademySimulationProfile => {
  const rng = new SeededRandom(`${seed}:academy-profile:${academy.id}`);
  const national = academy.academyType === "NATIONAL_ACADEMY";
  const regional = academy.academyType === "REGIONAL_ACADEMY";
  const club =
    academy.academyType === "CLUB_ACADEMY" || academy.academyType === "ACADEMY_CLUB_HYBRID";
  return {
    id: createStableEntityId("academy-simulation-profile", academy.id),
    academyId: academy.id,
    clubId: academy.linkedClubId ?? academy.parentClubId,
    countryId: academy.countryId,
    youthRecruitmentQuality: round((national ? 10 : regional ? 8 : club ? 7 : 6) + rng.next() * 2),
    academyCoachingQuality: round(
      (national ? 9 : regional ? 7 : club ? 6.5 : 5.5) + rng.next() * 2,
    ),
    academyFacilitiesQuality: round(
      (national ? 8 : regional ? 6.5 : club ? 6 : 5) + rng.next() * 2,
    ),
    regionalReach: round((national ? 10 : regional ? 8 : club ? 5.5 : 4) + rng.next() * 2),
    talentIdentificationQuality: round(
      (national ? 9 : regional ? 7 : club ? 6 : 5) + rng.next() * 2,
    ),
    status: "SIMULATION_ONLY",
  };
};

const clubFallbackProfile = (club: YouthClub, seed: string): AcademySimulationProfile => {
  const rng = new SeededRandom(`${seed}:club-youth-profile:${club.id}`);
  const departmental = club.ownershipType === "DEPARTMENTAL";
  return {
    id: createStableEntityId("academy-simulation-profile", `club:${club.id}`),
    clubId: club.id,
    countryId: club.countryId,
    youthRecruitmentQuality: round((departmental ? 5.2 : 4.6) + rng.next() * 1.8),
    academyCoachingQuality: round(4.2 + rng.next() * 1.8),
    academyFacilitiesQuality: round(3.8 + rng.next() * 1.8),
    regionalReach: round((departmental ? 5 : 4) + rng.next() * 2),
    talentIdentificationQuality: round(4.5 + rng.next() * 2),
    status: "SIMULATION_ONLY",
  };
};

const profileForClub = (
  profiles: AcademySimulationProfile[],
  club: YouthClub,
  academyRows: YouthAcademy[],
): AcademySimulationProfile =>
  profiles.find((profile) => profile.clubId === club.id) ??
  profiles.find((profile) => profile.academyId === academyForClub(academyRows, club.id)?.id) ??
  clubFallbackProfile(club, "fallback");

const originTypeFor = (
  academy: YouthAcademy | undefined,
  club: YouthClub | undefined,
  rng: SeededRandom,
): PlayerOriginType => {
  if (!club && academy?.academyType === "NATIONAL_ACADEMY") return "NATIONAL_ACADEMY";
  if (!club && academy?.academyType === "REGIONAL_ACADEMY") return "REGIONAL_ACADEMY";
  if (academy?.academyType === "PRIVATE_ACADEMY") return "PRIVATE_ACADEMY";
  if (academy && club) return "CLUB_ACADEMY";
  if (club?.ownershipType === "DEPARTMENTAL" && rng.next() < 0.18)
    return "DEPARTMENTAL_RECRUITMENT";
  const roll = rng.next();
  if (roll < 0.48) return "DISTRICT_FOOTBALL";
  if (roll < 0.86) return "GRASSROOTS";
  if (roll < 0.97) return "GENERATED_FREE_PLAYER";
  return "DIASPORA_YOUTH";
};

/**
 * Women's football generates from its own name pool. Sharing the surname pool
 * is correct - Nepali family names are not gendered - but given names are.
 */
export type GeneratedYouthGender = "male" | "female";

const FEMALE_FIRST_NAMES = [
  "Anita",
  "Anjali",
  "Asmita",
  "Bimala",
  "Deepa",
  "Dipa",
  "Gita",
  "Kabita",
  "Manisha",
  "Nirmala",
  "Pooja",
  "Prabha",
  "Preeti",
  "Rachana",
  "Rekha",
  "Renuka",
  "Sabitra",
  "Samjhana",
  "Sanju",
  "Saru",
  "Sarita",
  "Sunita",
  "Susmita",
  "Rasila",
];

const generatedNepaliName = (
  rng: SeededRandom,
  seenNames: Set<string>,
  gender: GeneratedYouthGender = "male",
): { firstName: string; middleName?: string; surname: string; fullName: string } => {
  const first =
    gender === "female"
      ? FEMALE_FIRST_NAMES
      : [
          "Aarav",
          "Aashish",
          "Abinash",
          "Anish",
          "Arjun",
          "Bikash",
          "Bimal",
          "Bibek",
          "Deepak",
          "Dinesh",
          "Kiran",
          "Manish",
          "Nabin",
          "Niraj",
          "Prabin",
          "Prakash",
          "Rabin",
          "Rajan",
          "Ramesh",
          "Ritesh",
          "Roshan",
          "Sagar",
          "Sandesh",
          "Sanjog",
          "Suman",
          "Suraj",
          "Sushil",
          "Utsav",
          "Yogesh",
        ];
  const middle =
    gender === "female"
      ? ["Kumari", "Devi", "Maya", "Laxmi"]
      : ["Bahadur", "Kumar", "Raj", "Prasad", "Man", "Bir"];
  const surnames = [
    "Adhikari",
    "Ale",
    "Basnet",
    "Bhandari",
    "Bista",
    "Budha",
    "Chaudhary",
    "Ghale",
    "Gurung",
    "Karki",
    "Khadka",
    "Lama",
    "Limbu",
    "Magar",
    "Maharjan",
    "Poudel",
    "Rai",
    "Shahi",
    "Sharma",
    "Sherpa",
    "Shrestha",
    "Tamang",
    "Thapa",
    "Yadav",
  ];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const firstName = rng.pick(first);
    const middleName = rng.next() < 0.16 ? rng.pick(middle) : undefined;
    const surname = rng.pick(surnames);
    const fullName = [firstName, middleName, surname].filter(Boolean).join(" ");
    if (!seenNames.has(fullName.toLowerCase())) {
      seenNames.add(fullName.toLowerCase());
      return { firstName, middleName, surname, fullName };
    }
  }
  const fullName = `${rng.pick(first)} ${rng.pick(surnames)} ${rng.integer(10, 99)}`;
  seenNames.add(fullName.toLowerCase());
  return { firstName: fullName.split(" ")[0]!, surname: fullName.split(" ").at(-2)!, fullName };
};

const weightedAge = (rng: SeededRandom): number => {
  const roll = rng.next();
  if (roll < 0.18) return 15;
  if (roll < 0.55) return 16;
  if (roll < 0.84) return 17;
  return 18;
};

const generatedPosition = (rng: SeededRandom): PlayerPosition => {
  const pool: PlayerPosition[] = [
    "GK",
    "CB",
    "CB",
    "RB",
    "LB",
    "DM",
    "CM",
    "CM",
    "AM",
    "RW",
    "LW",
    "ST",
    "ST",
  ];
  return rng.pick(pool);
};

const archetypeFor = (position: PlayerPosition, rng: SeededRandom): PlayerArchetype => {
  const pools: Record<PlayerPosition, PlayerArchetype[]> = {
    GK: ["SHOT_STOPPER", "SWEEPER_KEEPER"],
    CB: ["PHYSICAL_CB", "BALL_PLAYING_CB"],
    RB: ["ATTACKING_FULLBACK", "DEFENSIVE_FULLBACK"],
    LB: ["ATTACKING_FULLBACK", "DEFENSIVE_FULLBACK"],
    DM: ["BALL_WINNING_MIDFIELDER", "DEEP_PLAYMAKER"],
    CM: ["BOX_TO_BOX", "DEEP_PLAYMAKER"],
    AM: ["CREATIVE_MIDFIELDER", "BOX_TO_BOX"],
    RW: ["WINGER", "INSIDE_FORWARD"],
    LW: ["WINGER", "INSIDE_FORWARD"],
    ST: ["MOBILE_STRIKER", "POACHER", "TARGET_FORWARD"],
  };
  return rng.pick(pools[position]);
};

const currentAbilityFor = (
  profile: AcademySimulationProfile,
  age: number,
  rng: SeededRandom,
): number => {
  const quality =
    (profile.academyCoachingQuality +
      profile.academyFacilitiesQuality +
      profile.talentIdentificationQuality) /
    30;
  return round(clamp(3.2 + quality * 2.4 + (age - 15) * 0.25 + rng.next() * 1.2, 2.2, 8.4));
};

const potentialFor = (
  profile: AcademySimulationProfile,
  currentAbility: number,
  rng: SeededRandom,
): number => {
  const quality =
    (profile.youthRecruitmentQuality +
      profile.regionalReach +
      profile.talentIdentificationQuality) /
    30;
  const roll = rng.next();
  const tail = roll > 0.995 ? 6.6 : roll > 0.975 ? 4.8 : roll > 0.9 ? 3.4 : roll > 0.68 ? 2.4 : 1.4;
  return round(
    clamp(
      currentAbility + 1.1 + quality * 2.5 + tail + rng.next() * 0.9,
      currentAbility + 0.4,
      15.8,
    ),
  );
};

const statusFor = (ability: number, potential: number, age: number): YouthPlayerStatus => {
  if (ability >= 7.4 || (age >= 18 && ability >= 6.8)) return "FIRST_TEAM_PROSPECT";
  if (potential >= 11.5 || ability >= 6.2) return "YOUTH_PLAYER";
  return "ACADEMY_CANDIDATE";
};

const attributesFor = (
  position: PlayerPosition,
  ability: number,
  personId: EntityId,
  key: string,
  rng: SeededRandom,
): PlayerAttributeSet => {
  const base = Math.round(ability);
  const mod = (value: number) => clamp(Math.round(value + (rng.next() - 0.5) * 4), 1, 20);
  const gk = position === "GK";
  return {
    id: createStableEntityId("player-attribute", key),
    personId,
    primaryPosition: position,
    secondaryPositions: secondaryPositions(position, rng),
    technical: {
      firstTouch: mod(base + (gk ? -3 : 0)),
      passing: mod(base),
      crossing: mod(base + (["RB", "LB", "RW", "LW"].includes(position) ? 1 : -1)),
      dribbling: mod(base + (["AM", "RW", "LW"].includes(position) ? 1 : -1)),
      finishing: mod(base + (position === "ST" ? 2 : -2)),
      heading: mod(base + (["CB", "ST"].includes(position) ? 2 : -1)),
      tackling: mod(base + (["CB", "RB", "LB", "DM"].includes(position) ? 2 : -2)),
      technique: mod(base),
      longShots: mod(base + (["CM", "AM"].includes(position) ? 1 : -1)),
      setPieces: mod(base - 1),
    },
    mental: {
      decisions: mod(base),
      vision: mod(base + (["CM", "AM"].includes(position) ? 1 : -1)),
      composure: mod(base),
      positioning: mod(base),
      anticipation: mod(base),
      workRate: mod(base + 1),
      teamwork: mod(base),
      leadership: mod(base - 1),
      aggression: mod(base),
      determination: mod(base + 1),
      professionalism: mod(base),
    },
    physical: {
      pace: mod(base + (["RB", "LB", "RW", "LW"].includes(position) ? 2 : 0)),
      acceleration: mod(base + (["RW", "LW", "ST"].includes(position) ? 1 : 0)),
      strength: mod(base + (["CB", "ST"].includes(position) ? 1 : -1)),
      stamina: mod(base),
      agility: mod(base + (["RW", "LW", "AM"].includes(position) ? 1 : 0)),
      balance: mod(base),
      jumping: mod(base + (["CB", "ST", "GK"].includes(position) ? 1 : -1)),
      naturalFitness: mod(base),
    },
    goalkeeping: {
      handling: mod(gk ? base + 2 : 2),
      reflexes: mod(gk ? base + 2 : 2),
      oneOnOnes: mod(gk ? base + 1 : 2),
      aerialReach: mod(gk ? base + 1 : 2),
      kicking: mod(gk ? base : 2),
      distribution: mod(gk ? base : 2),
      commandOfArea: mod(gk ? base : 2),
    },
  };
};

const secondaryPositions = (position: PlayerPosition, rng: SeededRandom): PlayerPosition[] => {
  const map: Record<PlayerPosition, PlayerPosition[]> = {
    GK: [],
    CB: ["DM"],
    RB: ["LB", "RW"],
    LB: ["RB", "LW"],
    DM: ["CM", "CB"],
    CM: ["DM", "AM"],
    AM: ["CM", "RW", "LW"],
    RW: ["LW", "AM"],
    LW: ["RW", "AM"],
    ST: ["AM", "RW", "LW"],
  };
  const pool = map[position];
  return pool.length > 0 && rng.next() < 0.35 ? [rng.pick(pool)] : [];
};

/*
 * Youth intake feeds the domestic pyramid, so it is sized against the playable
 * world. Without this the canonical global dataset made all 573 clubs intake
 * targets rather than the 63 Nepal clubs, generating domestic youth into
 * CONTEXT_ONLY backdrop clubs the player never manages.
 */
const youthClubs = (db: GameDatabase): YouthClub[] =>
  db
    .prepare(
      `SELECT c.*, MIN(t.id) AS team_id
      FROM clubs c
      LEFT JOIN teams t ON t.club_id = c.id AND t.level = 'senior'
      WHERE ${PLAYABLE_CLUB_PREDICATE}
      GROUP BY c.id
      ORDER BY c.name`,
    )
    .all()
    .map((row: any) => ({
      id: row.id,
      name: row.name,
      countryId: row.country_id,
      locationId: row.location_id ?? undefined,
      canonicalExternalId: row.canonical_external_id ?? undefined,
      ownershipType: row.ownership_type,
      teamId: row.team_id ?? undefined,
    }));

const youthClubById = (
  db: GameDatabase,
  clubId: EntityId,
  teamId?: EntityId,
): YouthClub | undefined => {
  const row = db
    .prepare(
      `SELECT c.*, MIN(t.id) AS team_id
      FROM clubs c
      LEFT JOIN teams t ON t.club_id = c.id AND t.level = 'senior'
      WHERE c.id = ?
      GROUP BY c.id`,
    )
    .get(clubId) as any;
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    countryId: row.country_id,
    locationId: row.location_id ?? undefined,
    canonicalExternalId: row.canonical_external_id ?? undefined,
    ownershipType: row.ownership_type,
    teamId: teamId ?? row.team_id ?? undefined,
  };
};

const academies = (db: GameDatabase): YouthAcademy[] =>
  db
    .prepare("SELECT * FROM academies ORDER BY name")
    .all()
    .map((row: any) => ({
      id: row.id,
      name: row.name,
      countryId: row.country_id,
      locationId: row.location_id ?? undefined,
      parentClubId: row.parent_club_id ?? undefined,
      linkedClubId: row.linked_club_id ?? undefined,
      federationId: row.federation_id ?? undefined,
      academyType: row.academy_type,
    }));

const academyForClub = (academyRows: YouthAcademy[], clubId: EntityId): YouthAcademy | undefined =>
  academyRows.find((academy) => academy.linkedClubId === clubId || academy.parentClubId === clubId);

const nepalCountry = (db: GameDatabase): { id: EntityId; name: string } | undefined => {
  const row = db
    .prepare(
      "SELECT id, name FROM countries WHERE iso_code IN ('NP', 'NPL') OR name = 'Nepal' LIMIT 1",
    )
    .get() as any;
  return row ? { id: row.id, name: row.name } : undefined;
};

const squadNeedBoost = (db: GameDatabase, clubId: EntityId): number => {
  const count = activeSeniorPlayers(db, clubId);
  return count < 18 ? 1.1 : count < 22 ? 0.6 : count > 34 ? -1.1 : 0;
};

const activeSeniorPlayers = (db: GameDatabase, clubId: EntityId): number => {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT tpa.person_id) AS count
      FROM teams t
      JOIN team_person_assignments tpa ON tpa.team_id = t.id AND tpa.ended_on IS NULL
      WHERE t.club_id = ? AND t.level = 'senior'`,
    )
    .get(clubId) as any;
  return Number(row?.count ?? 0);
};

const allPlayersForRetirement = (
  db: GameDatabase,
  date: string,
): Array<{
  playerId: EntityId;
  age: number;
  position: PlayerPosition;
  ability: number;
  clubId?: EntityId;
  leadership: number;
  professionalism: number;
}> =>
  db
    .prepare(
      /*
       * One row per player. A person can hold more than one open PLAYER role and
       * more than one factual profile, and the join then multiplied them out: the
       * same player was retired several times in a pass, writing the identical
       * retirement history event twice and colliding on its deterministic ID.
       */
      `SELECT p.id AS player_id, p.date_of_birth, pa.primary_position,
        pa.technical_json, pa.mental_json, pa.physical_json, pa.goalkeeping_json,
        MIN(pfp.current_club_id) AS current_club_id
      FROM person_roles pr
      JOIN persons p ON p.id = pr.person_id
      JOIN player_attributes pa ON pa.person_id = p.id
      LEFT JOIN player_factual_profiles pfp ON pfp.player_id = p.id
      WHERE pr.role = 'PLAYER' AND pr.active_to IS NULL
      GROUP BY p.id
      ORDER BY p.id`,
    )
    .all()
    .map((row: any) => {
      const attributes = mapAttributeRow(row);
      return {
        playerId: row.player_id,
        age: row.date_of_birth ? ageOn(row.date_of_birth, date) : 24,
        position: row.primary_position,
        ability: averageAttributeSet(attributes),
        clubId: row.current_club_id ?? currentClubFromAssignment(db, row.player_id),
        leadership: attributes.mental.leadership,
        professionalism: attributes.mental.professionalism,
      };
    });

const mapAttributeRow = (row: any): PlayerAttributeSet => ({
  id: "temp" as EntityId,
  personId: row.player_id,
  primaryPosition: row.primary_position,
  secondaryPositions: [],
  technical: JSON.parse(row.technical_json),
  mental: JSON.parse(row.mental_json),
  physical: JSON.parse(row.physical_json),
  goalkeeping: JSON.parse(row.goalkeeping_json),
});

const currentClubFromAssignment = (db: GameDatabase, playerId: EntityId): EntityId | undefined => {
  const row = db
    .prepare(
      `SELECT t.club_id FROM team_person_assignments tpa
      JOIN teams t ON t.id = tpa.team_id
      WHERE tpa.person_id = ? AND tpa.ended_on IS NULL
      ORDER BY tpa.started_on DESC LIMIT 1`,
    )
    .get(playerId) as any;
  return row?.club_id ?? undefined;
};

const existingNames = (db: GameDatabase): Set<string> =>
  new Set(
    db
      .prepare("SELECT full_name FROM persons")
      .all()
      .map((row: any) => String(row.full_name).toLowerCase()),
  );

const originLocation = (
  db: GameDatabase,
  club: YouthClub | undefined,
  academy: YouthAcademy | undefined,
  rng: SeededRandom,
): EntityId | undefined => {
  if (academy?.locationId && rng.next() < 0.72) return academy.locationId;
  if (club?.locationId && rng.next() < 0.7) return club.locationId;
  const rows = db
    .prepare(
      "SELECT id FROM locations WHERE kind IN ('district', 'city', 'municipality') ORDER BY name",
    )
    .all() as Array<{ id: EntityId }>;
  return rows.length > 0 ? rng.pick(rows).id : (club?.locationId ?? academy?.locationId);
};

const districtName = (db: GameDatabase, locationId: EntityId | undefined): string => {
  if (!locationId) return "Unknown district";
  const row = db.prepare("SELECT name FROM locations WHERE id = ?").get(locationId) as any;
  return row?.name ?? "Unknown district";
};

const populationSnapshot = (
  db: GameDatabase,
  date: string,
): Omit<YouthDiagnosticReport["populationBySeason"][number], "seasonLabel"> => {
  const youth = new YouthRepository(db);
  const population = youth.playerPopulation();
  const ages = db
    .prepare(
      `SELECT p.date_of_birth FROM person_roles pr
      JOIN persons p ON p.id = pr.person_id
      WHERE pr.role = 'PLAYER' AND pr.active_to IS NULL AND p.date_of_birth IS NOT NULL`,
    )
    .all()
    .map((row: any) => ageOn(row.date_of_birth, date));
  const freeAgents = Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM player_transfer_statuses WHERE status = 'FREE_AGENT'",
        )
        .get() as any
    )?.count ?? 0,
  );
  return {
    ...population,
    averageAge: round(average(ages)),
    freeAgents,
    clubSquadSizes: clubSquadSizes(db),
  };
};

const clubSquadSizes = (
  db: GameDatabase,
): Array<{ clubId: EntityId; clubName: string; players: number }> =>
  db
    .prepare(
      `SELECT c.id AS club_id, c.name AS club_name, COUNT(DISTINCT tpa.person_id) AS players
      FROM clubs c
      LEFT JOIN teams t ON t.club_id = c.id AND t.level = 'senior'
      LEFT JOIN team_person_assignments tpa ON tpa.team_id = t.id AND tpa.ended_on IS NULL
      GROUP BY c.id, c.name
      ORDER BY c.name`,
    )
    .all()
    .map((row: any) => ({
      clubId: row.club_id,
      clubName: row.club_name,
      players: Number(row.players),
    }));

const summarizeExistingSeason = (
  db: GameDatabase,
  seasonLabel: string,
  date: string,
): YouthAnnualReport => {
  const report = blankAnnualReport(nepalIntakeDateFor(date), seasonLabel);
  // Squad repair during save creation is not the club's annual intake.
  const events = new YouthRepository(db).annualIntakeEvents(seasonLabel);
  report.intakeEvents = events.length;
  report.generatedPlayers = events.reduce((total, event) => total + event.playersGenerated, 0);
  report.averageCurrentAbility = average(events.map((event) => event.averageCurrentAbility));
  report.averagePotential = average(events.map((event) => event.averagePotential));
  report.highestPotential = Math.max(0, ...events.map((event) => event.highestPotential));
  return normalizeAnnualReport(report);
};

const accumulate = (target: YouthAnnualReport, source: YouthAnnualReport): void => {
  target.intakeEvents += 1;
  target.generatedPlayers += source.generatedPlayers;
  target.academyLinkedPlayers += source.academyLinkedPlayers;
  target.districtPlayers += source.districtPlayers;
  target.grassrootsPlayers += source.grassrootsPlayers;
  target.diasporaPlayers += source.diasporaPlayers;
  target.youthContracts += source.youthContracts;
  target.averageCurrentAbility += source.averageCurrentAbility * source.generatedPlayers;
  target.averagePotential += source.averagePotential * source.generatedPlayers;
  target.highestPotential = Math.max(target.highestPotential, source.highestPotential);
  for (const [position, count] of Object.entries(source.positionsGenerated)) {
    target.positionsGenerated[position] = (target.positionsGenerated[position] ?? 0) + count;
  }
  for (const [academy, count] of Object.entries(source.academySources)) {
    target.academySources[academy] = (target.academySources[academy] ?? 0) + count;
  }
  for (const [district, count] of Object.entries(source.districtSources)) {
    target.districtSources[district] = (target.districtSources[district] ?? 0) + count;
  }
};

const normalizeAnnualReport = (report: YouthAnnualReport): YouthAnnualReport => ({
  ...report,
  averageCurrentAbility:
    report.generatedPlayers > 0
      ? round(report.averageCurrentAbility / report.generatedPlayers)
      : round(report.averageCurrentAbility),
  averagePotential:
    report.generatedPlayers > 0
      ? round(report.averagePotential / report.generatedPlayers)
      : round(report.averagePotential),
  highestPotential: round(report.highestPotential),
});

const blankAnnualReport = (intakeDate: string, seasonLabel: string): YouthAnnualReport => ({
  intakeDate,
  seasonLabel,
  intakeEvents: 0,
  generatedPlayers: 0,
  academyLinkedPlayers: 0,
  districtPlayers: 0,
  grassrootsPlayers: 0,
  diasporaPlayers: 0,
  youthContracts: 0,
  promotedPlayers: 0,
  releasedYouth: 0,
  retirementsAnnounced: 0,
  retiredPlayers: 0,
  staffTransitions: 0,
  averageCurrentAbility: 0,
  averagePotential: 0,
  highestPotential: 0,
  positionsGenerated: {},
  academySources: {},
  districtSources: {},
});

const insertSimpleHistory = (
  db: GameDatabase,
  eventType: string,
  playerId: EntityId,
  date: string,
  data: Record<string, unknown>,
): void => {
  const event: HistoricalEvent = {
    id: createStableEntityId("history", `${eventType}:${playerId}:${date}`),
    occurredOn: date,
    eventType,
    involvedEntities: [{ id: playerId, type: "person" }],
    title: eventType.replaceAll("_", " ").toLowerCase(),
    data,
    importance: "low",
    scope: "person",
  };
  new EventRepository(db).insertHistoricalEvent(event);
};

const positionGroup = (position: PlayerPosition): string => {
  if (position === "GK") return "GOALKEEPER";
  if (["CB", "RB", "LB"].includes(position)) return "DEFENDER";
  if (["DM", "CM", "AM"].includes(position)) return "MIDFIELDER";
  return "FORWARD";
};

export const ageForPlayer = (db: GameDatabase, playerId: EntityId, date: string): number => {
  const row = db.prepare("SELECT date_of_birth FROM persons WHERE id = ?").get(playerId) as any;
  return row?.date_of_birth ? ageOn(row.date_of_birth, date) : 18;
};

const averageAttributes = (attributes: PlayerAttributeSet): number =>
  averageAttributeSet(attributes);

const averageAttributeSet = (attributes: PlayerAttributeSet): number => {
  const values = [
    ...Object.values(attributes.technical),
    ...Object.values(attributes.mental),
    ...Object.values(attributes.physical),
    ...(attributes.primaryPosition === "GK" ? Object.values(attributes.goalkeeping) : []),
  ];
  return round(average(values));
};

const birthDateForAge = (date: string, age: number, rng: SeededRandom): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() - age);
  parsed.setUTCMonth(rng.integer(0, 11), rng.integer(1, 28));
  return parsed.toISOString().slice(0, 10);
};

const nepalIntakeDateFor = (date: string): string => `${date.slice(0, 4)}-08-15`;

const addYears = (date: string, years: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + years);
  return parsed.toISOString().slice(0, 10);
};

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const ageOn = (dateOfBirth: string, worldDate: string): number => {
  const birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  const date = new Date(`${worldDate}T00:00:00.000Z`);
  let age = date.getUTCFullYear() - birth.getUTCFullYear();
  if (
    date.getUTCMonth() < birth.getUTCMonth() ||
    (date.getUTCMonth() === birth.getUTCMonth() && date.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
};

const average = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const round = (value: number): number => Math.round(value * 100) / 100;
