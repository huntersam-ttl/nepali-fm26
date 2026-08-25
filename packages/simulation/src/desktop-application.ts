import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
  type AppResult,
  type CareerCreationCommand,
  type CareerHeader,
  type Club,
  type CompetitionRuleSet,
  type CompetitionSeason,
  type CompetitionView,
  type DesktopAppError,
  type DesktopApplicationState,
  type DesktopErrorCode,
  type EntityId,
  type FixtureReadModel,
  type MatchEvent,
  type Person,
  type PlayerAttributeSet,
  type PostMatchReadModel,
  type SaveCatalogEntry,
  type SaveMetadata,
  type SquadRow,
  type StartingClubOption,
  type TacticalAssignment,
  type TacticalSetup,
  type Team,
} from "@nepal-football-sim/shared-types";
import { validateNepalWorldDataset, type NepalWorldDataset } from "@nepal-football-sim/data-import";
import { generateLeagueFixtures } from "./fixture-generation.js";
import { importNepalWorld } from "./nepal-save.js";
import { createCareerCharacter, createManagerContract, testLicence } from "./manager-career.js";
import {
  continueToNextFixtureDate,
  nextFixtureForTeam,
  persistQuickSimResult,
  quickSimManagerMatch,
} from "./manager-flow.js";
import { FORMATION_PRESETS, TACTICAL_STYLE_PRESETS, createTacticalSetup } from "./tactics.js";

export type { DesktopAppError, AppResult };

export const GAME_VERSION = "0.2.0";

/** A starting club must be able to field a legal XI plus cover. */
const MINIMUM_STARTING_SQUAD = 14;

export type DesktopRuntimeOptions = {
  savesDirectory: string;
  worldDatasetPath: string;
  gameVersion?: string;
};

/** Raw sqlite row. Column access is unchecked, exactly as in the repositories. */
type SqlRow = Record<string, any>;

type CareerSession = {
  saveId: EntityId;
  filePath: string;
  db: GameDatabase;
};

type ManagerContext = ReturnType<typeof managerContext>;

/**
 * Authoritative desktop runtime. Owns the SQLite career session and is the only
 * place that turns UI commands into simulation + repository work.
 */
export class DesktopApplicationService {
  private readonly savesDirectory: string;
  private readonly worldDatasetPath: string;
  private readonly gameVersion: string;
  private dataset?: NepalWorldDataset;
  private session?: CareerSession;

  constructor(options: DesktopRuntimeOptions) {
    this.savesDirectory = options.savesDirectory;
    this.worldDatasetPath = options.worldDatasetPath;
    this.gameVersion = options.gameVersion ?? GAME_VERSION;
  }

  listSaves(): AppResult<SaveCatalogEntry[]> {
    try {
      mkdirSync(this.savesDirectory, { recursive: true });
      const entries = readdirSync(this.savesDirectory)
        .filter((file) => file.endsWith(".sqlite"))
        .flatMap((file) => {
          const entry = this.readCatalogEntry(join(this.savesDirectory, file));
          return entry ? [entry] : [];
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return ok(entries);
    } catch (error) {
      return fail("DATABASE_ERROR", "Could not list saves.", error);
    }
  }

  listStartingClubs(): AppResult<StartingClubOption[]> {
    try {
      return ok(startingClubOptions(this.worldDataset()));
    } catch (error) {
      return fail("WORLD_DATA_UNAVAILABLE", "Could not read the Nepal world dataset.", error);
    }
  }

  createCareer(command: CareerCreationCommand): AppResult<DesktopApplicationState> {
    let filePath: string;
    let dataset: NepalWorldDataset;
    try {
      dataset = this.worldDataset();
    } catch (error) {
      return fail("WORLD_DATA_UNAVAILABLE", "Could not read the Nepal world dataset.", error);
    }

    const options = startingClubOptions(dataset);
    const target = command.joinTeamId
      ? options.find((option) => option.teamId === command.joinTeamId)
      : options[0];
    if (!target) {
      return fail(
        "INVALID_SELECTION",
        "The selected starting club is not a playable Nepal club in this world.",
      );
    }

    try {
      mkdirSync(this.savesDirectory, { recursive: true });
      filePath = join(
        this.savesDirectory,
        `${slug(command.saveName)}-${Date.now().toString(36)}.sqlite`,
      );
    } catch (error) {
      return fail("DATABASE_ERROR", "Could not prepare the saves directory.", error);
    }

    this.closeSession();
    let db: GameDatabase | undefined;
    try {
      db = openGameDatabase(filePath);
      migrateDatabase(db);
      db.exec("BEGIN;");
      try {
        importNepalWorld(db, dataset);
        const season = seasonForTeam(db, target.teamId);
        const ruleSet = new CompetitionRepository(db).getRuleSet(season.id);
        if (!ruleSet) {
          throw appError("SAVE_CORRUPT", `Competition ${season.name} has no rule set.`);
        }
        scheduleSeasonFixtures(db, season, ruleSet);

        const careerStartDate = command.character.careerStartDate ?? season.startDate;
        const country = firstCountry(db);
        const career = createCareerCharacter({
          ...command.character,
          footballBackground: command.character.footballBackground as never,
          education: command.character.education as never,
          playingExperience: command.character.playingExperience as never,
          coachingExperience: command.character.coachingExperience as never,
          businessBackground: command.character.businessBackground as never,
          startingReputationProfile: command.character.startingReputationProfile as never,
          nationalityCountryId: country.id,
          coachingLicences: [testLicence("AFC C Licence")],
          careerStartDate,
        });

        createNewSave(db, {
          name: command.saveName,
          worldDate: careerStartDate,
          gameVersion: this.gameVersion,
          randomSeed: `desktop:${command.saveName}:${career.person.id}`,
          playerCharacterId: career.character.id,
        });

        const world = new WorldRepository(db);
        const managers = new ManagerRepository(db);
        world.insertPerson(career.person);
        world.insertPersonRole(career.managerRole);
        world.insertCareerCharacter(career.character);
        managers.insertProfile(career.managerProfile);

        const team = getTeam(db, target.teamId);
        managers.insertContract(
          createManagerContract({
            managerProfileId: career.managerProfile.id,
            personId: career.person.id,
            teamId: team.id,
            clubId: team.clubId,
            contractStart: careerStartDate,
            contractEnd: ruleSet.seasonEndDate,
            salaryAmountMinor: 9_000_000,
          }),
        );
        const players = new PlayerRepository(db).attributesForTeam(team.id);
        managers.insertTacticalSetup(defaultSetup(team.id, players, career.managerProfile.id));
        managers.insertInboxItem({
          id: createEntityId(),
          createdOn: careerStartDate,
          type: "FIXTURE_UPCOMING",
          title: `Welcome to ${target.clubName}`,
          body: `You have taken charge of ${target.teamName} in the ${target.competitionName}.`,
          relatedEntity: { type: "team", id: team.id },
          read: false,
        });
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }

      const opened = loadSave(db);
      this.session = { saveId: opened.id, filePath, db };
      const state = this.buildState(db, opened, filePath);
      this.writeCatalogEntry(state.catalogEntry);
      return ok(state);
    } catch (error) {
      db?.close();
      discardFile(filePath);
      if (isAppError(error)) return fail(error.code, error.message, error.detail);
      return fail("CAREER_CREATION_FAILED", "Could not create the career save.", error);
    }
  }

  loadCareer(saveId: EntityId): AppResult<DesktopApplicationState> {
    const listed = this.listSaves();
    if (!listed.ok) return listed;
    const entry = listed.data.find((candidate) => candidate.saveId === saveId);
    if (!entry) return fail("SAVE_NOT_FOUND", `Save ${saveId} was not found.`);
    return this.loadCareerByPath(entry.filePath);
  }

  loadCareerByPath(filePath: string): AppResult<DesktopApplicationState> {
    this.closeSession();
    let db: GameDatabase | undefined;
    try {
      db = openGameDatabase(filePath);
      migrateDatabase(db);
      const save = loadSave(db);
      this.session = { saveId: save.id, filePath, db };
      const state = this.buildState(db, save, filePath);
      this.writeCatalogEntry(state.catalogEntry);
      return ok(state);
    } catch (error) {
      db?.close();
      this.session = undefined;
      if (isAppError(error)) return fail(error.code, error.message, error.detail);
      return fail("SAVE_CORRUPT", "Could not load the save.", error);
    }
  }

  closeCareer(): AppResult<{ closed: boolean }> {
    const wasOpen = this.session !== undefined;
    try {
      if (this.session) {
        const { db, filePath } = this.session;
        const save = new SaveRepository(db).get(this.session.saveId);
        if (save) this.writeCatalogEntry(this.catalogEntry(db, save, filePath));
      }
    } catch {
      // Metadata refresh is best-effort; closing the handle still has to happen.
    }
    this.closeSession();
    return ok({ closed: wasOpen });
  }

  getCareerHeader(): AppResult<CareerHeader> {
    return this.withSession((db, save) => careerHeader(db, save));
  }

  getHomeDashboard(): AppResult<DesktopApplicationState> {
    return this.withSession((db, save, filePath) => this.buildState(db, save, filePath));
  }

  saveTactic(tactic: TacticalSetup): AppResult<TacticalSetup> {
    return this.withSession((db) => {
      new ManagerRepository(db).insertTacticalSetup({ ...tactic, updatedOn: today() });
      return tactic;
    });
  }

  quickSimMatch(fixtureId?: EntityId): AppResult<DesktopApplicationState> {
    return this.withSession((db, save, filePath) => {
      const context = managerContext(db, save);
      const fixture = fixtureId
        ? context.fixtures.find((candidate) => candidate.id === fixtureId)
        : context.fixtures.find(
            (candidate) =>
              candidate.status === "scheduled" &&
              (candidate.homeTeamId === context.team.id ||
                candidate.awayTeamId === context.team.id),
          );
      if (!fixture) {
        throw appError("FIXTURE_MISSING", "No upcoming fixture is available.");
      }
      const players = new PlayerRepository(db);
      const homePlayers = players.attributesForTeam(fixture.homeTeamId);
      const awayPlayers = players.attributesForTeam(fixture.awayTeamId);
      const managers = new ManagerRepository(db);
      const tactic = managers.tacticalSetups(context.team.id)[0];
      if (!tactic) {
        throw appError("INVALID_SELECTION", "No saved tactic exists for your team.");
      }
      const managerIsHome = fixture.homeTeamId === context.team.id;
      const opponentTactic = defaultSetup(
        managerIsHome ? fixture.awayTeamId : fixture.homeTeamId,
        managerIsHome ? awayPlayers : homePlayers,
      );
      const input = {
        fixture,
        competitionTeamIds: context.teams.map((team) => team.id),
        ruleSet: context.ruleSet,
        homePlayers,
        awayPlayers,
        homeTacticalSetup: managerIsHome ? tactic : opponentTactic,
        awayTacticalSetup: managerIsHome ? opponentTactic : tactic,
        seed: `${save.randomSeed}:${fixture.id}`,
        save,
      };
      const result = quickSimManagerMatch(input);
      db.exec("BEGIN;");
      try {
        persistQuickSimResult(db, input, result);
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
      const state = this.buildState(db, loadSave(db, save.id), filePath);
      this.writeCatalogEntry(state.catalogEntry);
      return state;
    });
  }

  continueCareer(): AppResult<DesktopApplicationState> {
    return this.withSession((db, save, filePath) => {
      const context = managerContext(db, save);
      if (!nextFixtureForTeam(context.fixtures, context.team.id, save.worldDate)) {
        throw appError("FIXTURE_MISSING", "There is no further fixture to advance to.");
      }
      const updated = continueToNextFixtureDate(save, context.fixtures, context.team.id);
      db.exec("BEGIN;");
      try {
        new SaveRepository(db).upsert(updated);
        new ManagerRepository(db).insertInboxItem({
          id: createEntityId(),
          createdOn: updated.worldDate,
          type: "FIXTURE_UPCOMING",
          title: "Next fixture reached",
          body: "Your next fixture is ready for team selection.",
          relatedEntity: { type: "team", id: context.team.id },
          read: false,
        });
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
      const state = this.buildState(db, updated, filePath);
      this.writeCatalogEntry(state.catalogEntry);
      return state;
    });
  }

  /**
   * Explicit checkpoint: stamp lastSavedAt, force a WAL checkpoint so the .sqlite
   * file alone is complete, and refresh the catalog entry.
   */
  saveCareer(): AppResult<SaveCatalogEntry> {
    return this.withSession((db, save, filePath) => {
      const stamped = { ...save, lastSavedAt: new Date().toISOString() };
      new SaveRepository(db).upsert(stamped);
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      const entry = this.catalogEntry(db, stamped, filePath);
      this.writeCatalogEntry(entry);
      return entry;
    });
  }

  deleteSave(saveId: EntityId): AppResult<{ deleted: boolean }> {
    const listed = this.listSaves();
    if (!listed.ok) return listed;
    const entry = listed.data.find((candidate) => candidate.saveId === saveId);
    if (!entry) return fail("SAVE_NOT_FOUND", `Save ${saveId} was not found.`);
    if (this.session?.saveId === saveId) this.closeSession();
    try {
      discardFile(entry.filePath);
      return ok({ deleted: true });
    } catch (error) {
      return fail("DATABASE_ERROR", "Could not delete the save.", error);
    }
  }

  private withSession<T>(
    action: (db: GameDatabase, save: SaveMetadata, filePath: string) => T,
  ): AppResult<T> {
    const session = this.session;
    if (!session) return fail("SESSION_NOT_OPEN", "No career is currently open.");
    try {
      const save = loadSave(session.db, session.saveId);
      return ok(action(session.db, save, session.filePath));
    } catch (error) {
      if (isAppError(error)) return fail(error.code, error.message, error.detail);
      return fail("SIMULATION_ERROR", "The career command failed.", error);
    }
  }

  private closeSession(): void {
    if (!this.session) return;
    try {
      this.session.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // A checkpoint failure must not prevent releasing the handle.
    }
    try {
      this.session.db.close();
    } finally {
      this.session = undefined;
    }
  }

  private worldDataset(): NepalWorldDataset {
    if (!this.dataset) {
      const raw = JSON.parse(readFileSync(this.worldDatasetPath, "utf8")) as unknown;
      this.dataset = validateNepalWorldDataset(raw);
    }
    return this.dataset;
  }

  private buildState(
    db: GameDatabase,
    save: SaveMetadata,
    filePath: string,
  ): DesktopApplicationState {
    const context = managerContext(db, save);
    const squad = squadReadModel(db, context.team.id, save.worldDate);
    const managers = new ManagerRepository(db);
    const tactics = managers.tacticalSetups(context.team.id);
    const fixtures = fixtureReadModels(db, context, save);
    return {
      save,
      header: careerHeaderFromContext(save, context),
      catalogEntry: this.catalogEntry(db, save, filePath),
      home: {
        save,
        manager: context.manager,
        managerName: displayName(context.managerPerson),
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

  private catalogEntry(db: GameDatabase, save: SaveMetadata, filePath: string): SaveCatalogEntry {
    const base: SaveCatalogEntry = {
      saveId: save.id,
      saveName: save.name,
      filePath,
      createdAt: save.createdAt,
      updatedAt: save.lastSavedAt,
      worldDate: save.worldDate,
      gameVersion: save.gameVersion,
      schemaVersion: save.databaseVersion,
    };
    try {
      const context = managerContext(db, save);
      return {
        ...base,
        characterName: displayName(context.managerPerson),
        activeRole: "MANAGER",
        organisation: context.club?.name ?? context.team.name,
      };
    } catch {
      return base;
    }
  }

  private catalogPath(filePath: string): string {
    return join(dirname(filePath), `${basename(filePath, ".sqlite")}.meta.json`);
  }

  private writeCatalogEntry(entry: SaveCatalogEntry): void {
    try {
      writeFileSync(this.catalogPath(entry.filePath), JSON.stringify(entry, null, 2));
    } catch {
      // The sqlite file stays authoritative; the sidecar is only a listing cache.
    }
  }

  /**
   * Reads the sidecar first so the main menu does not have to open every world.
   * Falls back to the save file itself when the sidecar is missing or stale.
   */
  private readCatalogEntry(filePath: string): SaveCatalogEntry | undefined {
    try {
      const raw = readFileSync(this.catalogPath(filePath), "utf8");
      const parsed = JSON.parse(raw) as SaveCatalogEntry;
      if (parsed.saveId && parsed.worldDate) return { ...parsed, filePath };
    } catch {
      // Fall through to reading the save file.
    }
    if (this.session?.filePath === filePath) {
      const save = new SaveRepository(this.session.db).first();
      return save ? this.catalogEntry(this.session.db, save, filePath) : undefined;
    }
    let db: GameDatabase | undefined;
    try {
      db = openGameDatabase(filePath);
      migrateDatabase(db);
      const save = new SaveRepository(db).first();
      if (!save) return undefined;
      const entry = this.catalogEntry(db, save, filePath);
      this.writeCatalogEntry(entry);
      return entry;
    } catch {
      return undefined;
    } finally {
      db?.close();
    }
  }
}

const startingClubOptions = (dataset: NepalWorldDataset): StartingClubOption[] => {
  const squadSizes = new Map<string, number>();
  for (const assignment of dataset.teamPersonAssignments) {
    if (assignment.role !== "PLAYER") continue;
    squadSizes.set(assignment.teamKey, (squadSizes.get(assignment.teamKey) ?? 0) + 1);
  }
  const competitionNames = new Map(
    dataset.competitions.map((competition) => [competition.key, competition.name]),
  );
  const clubNames = new Map(dataset.clubs.map((club) => [club.key, club.name]));
  const membershipByTeam = new Map<string, string>();
  for (const membership of dataset.clubMemberships ?? []) {
    const teamKey = membership.teamKey?.value;
    if (teamKey) membershipByTeam.set(teamKey, membership.competitionKey);
  }

  return dataset.teams
    .filter((team) => (squadSizes.get(team.key) ?? 0) >= MINIMUM_STARTING_SQUAD)
    .map((team) => {
      const clubKey = team.clubKey?.value;
      const competitionKey = membershipByTeam.get(team.key);
      return {
        teamId: createStableEntityId("team", team.key),
        clubId: clubKey ? createStableEntityId("club", clubKey) : undefined,
        clubName: (clubKey ? clubNames.get(clubKey) : undefined) ?? team.name,
        teamName: team.name,
        competitionName:
          (competitionKey ? competitionNames.get(competitionKey) : undefined) ?? "Nepal football",
        squadSize: squadSizes.get(team.key) ?? 0,
      };
    })
    .sort((a, b) => a.clubName.localeCompare(b.clubName));
};

const scheduleSeasonFixtures = (
  db: GameDatabase,
  season: CompetitionSeason,
  ruleSet: CompetitionRuleSet,
): void => {
  const competitions = new CompetitionRepository(db);
  if (competitions.fixtures(season.id).length > 0) return;
  const teams = new WorldRepository(db).teamsForCompetitionSeason(season.id);
  const fixtures = generateLeagueFixtures({
    competitionSeasonId: season.id,
    teamIds: teams.map((team) => team.id),
    // The career opens on the season start date; matchday one follows a week later
    // so preseason has a day to advance from.
    ruleSet: {
      ...ruleSet,
      seasonStartDate: addDays(ruleSet.seasonStartDate, ruleSet.roundSpacingDays),
    },
    seed: `nepal:${season.id}`,
  });
  for (const fixture of fixtures) competitions.insertFixture(fixture);
};

const seasonForTeam = (db: GameDatabase, teamId: EntityId): CompetitionSeason => {
  const row = db
    .prepare(
      `SELECT cs.* FROM club_memberships cm
      JOIN competition_seasons cs ON cs.id = cm.competition_season_id
      WHERE cm.team_id = ? AND cm.status = 'ACTIVE'
      ORDER BY cs.start_date LIMIT 1`,
    )
    .get(teamId) as Record<string, string> | undefined;
  if (!row) {
    throw appError("SAVE_CORRUPT", "The selected team has no active competition membership.");
  }
  return {
    id: row.id as EntityId,
    competitionId: row.competition_id as EntityId,
    name: row.name!,
    startDate: row.start_date!,
    endDate: row.end_date!,
  };
};

const managerContext = (db: GameDatabase, save: SaveMetadata) => {
  if (!save.playerCharacterId) throw appError("SAVE_CORRUPT", "Save has no player character.");
  const world = new WorldRepository(db);
  const managers = new ManagerRepository(db);
  const character = world.getCareerCharacter(save.playerCharacterId);
  if (!character) throw appError("SAVE_CORRUPT", "Career character record is missing.");
  const manager = managers.getProfileByPerson(character.personId);
  if (!manager) throw appError("SAVE_CORRUPT", "Manager profile record is missing.");
  const managerPerson = world.getPerson(character.personId);
  if (!managerPerson) throw appError("SAVE_CORRUPT", "Manager person record is missing.");
  const contract = managers.activeContract(manager.id);
  if (!contract?.teamId) throw appError("SAVE_CORRUPT", "Manager has no active team.");
  const team = getTeam(db, contract.teamId);
  const club = team.clubId ? getClub(db, team.clubId) : undefined;
  const season = seasonForTeam(db, team.id);
  const ruleSet = new CompetitionRepository(db).getRuleSet(season.id);
  if (!ruleSet) throw appError("SAVE_CORRUPT", "Competition rule set is missing.");
  const teams = world.teamsForCompetitionSeason(season.id);
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

const careerHeader = (db: GameDatabase, save: SaveMetadata): CareerHeader =>
  careerHeaderFromContext(save, managerContext(db, save));

const careerHeaderFromContext = (save: SaveMetadata, context: ManagerContext): CareerHeader => ({
  saveId: save.id,
  saveName: save.name,
  worldDate: save.worldDate,
  characterName: displayName(context.managerPerson),
  activeRole: "MANAGER",
  clubName: context.club?.name,
  teamName: context.team.name,
  competitionName: context.season.name,
});

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
      name: displayName(person),
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
  context: ManagerContext,
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
  context: ManagerContext,
): PostMatchReadModel | undefined => {
  const row = db
    .prepare(
      `SELECT m.id FROM matches m
      JOIN fixtures f ON f.id = m.fixture_id
      WHERE f.home_team_id = ? OR f.away_team_id = ?
      ORDER BY m.played_date DESC, m.id DESC LIMIT 1`,
    )
    .get(context.team.id, context.team.id) as { id: EntityId } | undefined;
  return row ? postMatchReadModel(db, row.id) : undefined;
};

const postMatchReadModel = (db: GameDatabase, matchId: EntityId): PostMatchReadModel => {
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as Record<
    string,
    never
  >;
  const fixture = db.prepare("SELECT * FROM fixtures WHERE id = ?").get(match.fixture_id) as SqlRow;
  const events = db
    .prepare("SELECT * FROM match_events WHERE match_id = ? ORDER BY minute, id")
    .all(matchId)
    .map((row: SqlRow) => ({
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
    })) as unknown as MatchEvent[];
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
    name: "4-3-3",
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

const competitionView = (db: GameDatabase, context: ManagerContext): CompetitionView => {
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

const competitionPosition = (db: GameDatabase, context: ManagerContext): string | undefined => {
  const table = competitionView(db, context).table;
  const index = table.findIndex((row) => row.teamId === context.team.id);
  return index >= 0 ? String(index + 1) : undefined;
};

const getTeam = (db: GameDatabase, id: EntityId): Team => {
  const row = db.prepare("SELECT * FROM teams WHERE id = ?").get(id) as SqlRow | undefined;
  if (!row) throw appError("SAVE_CORRUPT", `Team ${id} is missing.`);
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
  const row = db.prepare("SELECT * FROM clubs WHERE id = ?").get(id) as SqlRow | undefined;
  if (!row) throw appError("SAVE_CORRUPT", `Club ${id} is missing.`);
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

const firstCountry = (db: GameDatabase): { id: EntityId } => {
  const row = db.prepare("SELECT id FROM countries ORDER BY name LIMIT 1").get() as
    { id: EntityId } | undefined;
  if (!row) throw appError("SAVE_CORRUPT", "The world has no country records.");
  return row;
};

const matchForFixture = (db: GameDatabase, fixtureId: EntityId): SqlRow | undefined =>
  db.prepare("SELECT * FROM matches WHERE fixture_id = ? LIMIT 1").get(fixtureId) as
    SqlRow | undefined;

type SeasonStat = {
  appearances: number;
  goals: number;
  assists: number;
  averageRating: number;
  minutes: number;
  yellowCards: number;
  redCards: number;
};

const seasonStatsForTeam = (db: GameDatabase, teamId: EntityId): Map<EntityId, SeasonStat> =>
  new Map(
    (
      db.prepare("SELECT * FROM player_season_stats WHERE team_id = ?").all(teamId) as Array<SqlRow>
    ).map((row) => [
      row.person_id as EntityId,
      {
        appearances: row.appearances,
        goals: row.goals,
        assists: row.assists,
        averageRating: row.average_rating,
        minutes: row.minutes,
        yellowCards: row.yellow_cards,
        redCards: row.red_cards,
      },
    ]),
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

const displayName = (person: Person): string => person.displayName ?? person.fullName;

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

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const discardFile = (filePath: string): void => {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${filePath}${suffix}`, { force: true });
  }
  const meta = join(dirname(filePath), `${basename(filePath, ".sqlite")}.meta.json`);
  if (existsSync(meta)) rmSync(meta, { force: true });
};

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "save";

const today = (): string => new Date().toISOString().slice(0, 10);

const ok = <T>(data: T): AppResult<T> => ({ ok: true, data });

const fail = (code: DesktopErrorCode, message: string, error?: unknown): AppResult<never> => ({
  ok: false,
  error: {
    code,
    message,
    detail: error instanceof Error ? error.message : typeof error === "string" ? error : undefined,
  },
});

const appError = (code: DesktopErrorCode, message: string, detail?: string): DesktopAppError => ({
  code,
  message,
  detail,
});

const isAppError = (error: unknown): error is DesktopAppError =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof (error as { code: unknown }).code === "string";
