import {
  createStableEntityId,
  type DistrictDevelopmentProject,
  type DistrictFootballUnit,
  type EntityId,
  type FixtureRecord,
  type MatchResult,
  type PlayerAttributeSet,
  type ProvinceFootballUnit,
  type TerritorialCompetitionConfig,
  type TerritorialCompetitionSeason,
  type TerritorialEligibilityRule,
  type TerritorialRepresentativeTeam,
} from "@nepal-football-sim/shared-types";
import {
  CompetitionRepository,
  FederationComplianceRepository,
  FederationGovernanceRepository,
  PlayerRepository,
  TerritorialFootballRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { generateKnockoutFixtures, generateLeagueFixtures } from "./fixture-generation.js";
import { requireFixtureOfficials } from "./referee-assignment.js";
import { simulateMatch } from "./match-engine.js";
import {
  persistPyramidProgression,
  progressPyramidSeason,
  type CompletedCompetitionSeason,
  type PyramidProgressionResult,
} from "./pyramid-progression.js";
import { postFederationTransaction } from "./federation-governance.js";
import type {
  CompetitionRelationship,
  CompetitionRuleSet,
  CompetitionSeason,
  MacroEconomicState,
} from "@nepal-football-sim/shared-types";

const provinces: Array<[string, string[]]> = [
  [
    "Koshi",
    [
      "Taplejung",
      "Panchthar",
      "Ilam",
      "Jhapa",
      "Morang",
      "Sunsari",
      "Dhankuta",
      "Terhathum",
      "Sankhuwasabha",
      "Bhojpur",
      "Solukhumbu",
      "Okhaldhunga",
      "Khotang",
      "Udayapur",
    ],
  ],
  [
    "Madhesh",
    ["Saptari", "Siraha", "Dhanusha", "Mahottari", "Sarlahi", "Rautahat", "Bara", "Parsa"],
  ],
  [
    "Bagmati",
    [
      "Dolakha",
      "Ramechhap",
      "Sindhuli",
      "Kavrepalanchok",
      "Sindhupalchok",
      "Rasuwa",
      "Nuwakot",
      "Dhading",
      "Kathmandu",
      "Bhaktapur",
      "Lalitpur",
      "Makwanpur",
      "Chitwan",
    ],
  ],
  [
    "Gandaki",
    [
      "Gorkha",
      "Manang",
      "Mustang",
      "Myagdi",
      "Kaski",
      "Lamjung",
      "Tanahun",
      "Syangja",
      "Parbat",
      "Baglung",
      "Nawalpur",
    ],
  ],
  [
    "Lumbini",
    [
      "Rupandehi",
      "Kapilvastu",
      "Palpa",
      "Arghakhanchi",
      "Gulmi",
      "Dang",
      "Pyuthan",
      "Rolpa",
      "Rukum East",
      "Banke",
      "Bardiya",
      "Nawalparasi West",
    ],
  ],
  [
    "Karnali",
    [
      "Dolpa",
      "Humla",
      "Jumla",
      "Kalikot",
      "Mugu",
      "Surkhet",
      "Dailekh",
      "Jajarkot",
      "Salyan",
      "Rukum West",
    ],
  ],
  [
    "Sudurpashchim",
    [
      "Bajura",
      "Bajhang",
      "Doti",
      "Achham",
      "Kailali",
      "Kanchanpur",
      "Dadeldhura",
      "Baitadi",
      "Darchula",
    ],
  ],
];
const clean = (value: string) => value.toLowerCase().replace(/ district| province|\s+/g, "");
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const monthNumber = (date: string) => Number(date.slice(5, 7));
const monthsBetween = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + monthNumber(to) - monthNumber(from);

export const lowerLeagueFinanceMultiplier = (
  division: "A" | "B" | "C",
  macro?: MacroEconomicState,
): number => {
  const base = division === "A" ? 1 : division === "B" ? 0.42 : 0.2;
  return Number(
    (base * Math.max(0.75, Math.min(2.2, macro?.footballCommercialStrength ?? 1))).toFixed(3),
  );
};

export const initializeNepalTerritorialStructure = (
  db: GameDatabase,
  date: string,
): { districts: DistrictFootballUnit[]; provinces: ProvinceFootballUnit[] } => {
  const repo = new TerritorialFootballRepository(db);
  const locations = db
    .prepare("SELECT id,name FROM locations WHERE kind='district'")
    .all() as Array<{ id: EntityId; name: string }>;
  const byName = new Map(locations.map((location) => [clean(location.name), location]));
  const result: DistrictFootballUnit[] = [];
  for (const [provinceName, names] of provinces) {
    const provinceId = createStableEntityId("nepal-province", provinceName);
    const districts = names.map((name) => {
      const location = byName.get(clean(name));
      const remoteness = [
        "Manang",
        "Mustang",
        "Dolpa",
        "Humla",
        "Mugu",
        "Jumla",
        "Kalikot",
        "Bajura",
        "Bajhang",
        "Darchula",
        "Solukhumbu",
      ].includes(name)
        ? 80
        : 35;
      const seededDistrict: DistrictFootballUnit = {
        id: createStableEntityId("nepal-district", name),
        name,
        provinceId,
        locationId: location?.id,
        remoteness,
        developmentStatus: "DEVELOPING",
        affiliationStatus: location ? "UNKNOWN" : "DEVELOPING",
        developmentReputation: 20,
        registeredClubCount: 0,
        schoolParticipation: 10,
        girlsParticipation: 8,
        youthParticipation: 12,
        coachSupply: 10,
        refereeSupply: 10,
        groundAvailability: 25,
        scoutingVisibility: 10,
        governanceCompliance: 60,
        history: [
          {
            date,
            event: "TERRITORIAL_UNIT_INITIALISED",
            indicators: { schoolParticipation: 10, youthParticipation: 12 },
          },
        ],
        provenanceStatus: "SIMULATION_ONLY",
      };
      const district = repo.district(seededDistrict.id) ?? seededDistrict;
      repo.upsertDistrict(district);
      result.push(district);
      return district;
    });
    const provincial: ProvinceFootballUnit = {
      id: provinceId,
      name: provinceName,
      districtIds: districts.map((district) => district.id),
      footballStrength: 10,
      infrastructure: 20,
      playerProduction: 10,
      competitionPerformance: 10,
      fundingReceived: 0,
      fundingSpent: 0,
      history: [{ date, event: "PROVINCIAL_UNIT_INITIALISED" }],
      provenanceStatus: "SIMULATION_ONLY",
    };
    repo.upsertProvince(repo.province(provinceId) ?? provincial);
  }
  return { districts: repo.districts(), provinces: repo.provinces() };
};

const territorialCompetitionConfig = (input: {
  id: EntityId;
  name: string;
  level: TerritorialCompetitionConfig["level"];
  participantType: TerritorialCompetitionConfig["participantType"];
  format: TerritorialCompetitionConfig["format"];
  start: string;
  end: string;
  qualifierCount?: number;
}): TerritorialCompetitionConfig => ({
  id: input.id,
  name: input.name,
  level: input.level,
  participantType: input.participantType,
  format: input.format,
  qualifierCount: input.qualifierCount,
  seasonStartDate: input.start,
  seasonEndDate: input.end,
  roundSpacingDays: 3,
  winnerRequired: input.format === "KNOCKOUT",
  eligibility: { residence: true, developmentRegistration: true },
  provenanceStatus: "SIMULATION_ONLY",
});

const productionTerritorialProject = (db: GameDatabase, date: string, seed: string): void => {
  const territorial = new TerritorialFootballRepository(db);
  const existing = territorial.projects().filter((project) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(project.status));
  for (const project of existing) {
    if (project.status === "ACTIVE" && monthsBetween(project.createdOn, date) >= project.durationMonths) {
      const completed = advanceDistrictDevelopmentProject(db, project.id, {
        date,
        status: "COMPLETED",
        reportingStatus: "ACCEPTED",
        outcome: "DELIVERED_WITH_BOUNDED_DEVELOPMENT_EFFECT",
      });
      updateDistrictDevelopment(db, {
        districtId: completed.districtId,
        date,
        funding: completed.federationContribution,
        reportedWell: true,
      });
    }
  }
  if (existing.length > 0) return;
  const federation = db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id?: EntityId } | undefined;
  if (!federation?.id) return;
  const account = new FederationGovernanceRepository(db).financialAccount(federation.id);
  if (!account || account.cashBalance < 2000000) return;
  const sanctions = new FederationComplianceRepository(db).activeSanctionsForFederation(federation.id);
  if (sanctions.some((sanction) => sanction.consequences.includes("FUNDING_FROZEN") || sanction.consequences.includes("NEW_GRANTS_BLOCKED"))) return;
  const district = territorial.districts().sort((a, b) => {
    const need = (item: DistrictFootballUnit) =>
      100 - item.developmentReputation + item.remoteness * 0.15 + (100 - item.groundAvailability) * 0.2 + (100 - item.governanceCompliance) * 0.1;
    return need(b) - need(a) || a.id.localeCompare(b.id);
  })[0];
  if (!district) return;
  const amount = 100000;
  const project = createDistrictDevelopmentProject(db, {
    districtId: district.id,
    provinceId: district.provinceId,
    projectType: "GRASSROOTS_FACILITY",
    requestedBudget: amount,
    districtContribution: 0,
    provinceContribution: 0,
    municipalityContribution: 0,
    federationContribution: amount,
    durationMonths: 6,
    milestones: ["SITE_REVIEW", "DELIVERY_REPORT"],
    conditions: ["FEDERATION_AUDIT"],
    createdOn: date,
  });
  postFederationTransaction(db, {
    federationId: federation.id,
    date,
    category: "INFRASTRUCTURE",
    direction: "DEBIT",
    amount,
    description: "Territorial district development project funded",
    relatedEntityId: project.id,
    idempotencyKey: `territorial-project:${project.id}`,
  });
  advanceDistrictDevelopmentProject(db, project.id, { date, status: "ACTIVE" });
  void seed;
};

const productionTerritorialCompetitions = (db: GameDatabase, date: string, seed: string): void => {
  const year = date.slice(0, 4);
  const start = `${year}-01-01`;
  const end = date;
  const repo = new TerritorialFootballRepository(db);
  const configurations = [
    territorialCompetitionConfig({ id: createStableEntityId("territorial-competition", "district"), name: "National District Championship", level: "DISTRICT", participantType: "DISTRICT", format: "KNOCKOUT", start, end }),
    territorialCompetitionConfig({ id: createStableEntityId("territorial-competition", "provincial"), name: "Provincial Representative Championship", level: "PROVINCIAL", participantType: "PROVINCE", format: "LEAGUE", qualifierCount: 2, start, end }),
    territorialCompetitionConfig({ id: createStableEntityId("territorial-competition", "national"), name: "National Territorial Championship", level: "NATIONAL", participantType: "PROVINCE", format: "KNOCKOUT", start, end }),
  ];
  for (const config of configurations) {
    const seasonId = createStableEntityId("territorial-season", `${config.id}:${year}`);
    let season = repo.competitionSeason(seasonId) ?? initializeTerritorialCompetition(db, { config, seasonLabel: year, seed: `${seed}:${config.id}` });
    for (const fixture of new CompetitionRepository(db).fixtures(season.id)) {
      if (!db.prepare("SELECT id FROM matches WHERE fixture_id=?").get(fixture.id)) simulateTerritorialFixture(db, { fixtureId: fixture.id, seasonId: season.id, seed: `${seed}:${fixture.id}` });
    }
    season = advanceTerritorialCompetition(db, { seasonId: season.id, date, seed: `${seed}:${config.id}` }).season;
    if (season.status === "COMPLETED") {
      const champion = season.championTeamId;
      const championTeam = champion ? repo.team(champion) : undefined;
      if (championTeam) repo.upsertTeam({ ...championTeam, history: [...championTeam.history, { date, event: "TERRITORIAL_CHAMPION", playerIds: championTeam.playerIds }] });
    }
  }
};

export const advanceTerritorialDevelopment = (db: GameDatabase, input: { date: string; seed: string }): void => {
  const state = initializeNepalTerritorialStructure(db, input.date);
  if (state.districts.some((district) => district.history.some((event) => event.event === "DEVELOPMENT_REVIEW" && event.date === input.date))) return;
  for (const district of state.districts) updateDistrictDevelopment(db, { districtId: district.id, date: input.date, funding: 0, reportedWell: true });
  productionTerritorialProject(db, input.date, input.seed);
  const month = monthNumber(input.date);
  if (month === 7 || month === 8) productionTerritorialCompetitions(db, input.date, input.seed);
};

export const createDistrictDevelopmentProject = (
  db: GameDatabase,
  input: Omit<DistrictDevelopmentProject, "id" | "status" | "reportingStatus" | "provenanceStatus">,
): DistrictDevelopmentProject => {
  const project: DistrictDevelopmentProject = {
    ...input,
    id: createStableEntityId(
      "district-project",
      `${input.districtId}:${input.projectType}:${input.createdOn}`,
    ),
    status: "PROPOSED",
    reportingStatus: "NOT_DUE",
    provenanceStatus: "SIMULATION_ONLY",
  };
  new TerritorialFootballRepository(db).upsertProject(project);
  return project;
};

export const advanceDistrictDevelopmentProject = (
  db: GameDatabase,
  projectId: EntityId,
  input: {
    date: string;
    status: DistrictDevelopmentProject["status"];
    reportingStatus?: DistrictDevelopmentProject["reportingStatus"];
    outcome?: string;
  },
): DistrictDevelopmentProject => {
  const repo = new TerritorialFootballRepository(db);
  const current = repo.project(projectId);
  if (!current) throw new Error(`District project ${projectId} not found`);
  const next = {
    ...current,
    status: input.status,
    reportingStatus: input.reportingStatus ?? current.reportingStatus,
    outcome: input.outcome ?? current.outcome,
  };
  repo.upsertProject(next);
  return next;
};

export const updateDistrictDevelopment = (
  db: GameDatabase,
  input: { districtId: EntityId; date: string; funding: number; reportedWell?: boolean },
): DistrictFootballUnit => {
  const repo = new TerritorialFootballRepository(db);
  const current = repo.district(input.districtId);
  if (!current) throw new Error(`District ${input.districtId} not found`);
  const delivery = input.reportedWell === false ? -2 : Math.min(5, input.funding / 100000);
  const next: DistrictFootballUnit = {
    ...current,
    developmentReputation: clamp(current.developmentReputation + delivery),
    schoolParticipation: clamp(current.schoolParticipation + delivery * 0.8),
    girlsParticipation: clamp(current.girlsParticipation + delivery * 0.6),
    youthParticipation: clamp(current.youthParticipation + delivery),
    coachSupply: clamp(current.coachSupply + delivery * 0.5),
    refereeSupply: clamp(current.refereeSupply + delivery * 0.4),
    groundAvailability: clamp(current.groundAvailability + delivery * 0.5),
    scoutingVisibility: clamp(current.scoutingVisibility + delivery * 0.7),
    governanceCompliance: clamp(
      current.governanceCompliance + (input.reportedWell === false ? -5 : 1),
    ),
    developmentStatus: current.developmentReputation + delivery > 35 ? "ESTABLISHED" : "DEVELOPING",
    history: [
      ...current.history,
      {
        date: input.date,
        event: "DEVELOPMENT_REVIEW",
        indicators: { funding: input.funding, delayedEffect: Math.max(0, delivery) },
      },
    ],
  };
  repo.upsertDistrict(next);
  return next;
};

export const createTerritorialRepresentativeTeam = (
  db: GameDatabase,
  input: {
    territoryType: "DISTRICT" | "PROVINCE";
    territoryId: EntityId;
    name: string;
    date: string;
    competitionCycleId?: EntityId;
  },
): TerritorialRepresentativeTeam => {
  const repo = new TerritorialFootballRepository(db);
  const existing = repo
    .teams()
    .find(
      (team) =>
        team.territoryType === input.territoryType && team.territoryId === input.territoryId,
    );
  if (existing) return existing;
  const team: TerritorialRepresentativeTeam = {
    id: createStableEntityId("territorial-team", `${input.territoryType}:${input.territoryId}`),
    name: input.name,
    territoryType: input.territoryType,
    territoryId: input.territoryId,
    playerIds: [],
    competitionCycleId: input.competitionCycleId,
    status: "SIMULATION_ONLY",
    history: [{ date: input.date, event: "REPRESENTATIVE_TEAM_CREATED", playerIds: [] }],
  };
  repo.upsertTeam(team);
  return team;
};

export const selectTerritorialRepresentativePlayers = (
  db: GameDatabase,
  input: {
    teamId: EntityId;
    date: string;
    candidates: Array<{
      playerId: EntityId;
      eligible: boolean;
      ability: number;
      form: number;
      available: boolean;
      known: boolean;
    }>;
    limit: number;
  },
): TerritorialRepresentativeTeam => {
  const repo = new TerritorialFootballRepository(db);
  const team = repo.team(input.teamId);
  if (!team) throw new Error(`Territorial team ${input.teamId} not found`);
  const playerIds = input.candidates
    .filter((candidate) => candidate.eligible && candidate.available && candidate.known)
    .sort((a, b) => b.ability + b.form - a.ability - a.form || a.playerId.localeCompare(b.playerId))
    .slice(0, input.limit)
    .map((candidate) => candidate.playerId);
  const next = {
    ...team,
    playerIds,
    history: [...team.history, { date: input.date, event: "SQUAD_SELECTED", playerIds }],
  };
  repo.upsertTeam(next);
  return next;
};

const ensureCompetitionRecords = (
  db: GameDatabase,
  config: TerritorialCompetitionConfig,
  seasonId: EntityId,
  seasonLabel: string,
): void => {
  const competitions = new CompetitionRepository(db);
  if (!db.prepare("SELECT id FROM competitions WHERE id=?").get(config.id))
    db.prepare("INSERT INTO competitions (id,name,scope) VALUES (?,?,?)").run(
      config.id,
      config.name,
      "local",
    );
  if (!db.prepare("SELECT id FROM competition_seasons WHERE id=?").get(seasonId))
    db.prepare(
      "INSERT INTO competition_seasons (id,competition_id,name,start_date,end_date) VALUES (?,?,?,?,?)",
    ).run(
      seasonId,
      config.id,
      `${config.name} ${seasonLabel}`,
      config.seasonStartDate,
      config.seasonEndDate,
    );
  if (!db.prepare("SELECT id FROM competition_rules WHERE competition_season_id=?").get(seasonId))
    competitions.insertRuleSet({
      id: createStableEntityId("territorial-rule", seasonId),
      competitionSeasonId: seasonId,
      competitionType: config.format === "KNOCKOUT" ? "CUP" : "LEAGUE",
      pointsForWin: 3,
      pointsForDraw: 1,
      pointsForLoss: 0,
      tiebreakers: ["points", "goalDifference", "goalsScored"],
      numberOfRounds: 1,
      homeAwayStructure: "single",
      seasonStartDate: config.seasonStartDate,
      seasonEndDate: config.seasonEndDate,
      roundSpacingDays: config.roundSpacingDays,
      promotionSlots: 0,
      relegationSlots: 0,
      continentalQualificationSlots: 0,
      matchesRequireWinner: config.winnerRequired,
      winnerResolution: "EXTRA_TIME_THEN_PENALTIES",
      allowExtraTime: true,
      allowPenalties: true,
      specialRules: {},
    });
};

const footballTeamFor = (db: GameDatabase, team: TerritorialRepresentativeTeam): void => {
  if (db.prepare("SELECT id FROM teams WHERE id=?").get(team.id)) return;
  const federation = db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as
    { id?: EntityId } | undefined;
  if (!federation?.id) throw new Error("Territorial competition requires a federation-backed save");
  db.prepare("INSERT INTO teams (id,federation_id,name,level,gender) VALUES (?,?,?,?,?)").run(
    team.id,
    federation.id,
    team.name,
    "TERRITORIAL",
    "MALE",
  );
};

const territoryLocationIds = (
  db: GameDatabase,
  team: TerritorialRepresentativeTeam,
): EntityId[] => {
  const repo = new TerritorialFootballRepository(db);
  if (team.territoryType === "DISTRICT") {
    const district = repo.district(team.territoryId);
    return district?.locationId ? [district.locationId] : [];
  }
  const province = repo.province(team.territoryId);
  return (province?.districtIds ?? []).flatMap((id) => {
    const district = repo.district(id);
    return district?.locationId ? [district.locationId] : [];
  });
};

const eligiblePlayerIds = (
  db: GameDatabase,
  team: TerritorialRepresentativeTeam,
  rules: TerritorialEligibilityRule,
  asOfDate: string,
): EntityId[] => {
  const locations = territoryLocationIds(db, team);
  if (!locations.length) return [];
  const marks = locations.map(() => "?").join(",");
  const conditions: string[] = [];
  const args: unknown[] = [];
  if (rules.birthplace) {
    conditions.push(`p.place_of_birth_location_id IN (${marks})`);
    args.push(...locations);
  }
  if (rules.residence) {
    conditions.push(`p.hometown_location_id IN (${marks})`);
    args.push(...locations);
  }
  if (rules.developmentRegistration) {
    conditions.push(
      `EXISTS (SELECT 1 FROM generated_player_origins gpo WHERE gpo.player_id=p.id AND gpo.district_location_id IN (${marks}))`,
    );
    args.push(...locations);
  }
  if (rules.localClubAffiliation) {
    conditions.push(
      `EXISTS (SELECT 1 FROM team_person_assignments tpa JOIN teams t ON t.id=tpa.team_id JOIN clubs c ON c.id=t.club_id WHERE tpa.person_id=p.id AND c.location_id IN (${marks}) AND tpa.role='PLAYER' AND tpa.ended_on IS NULL)`,
    );
    args.push(...locations);
  }
  if (!conditions.length) return [];
  const rows = db
    .prepare(
      `SELECT DISTINCT p.id, p.date_of_birth FROM persons p JOIN player_attributes pa ON pa.person_id=p.id WHERE (${conditions.join(" OR ")}) ORDER BY p.id`,
  )
    .all(...(args as any[])) as Array<{ id: EntityId; date_of_birth?: string }>;
  return rows
    .filter((row) => {
      if (rules.ageMaximum === undefined || !row.date_of_birth) return true;
      const age = (Date.parse(asOfDate) - Date.parse(row.date_of_birth)) / (365.25 * 86400000);
      return age <= rules.ageMaximum;
    })
    .filter((row) => !db.prepare("SELECT 1 FROM injuries WHERE person_id=? AND expected_recovery_date>=? LIMIT 1").get(row.id, asOfDate))
    .filter((row) => !db.prepare("SELECT 1 FROM suspensions WHERE person_id=? AND matches_remaining>0 LIMIT 1").get(row.id))
    .map((row) => row.id);
};

const selectCycleSquad = (
  db: GameDatabase,
  seasonId: EntityId,
  team: TerritorialRepresentativeTeam,
  config: TerritorialCompetitionConfig,
): TerritorialRepresentativeTeam => {
  const repo = new TerritorialFootballRepository(db);
  const ids = eligiblePlayerIds(db, team, config.eligibility, config.seasonStartDate);
  const attrs = new PlayerRepository(db).attributesForPlayers(ids);
  const score = (a: PlayerAttributeSet) =>
    Object.values(a.mental).reduce((sum, v) => sum + v, 0) +
    Object.values(a.technical).reduce((sum, v) => sum + v, 0) +
    Object.values(a.physical).reduce((sum, v) => sum + v, 0);
  const ranked = [...attrs].sort(
    (a, b) => score(b) - score(a) || a.personId.localeCompare(b.personId),
  );
  const selected: PlayerAttributeSet[] = [];
  const positions = ["GK", "D", "M", "F"];
  for (const position of positions) {
    const candidate = ranked.find(
      (a) => !selected.includes(a) && String(a.primaryPosition).startsWith(position),
    );
    if (candidate) selected.push(candidate);
  }
  for (const candidate of ranked)
    if (selected.length < 23 && !selected.includes(candidate)) selected.push(candidate);
  const playerIds = selected.map((a) => a.personId);
  const next = {
    ...team,
    competitionCycleId: seasonId,
    playerIds,
    history: [
      ...team.history,
      { date: config.seasonStartDate, event: "SQUAD_SELECTED", playerIds },
    ],
  };
  repo.upsertTeam(next);
  repo.saveSquad(seasonId, team.id, playerIds, config.seasonStartDate);
  return next;
};

const participantsFor = (
  db: GameDatabase,
  config: TerritorialCompetitionConfig,
  seasonId: EntityId,
  seasonLabel: string,
): TerritorialRepresentativeTeam[] => {
  const repo = new TerritorialFootballRepository(db);
  const source =
    config.participantType === "DISTRICT"
      ? repo
          .districts()
          .filter((d) => !config.provinceId || d.provinceId === config.provinceId)
          .map((d) =>
            createTerritorialRepresentativeTeam(db, {
              territoryType: "DISTRICT",
              territoryId: d.id,
              name: `${d.name} District`,
              date: config.seasonStartDate,
              competitionCycleId: seasonId,
            }),
          )
      : repo.provinces().map((p) =>
          createTerritorialRepresentativeTeam(db, {
            territoryType: "PROVINCE",
            territoryId: p.id,
            name: `${p.name} Province`,
            date: config.seasonStartDate,
            competitionCycleId: seasonId,
          }),
        );
  for (const team of source) {
    footballTeamFor(db, team);
  }
  return source;
};

export const initializeTerritorialCompetition = (
  db: GameDatabase,
  input: {
    config: TerritorialCompetitionConfig;
    seasonLabel: string;
    seed: string;
    participantTeamIds?: readonly EntityId[];
  },
): TerritorialCompetitionSeason => {
  initializeNepalTerritorialStructure(db, input.config.seasonStartDate);
  const seasonId = createStableEntityId(
    "territorial-season",
    `${input.config.id}:${input.seasonLabel}`,
  );
  ensureCompetitionRecords(db, input.config, seasonId, input.seasonLabel);
  const teams =
    input.participantTeamIds
      ?.map((id) => new TerritorialFootballRepository(db).team(id))
      .filter((team): team is TerritorialRepresentativeTeam => Boolean(team)) ??
    participantsFor(db, input.config, seasonId, input.seasonLabel);
  const repo = new TerritorialFootballRepository(db);
  const saved = repo.competitionSeason(seasonId);
  if (saved) return saved;
  for (const team of teams) {
    footballTeamFor(db, team);
    selectCycleSquad(db, seasonId, team, input.config);
  }
  const competition = new CompetitionRepository(db);
  const existing = competition.fixtures(seasonId);
  if (!existing.length) {
    const ids = teams.map((team) => team.id);
    const rules = new CompetitionRepository(db).getRuleSet(seasonId)!;
    const fixtures =
      input.config.format === "KNOCKOUT"
        ? generateKnockoutFixtures({
            competitionSeasonId: seasonId,
            teamIds: ids,
            ruleSet: rules,
            seed: input.seed,
          })
        : generateLeagueFixtures({
            competitionSeasonId: seasonId,
            teamIds: ids,
            ruleSet: rules,
            seed: input.seed,
          });
    for (const fixture of fixtures) competition.insertFixture(fixture);
  }
  const result: TerritorialCompetitionSeason = {
    id: seasonId,
    competitionId: input.config.id,
    seasonLabel: input.seasonLabel,
    config: input.config,
    participantTeamIds: teams.map((team) => team.id),
    qualifiedTeamIds: [],
    status: "SCHEDULED",
    history: [
      {
        date: input.config.seasonStartDate,
        event: "TERRITORIAL_COMPETITION_INITIALISED",
        teamIds: teams.map((team) => team.id),
      },
    ],
    provenanceStatus: "SIMULATION_ONLY",
  };
  repo.upsertCompetitionSeason(result);
  return result;
};

const winnerFor = (row: any): EntityId | undefined =>
  row.winner_team_id ??
  (row.home_goals > row.away_goals
    ? row.home_team_id
    : row.away_goals > row.home_goals
      ? row.away_team_id
      : undefined);
export const advanceTerritorialCompetition = (
  db: GameDatabase,
  input: {
    seasonId: EntityId;
    date: string;
    targetConfig?: TerritorialCompetitionConfig;
    targetSeasonLabel?: string;
    seed?: string;
  },
): { season: TerritorialCompetitionSeason; target?: TerritorialCompetitionSeason } => {
  const repo = new TerritorialFootballRepository(db);
  const season = repo.competitionSeason(input.seasonId);
  if (!season) throw new Error(`Territorial season ${input.seasonId} not found`);
  const pending = db
    .prepare(
      "SELECT f.id FROM fixtures f LEFT JOIN matches m ON m.fixture_id=f.id WHERE f.competition_season_id=? AND m.id IS NULL",
    )
    .all(input.seasonId) as unknown[];
  if (pending.length) return { season };
  const rows = db
    .prepare(
      "SELECT f.*,m.home_goals,m.away_goals,m.winner_team_id FROM fixtures f JOIN matches m ON m.fixture_id=f.id WHERE f.competition_season_id=? ORDER BY f.round,f.id",
    )
    .all(input.seasonId) as any[];
  let qualified: EntityId[];
  if (season.config.format === "LEAGUE") {
    const table = new Map<EntityId, { points: number; goalDifference: number; goals: number }>();
    for (const teamId of season.participantTeamIds)
      table.set(teamId, { points: 0, goalDifference: 0, goals: 0 });
    for (const row of rows) {
      const home = table.get(row.home_team_id),
        away = table.get(row.away_team_id);
      if (!home || !away) continue;
      home.goals += row.home_goals;
      away.goals += row.away_goals;
      home.goalDifference += row.home_goals - row.away_goals;
      away.goalDifference += row.away_goals - row.home_goals;
      if (row.home_goals > row.away_goals) home.points += 3;
      else if (row.away_goals > row.home_goals) away.points += 3;
      else {
        home.points += 1;
        away.points += 1;
      }
    }
    qualified = [...table.entries()]
      .sort(
        (a, b) =>
          b[1].points - a[1].points ||
          b[1].goalDifference - a[1].goalDifference ||
          b[1].goals - a[1].goals ||
          a[0].localeCompare(b[0]),
      )
      .slice(0, season.config.qualifierCount ?? 1)
      .map(([teamId]) => teamId);
  } else {
    const winners = [...new Set(rows.map(winnerFor).filter(Boolean) as EntityId[])];
    const playedTeams = new Set(rows.flatMap((row) => [row.home_team_id, row.away_team_id]));
    const currentTeams = season.qualifiedTeamIds.length
      ? season.qualifiedTeamIds
      : season.participantTeamIds;
    qualified = [
      ...new Set([...winners, ...currentTeams.filter((teamId) => !playedTeams.has(teamId))]),
    ];
  }
  if (season.config.format === "KNOCKOUT" && qualified.length > 1) {
    const round = Math.max(...rows.map((row) => Number(row.round)), 0) + 1;
    const rules = new CompetitionRepository(db).getRuleSet(input.seasonId)!;
    const fixtures = generateKnockoutFixtures({
      competitionSeasonId: input.seasonId,
      teamIds: qualified,
      ruleSet: rules,
      seed: `${input.seed ?? input.seasonId}:round:${round}`,
    }).map((fixture) => ({ ...fixture, round }));
    for (const fixture of fixtures) new CompetitionRepository(db).insertFixture(fixture);
    const next = {
      ...season,
      qualifiedTeamIds: qualified,
      status: "IN_PROGRESS" as const,
      history: [
        ...season.history,
        { date: input.date, event: "TERRITORIAL_KNOCKOUT_ROUND_ADVANCED", teamIds: qualified },
      ],
    };
    repo.upsertCompetitionSeason(next);
    return { season: next };
  }
  const champion = qualified.length === 1 ? qualified[0] : undefined;
  const completed = {
    ...season,
    qualifiedTeamIds: qualified,
    status: "COMPLETED" as const,
    championTeamId: champion,
    history: [
      ...season.history,
      { date: input.date, event: "TERRITORIAL_STAGE_COMPLETED", teamIds: qualified },
    ],
  };
  repo.upsertCompetitionSeason(completed);
  if (!input.targetConfig) return { season: completed };
  let targetTeamIds = qualified;
  if (
    input.targetConfig.participantType === "PROVINCE" &&
    season.config.participantType === "DISTRICT"
  ) {
    const territorial = new TerritorialFootballRepository(db);
    targetTeamIds = [
      ...new Set(
        qualified.flatMap((teamId) => {
          const districtTeam = territorial.team(teamId);
          const district = districtTeam && territorial.district(districtTeam.territoryId);
          if (!district) return [];
          return [
            createTerritorialRepresentativeTeam(db, {
              territoryType: "PROVINCE",
              territoryId: district.provinceId,
              name: `${territorial.province(district.provinceId)?.name ?? "Province"} Province`,
              date: input.targetConfig!.seasonStartDate,
            }).id,
          ];
        }),
      ),
    ];
  }
  const target = initializeTerritorialCompetition(db, {
    config: input.targetConfig,
    seasonLabel: input.targetSeasonLabel ?? season.seasonLabel,
    seed: input.seed ?? input.seasonId,
    participantTeamIds: targetTeamIds,
  });
  return { season: completed, target };
};

export const simulateTerritorialFixture = (
  db: GameDatabase,
  input: { fixtureId: EntityId; seasonId: EntityId; seed: string },
): MatchResult => {
  const repo = new TerritorialFootballRepository(db);
  const season = repo.competitionSeason(input.seasonId);
  if (!season) throw new Error("Territorial season not found");
  const fixture = new CompetitionRepository(db)
    .fixtures(input.seasonId)
    .find((item) => item.id === input.fixtureId);
  if (!fixture) throw new Error("Territorial fixture not found");
  if (db.prepare("SELECT id FROM matches WHERE fixture_id=?").get(fixture.id))
    throw new Error("Territorial fixture already played");
  const home = repo.team(fixture.homeTeamId),
    away = repo.team(fixture.awayTeamId);
  if (!home || !away) throw new Error("Territorial representative team missing");
  const assignment = requireFixtureOfficials(db, fixture, { seed: input.seed });
  const result = simulateMatch({
    fixture,
    refereeAssignment: assignment,
    homePlayers: new PlayerRepository(db).attributesForPlayers(repo.squad(input.seasonId, home.id)),
    awayPlayers: new PlayerRepository(db).attributesForPlayers(repo.squad(input.seasonId, away.id)),
    seed: input.seed,
    requiresWinner: season.config.winnerRequired,
    winnerResolution: "EXTRA_TIME_THEN_PENALTIES",
    allowExtraTime: true,
    allowPenalties: true,
  });
  const competitions = new CompetitionRepository(db);
  competitions.insertMatch(result.match, result.attendance);
  for (const event of result.events) competitions.insertMatchEvent(event);
  competitions.markFixturePlayed(fixture.id);
  for (const playerId of [...home.playerIds, ...away.playerIds])
    repo.recordExposure(
      input.seasonId,
      playerId,
      season.config.level,
      season.config.level === "DISTRICT" ? 10 : season.config.level === "PROVINCIAL" ? 20 : 30,
    );
  return result;
};

export const rollNepalPyramidSeason = (
  db: GameDatabase,
  input: {
    completedSeasons: readonly CompletedCompetitionSeason[];
    nextSeasons: ReadonlyMap<EntityId, CompetitionSeason>;
    relationships: readonly CompetitionRelationship[];
    eligibleClubIds?: ReadonlySet<EntityId>;
    fixtureRules?: ReadonlyMap<EntityId, CompetitionRuleSet>;
    seed: string;
  },
): PyramidProgressionResult => {
  const result = progressPyramidSeason({
    completedSeasons: input.completedSeasons,
    nextSeasons: input.nextSeasons,
    relationships: input.relationships,
    eligibleClubIds: input.eligibleClubIds,
  });
  persistPyramidProgression(db, result);
  const competitions = new CompetitionRepository(db);
  for (const [seasonId, ruleSet] of input.fixtureRules ?? new Map()) {
    const memberships = result.nextMemberships.filter(
      (membership) =>
        membership.competitionSeasonId === seasonId && membership.status !== "WITHDRAWN",
    );
    const fixtures = generateLeagueFixtures({
      competitionSeasonId: seasonId,
      teamIds: memberships
        .map((membership) => membership.teamId)
        .filter((teamId): teamId is EntityId => teamId !== undefined),
      ruleSet,
      seed: `${input.seed}:${seasonId}`,
    });
    for (const fixture of fixtures) competitions.insertFixture(fixture);
  }
  return result;
};
