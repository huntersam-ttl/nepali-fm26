import {
  ClubCreationRepository,
  ClubEconomyRepository,
  CareerWorldRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type Club,
  type ClubMembership,
  type ClubOwnershipStake,
  type EntityId,
  type SimulationClubLifecycleEvent,
  type SimulationClubRecord,
  type JobVacancy,
  type Team,
  type Venue,
  type VenueRelationship,
} from "@nepal-football-sim/shared-types";
import { repairPreseasonContinuity } from "./preseason-continuity.js";
import { homeCurrency } from "./home-context.js";
import { SeededRandom } from "./rng.js";
import { initializeSupporterCultureForSave } from "./supporter-culture.js";

const status = "SIMULATION_ONLY" as const;
const yearOf = (date: string): number => Number(date.slice(0, 4));

const venueForLocation = (db: GameDatabase, locationId: EntityId, groundName?: string, foundedOn?: string): { id: EntityId } | undefined => {
  if (groundName && foundedOn) {
    const existing = db.prepare("SELECT id FROM venues WHERE location_id=? AND name=? LIMIT 1").get(locationId, groundName) as { id?: EntityId } | undefined;
    if (existing?.id) return { id: existing.id };
    const location = db.prepare("SELECT country_id FROM locations WHERE id=?").get(locationId) as { country_id?: EntityId } | undefined;
    if (location?.country_id) {
      const id = createStableEntityId("simulation-ground", `${locationId}:${groundName}`);
      const ground: Venue = { id, countryId: location.country_id, locationId, name: groundName, officialName: groundName, shortName: groundName, venueType: "FOOTBALL_GROUND", capacity: 300, surfaceType: "NATURAL_GRASS", pitchQuality: "POOR", status: "ACTIVE" };
      new WorldRepository(db).insertVenue(ground);
      return { id };
    }
  }
  const exact = db
    .prepare(
      "SELECT id FROM venues WHERE location_id = ? AND status != 'CLOSED' ORDER BY id LIMIT 1",
    )
    .get(locationId) as { id: EntityId } | undefined;
  if (exact) return exact;
  return db
    .prepare(
      "SELECT id FROM venues WHERE country_id = (SELECT country_id FROM locations WHERE id = ?) AND status != 'CLOSED' ORDER BY capacity DESC, id LIMIT 1",
    )
    .get(locationId) as { id: EntityId } | undefined;
};

const createVacancies = (
  db: GameDatabase,
  clubId: EntityId,
  teamId: EntityId,
  name: string,
  date: string,
): void => {
  const world = new WorldRepository(db);
  for (const role of ["HEAD_COACH", "ASSISTANT_COACH", "FITNESS_COACH", "PHYSIO"] as const)
    world.insertStaffVacancy({
      id: createStableEntityId("simulation-club-vacancy", `${clubId}:${role}`),
      organisationType: "CLUB",
      clubId,
      teamId,
      organisationName: name,
      role,
      required: role === "HEAD_COACH",
      status: "VACANT",
      openedOn: date,
      reason: "NEW_ROLE",
    });
  new CareerWorldRepository(db).insertVacancy({
    id: createStableEntityId("simulation-manager-vacancy", clubId),
    clubId,
    teamId,
    countryId: (db.prepare("SELECT country_id FROM clubs WHERE id=?").get(clubId) as { country_id?: EntityId } | undefined)?.country_id,
    openedOn: date,
    reason: "NEW_CLUB",
    boardExpectation: "SURVIVE",
    status: "OPEN",
  } satisfies JobVacancy);
};

export type CreateSimulationClubInput = {
  name: string;
  locationId: EntityId;
  foundedOn: string;
  seed: string;
  ownershipType?: Club["ownershipType"];
  competitionSeasonId?: EntityId;
  groundName?: string;
};

/** Give every playable Nepal league club a canonical or simulation-only venue relationship. */
export const ensurePlayableClubVenues = (db: GameDatabase, date: string): void => {
  const world = new WorldRepository(db);
  const clubs = db.prepare(`SELECT DISTINCT c.id, c.name, c.country_id, c.location_id, lower(co.name) AS competition_name FROM clubs c JOIN countries country ON country.id=c.country_id AND country.id = (SELECT country_id FROM home_football_country LIMIT 1) JOIN club_memberships cm ON cm.club_id=c.id AND cm.status='ACTIVE' JOIN competition_seasons cs ON cs.id=cm.competition_season_id JOIN competitions co ON co.id=cs.competition_id WHERE (SELECT tier FROM competition_tiers WHERE competition_id = co.id) = 1 OR (SELECT tier FROM competition_tiers WHERE competition_id = co.id) = 2 OR (SELECT tier FROM competition_tiers WHERE competition_id = co.id) = 3`).all() as Array<{ id: EntityId; name: string; country_id: EntityId; location_id?: EntityId; competition_name: string }>;
  for (const club of clubs) {
    if (db.prepare("SELECT 1 FROM venue_relationships WHERE club_id=? AND status!='CLOSED' LIMIT 1").get(club.id)) continue;
    const existing = club.location_id ? db.prepare("SELECT id FROM venues WHERE location_id=? AND status!='CLOSED' ORDER BY capacity DESC LIMIT 1").get(club.location_id) as { id?: EntityId } | undefined : undefined;
    const venueId = existing?.id ?? createStableEntityId("simulation-club-ground", club.id);
    if (!existing?.id) world.insertVenue({ id: venueId, countryId: club.country_id, locationId: club.location_id, name: `${club.name} Ground`, officialName: `${club.name} Ground`, shortName: `${club.name} Ground`, venueType: "FOOTBALL_GROUND", capacity: club.competition_name.includes("a-division") ? 5000 : club.competition_name.includes("b-division") ? 2500 : 600, surfaceType: "NATURAL_GRASS", pitchQuality: "POOR", status: "ACTIVE" });
    const team = db.prepare("SELECT id FROM teams WHERE club_id=? AND level='senior' ORDER BY id LIMIT 1").get(club.id) as { id?: EntityId } | undefined;
    world.insertVenueRelationship({ id: createStableEntityId("simulation-club-ground-relationship", club.id), venueId, clubId: club.id, teamId: team?.id, relationshipType: "PRIMARY_TENANT", startDate: date, status: "available" });
  }
};

export const createSimulationClub = (
  db: GameDatabase,
  input: CreateSimulationClubInput,
): SimulationClubRecord => {
  const location = db
    .prepare("SELECT id, country_id, name, kind FROM locations WHERE id = ?")
    .get(input.locationId) as
    { id: EntityId; country_id: EntityId; name: string; kind: string } | undefined;
  if (!location) throw new Error("Club location does not exist");
  const nepal = db.prepare("SELECT country_id AS id FROM home_football_country LIMIT 1").get() as
    { id: EntityId } | undefined;
  if (!nepal || location.country_id !== nepal.id)
    throw new Error("Simulation clubs must be founded in Nepal");
  if (!["district", "municipality", "city"].includes(location.kind))
    throw new Error("Club location must be a local district or municipality");
  const venue = venueForLocation(db, input.locationId, input.groundName, input.foundedOn);
  if (!venue) throw new Error("A usable shared venue is required");
  const clubId = createStableEntityId(
    "simulation-club",
    `${input.name}:${input.locationId}:${input.foundedOn}`,
  );
  if (db.prepare("SELECT 1 FROM clubs WHERE id = ?").get(clubId))
    throw new Error("Simulation club already exists");
  const club: Club = {
    id: clubId,
    name: input.name,
    officialName: `${input.name} Football Club`,
    shortName: input.name,
    countryId: nepal.id,
    locationId: input.locationId,
    ownershipType: input.ownershipType ?? "COMMUNITY",
    organisationType: "CLUB",
    foundedYear: yearOf(input.foundedOn),
  };
  const team: Team = {
    id: createStableEntityId("simulation-team", clubId),
    clubId,
    name: input.name,
    level: "senior",
    gender: "men",
  };
  const world = new WorldRepository(db);
  world.insertClub(club);
  world.insertTeam(team);
  const relationship: VenueRelationship = {
    id: createStableEntityId("simulation-venue-use", `${clubId}:${venue.id}`),
    venueId: venue.id,
    clubId,
    teamId: team.id,
    relationshipType: "SHARED_USER",
    startDate: input.foundedOn,
    status: "available",
  };
  world.insertVenueRelationship(relationship);
  const economy = new ClubEconomyRepository(db);
  economy.upsertFinancialAccount({
    clubId,
    currency: homeCurrency(db),
    cashBalance: 350000,
    restrictedCash: 0,
    receivables: 0,
    payables: 0,
    debtBalance: 0,
    equityBalance: 350000,
    seasonRevenue: 0,
    seasonExpenses: 0,
    seasonProfitLoss: 0,
    financialHealth: "DISTRESSED",
    lastUpdatedAt: input.foundedOn,
    status,
  });
  economy.upsertFacilityProfile({
    clubId,
    trainingFacilityQuality: 1.5,
    youthFacilityQuality: 1.2,
    medicalFacilityQuality: 1,
    analyticsFacilityQuality: 1,
    academyCapacity: 8,
    monthlyOperatingCost: 18000,
    currency: homeCurrency(db),
    status,
  });
  economy.upsertCommercialProfile({
    clubId,
    brandStrength: 1,
    digitalReach: 0.5,
    broadcastAppeal: 0.5,
    merchandiseAppeal: 0.5,
    ticketPriceElasticity: 1.1,
    updatedOn: input.foundedOn,
    status,
  });
  economy.upsertSupporterProfile({
    clubId,
    coreSupporters: 100,
    casualSupporters: 150,
    regionalSupport: 50,
    diasporaSupport: 0,
    activeSupport: 40,
    familySupport: 30,
    youthSupport: 50,
    clubPopularity: 1.5,
    footballReputation: 1.5,
    commercialReputation: 1,
    sentiment: "NEUTRAL",
    standardTicketPrice: 100,
    currency: homeCurrency(db),
    status,
  });
  initializeSupporterCultureForSave({ db, worldDate: input.foundedOn, seed: input.seed });
  const admitted = input.competitionSeasonId
    ? admitSimulationClub(db, {
        clubId,
        teamId: team.id,
        competitionSeasonId: input.competitionSeasonId,
        date: input.foundedOn,
      })
    : false;
  const record: SimulationClubRecord = {
    id: createStableEntityId("simulation-club-record", clubId),
    clubId,
    locationId: input.locationId,
    foundedOn: input.foundedOn,
    ownershipType: club.ownershipType,
    initialReputation: 1.5,
    supporterBase: 250,
    status: "ACTIVE",
    admissionStatus: input.competitionSeasonId ? (admitted ? "ADMITTED" : "REJECTED") : "PENDING",
    venueId: venue.id,
    provenanceStatus: status,
  };
  const history = new ClubCreationRepository(db);
  history.upsert(record);
  history.recordEvent({
    id: createStableEntityId("simulation-club-event", `${clubId}:founded`),
    clubId,
    eventType: "FOUNDED",
    occurredOn: input.foundedOn,
    reason: "Local simulation club founded from Nepal geography.",
    provenanceStatus: status,
  });
  if (input.competitionSeasonId)
    history.recordEvent({
      id: createStableEntityId(
        "simulation-club-event",
        `${clubId}:admission:${input.competitionSeasonId}`,
      ),
      clubId,
      eventType: admitted ? "ADMITTED" : "REJECTED",
      occurredOn: input.foundedOn,
      reason: admitted
        ? "Passed venue and financial admission checks."
        : "Did not pass local competition admission checks.",
      provenanceStatus: status,
    });
  createVacancies(db, clubId, team.id, input.name, input.foundedOn);
  if (admitted && input.competitionSeasonId)
    repairPreseasonContinuity({
      db,
      competitionSeasonIds: [input.competitionSeasonId],
      date: input.foundedOn,
      seed: input.seed,
    });
  return record;
};

export const foundSimulationClub = (
  db: GameDatabase,
  input: CreateSimulationClubInput & {
    founderPersonId: EntityId;
    founderName: string;
    callerRole: "MANAGER" | "CHAIRMAN_OWNER" | "FEDERATION_PRESIDENT";
  },
): SimulationClubRecord => {
  if (input.callerRole !== "CHAIRMAN_OWNER")
    throw new Error("Only the active chairman/owner may found a club");
  if (!db.prepare("SELECT 1 FROM persons WHERE id = ?").get(input.founderPersonId))
    throw new Error("Founding owner does not exist");
  const duplicate = db
    .prepare(
      `SELECT c.id FROM clubs c
       JOIN countries co ON co.id = c.country_id
       WHERE co.id = (SELECT country_id FROM home_football_country LIMIT 1) AND lower(trim(c.name)) = lower(trim(?))
       LIMIT 1`,
    )
    .get(input.name);
  if (duplicate) throw new Error("A Nepal club with this name already exists");
  const club = createSimulationClub(db, { ...input, ownershipType: "PRIVATE" });
  const ownership: ClubOwnershipStake = {
    id: createStableEntityId("club-ownership-stake", `${club.clubId}:${input.founderPersonId}:founder`),
    clubId: club.clubId,
    holderType: "PERSON",
    holderId: input.founderPersonId,
    holderName: input.founderName,
    role: "MAJORITY_OWNER",
    percentage: 100,
    votingPercentage: 100,
    startDate: input.foundedOn,
    status: "ACTIVE",
    ownershipModel: "BUYABLE",
    provenanceStatus: status,
  };
  new ClubEconomyRepository(db).upsertOwnershipStake(ownership);
  return club;
};

export const admitSimulationClub = (
  db: GameDatabase,
  input: { clubId: EntityId; teamId: EntityId; competitionSeasonId: EntityId; date: string },
): boolean => {
  const season = db
    .prepare(
      "SELECT cs.id, c.id AS competition_id FROM competition_seasons cs JOIN competitions c ON c.id = cs.competition_id WHERE cs.id = ?",
    )
    .get(input.competitionSeasonId) as { id: EntityId; competition_id: EntityId } | undefined;
  const venue = db
    .prepare("SELECT 1 FROM venue_relationships WHERE club_id = ? AND status != 'CLOSED'")
    .get(input.clubId);
  const account = db
    .prepare("SELECT cash_balance FROM club_financial_accounts WHERE club_id = ?")
    .get(input.clubId) as { cash_balance?: number } | undefined;
  if (!season || !venue || (account?.cash_balance ?? 0) < 100000) return false;
  const membership: ClubMembership = {
    id: createStableEntityId(
      "simulation-club-membership",
      `${input.clubId}:${input.competitionSeasonId}`,
    ),
    clubId: input.clubId,
    teamId: input.teamId,
    competitionId: season.competition_id,
    competitionSeasonId: input.competitionSeasonId,
    membershipType: "LEAGUE_MEMBER",
    status: "ACTIVE",
  };
  new WorldRepository(db).insertClubMembership(membership);
  new ClubCreationRepository(db).recordEvent({
    id: createStableEntityId(
      "simulation-club-event",
      `${input.clubId}:admitted:${input.competitionSeasonId}`,
    ),
    clubId: input.clubId,
    eventType: "ADMITTED",
    occurredOn: input.date,
    reason: "Passed existing competition, venue, and financial checks.",
    provenanceStatus: status,
  });
  return true;
};

const updateSupporters = (
  db: GameDatabase,
  record: SimulationClubRecord,
  date: string,
  thriving: boolean,
): void => {
  const economy = new ClubEconomyRepository(db);
  const profile = economy.supporterProfile(record.clubId);
  if (!profile) return;
  const delta = thriving
    ? Math.max(2, Math.round((profile.clubPopularity + profile.footballReputation) * 0.7))
    : -Math.max(1, Math.round(profile.clubPopularity * 0.35));
  const total = Math.max(40, profile.coreSupporters + profile.casualSupporters + delta);
  const next = {
    ...profile,
    coreSupporters: Math.max(20, profile.coreSupporters + (thriving ? 1 : -1)),
    casualSupporters: Math.max(
      20,
      total - Math.max(20, profile.coreSupporters + (thriving ? 1 : -1)),
    ),
    clubPopularity: Math.max(0.5, Math.min(10, profile.clubPopularity + (thriving ? 0.08 : -0.05))),
    footballReputation: Math.max(
      0.5,
      Math.min(10, profile.footballReputation + (thriving ? 0.06 : -0.04)),
    ),
  };
  economy.upsertSupporterProfile(next);
  const repo = new ClubCreationRepository(db);
  repo.upsert({
    ...record,
    supporterBase: next.coreSupporters + next.casualSupporters,
    status: record.status,
  });
};

export const evaluateSimulationClubSurvival = (
  db: GameDatabase,
  input: { date: string },
): SimulationClubRecord[] => {
  const repo = new ClubCreationRepository(db);
  const results: SimulationClubRecord[] = [];
  for (const record of repo.all().filter((item) => item.status === "ACTIVE")) {
    const account = db
      .prepare("SELECT cash_balance FROM club_financial_accounts WHERE club_id = ?")
      .get(record.clubId) as { cash_balance?: number } | undefined;
    const activeMemberships =
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM club_memberships WHERE club_id = ? AND status IN ('ACTIVE','PROMOTED','QUALIFIED')",
          )
          .get(record.clubId) as { count?: number }
      )?.count ?? 0;
    const facilities = db
      .prepare(
        "SELECT AVG((training_facility_quality + youth_facility_quality + medical_facility_quality) / 3.0) AS quality FROM club_facility_profiles WHERE club_id = ?",
      )
      .get(record.clubId) as { quality?: number } | undefined;
    const viable =
      (account?.cash_balance ?? 0) >= 0 &&
      (activeMemberships > 0 || input.date <= `${record.foundedOn.slice(0, 4)}-12-31`) &&
      (facilities?.quality ?? 0) >= 1;
    updateSupporters(db, record, input.date, viable);
    const next = viable
      ? record
      : { ...record, status: "DORMANT" as const, admissionStatus: "PENDING" as const };
    repo.upsert(next);
    if (!viable)
      repo.recordEvent({
        id: createStableEntityId("simulation-club-event", `${record.clubId}:dormant:${input.date}`),
        clubId: record.clubId,
        eventType: "DORMANT",
        occurredOn: input.date,
        reason:
          "Financial, facility, or competition participation failure; historic club retained.",
        provenanceStatus: status,
      });
    results.push(next);
  }
  return results;
};

export const considerSimulationClubAdmissions = (
  db: GameDatabase,
  input: { competitionSeasonId: EntityId; date: string; seed: string; maxAdmissions?: number },
): SimulationClubRecord[] => {
  const repo = new ClubCreationRepository(db);
  const candidates = repo
    .all()
    .filter(
      (item) => item.status === "ACTIVE" && ["PENDING", "REJECTED"].includes(item.admissionStatus),
    );
  const current =
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM club_memberships WHERE competition_season_id = ? AND status = 'ACTIVE'",
        )
        .get(input.competitionSeasonId) as { count?: number }
    )?.count ?? 0;
  if (candidates.length < 2 || current < 1) return [];
  const rng = new SeededRandom(
    `${input.seed}:admissions:${input.competitionSeasonId}:${input.date}`,
  );
  const admitted: SimulationClubRecord[] = [];
  for (const candidate of candidates.sort((a, b) => a.clubId.localeCompare(b.clubId))) {
    if (admitted.length >= (input.maxAdmissions ?? 1) || rng.next() < 0.35) continue;
    const team = db
      .prepare("SELECT id FROM teams WHERE club_id = ? AND level = 'senior' ORDER BY id LIMIT 1")
      .get(candidate.clubId) as { id: EntityId } | undefined;
    if (
      !team ||
      !admitSimulationClub(db, {
        clubId: candidate.clubId,
        teamId: team.id,
        competitionSeasonId: input.competitionSeasonId,
        date: input.date,
      })
    )
      continue;
    const next = { ...candidate, admissionStatus: "ADMITTED" as const };
    repo.upsert(next);
    repo.recordEvent({
      id: createStableEntityId(
        "simulation-club-event",
        `${candidate.clubId}:admission-request:${input.date}`,
      ),
      clubId: candidate.clubId,
      eventType: "ADMISSION_REQUESTED",
      occurredOn: input.date,
      reason: "Federation considered a viable local entrant.",
      provenanceStatus: status,
    });
    admitted.push(next);
  }
  return admitted;
};

export const reviveSimulationClub = (
  db: GameDatabase,
  input: { clubId: EntityId; competitionSeasonId: EntityId; date: string; seed: string },
): SimulationClubRecord => {
  const repo = new ClubCreationRepository(db);
  const record = repo.get(input.clubId);
  if (!record || record.status !== "DORMANT") throw new Error("Dormant simulation club not found");
  const team = db
    .prepare("SELECT id FROM teams WHERE club_id = ? AND level = 'senior' ORDER BY id LIMIT 1")
    .get(input.clubId) as { id: EntityId } | undefined;
  if (
    !team ||
    !admitSimulationClub(db, {
      clubId: input.clubId,
      teamId: team.id,
      competitionSeasonId: input.competitionSeasonId,
      date: input.date,
    })
  )
    throw new Error("Club does not meet revival requirements");
  const next = { ...record, status: "ACTIVE" as const, admissionStatus: "ADMITTED" as const };
  repo.upsert(next);
  repo.recordEvent({
    id: createStableEntityId("simulation-club-event", `${input.clubId}:revived:${input.date}`),
    clubId: input.clubId,
    eventType: "REVIVED",
    occurredOn: input.date,
    reason: "Returned after meeting finance, venue, and competition entry requirements.",
    provenanceStatus: status,
  });
  repairPreseasonContinuity({
    db,
    competitionSeasonIds: [input.competitionSeasonId],
    date: input.date,
    seed: input.seed,
  });
  return next;
};
