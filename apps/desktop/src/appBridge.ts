export type AppResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

export type AppError = {
  code: string;
  message: string;
  detail?: string;
};

export type SaveListItem = {
  saveId: string;
  displayName: string;
  createdAt: string;
  lastPlayedAt: string;
  worldDate: string;
  characterName?: string;
  currentClub?: string;
  currentRole?: string;
};

export type CareerCreationCommand = {
  saveName: string;
  character: {
    fullName: string;
    preferredDisplayName?: string;
    dateOfBirth: string;
    startingAge: number;
    languages: string[];
    footballBackground: string;
    education: string;
    playingExperience: string;
    coachingExperience: string;
    businessBackground: string;
    startingReputationProfile: string;
    careerStartDate?: string;
  };
  joinTeamId?: string;
};

export type SquadRow = {
  personId: string;
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

export type TacticalSetup = {
  id: string;
  teamId: string;
  managerProfileId?: string;
  name: string;
  formation: {
    id: string;
    name: string;
    kind: "PRESET" | "CUSTOM";
    slots: Array<{
      id: string;
      label: string;
      position: string;
      x: number;
      y: number;
      zone: string;
    }>;
  };
  style: string;
  instructions: {
    mentality: string;
    inPossession: { tempo: number; passingLength: number; width: number; buildUpRisk: number };
    outOfPossession: { pressingIntensity: number; defensiveLine: number; engagementLine: number };
  } & Record<string, unknown>;
  familiarity: Record<string, number>;
  assignments: Array<{ slotId: string; playerId?: string; roleId: string }>;
  bench: string[];
  setPieces: Record<string, string | undefined>;
  createdOn: string;
  updatedOn: string;
};

export type FixtureReadModel = {
  id: string;
  date: string;
  opponent: string;
  homeAway: "home" | "away";
  competition: string;
  status: "scheduled" | "postponed" | "played" | "cancelled";
  score?: string;
};

export type DesktopApplicationState = {
  save: { id: string; name: string; worldDate: string };
  saveListItem: SaveListItem;
  home: {
    managerName: string;
    clubName?: string;
    teamName?: string;
    nextFixture?: FixtureReadModel;
    previousResult?: {
      score: string;
      homeTeam: string;
      awayTeam: string;
      events: Array<{
        id: string;
        minute?: number;
        type: string;
        primaryPersonId?: string;
        teamId?: string;
      }>;
      homeStats: Record<string, number | string>;
      awayStats: Record<string, number | string>;
    };
    inbox: Array<{ id: string; title: string; body: string; type: string; read: boolean }>;
    unavailablePlayers: SquadRow[];
    position?: string;
  };
  squad: SquadRow[];
  tactics: TacticalSetup[];
  activeTactic?: TacticalSetup;
  fixtures: FixtureReadModel[];
  competition: {
    name: string;
    table: Array<{
      teamId: string;
      teamName: string;
      played: number;
      goalDifference: number;
      points: number;
    }>;
  };
};

export type AppBridge = {
  listSaves(): Promise<AppResult<SaveListItem[]>>;
  createCareer(command: CareerCreationCommand): Promise<AppResult<DesktopApplicationState>>;
  loadSave(saveId: string): Promise<AppResult<DesktopApplicationState>>;
  saveTactic(saveId: string, tactic: TacticalSetup): Promise<AppResult<TacticalSetup>>;
  quickSimMatch(saveId: string, fixtureId?: string): Promise<AppResult<DesktopApplicationState>>;
  continueToNextFixture(saveId: string): Promise<AppResult<DesktopApplicationState>>;
};

export const createAppBridge = (): AppBridge => {
  const tauriInvoker = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (tauriInvoker) {
    return tauriBridge();
  }
  return browserBridge();
};

const tauriBridge = (): AppBridge => {
  const invokeCommand = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<AppResult<T>> => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AppResult<T>>(command, args);
  };
  return {
    listSaves: () => invokeCommand("list_saves"),
    createCareer: (command) => invokeCommand("create_career", { command }),
    loadSave: (saveId) => invokeCommand("load_save", { saveId }),
    saveTactic: (saveId, tactic) => invokeCommand("save_tactic", { saveId, tactic }),
    quickSimMatch: (saveId, fixtureId) => invokeCommand("quick_sim_match", { saveId, fixtureId }),
    continueToNextFixture: (saveId) => invokeCommand("continue_to_next_fixture", { saveId }),
  };
};

const storageKey = "nepal-football-stage-4-1-saves";

const browserBridge = (): AppBridge => {
  const read = (): DesktopApplicationState[] =>
    JSON.parse(localStorage.getItem(storageKey) ?? "[]") as DesktopApplicationState[];
  const write = (states: DesktopApplicationState[]): void =>
    localStorage.setItem(storageKey, JSON.stringify(states));
  const update = (state: DesktopApplicationState): DesktopApplicationState => {
    const states = read().filter((candidate) => candidate.save.id !== state.save.id);
    states.push(state);
    write(states);
    return state;
  };

  return {
    async listSaves() {
      return { ok: true, data: read().map((state) => state.saveListItem) };
    },
    async createCareer(command) {
      const now = new Date().toISOString();
      const state = buildBrowserState(command, now);
      return { ok: true, data: update(state) };
    },
    async loadSave(saveId) {
      const state = read().find((candidate) => candidate.save.id === saveId);
      return state
        ? { ok: true, data: state }
        : { ok: false, error: { code: "SAVE_MISSING", message: "Save was not found." } };
    },
    async saveTactic(saveId, tactic) {
      const state = read().find((candidate) => candidate.save.id === saveId);
      if (!state)
        return { ok: false, error: { code: "SAVE_MISSING", message: "Save was not found." } };
      const updated = { ...tactic, updatedOn: new Date().toISOString().slice(0, 10) };
      update({ ...state, tactics: [updated], activeTactic: updated });
      return { ok: true, data: updated };
    },
    async quickSimMatch(saveId, fixtureId) {
      const state = read().find((candidate) => candidate.save.id === saveId);
      if (!state)
        return { ok: false, error: { code: "SAVE_MISSING", message: "Save was not found." } };
      const fixture =
        state.fixtures.find((candidate) => candidate.id === fixtureId) ?? state.fixtures[0];
      if (!fixture)
        return { ok: false, error: { code: "FIXTURE_MISSING", message: "No fixture available." } };
      const score = state.activeTactic?.style === "HIGH_PRESS" ? "2-1" : "1-1";
      const played = { ...fixture, status: "played" as const, score };
      const updatedSquad = state.squad.map((player, index) => ({
        ...player,
        fitness: Math.max(35, player.fitness - (index < 11 ? 9 : 0)),
        appearances: index < 11 ? player.appearances + 1 : player.appearances,
        averageRating: index < 11 ? 6.7 + (index % 4) * 0.2 : player.averageRating,
      }));
      const updated: DesktopApplicationState = {
        ...state,
        save: { ...state.save, worldDate: "2026-08-04" },
        saveListItem: {
          ...state.saveListItem,
          worldDate: "2026-08-04",
          lastPlayedAt: new Date().toISOString(),
        },
        squad: updatedSquad,
        fixtures: state.fixtures.map((candidate) =>
          candidate.id === played.id ? played : candidate,
        ),
        home: {
          ...state.home,
          nextFixture: state.fixtures.find((candidate) => candidate.id !== played.id),
          previousResult: {
            score,
            homeTeam: state.home.teamName ?? "Kathmandu Testing Club",
            awayTeam: fixture.opponent,
            events: [
              { id: "e1", minute: 12, type: "SHOT" },
              { id: "e2", minute: 31, type: "GOAL" },
              { id: "e3", minute: 63, type: "SUBSTITUTION" },
            ],
            homeStats: { possession: 52, shots: 8, shotsOnTarget: 5, xg: 1.42, corners: 4 },
            awayStats: { possession: 48, shots: 6, shotsOnTarget: 3, xg: 1.08, corners: 3 },
          },
          inbox: [
            {
              id: `inbox-${Date.now()}`,
              title: `Match result: ${score}`,
              body: "Quick sim completed and persisted.",
              type: "MATCH_RESULT",
              read: false,
            },
            ...state.home.inbox,
          ],
        },
        competition: {
          ...state.competition,
          table: state.competition.table.map((row, index) =>
            index === 0 ? { ...row, played: row.played + 1, points: row.points + 1 } : row,
          ),
        },
      };
      return { ok: true, data: update(updated) };
    },
    async continueToNextFixture(saveId) {
      const state = read().find((candidate) => candidate.save.id === saveId);
      if (!state)
        return { ok: false, error: { code: "SAVE_MISSING", message: "Save was not found." } };
      const next = state.fixtures.find((fixture) => fixture.status === "scheduled");
      const updated = next
        ? {
            ...state,
            save: { ...state.save, worldDate: next.date },
            saveListItem: { ...state.saveListItem, worldDate: next.date },
          }
        : state;
      return { ok: true, data: update(updated) };
    },
  };
};

const buildBrowserState = (
  command: CareerCreationCommand,
  now: string,
): DesktopApplicationState => {
  const saveId = `save-${Date.now().toString(36)}`;
  const squad = browserSquad();
  const tactic = browserTactic(squad);
  const fixtures: FixtureReadModel[] = [
    {
      id: "fixture-1",
      date: "2026-08-03",
      opponent: "Lalitpur Test XI",
      homeAway: "home",
      competition: "Testing-only Nepal League 2026",
      status: "scheduled",
    },
    {
      id: "fixture-2",
      date: "2026-08-10",
      opponent: "Pokhara Sample Club",
      homeAway: "away",
      competition: "Testing-only Nepal League 2026",
      status: "scheduled",
    },
  ];
  const display = command.character.preferredDisplayName || command.character.fullName;
  return {
    save: { id: saveId, name: command.saveName, worldDate: "2026-08-01" },
    saveListItem: {
      saveId,
      displayName: command.saveName,
      createdAt: now,
      lastPlayedAt: now,
      worldDate: "2026-08-01",
      characterName: display,
      currentClub: "Kathmandu Testing Club",
      currentRole: "Manager",
    },
    home: {
      managerName: display,
      clubName: "Kathmandu Testing Club",
      teamName: "Kathmandu Testing Club",
      nextFixture: fixtures[0],
      inbox: [
        {
          id: "welcome",
          title: "Welcome to manager mode",
          body: "Your testing-world save is ready.",
          type: "FIXTURE_UPCOMING",
          read: false,
        },
      ],
      unavailablePlayers: squad.filter((player) => player.availability !== "Available"),
      position: "1",
    },
    squad,
    tactics: [tactic],
    activeTactic: tactic,
    fixtures,
    competition: {
      name: "Testing-only Nepal League 2026",
      table: [
        "Kathmandu Testing Club",
        "Lalitpur Test XI",
        "Pokhara Sample Club",
        "Biratnagar Demo",
      ].map((teamName, index) => ({
        teamId: `team-${index}`,
        teamName,
        played: 0,
        goalDifference: 0,
        points: 0,
      })),
    },
  };
};

const browserSquad = (): SquadRow[] =>
  [
    ["Kiran Kathmandu", 28, ["GK"], 84, 12],
    ["Suman Kathmandu", 24, ["RB", "LB"], 91, 11],
    ["Anil Kathmandu", 31, ["CB"], 76, 12],
    ["Bikash Kathmandu", 22, ["CB", "DM"], 88, 10],
    ["Nabin Kathmandu", 25, ["LB"], 82, 10],
    ["Rohit Kathmandu", 27, ["DM", "CM"], 79, 12],
    ["Aakash Kathmandu", 23, ["CM"], 86, 11],
    ["Sanjay Kathmandu", 21, ["AM", "CM"], 92, 13],
    ["Prakash Kathmandu", 26, ["RW"], 73, 10],
    ["Milan Kathmandu", 20, ["LW", "ST"], 89, 11],
    ["Dinesh Kathmandu", 29, ["ST"], 81, 13],
    ["Ramesh Kathmandu", 19, ["GK"], 96, 8],
    ["Ashim Kathmandu", 24, ["CB", "RB"], 83, 9],
    ["Manish Kathmandu", 27, ["CM", "DM"], 77, 9],
    ["Sagar Kathmandu", 22, ["RW", "LW"], 87, 10],
    ["Bimal Kathmandu", 30, ["ST", "AM"], 74, 10],
    ["Hari Kathmandu", 23, ["LB", "CB"], 90, 9],
    ["Deepak Kathmandu", 21, ["CM"], 93, 8],
  ].map(([name, age, positions, fitness, overall], index) => ({
    personId: `p${index + 1}`,
    name: String(name),
    age: Number(age),
    nationality: "NEP",
    positions: positions as string[],
    preferredFoot: index % 3 === 0 ? "Left" : "Right",
    fitness: Number(fitness),
    form: index % 4,
    morale: "Okay",
    overall: Number(overall),
    roleSuitability: Number(overall) >= 12 ? "Good" : "Adequate",
    appearances: 0,
    goals: 0,
    assists: 0,
    averageRating: 0,
    availability: Number(fitness) < 78 ? "Managed minutes" : "Available",
  }));

const browserTactic = (squad: SquadRow[]): TacticalSetup => ({
  id: "tactic-default",
  teamId: "team-0",
  name: "Saved 4-3-3",
  formation: {
    id: "formation-433",
    name: "4-3-3",
    kind: "PRESET",
    slots: [
      ["GK", "GK", 50, 8, "goalkeeper"],
      ["DL", "DL", 18, 25, "defense"],
      ["DCL", "DCL", 38, 23, "defense"],
      ["DCR", "DCR", 62, 23, "defense"],
      ["DR", "DR", 82, 25, "defense"],
      ["MCL", "MCL", 38, 52, "midfield"],
      ["MC", "MC", 50, 49, "midfield"],
      ["MCR", "MCR", 62, 52, "midfield"],
      ["AML", "AML", 22, 76, "attackingMidfield"],
      ["AMR", "AMR", 78, 76, "attackingMidfield"],
      ["STC", "STC", 50, 89, "forward"],
    ].map(([id, position, x, y, zone]) => ({
      id: String(id),
      label: String(id),
      position: String(position),
      x: Number(x),
      y: Number(y),
      zone: String(zone),
    })),
  },
  style: "BALANCED",
  instructions: {
    mentality: "BALANCED",
    inPossession: { tempo: 50, passingLength: 50, width: 50, buildUpRisk: 50 },
    outOfPossession: { pressingIntensity: 50, defensiveLine: 50, engagementLine: 50 },
  },
  familiarity: { formation: 72, style: 68, roles: 64, instructions: 66 },
  assignments: squad.slice(0, 11).map((player, index) => ({
    slotId: ["GK", "DL", "DCL", "DCR", "DR", "MCL", "MC", "MCR", "AML", "AMR", "STC"][index],
    playerId: player.personId,
    roleId: index === 0 ? "GOALKEEPER" : index === 10 ? "PRESSING_FORWARD" : "CENTRAL_MIDFIELDER",
  })),
  bench: squad.slice(11, 18).map((player) => player.personId),
  setPieces: {
    penaltyTaker: "p11",
    directFreeKickTaker: "p8",
    leftCornerTaker: "p10",
    rightCornerTaker: "p9",
  },
  createdOn: "2026-08-01",
  updatedOn: "2026-08-01",
});
