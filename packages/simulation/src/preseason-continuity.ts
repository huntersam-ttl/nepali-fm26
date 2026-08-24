import {
  createStableEntityId,
  type EntityId,
  type GeneratedPlayerOrigin,
  type Person,
  type PlayerAttributeSet,
  type PlayerContractRecord,
  type PlayerPotential,
} from "@nepal-football-sim/shared-types";
import {
  PlayerRepository,
  TransferMarketRepository,
  WorldRepository,
  YouthRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { createInitialDevelopmentState } from "./player-development.js";
import { SeededRandom } from "./rng.js";

export type PreseasonContinuityReport = {
  date: string;
  competitionSeasonId: EntityId;
  competitionName: string;
  expectedMembershipCount: number;
  actualMembershipCount: number;
  playableTeamCountBefore: number;
  playableTeamCountAfter: number;
  minimumSquadSize: number;
  healthySquadSize: number;
  goalkeeperTarget: number;
  clubsRepaired: number;
  youthPromoted: number;
  freeAgentsSigned: number;
  emergencyGeneratedPlayers: number;
  contractAssignmentsRestored: number;
  goalkeeperRepairs: number;
  minimumClubSquadSize: number;
  maximumClubSquadSize: number;
  averageClubSquadSize: number;
  clubDiagnostics: ClubContinuityDiagnostic[];
};

export type ClubContinuityDiagnostic = {
  clubId: EntityId;
  clubName: string;
  teamId?: EntityId;
  playersBefore: number;
  goalkeepersBefore: number;
  playersAfter: number;
  goalkeepersAfter: number;
  youthPromoted: number;
  freeAgentsSigned: number;
  emergencyGeneratedPlayers: number;
  contractAssignmentsRestored: number;
};

type RepairClub = {
  clubId: EntityId;
  clubName: string;
  teamId?: EntityId;
  countryId: EntityId;
  locationId?: EntityId;
};

type Candidate = {
  playerId: EntityId;
  position: string;
  ability: number;
};

const minimumSquadSize = 11;
const healthySquadSize = 22;
const goalkeeperTarget = 2;
const currency = "NPR";

export const repairPreseasonContinuity = (input: {
  db: GameDatabase;
  competitionSeasonIds: readonly EntityId[];
  date: string;
  seed: string;
}): PreseasonContinuityReport[] => {
  const reports: PreseasonContinuityReport[] = [];
  for (const seasonId of input.competitionSeasonIds) {
    const meta = competitionSeasonMeta(input.db, seasonId);
    if (!meta || !isCoreContinuityCompetition(meta.competitionName)) {
      continue;
    }
    const clubs = memberClubs(input.db, seasonId);
    if (clubs.length === 0) {
      continue;
    }
    const before = clubs.map((club) => squadSnapshot(input.db, club));
    let youthPromoted = 0;
    let freeAgentsSigned = 0;
    let emergencyGeneratedPlayers = 0;
    let contractAssignmentsRestored = 0;
    let goalkeeperRepairs = 0;
    const clubDiagnostics: ClubContinuityDiagnostic[] = [];

    for (const club of clubs) {
      const initial = squadSnapshot(input.db, club);
      let current = initial;
      let clubYouth = 0;
      let clubFreeAgents = 0;
      let clubEmergency = 0;
      let clubRestored = 0;

      for (const candidate of contractedPlayersWithoutAssignment(
        input.db,
        club.clubId,
        input.date,
      )) {
        if (current.players >= healthySquadSize && current.goalkeepers >= goalkeeperTarget) break;
        assignPlayer(input.db, club, candidate.playerId, input.date, "contract-restored");
        clubRestored += 1;
        current = squadSnapshot(input.db, club);
      }

      while (current.goalkeepers < goalkeeperTarget) {
        const promoted = promoteYouth(input.db, club, input.date, "GK");
        if (promoted) {
          clubYouth += 1;
          current = squadSnapshot(input.db, club);
          continue;
        }
        const freeAgent = signFreeAgent(input.db, club, input.date, input.seed, "GK");
        if (freeAgent) {
          clubFreeAgents += 1;
          current = squadSnapshot(input.db, club);
          continue;
        }
        createEmergencyPlayer(input.db, club, input.date, input.seed, "GK");
        clubEmergency += 1;
        current = squadSnapshot(input.db, club);
      }

      while (current.players < healthySquadSize) {
        const neededPosition =
          current.players < minimumSquadSize ? undefined : shallowestPosition(input.db, club);
        const promoted = promoteYouth(input.db, club, input.date, neededPosition);
        if (promoted) {
          clubYouth += 1;
          current = squadSnapshot(input.db, club);
          continue;
        }
        const freeAgent = signFreeAgent(input.db, club, input.date, input.seed, neededPosition);
        if (freeAgent) {
          clubFreeAgents += 1;
          current = squadSnapshot(input.db, club);
          continue;
        }
        createEmergencyPlayer(input.db, club, input.date, input.seed, neededPosition ?? "CB");
        clubEmergency += 1;
        current = squadSnapshot(input.db, club);
      }

      if (
        clubYouth > 0 ||
        clubFreeAgents > 0 ||
        clubEmergency > 0 ||
        clubRestored > 0 ||
        initial.goalkeepers < goalkeeperTarget
      ) {
        clubDiagnostics.push({
          clubId: club.clubId,
          clubName: club.clubName,
          teamId: club.teamId,
          playersBefore: initial.players,
          goalkeepersBefore: initial.goalkeepers,
          playersAfter: current.players,
          goalkeepersAfter: current.goalkeepers,
          youthPromoted: clubYouth,
          freeAgentsSigned: clubFreeAgents,
          emergencyGeneratedPlayers: clubEmergency,
          contractAssignmentsRestored: clubRestored,
        });
      }
      youthPromoted += clubYouth;
      freeAgentsSigned += clubFreeAgents;
      emergencyGeneratedPlayers += clubEmergency;
      contractAssignmentsRestored += clubRestored;
      if (current.goalkeepers > initial.goalkeepers) goalkeeperRepairs += 1;
    }

    const after = clubs.map((club) => squadSnapshot(input.db, club));
    reports.push({
      date: input.date,
      competitionSeasonId: seasonId,
      competitionName: meta.competitionName,
      expectedMembershipCount: clubs.length,
      actualMembershipCount: clubs.length,
      playableTeamCountBefore: before.filter((item) => item.players >= minimumSquadSize).length,
      playableTeamCountAfter: after.filter((item) => item.players >= minimumSquadSize).length,
      minimumSquadSize,
      healthySquadSize,
      goalkeeperTarget,
      clubsRepaired: clubDiagnostics.length,
      youthPromoted,
      freeAgentsSigned,
      emergencyGeneratedPlayers,
      contractAssignmentsRestored,
      goalkeeperRepairs,
      minimumClubSquadSize: Math.min(...after.map((item) => item.players)),
      maximumClubSquadSize: Math.max(...after.map((item) => item.players)),
      averageClubSquadSize: round(average(after.map((item) => item.players))),
      clubDiagnostics,
    });
  }
  return reports;
};

const contractedPlayersWithoutAssignment = (
  db: GameDatabase,
  clubId: EntityId,
  date: string,
): Candidate[] =>
  db
    .prepare(
      `SELECT pc.player_id, pa.primary_position
      FROM player_contracts pc
      JOIN player_attributes pa ON pa.person_id = pc.player_id
      LEFT JOIN team_person_assignments active
        ON active.person_id = pc.player_id AND active.role = 'PLAYER' AND active.ended_on IS NULL
      LEFT JOIN player_retirement_states prs
        ON prs.player_id = pc.player_id AND prs.state = 'RETIRED'
      WHERE pc.club_id = ? AND pc.status = 'ACTIVE' AND pc.start_date <= ? AND pc.end_date >= ?
        AND active.person_id IS NULL AND prs.player_id IS NULL
      ORDER BY pc.squad_role DESC, pc.end_date DESC, pc.player_id`,
    )
    .all(clubId, date, date)
    .map((row: any) => ({
      playerId: row.player_id,
      position: row.primary_position,
      ability: 0,
    }));

const promoteYouth = (
  db: GameDatabase,
  club: RepairClub,
  date: string,
  position?: string,
): boolean => {
  const candidates = youthCandidates(db, club.clubId, position);
  const candidate = candidates[0];
  if (!candidate) return false;
  assignPlayer(db, club, candidate.playerId, date, "youth-promotion");
  new YouthRepository(db).updateYouthStatus(candidate.playerId, "FIRST_TEAM_PROSPECT", date);
  ensureRepairContract(db, candidate.playerId, club.clubId, date, "SEMI_PRO", "PROSPECT");
  return true;
};

const signFreeAgent = (
  db: GameDatabase,
  club: RepairClub,
  date: string,
  seed: string,
  position?: string,
): boolean => {
  const candidates = freeAgentCandidates(db, position);
  if (candidates.length === 0) return false;
  const rng = new SeededRandom(
    `${seed}:free-agent-repair:${club.clubId}:${date}:${position ?? "any"}`,
  );
  const candidate =
    candidates[
      Math.min(candidates.length - 1, rng.integer(0, Math.min(5, candidates.length - 1)))
    ]!;
  assignPlayer(db, club, candidate.playerId, date, "free-agent-repair");
  ensureRepairContract(db, candidate.playerId, club.clubId, date, "SEMI_PRO", "BACKUP");
  new TransferMarketRepository(db).updatePlayerClub(candidate.playerId, club.clubId);
  return true;
};

const youthCandidates = (db: GameDatabase, clubId: EntityId, position?: string): Candidate[] =>
  db
    .prepare(
      `SELECT yps.player_id, pa.primary_position, pa.technical_json, pa.mental_json, pa.physical_json, pa.goalkeeping_json
      FROM youth_player_statuses yps
      JOIN player_attributes pa ON pa.person_id = yps.player_id
      LEFT JOIN team_person_assignments active
        ON active.person_id = yps.player_id AND active.role = 'PLAYER' AND active.ended_on IS NULL
      LEFT JOIN player_retirement_states prs
        ON prs.player_id = yps.player_id AND prs.state = 'RETIRED'
      WHERE yps.club_id = ? AND active.person_id IS NULL AND prs.player_id IS NULL
        AND (? IS NULL OR pa.primary_position = ?)
      ORDER BY yps.youth_status DESC, yps.status_since, yps.player_id`,
    )
    .all(clubId, position ?? null, position ?? null)
    .map(mapCandidate);

const freeAgentCandidates = (db: GameDatabase, position?: string): Candidate[] =>
  db
    .prepare(
      `SELECT pa.person_id AS player_id, pa.primary_position, pa.technical_json, pa.mental_json,
        pa.physical_json, pa.goalkeeping_json
      FROM player_attributes pa
      JOIN persons p ON p.id = pa.person_id
      LEFT JOIN team_person_assignments active
        ON active.person_id = pa.person_id AND active.role = 'PLAYER' AND active.ended_on IS NULL
      LEFT JOIN player_retirement_states prs
        ON prs.player_id = pa.person_id AND prs.state = 'RETIRED'
      LEFT JOIN player_contracts pc
        ON pc.player_id = pa.person_id AND pc.status = 'ACTIVE'
      WHERE active.person_id IS NULL AND prs.player_id IS NULL AND pc.player_id IS NULL
        AND (? IS NULL OR pa.primary_position = ?)
      ORDER BY p.date_of_birth DESC, pa.person_id
      LIMIT 80`,
    )
    .all(position ?? null, position ?? null)
    .map(mapCandidate);

const mapCandidate = (row: any): Candidate => ({
  playerId: row.player_id,
  position: row.primary_position,
  ability: averageAttributeJson(row),
});

const assignPlayer = (
  db: GameDatabase,
  club: RepairClub,
  playerId: EntityId,
  date: string,
  reason: string,
): void => {
  if (!club.teamId) return;
  new TransferMarketRepository(db).insertTeamAssignment({
    id: createStableEntityId(
      "team-person-assignment",
      `${playerId}:${club.teamId}:${date}:${reason}`,
    ),
    personId: playerId,
    teamId: club.teamId,
    role: "PLAYER",
    startedOn: date,
  });
};

const ensureRepairContract = (
  db: GameDatabase,
  playerId: EntityId,
  clubId: EntityId,
  date: string,
  contractType: PlayerContractRecord["contractType"],
  squadRole: PlayerContractRecord["squadRole"],
): void => {
  const market = new TransferMarketRepository(db);
  if (market.activeContract(playerId, date)) return;
  market.upsertPlayerContract({
    id: createStableEntityId("player-contract", `${playerId}:${clubId}:repair:${date}`),
    playerId,
    clubId,
    startDate: date,
    endDate: addYears(date, 1),
    contractType,
    salary: contractType === "YOUTH" ? 0 : 6000,
    appearanceFee: 0,
    goalBonus: 0,
    cleanSheetBonus: 0,
    signingBonus: 0,
    loyaltyBonus: 0,
    currency,
    squadRole,
    status: "ACTIVE",
    provenance: {
      sourceName: "Nepal preseason squad repair",
      confidence: 1,
      confidenceLevel: "HIGH",
      status: "SIMULATION_ONLY",
      notes: "Generated or repaired preseason squad continuity contract.",
    },
  });
};

const createEmergencyPlayer = (
  db: GameDatabase,
  club: RepairClub,
  date: string,
  seed: string,
  position: string,
): void => {
  const squadCount = squadSnapshot(db, club).players;
  const rng = new SeededRandom(
    `${seed}:emergency:${club.clubId}:${date}:${position}:${squadCount}`,
  );
  const key = `${club.clubId}:${date}:${position}:${squadCount}:${rng.integer(1000, 9999)}`;
  const personId = createStableEntityId("person-emergency-repair", key);
  if (personExists(db, personId)) {
    ensureRepairContract(db, personId, club.clubId, date, "SEMI_PRO", "BACKUP");
    assignPlayer(db, club, personId, date, "emergency-repair");
    return;
  }
  const name = emergencyName(rng);
  const person: Person = {
    id: personId,
    fullName: name,
    displayName: name,
    dateOfBirth: birthDate(date, rng.integer(19, 26), rng),
    nationalityCountryId: club.countryId,
    genderPresentation: "male",
    placeOfBirthLocationId: club.locationId,
    hometownLocationId: club.locationId,
    languages: ["Nepali"],
  };
  const world = new WorldRepository(db);
  world.insertPerson(person);
  world.insertPersonRole({
    id: createStableEntityId("person-role", `${personId}:PLAYER`),
    personId,
    role: "PLAYER",
    activeFrom: date,
  });
  const attributes = emergencyAttributes(personId, key, position, rng);
  const players = new PlayerRepository(db);
  players.insertAttributes(attributes);
  const potential: PlayerPotential = {
    id: createStableEntityId("player-potential", personId),
    playerId: personId,
    potentialCeiling: round(averageAttributeSet(attributes) + 1 + rng.next() * 1.8),
    developmentRate: round(0.55 + rng.next() * 0.45),
    volatility: round(0.5 + rng.next() * 0.8),
    professionalism: round(0.7 + rng.next() * 0.5),
    status: "SIMULATION_ONLY",
  };
  players.insertPotential(potential);
  players.upsertDevelopmentState(createInitialDevelopmentState(attributes, 22, date));
  const origin: GeneratedPlayerOrigin = {
    id: createStableEntityId("generated-player-origin", personId),
    playerId: personId,
    originType: "GENERATED_FREE_PLAYER",
    originDataType: "SIMULATION_ONLY",
    countryId: club.countryId,
    clubId: club.clubId,
    locationId: club.locationId,
    districtLocationId: club.locationId,
    generatedOn: date,
    nameGenerationKey: key,
    archetype: position === "GK" ? "SHOT_STOPPER" : "BALL_WINNING_MIDFIELDER",
    youthStatus: "FIRST_TEAM_PLAYER",
    eligibility: {
      nationalityCountryId: club.countryId,
      ageGroupEligible: false,
      diaspora: false,
    },
    sourceNotes: "Emergency simulation-only squad repair player.",
  };
  new YouthRepository(db).insertGeneratedPlayerOrigin(origin);
  ensureRepairContract(db, personId, club.clubId, date, "SEMI_PRO", "BACKUP");
  assignPlayer(db, club, personId, date, "emergency-repair");
};

const competitionSeasonMeta = (
  db: GameDatabase,
  seasonId: EntityId,
): { competitionName: string; startDate: string } | undefined => {
  const row = db
    .prepare(
      `SELECT c.name AS competition_name, cs.start_date
      FROM competition_seasons cs
      JOIN competitions c ON c.id = cs.competition_id
      WHERE cs.id = ?`,
    )
    .get(seasonId) as any;
  return row ? { competitionName: row.competition_name, startDate: row.start_date } : undefined;
};

const memberClubs = (db: GameDatabase, seasonId: EntityId): RepairClub[] =>
  db
    .prepare(
      `SELECT cm.club_id, c.name AS club_name, c.country_id, c.location_id, MIN(t.id) AS team_id
      FROM club_memberships cm
      JOIN clubs c ON c.id = cm.club_id
      LEFT JOIN teams t ON (t.id = cm.team_id OR (cm.team_id IS NULL AND t.club_id = cm.club_id))
        AND t.level = 'senior'
      WHERE cm.competition_season_id = ? AND cm.status NOT IN ('WITHDRAWN', 'SUSPENDED', 'INELIGIBLE')
      GROUP BY cm.club_id, c.name, c.country_id, c.location_id
      ORDER BY c.name`,
    )
    .all(seasonId)
    .map((row: any) => ({
      clubId: row.club_id,
      clubName: row.club_name,
      countryId: row.country_id,
      locationId: row.location_id ?? undefined,
      teamId: row.team_id ?? undefined,
    }));

const squadSnapshot = (
  db: GameDatabase,
  club: RepairClub,
): { players: number; goalkeepers: number } => {
  if (!club.teamId) return { players: 0, goalkeepers: 0 };
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT tpa.person_id) AS players,
        COUNT(DISTINCT CASE WHEN pa.primary_position = 'GK' THEN tpa.person_id END) AS goalkeepers
      FROM team_person_assignments tpa
      JOIN player_attributes pa ON pa.person_id = tpa.person_id
      LEFT JOIN player_retirement_states prs ON prs.player_id = tpa.person_id AND prs.state = 'RETIRED'
      WHERE tpa.team_id = ? AND tpa.role = 'PLAYER' AND tpa.ended_on IS NULL AND prs.player_id IS NULL`,
    )
    .get(club.teamId) as any;
  return { players: Number(row?.players ?? 0), goalkeepers: Number(row?.goalkeepers ?? 0) };
};

const shallowestPosition = (db: GameDatabase, club: RepairClub): string | undefined => {
  if (!club.teamId) return undefined;
  const counts = db
    .prepare(
      `SELECT pa.primary_position AS position, COUNT(*) AS count
      FROM team_person_assignments tpa
      JOIN player_attributes pa ON pa.person_id = tpa.person_id
      WHERE tpa.team_id = ? AND tpa.role = 'PLAYER' AND tpa.ended_on IS NULL
      GROUP BY pa.primary_position`,
    )
    .all(club.teamId) as Array<{ position: string; count: number }>;
  const desired = ["GK", "CB", "CM", "ST", "RB", "LB", "DM", "AM", "RW", "LW"];
  return desired.sort(
    (a, b) =>
      (counts.find((item) => item.position === a)?.count ?? 0) -
      (counts.find((item) => item.position === b)?.count ?? 0),
  )[0];
};

const isCoreContinuityCompetition = (name: string): boolean =>
  name === "ANFA National League" ||
  name === "Martyr's Memorial A-Division League" ||
  name === "Martyr's Memorial B-Division League";

const emergencyAttributes = (
  personId: EntityId,
  key: string,
  position: string,
  rng: SeededRandom,
): PlayerAttributeSet => {
  const base = position === "GK" ? 5 : 6;
  const mod = (value: number) =>
    Math.max(1, Math.min(20, Math.round(value + (rng.next() - 0.5) * 3)));
  return {
    id: createStableEntityId("player-attribute", key),
    personId,
    primaryPosition: position as PlayerAttributeSet["primaryPosition"],
    secondaryPositions: [],
    technical: {
      firstTouch: mod(base),
      passing: mod(base),
      crossing: mod(base - 1),
      dribbling: mod(base - 1),
      finishing: mod(position === "ST" ? base + 1 : base - 2),
      heading: mod(position === "CB" || position === "ST" ? base + 1 : base - 1),
      tackling: mod(["CB", "RB", "LB", "DM"].includes(position) ? base + 1 : base - 2),
      technique: mod(base),
      longShots: mod(base - 1),
      setPieces: mod(base - 2),
    },
    mental: {
      decisions: mod(base),
      vision: mod(base - 1),
      composure: mod(base),
      positioning: mod(base),
      anticipation: mod(base),
      workRate: mod(base + 1),
      teamwork: mod(base),
      leadership: mod(base - 2),
      aggression: mod(base),
      determination: mod(base),
      professionalism: mod(base),
    },
    physical: {
      pace: mod(base),
      acceleration: mod(base),
      strength: mod(base),
      stamina: mod(base),
      agility: mod(base),
      balance: mod(base),
      jumping: mod(base),
      naturalFitness: mod(base),
    },
    goalkeeping: {
      handling: mod(position === "GK" ? base + 2 : 2),
      reflexes: mod(position === "GK" ? base + 2 : 2),
      oneOnOnes: mod(position === "GK" ? base + 1 : 2),
      aerialReach: mod(position === "GK" ? base + 1 : 2),
      kicking: mod(position === "GK" ? base : 2),
      distribution: mod(position === "GK" ? base : 2),
      commandOfArea: mod(position === "GK" ? base : 2),
    },
  };
};

const emergencyName = (rng: SeededRandom): string => {
  const first = [
    "Aashish",
    "Bibek",
    "Deepak",
    "Kiran",
    "Nabin",
    "Prabin",
    "Rabin",
    "Roshan",
    "Sagar",
    "Suman",
  ];
  const surname = [
    "Adhikari",
    "Basnet",
    "Gurung",
    "Karki",
    "Khadka",
    "Lama",
    "Magar",
    "Rai",
    "Shrestha",
    "Thapa",
  ];
  return `${rng.pick(first)} ${rng.pick(surname)}`;
};

const birthDate = (date: string, age: number, rng: SeededRandom): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() - age);
  parsed.setUTCMonth(rng.integer(0, 11), rng.integer(1, 28));
  return parsed.toISOString().slice(0, 10);
};

const averageAttributeJson = (row: any): number => {
  const values = [
    ...Object.values(JSON.parse(row.technical_json) as Record<string, number>),
    ...Object.values(JSON.parse(row.mental_json) as Record<string, number>),
    ...Object.values(JSON.parse(row.physical_json) as Record<string, number>),
    ...(row.primary_position === "GK"
      ? Object.values(JSON.parse(row.goalkeeping_json) as Record<string, number>)
      : []),
  ];
  return average(values);
};

const averageAttributeSet = (attributes: PlayerAttributeSet): number =>
  average([
    ...Object.values(attributes.technical),
    ...Object.values(attributes.mental),
    ...Object.values(attributes.physical),
    ...(attributes.primaryPosition === "GK" ? Object.values(attributes.goalkeeping) : []),
  ]);

const addYears = (date: string, years: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + years);
  return parsed.toISOString().slice(0, 10);
};

const average = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

const round = (value: number): number => Math.round(value * 100) / 100;

const personExists = (db: GameDatabase, personId: EntityId): boolean =>
  db.prepare("SELECT 1 FROM persons WHERE id = ? LIMIT 1").get(personId) !== undefined;
