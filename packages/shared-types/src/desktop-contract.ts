import type { EntityId } from "./ids.js";
import type {
  FixtureRecord,
  InboxItem,
  ISODate,
  ManagerContract,
  ManagerProfile,
  MatchEvent,
  MatchResult,
  PlayerAttributeSet,
  SaveMetadata,
  TacticalSetup,
} from "./domain.js";

/**
 * Canonical desktop application contract.
 *
 * Both the runtime service (packages/simulation) and the desktop UI (apps/desktop)
 * import these types so the wire format cannot drift between them.
 */

export type DesktopErrorCode =
  | "SAVE_NOT_FOUND"
  | "SAVE_CORRUPT"
  | "MIGRATION_FAILED"
  | "CAREER_CREATION_FAILED"
  | "DATABASE_ERROR"
  | "SESSION_NOT_OPEN"
  | "SIMULATION_ERROR"
  | "FIXTURE_MISSING"
  | "PLAYER_MISSING"
  | "INVALID_SELECTION"
  | "WORLD_DATA_UNAVAILABLE"
  | "RUNTIME_UNAVAILABLE"
  /** The active career role may not perform the requested action. */
  | "ROLE_NOT_AUTHORIZED"
  /** The fixture already has a result and cannot be played again. */
  | "MATCH_ALREADY_PLAYED";

export type DesktopAppError = {
  code: DesktopErrorCode;
  message: string;
  detail?: string;
};

export type AppResult<T> = { ok: true; data: T } | { ok: false; error: DesktopAppError };

export type CareerRole = "MANAGER";

/** Save catalog entry. Readable without opening the full simulation world. */
export type SaveCatalogEntry = {
  saveId: EntityId;
  saveName: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  worldDate: string;
  characterName?: string;
  activeRole?: CareerRole;
  organisation?: string;
  gameVersion: string;
  schemaVersion: number;
};

export type StartingClubOption = {
  teamId: EntityId;
  clubId?: EntityId;
  clubName: string;
  teamName: string;
  competitionName: string;
  squadSize: number;
};

export type CareerCreationCommand = {
  saveName: string;
  character: {
    fullName: string;
    preferredDisplayName?: string;
    dateOfBirth: ISODate;
    startingAge: number;
    languages: string[];
    footballBackground: string;
    education: string;
    playingExperience: string;
    coachingExperience: string;
    businessBackground: string;
    startingReputationProfile: string;
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

export type PlayerProfileReadModel = SquadRow & {
  attributes: PlayerAttributeSet;
  provenanceStatus?: string;
  matchStats: { minutes: number; yellowCards: number; redCards: number };
};

/** Lightweight identity of the open career. Cheap enough for headers and menus. */
export type CareerHeader = {
  saveId: EntityId;
  saveName: string;
  worldDate: string;
  characterName: string;
  activeRole: CareerRole;
  clubName?: string;
  teamName?: string;
  competitionName?: string;
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
  header: CareerHeader;
  catalogEntry: SaveCatalogEntry;
  home: ManagerHomeReadModel;
  squad: SquadRow[];
  tactics: TacticalSetup[];
  activeTactic?: TacticalSetup;
  fixtures: FixtureReadModel[];
  competition: CompetitionView;
};

/**
 * Runtime command surface. The transport (HTTP sidecar today, Tauri IPC later)
 * must implement exactly this shape.
 */
export type DesktopRuntimeApi = {
  listSaves(): Promise<AppResult<SaveCatalogEntry[]>>;
  listStartingClubs(): Promise<AppResult<StartingClubOption[]>>;
  createCareer(command: CareerCreationCommand): Promise<AppResult<DesktopApplicationState>>;
  loadCareer(saveId: EntityId): Promise<AppResult<DesktopApplicationState>>;
  closeCareer(): Promise<AppResult<{ closed: boolean }>>;
  getCareerHeader(): Promise<AppResult<CareerHeader>>;
  getHomeDashboard(): Promise<AppResult<DesktopApplicationState>>;
  continueCareer(): Promise<AppResult<DesktopApplicationState>>;
  quickSimMatch(fixtureId?: EntityId): Promise<AppResult<DesktopApplicationState>>;
  saveTactic(tactic: TacticalSetup): Promise<AppResult<TacticalSetup>>;
  saveCareer(): Promise<AppResult<SaveCatalogEntry>>;
  deleteSave(saveId: EntityId): Promise<AppResult<{ deleted: boolean }>>;
};
