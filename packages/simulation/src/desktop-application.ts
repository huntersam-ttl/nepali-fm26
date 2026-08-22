import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CompetitionRepository,
  ManagerRepository,
  PlayerRepository,
  SaveRepository,
  WorldRepository,
  createNewSave,
  loadSave,
  migrateDatabase,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createEntityId,
  createStableEntityId,
  type Club,
  type Competition,
  type CompetitionRuleSet,
  type CompetitionSeason,
  type Country,
  type EntityId,
  type FixtureRecord,
  type InboxItem,
  type ISODate,
  type ManagerContract,
  type ManagerProfile,
  type MatchEvent,
  type MatchResult,
  type Person,
  type PlayerAttributeSet,
  type PlayerPosition,
  type SaveMetadata,
  type TacticalAssignment,
  type TacticalSetup,
  type Team,
} from "@nepal-football-sim/shared-types";
import { generateLeagueFixtures } from "./fixture-generation.js";
import {
  createCareerCharacter,
  createManagerContract,
  testLicence,
  type CreateCareerCharacterInput,
} from "./manager-career.js";
import {
  continueToNextFixtureDate,
  persistQuickSimResult,
  quickSimManagerMatch,
} from "./manager-flow.js";
import { FORMATION_PRESETS, TACTICAL_STYLE_PRESETS, createTacticalSetup } from "./tactics.js";

export type DesktopAppError = {
  code:
    | "SAVE_MISSING"
    | "SAVE_CORRUPTED"
    | "MIGRATION_FAILED"
    | "FIXTURE_MISSING"
    | "PLAYER_MISSING"
    | "INVALID_SELECTION"
    | "DATABASE_UNAVAILABLE"
    | "SIMULATION_ERROR";
  message: string;
  detail?: string;
};

export type AppResult<T> = { ok: true; data: T } | { ok: false; error: DesktopAppError };

export type SaveListItem = {
  saveId: EntityId;
  displayName: string;
  databasePath: string;
  createdAt: string;
  lastPlayedAt: string;
  worldDate: string;
  characterName?: string;
  currentClub?: string;
  currentRole?: string;
};

export type CareerCreationCommand = {
  saveName: string;
  character: Omit<
    CreateCareerCharacterInput,
    "nationalityCountryId" | "coachingLicences" | "careerStartDate"
  > & {
    careerStartDate?: ISODate;
  };
  joinTeamId?: EntityId;
};

export type SquadRow = {
  personId: EntityId;
  name: string;
  age?: number;
  nationality: string;
  positions: string[];
  preferredFoot: "Left" | "Right";
  fitness: number;
  form: number;
  morale: string;
  overall: number;
  roleSuitability: string;
  appearances: number;
  goals: number;
  assists: number;
  averageRating: number;
  availability: string;
};

export type PlayerProfileReadModel = SquadRow & {
  attributes: PlayerAttributeSet;
  provenanceStatus?: string;
  matchStats: {
    minutes: number;
    yellowCards: number;
    redCards: number;
  };
};

export type FixtureReadModel = {
  id: EntityId;
  date: string;
  opponent: string;
  homeAway: "home" | "away";
  competition: string;
  status: FixtureRecord["status"];
  score?: string;
};

export type CompetitionView = {
  name: string;
  table: Array<{
    teamId: EntityId;
    teamName: string;
    played: number;
    goalDifference: number;
    points: number;
  }>;
};

export type PostMatchReadModel = {
  match: MatchResult["match"];
  homeTeam: string;
  awayTeam: string;
  events: MatchEvent[];
  score: string;
  homeStats: MatchResult["homeStats"];
  awayStats: MatchResult["awayStats"];
  playerRatings: Array<{ personId: EntityId; name: string; rating: number; minutes: number }>;
};

export type ManagerHomeReadModel = {
  save: SaveMetadata;
  manager: ManagerProfile;
  managerName: string;
  contract?: ManagerContract;
  clubName?: string;
  teamName?: string;
  nextFixture?: FixtureReadModel;
  previousResult?: PostMatchReadModel;
  inbox: InboxItem[];
  unavailablePlayers: SquadRow[];
  position?: string;
};

export type DesktopApplicationState = {
  save: SaveMetadata;
  saveListItem: SaveListItem;
  home: ManagerHomeReadModel;
  squad: SquadRow[];
  tactics: TacticalSetup[];
  activeTactic?: TacticalSetup;
  fixtures: FixtureReadModel[];
  competition: CompetitionView;
};

type TestingWorld = {
  country: Country;
  competition: Competition;
  season: CompetitionSeason;
  ruleSet: CompetitionRuleSet;
  clubs: Club[];
  teams: Team[];
  fixtures: FixtureRecord[];
  playersByTeam: Map<EntityId, PlayerAttributeSet[]>;
  peopleById: Map<EntityId, Person>;
};

export class DesktopApplicationService {
  constructor(private readonly savesDirectory: string) {}

  listSaves(): AppResult<SaveListItem[]> {
    try {
      mkdirSync(this.savesDirectory, { recursive: true });
      const items = readdirSync(this.savesDirectory)
        .filter((file) => file.endsWith(".sqlite"))
        .flatMap((file) => {
          const databasePath = join(this.savesDirectory, file);
          let db: GameDatabase | undefined;
          try {
            db = openGameDatabase(databasePath);
            migrateDatabase(db);
            const save = new SaveRepository(db).first();
            return save ? [this.saveListItem(db, save, databasePath)] : [];
          } catch {
            return [];
          } finally {
            db?.close();
          }
        })
        .sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt));
      return ok(items);
    } catch (error) {
      return fail("DATABASE_UNAVAILABLE", "Could not list saves.", error);
    }
  }

  createCareer(command: CareerCreationCommand): AppResult<DesktopApplicationState> {
    const databasePath = join(
      this.savesDirectory,
      `${slug(command.saveName)}-${Date.now().toString(36)}.sqlite`,
    );
    try {
      mkdirSync(dirname(databasePath), { recursive: true });
      const db = openGameDatabase(databasePath);
      try {
        migrateDatabase(db);
        const world = seedTestingWorld(db);
        const careerStartDate = command.character.careerStartDate ?? world.season.startDate;
        const career = createCareerCharacter({
          ...command.character,
          nationalityCountryId: world.country.id,
          coachingLicences: [testLicence("Testing C Licence")],
          careerStartDate,
        });
        const save = createNewSave(db, {
          name: command.saveName,
          worldDate: careerStartDate,
          gameVersion: "0.1.0",
          randomSeed: `desktop:${command.saveName}:${career.person.id}`,
          playerCharacterId: career.character.id,
        });
        const worldRepo = new WorldRepository(db);
        const managers = new ManagerRepository(db);
        worldRepo.insertPerson(career.person);
        worldRepo.insertPersonRole(career.managerRole);
        worldRepo.insertCareerCharacter(career.character);
        managers.insertProfile(career.managerProfile);
        const joinedTeamId = command.joinTeamId ?? world.teams[0]!.id;
        const joinedTeam = world.teams.find((team) => team.id === joinedTeamId);
        if (joinedTeam) {
          managers.insertContract(
            createManagerContract({
              managerProfileId: career.managerProfile.id,
              personId: career.person.id,
              teamId: joinedTeam.id,
              clubId: joinedTeam.clubId,
              contractStart: careerStartDate,
              contractEnd: "2027-05-31",
              salaryAmountMinor: 9_000_000,
            }),
          );
          const players = new PlayerRepository(db).attributesForTeam(joinedTeam.id);
          managers.insertTacticalSetup(
            defaultSetup(joinedTeam.id, players, career.managerProfile.id),
          );
          managers.insertInboxItem({
            id: createEntityId(),
            createdOn: careerStartDate,
            type: "FIXTURE_UPCOMING",
            title: "Welcome to manager mode",
            body: "Your testing-world manager career has been created and saved.",
            relatedEntity: { type: "team", id: joinedTeam.id },
            read: false,
          });
        }
        const loadedSave = loadSave(db, save.id);
        return ok(this.loadStateFromOpenDb(db, loadedSave, databasePath));
      } finally {
        db.close();
      }
    } catch (error) {
      return fail("DATABASE_UNAVAILABLE", "Could not create career save.", error);
    }
  }

  loadSave(saveId: EntityId): AppResult<DesktopApplicationState> {
    const listed = this.listSaves();
    if (!listed.ok) return listed;
    const item = listed.data.find((candidate) => candidate.saveId === saveId);
    if (!item) return fail("SAVE_MISSING", `Save ${saveId} was not found.`);
    return this.loadSaveByPath(item.databasePath);
  }

  loadSaveByPath(databasePath: string): AppResult<DesktopApplicationState> {
    try {
      const db = openGameDatabase(databasePath);
      try {
        migrateDatabase(db);
        const save = loadSave(db);
        return ok(this.loadStateFromOpenDb(db, save, databasePath));
      } finally {
        db.close();
      }
    } catch (error) {
      return fail("SAVE_CORRUPTED", "Could not load save.", error);
    }
  }

  saveTactic(saveId: EntityId, tactic: TacticalSetup): AppResult<TacticalSetup> {
    return this.withSave(saveId, (db) => {
      new ManagerRepository(db).insertTacticalSetup({ ...tactic, updatedOn: today() });
      return tactic;
    });
  }

  quickSimMatch(saveId: EntityId, fixtureId?: EntityId): AppResult<DesktopApplicationState> {
    return this.withSave(saveId, (db, save, databasePath) => {
      const context = managerContext(db, save);
      const fixture =
        (fixtureId
          ? context.fixtures.find((candidate) => candidate.id === fixtureId)
          : context.fixtures.find(
              (candidate) =>
                candidate.status === "scheduled" &&
                (candidate.homeTeamId === context.team.id ||
                  candidate.awayTeamId === context.team.id),
            )) ?? undefined;
      if (!fixture) {
        throw appError("FIXTURE_MISSING", "No upcoming manager fixture is available.");
      }
      const homePlayers = new PlayerRepository(db).attributesForTeam(fixture.homeTeamId);
      const awayPlayers = new PlayerRepository(db).attributesForTeam(fixture.awayTeamId);
      const managers = new ManagerRepository(db);
      const tactic = managers.tacticalSetups(context.team.id)[0];
      if (!tactic) {
        throw appError("INVALID_SELECTION", "No saved tactic exists for the manager team.");
      }
      const opponentTactic = defaultSetup(
        fixture.homeTeamId === context.team.id ? fixture.awayTeamId : fixture.homeTeamId,
        fixture.homeTeamId === context.team.id ? awayPlayers : homePlayers,
      );
      const result = quickSimManagerMatch({
        fixture,
        competitionTeamIds: context.teams.map((team) => team.id),
        ruleSet: context.ruleSet,
        homePlayers,
        awayPlayers,
        homeTacticalSetup: fixture.homeTeamId === context.team.id ? tactic : opponentTactic,
        awayTacticalSetup: fixture.awayTeamId === context.team.id ? tactic : opponentTactic,
        seed: `${save.randomSeed}:${fixture.id}`,
        save,
      });
      persistQuickSimResult(
        db,
        {
          fixture,
          competitionTeamIds: context.teams.map((team) => team.id),
          ruleSet: context.ruleSet,
          homePlayers,
          awayPlayers,
          homeTacticalSetup: fixture.homeTeamId === context.team.id ? tactic : opponentTactic,
          awayTacticalSetup: fixture.awayTeamId === context.team.id ? tactic : opponentTactic,
          seed: `${save.randomSeed}:${fixture.id}`,
          save,
        },
        result,
      );
      return this.loadStateFromOpenDb(db, loadSave(db, save.id), databasePath);
    });
  }

  continueToNextFixture(saveId: EntityId): AppResult<DesktopApplicationState> {
    return this.withSave(saveId, (db, save, databasePath) => {
      const context = managerContext(db, save);
      const updated = continueToNextFixtureDate(save, context.fixtures, context.team.id);
      new SaveRepository(db).upsert(updated);
      new ManagerRepository(db).insertInboxItem({
        id: createEntityId(),
        createdOn: updated.worldDate,
        type: "FIXTURE_UPCOMING",
        title: "Continue stopped at next fixture",
        body: "Your next manager-controlled fixture is ready for selection.",
        relatedEntity: { type: "fixture", id: context.fixtures[0]!.id },
        read: false,
      });
      return this.loadStateFromOpenDb(db, updated, databasePath);
    });
  }

  private withSave<T>(
    saveId: EntityId,
    action: (db: GameDatabase, save: SaveMetadata, databasePath: string) => T,
  ): AppResult<T> {
    const listed = this.listSaves();
    if (!listed.ok) return listed;
    const item = listed.data.find((candidate) => candidate.saveId === saveId);
    if (!item) return fail("SAVE_MISSING", `Save ${saveId} was not found.`);
    try {
      const db = openGameDatabase(item.databasePath);
      try {
        migrateDatabase(db);
        const save = loadSave(db, saveId);
        return ok(action(db, save, item.databasePath));
      } finally {
        db.close();
      }
    } catch (error) {
      if (isAppError(error)) return fail(error.code, error.message, error.detail);
      return fail("DATABASE_UNAVAILABLE", "Save operation failed.", error);
    }
  }

  private loadStateFromOpenDb(
    db: GameDatabase,
    save: SaveMetadata,
    databasePath: string,
  ): DesktopApplicationState {
    const context = managerContext(db, save);
    const squad = squadReadModel(db, context.team.id, save.worldDate);
    const managers = new ManagerRepository(db);
    const tactics = managers.tacticalSetups(context.team.id);
    const fixtures = fixtureReadModels(db, context, save);
    return {
      save,
      saveListItem: this.saveListItem(db, save, databasePath),
      home: {
        save,
        manager: context.manager,
        managerName: context.managerPerson.displayName ?? context.managerPerson.fullName,
        contract: context.contract,
        clubName: context.club?.name,
        teamName: context.team.name,
        nextFixture: fixtures.find((fixture) => fixture.status === "scheduled"),
        previousResult: previousResultReadModel(db, context),
        inbox: managers.inboxItems(),
        unavailablePlayers: squad.filter((player) => player.availability !== "Available"),
        position: competitionPosition(db, context),
      },
      squad,
      tactics,
      activeTactic: tactics[0],
      fixtures,
      competition: competitionView(db, context),
    };
  }

  private saveListItem(db: GameDatabase, save: SaveMetadata, databasePath: string): SaveListItem {
    try {
      const context = managerContext(db, save);
      return {
        saveId: save.id,
        displayName: save.name,
        databasePath,
        createdAt: save.createdAt,
        lastPlayedAt: save.lastSavedAt,
        worldDate: save.worldDate,
        characterName: context.managerPerson.displayName ?? context.managerPerson.fullName,
        currentClub: context.club?.name,
        currentRole: context.contract?.jobTitle,
      };
    } catch {
      return {
        saveId: save.id,
        displayName: save.name,
        databasePath,
        createdAt: save.createdAt,
        lastPlayedAt: save.lastSavedAt,
        worldDate: save.worldDate,
      };
    }
  }
}

const seedTestingWorld = (db: GameDatabase): TestingWorld => {
  const worldRepo = new WorldRepository(db);
  const competitionRepo = new CompetitionRepository(db);
  const playerRepo = new PlayerRepository(db);
  const country: Country = {
    id: createStableEntityId("country", "stage-4-1-testing-np"),
    name: "Testing-only Nepal",
    isoCode: "NP",
  };
  const competition: Competition = {
    id: createStableEntityId("competition", "stage-4-1-testing-league"),
    name: "Testing-only Nepal League",
    scope: "domestic",
  };
  const season: CompetitionSeason = {
    id: createStableEntityId("competition-season", "stage-4-1-testing-league-2026"),
    competitionId: competition.id,
    name: "Testing-only Nepal League 2026",
    startDate: "2026-08-01",
    endDate: "2027-05-31",
  };
  const ruleSet: CompetitionRuleSet = {
    id: createStableEntityId("competition-rule", "stage-4-1-testing-league-2026"),
    competitionSeasonId: season.id,
    competitionType: "DOUBLE_ROUND_ROBIN",
    pointsForWin: 3,
    pointsForDraw: 1,
    pointsForLoss: 0,
    tiebreakers: ["points", "goalDifference", "goalsScored", "wins"],
    numberOfRounds: 2,
    homeAwayStructure: "double",
    seasonStartDate: season.startDate,
    seasonEndDate: season.endDate,
    roundSpacingDays: 7,
    promotionSlots: 0,
    relegationSlots: 1,
    continentalQualificationSlots: 1,
  };
  const clubs: Club[] = [
    "Kathmandu Testing Club",
    "Lalitpur Test XI",
    "Pokhara Sample Club",
    "Biratnagar Demo",
  ].map((name) => ({
    id: createStableEntityId("club", `stage-4-1:${name}`),
    name,
    countryId: country.id,
    ownershipType: "COMMUNITY",
  }));
  const teams: Team[] = clubs.map((club) => ({
    id: createStableEntityId("team", `stage-4-1:${club.name}:senior`),
    clubId: club.id,
    name: club.name,
    level: "senior",
    gender: "men",
  }));
  worldRepo.insertCountry(country);
  worldRepo.insertCompetition(competition);
  worldRepo.insertCompetitionSeason(season);
  competitionRepo.insertRuleSet(ruleSet);
  for (const club of clubs) worldRepo.insertClub(club);
  for (const team of teams) worldRepo.insertTeam(team);
  const peopleById = new Map<EntityId, Person>();
  const playersByTeam = new Map<EntityId, PlayerAttributeSet[]>();
  teams.forEach((team, teamIndex) => {
    const squad = createSquad(team.id, 9 + teamIndex * 2);
    playersByTeam.set(team.id, squad);
    squad.forEach((player, index) => {
      const person: Person = {
        id: player.personId,
        fullName: playerName(team.name, index),
        displayName: playerName(team.name, index).split(" ").slice(0, 2).join(" "),
        dateOfBirth: birthDate(index),
        nationalityCountryId: country.id,
        languages: ["ne"],
      };
      peopleById.set(person.id, person);
      worldRepo.insertPerson(person);
      worldRepo.insertPersonRole({
        id: createStableEntityId("role", `${person.id}:player`),
        personId: person.id,
        role: "PLAYER",
        activeFrom: season.startDate,
      });
      worldRepo.insertTeamPersonAssignment({
        id: createStableEntityId("team-person-assignment", `${team.id}:${person.id}`),
        personId: person.id,
        teamId: team.id,
        role: "PLAYER",
        startedOn: season.startDate,
      });
      playerRepo.insertAttributes(player);
      playerRepo.upsertAvailabilityState({
        personId: player.personId,
        teamId: team.id,
        fitness: 84 + (index % 5) * 2,
        moraleModifier: 0,
        formModifier: index % 3,
        availability: "AVAILABLE",
        updatedOn: season.startDate,
      });
    });
  });
  const fixtures = generateLeagueFixtures({
    competitionSeasonId: season.id,
    teamIds: teams.map((team) => team.id),
    ruleSet,
    seed: "stage-4-1-testing-fixtures",
  });
  fixtures.forEach((fixture) => competitionRepo.insertFixture(fixture));
  return {
    country,
    competition,
    season,
    ruleSet,
    clubs,
    teams,
    fixtures,
    playersByTeam,
    peopleById,
  };
};

const managerContext = (db: GameDatabase, save: SaveMetadata) => {
  if (!save.playerCharacterId) throw appError("SAVE_CORRUPTED", "Save has no player character.");
  const world = new WorldRepository(db);
  const managers = new ManagerRepository(db);
  const character = world.getCareerCharacter(save.playerCharacterId);
  if (!character) throw appError("SAVE_CORRUPTED", "Career character record is missing.");
  const manager = managers.getProfileByPerson(character.personId);
  if (!manager) throw appError("SAVE_CORRUPTED", "Manager profile record is missing.");
  const managerPerson = world.getPerson(character.personId);
  if (!managerPerson) throw appError("SAVE_CORRUPTED", "Manager person record is missing.");
  const contract = managers.activeContract(manager.id);
  if (!contract?.teamId) throw appError("SAVE_CORRUPTED", "Manager has no active team.");
  const team = getTeam(db, contract.teamId);
  const club = team.clubId ? getClub(db, team.clubId) : undefined;
  const season = firstSeason(db);
  const ruleSet = new CompetitionRepository(db).getRuleSet(season.id);
  if (!ruleSet) throw appError("SAVE_CORRUPTED", "Competition rule set is missing.");
  const teams = allTeams(db);
  const fixtures = new CompetitionRepository(db).fixtures(season.id);
  return {
    character,
    manager,
    managerPerson,
    contract,
    team,
    club,
    season,
    ruleSet,
    teams,
    fixtures,
  };
};

const squadReadModel = (db: GameDatabase, teamId: EntityId, worldDate: string): SquadRow[] => {
  const playerRepo = new PlayerRepository(db);
  const attributes = playerRepo.attributesForTeam(teamId);
  const states = new Map(
    playerRepo.availabilityStates(teamId).map((state) => [state.personId, state]),
  );
  const stats = seasonStatsForTeam(db, teamId);
  return attributes.map((player, index) => {
    const person = getPerson(db, player.personId);
    const availability = states.get(player.personId);
    const stat = stats.get(player.personId);
    const overall = playerOverall(player);
    return {
      personId: player.personId,
      name: person.displayName ?? person.fullName,
      age: person.dateOfBirth ? ageOn(person.dateOfBirth, worldDate) : undefined,
      nationality: "NEP",
      positions: [player.primaryPosition, ...player.secondaryPositions],
      preferredFoot: index % 3 === 0 ? "Left" : "Right",
      fitness: Math.round(availability?.fitness ?? 82),
      form: Math.round(availability?.formModifier ?? 0),
      morale: "Okay",
      overall,
      roleSuitability: roleSuitabilityLabel(overall),
      appearances: stat?.appearances ?? 0,
      goals: stat?.goals ?? 0,
      assists: stat?.assists ?? 0,
      averageRating: stat?.averageRating ?? 0,
      availability:
        availability?.availability === "INJURED"
          ? "Injured"
          : availability?.availability === "SUSPENDED"
            ? "Suspended"
            : "Available",
    };
  });
};

const fixtureReadModels = (
  db: GameDatabase,
  context: ReturnType<typeof managerContext>,
  save: SaveMetadata,
): FixtureReadModel[] =>
  context.fixtures
    .filter(
      (fixture) => fixture.homeTeamId === context.team.id || fixture.awayTeamId === context.team.id,
    )
    .map((fixture) => {
      const opponentId =
        fixture.homeTeamId === context.team.id ? fixture.awayTeamId : fixture.homeTeamId;
      const match = matchForFixture(db, fixture.id);
      return {
        id: fixture.id,
        date: fixture.scheduledDate,
        opponent: getTeam(db, opponentId).name,
        homeAway: fixture.homeTeamId === context.team.id ? ("home" as const) : ("away" as const),
        competition: context.season.name,
        status: fixture.status,
        score: match ? `${match.home_goals}-${match.away_goals}` : undefined,
      };
    })
    .filter((fixture) => fixture.status === "scheduled" || fixture.date <= save.worldDate);

const previousResultReadModel = (
  db: GameDatabase,
  context: ReturnType<typeof managerContext>,
): PostMatchReadModel | undefined => {
  const row = db
    .prepare(
      `SELECT m.* FROM matches m
      JOIN fixtures f ON f.id = m.fixture_id
      WHERE f.home_team_id = ? OR f.away_team_id = ?
      ORDER BY m.played_date DESC, m.id DESC LIMIT 1`,
    )
    .get(context.team.id, context.team.id) as any;
  return row ? postMatchReadModel(db, row.id) : undefined;
};

const postMatchReadModel = (db: GameDatabase, matchId: EntityId): PostMatchReadModel => {
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as any;
  const fixture = db.prepare("SELECT * FROM fixtures WHERE id = ?").get(match.fixture_id) as any;
  const events = db
    .prepare("SELECT * FROM match_events WHERE match_id = ? ORDER BY minute, id")
    .all(matchId)
    .map((row: any) => ({
      id: row.id,
      matchId: row.match_id,
      minute: row.minute ?? undefined,
      stoppageTime: row.stoppage_time ?? undefined,
      type: row.type,
      personId: row.person_id ?? undefined,
      teamId: row.team_id ?? undefined,
      primaryPersonId: row.primary_person_id ?? undefined,
      secondaryPersonId: row.secondary_person_id ?? undefined,
      data: row.data_json ? JSON.parse(row.data_json) : undefined,
    })) as MatchEvent[];
  const homeTeam = getTeam(db, fixture.home_team_id);
  const awayTeam = getTeam(db, fixture.away_team_id);
  const stats = teamStatsFromEvents(events, homeTeam.id, awayTeam.id);
  return {
    match: {
      id: match.id,
      fixtureId: match.fixture_id,
      playedDate: match.played_date ?? undefined,
      homeGoals: match.home_goals ?? undefined,
      awayGoals: match.away_goals ?? undefined,
    },
    homeTeam: homeTeam.name,
    awayTeam: awayTeam.name,
    events,
    score: `${match.home_goals}-${match.away_goals}`,
    homeStats: stats.homeStats,
    awayStats: stats.awayStats,
    playerRatings: [],
  };
};

const defaultSetup = (
  teamId: EntityId,
  players: readonly PlayerAttributeSet[],
  managerProfileId?: EntityId,
): TacticalSetup => {
  const formation = FORMATION_PRESETS[0]!;
  const setup = createTacticalSetup({
    teamId,
    managerProfileId,
    name: "Saved 4-3-3",
    formation,
    style: "BALANCED",
    assignments: formation.slots.map<TacticalAssignment>((slot, index) => ({
      slotId: slot.id,
      playerId: players[index]?.personId,
      roleId:
        slot.position === "GK"
          ? "GOALKEEPER"
          : slot.zone === "forward"
            ? "PRESSING_FORWARD"
            : slot.zone === "defense"
              ? "BALL_PLAYING_DEFENDER"
              : "CENTRAL_MIDFIELDER",
    })),
    bench: players.slice(11, 18).map((player) => player.personId),
  });
  return {
    ...setup,
    instructions: TACTICAL_STYLE_PRESETS.BALANCED,
    setPieces: {
      penaltyTaker: players[10]?.personId,
      directFreeKickTaker: players[7]?.personId,
      leftCornerTaker: players[9]?.personId,
      rightCornerTaker: players[8]?.personId,
    },
  };
};

const competitionView = (
  db: GameDatabase,
  context: ReturnType<typeof managerContext>,
): CompetitionView => {
  const standings = new CompetitionRepository(db).standings(context.season.id);
  return {
    name: context.season.name,
    table: (standings.length
      ? standings
      : context.teams.map((team) => ({
          competitionSeasonId: context.season.id,
          teamId: team.id,
          played: 0,
          won: 0,
          drawn: 0,
          lost: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDifference: 0,
          points: 0,
        }))
    ).map((standing) => ({
      teamId: standing.teamId,
      teamName: getTeam(db, standing.teamId).name,
      played: standing.played,
      goalDifference: standing.goalDifference,
      points: standing.points,
    })),
  };
};

const competitionPosition = (
  db: GameDatabase,
  context: ReturnType<typeof managerContext>,
): string | undefined => {
  const table = competitionView(db, context).table;
  const index = table.findIndex((row) => row.teamId === context.team.id);
  return index >= 0 ? String(index + 1) : undefined;
};

const createSquad = (teamId: EntityId, baseAbility: number): PlayerAttributeSet[] => {
  const positions: PlayerPosition[] = [
    "GK",
    "RB",
    "CB",
    "CB",
    "LB",
    "CM",
    "CM",
    "AM",
    "RW",
    "LW",
    "ST",
    "GK",
    "CB",
    "CM",
    "RW",
    "ST",
    "LB",
    "CM",
  ];
  return positions.map((position, index) => createPlayer(teamId, position, index, baseAbility));
};

const createPlayer = (
  teamId: EntityId,
  position: PlayerPosition,
  index: number,
  baseAbility: number,
): PlayerAttributeSet => {
  const rating = (delta = 0) =>
    Math.max(1, Math.min(20, Math.round(baseAbility + (index % 4) - 1 + delta)));
  return {
    id: createStableEntityId("player-attribute", `stage-4-1:${teamId}:${index}`),
    personId: createStableEntityId("person", `stage-4-1:${teamId}:${index}`),
    primaryPosition: position,
    secondaryPositions: position === "CB" ? ["LB", "RB"] : position === "CM" ? ["DM", "AM"] : [],
    technical: {
      firstTouch: rating(),
      passing: rating(position === "CM" || position === "AM" ? 2 : 0),
      crossing: rating(position === "RW" || position === "LW" ? 2 : 0),
      dribbling: rating(position === "RW" || position === "LW" || position === "AM" ? 2 : 0),
      finishing: rating(position === "ST" ? 3 : -1),
      heading: rating(position === "CB" || position === "ST" ? 2 : 0),
      tackling: rating(["CB", "RB", "LB", "CM"].includes(position) ? 2 : -1),
      technique: rating(),
      longShots: rating(),
      setPieces: rating(index === 7 ? 2 : 0),
    },
    mental: {
      decisions: rating(),
      vision: rating(position === "AM" || position === "CM" ? 2 : 0),
      composure: rating(),
      positioning: rating(),
      anticipation: rating(),
      workRate: rating(),
      teamwork: rating(),
      leadership: rating(index === 5 ? 2 : 0),
      aggression: rating(),
      determination: rating(),
      professionalism: rating(),
    },
    physical: {
      pace: rating(position === "RW" || position === "LW" ? 2 : 0),
      acceleration: rating(),
      strength: rating(position === "CB" || position === "ST" ? 2 : 0),
      stamina: rating(),
      agility: rating(),
      balance: rating(),
      jumping: rating(position === "CB" || position === "ST" ? 2 : 0),
      naturalFitness: rating(),
    },
    goalkeeping: {
      handling: rating(position === "GK" ? 4 : -6),
      reflexes: rating(position === "GK" ? 4 : -6),
      oneOnOnes: rating(position === "GK" ? 4 : -6),
      aerialReach: rating(position === "GK" ? 4 : -6),
      kicking: rating(position === "GK" ? 2 : -6),
      distribution: rating(position === "GK" ? 2 : -6),
      commandOfArea: rating(position === "GK" ? 4 : -6),
    },
  };
};

const getTeam = (db: GameDatabase, id: EntityId): Team => {
  const row = db.prepare("SELECT * FROM teams WHERE id = ?").get(id) as any;
  if (!row) throw appError("SAVE_CORRUPTED", `Team ${id} is missing.`);
  return {
    id: row.id,
    clubId: row.club_id ?? undefined,
    federationId: row.federation_id ?? undefined,
    name: row.name,
    level: row.level,
    gender: row.gender,
  };
};

const getClub = (db: GameDatabase, id: EntityId): Club => {
  const row = db.prepare("SELECT * FROM clubs WHERE id = ?").get(id) as any;
  if (!row) throw appError("SAVE_CORRUPTED", `Club ${id} is missing.`);
  return {
    id: row.id,
    name: row.name,
    countryId: row.country_id,
    locationId: row.location_id ?? undefined,
    ownershipType: row.ownership_type,
    foundedYear: row.founded_year ?? undefined,
  };
};

const getPerson = (db: GameDatabase, id: EntityId): Person => {
  const person = new WorldRepository(db).getPerson(id);
  if (!person) throw appError("PLAYER_MISSING", `Person ${id} is missing.`);
  return person;
};

const allTeams = (db: GameDatabase): Team[] =>
  db
    .prepare("SELECT * FROM teams ORDER BY name")
    .all()
    .map((row: any) => ({
      id: row.id,
      clubId: row.club_id ?? undefined,
      federationId: row.federation_id ?? undefined,
      name: row.name,
      level: row.level,
      gender: row.gender,
    }));

const firstSeason = (db: GameDatabase): CompetitionSeason => {
  const row = db
    .prepare("SELECT * FROM competition_seasons ORDER BY start_date LIMIT 1")
    .get() as any;
  if (!row) throw appError("SAVE_CORRUPTED", "No competition season exists.");
  return {
    id: row.id,
    competitionId: row.competition_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
  };
};

const matchForFixture = (db: GameDatabase, fixtureId: EntityId): any =>
  db.prepare("SELECT * FROM matches WHERE fixture_id = ? LIMIT 1").get(fixtureId);

const seasonStatsForTeam = (db: GameDatabase, teamId: EntityId): Map<EntityId, any> =>
  new Map(
    (db.prepare("SELECT * FROM player_season_stats WHERE team_id = ?").all(teamId) as any[]).map(
      (row) => [
        row.person_id,
        {
          appearances: row.appearances,
          goals: row.goals,
          assists: row.assists,
          averageRating: row.average_rating,
          minutes: row.minutes,
          yellowCards: row.yellow_cards,
          redCards: row.red_cards,
        },
      ],
    ),
  );

const teamStatsFromEvents = (
  events: readonly MatchEvent[],
  homeTeamId: EntityId,
  awayTeamId: EntityId,
): Pick<PostMatchReadModel, "homeStats" | "awayStats"> => {
  const stats = (teamId: EntityId) => ({
    teamId,
    possession: 50,
    shots: events.filter((event) => event.teamId === teamId && event.type === "SHOT").length,
    shotsOnTarget: events.filter(
      (event) => event.teamId === teamId && event.type === "SHOT_ON_TARGET",
    ).length,
    xg:
      Math.round(
        events
          .filter((event) => event.teamId === teamId && event.type === "SHOT")
          .reduce((total, event) => total + Number(event.data?.xg ?? 0), 0) * 100,
      ) / 100,
    corners: events.filter((event) => event.teamId === teamId && event.type === "CORNER").length,
    fouls: events.filter((event) => event.teamId === teamId && event.type === "FOUL").length,
    yellowCards: events.filter((event) => event.teamId === teamId && event.type === "YELLOW_CARD")
      .length,
    redCards: events.filter((event) => event.teamId === teamId && event.type === "RED_CARD").length,
  });
  return { homeStats: stats(homeTeamId), awayStats: stats(awayTeamId) };
};

const playerOverall = (player: PlayerAttributeSet): number => {
  const values = [
    ...Object.values(player.technical),
    ...Object.values(player.mental),
    ...Object.values(player.physical),
  ];
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
};

const roleSuitabilityLabel = (overall: number): string => {
  if (overall >= 15) return "Very Good";
  if (overall >= 12) return "Good";
  if (overall >= 9) return "Adequate";
  return "Weak";
};

const playerName = (teamName: string, index: number): string =>
  `${["Kiran", "Suman", "Anil", "Bikash", "Nabin", "Rohit", "Aakash", "Sanjay", "Prakash", "Milan", "Dinesh", "Ramesh", "Ashim", "Manish", "Sagar", "Bimal", "Hari", "Deepak"][index]} ${teamName.split(" ")[0]}`;

const birthDate = (index: number): string =>
  `${1992 + (index % 12)}-${String((index % 9) + 1).padStart(2, "0")}-12`;

const ageOn = (dateOfBirth: string, onDate: string): number => {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  const date = new Date(`${onDate}T00:00:00Z`);
  let age = date.getUTCFullYear() - birth.getUTCFullYear();
  if (
    date.getUTCMonth() < birth.getUTCMonth() ||
    (date.getUTCMonth() === birth.getUTCMonth() && date.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
};

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "save";

const today = (): string => new Date().toISOString().slice(0, 10);

const ok = <T>(data: T): AppResult<T> => ({ ok: true, data });

const fail = (
  code: DesktopAppError["code"],
  message: string,
  error?: unknown,
): AppResult<never> => ({
  ok: false,
  error: {
    code,
    message,
    detail: error instanceof Error ? error.message : typeof error === "string" ? error : undefined,
  },
});

const appError = (
  code: DesktopAppError["code"],
  message: string,
  detail?: string,
): DesktopAppError => ({ code, message, detail });

const isAppError = (error: unknown): error is DesktopAppError =>
  typeof error === "object" && error !== null && "code" in error && "message" in error;
