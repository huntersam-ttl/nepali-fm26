import type {
  AppResult,
  CareerCreationCommand,
  CareerHeader,
  DesktopApplicationState,
  DesktopRuntimeApi,
  EntityId,
  SaveCatalogEntry,
  SquadRow,
  StartingClubOption,
  TacticalSetup,
} from "@nepal-football-sim/shared-types";

export type {
  EntityId,
  SquadRow,
  AppResult,
  CareerCreationCommand,
  CareerHeader,
  DesktopApplicationState,
  DesktopRuntimeApi,
  SaveCatalogEntry,
  StartingClubOption,
  TacticalSetup,
};
export type AppError = Extract<AppResult<never>, { ok: false }>["error"];

/**
 * The UI never touches SQLite, save files, or simulation logic. Every command
 * goes to the Node runtime that owns DesktopApplicationService.
 *
 * Under Tauri the runtime is a managed sidecar reached through the Tauri
 * command layer; under Vite dev the same process is proxied at /runtime.
 */
export const createAppBridge = (): DesktopRuntimeApi => {
  const tauri = (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  return tauri ? tauriBridge() : httpBridge();
};

const tauriBridge = (): DesktopRuntimeApi => {
  const call = async <T>(command: string, args: Record<string, unknown> = {}) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AppResult<T>>("runtime_command", { command, args });
    } catch (error) {
      return runtimeUnavailable<T>(error);
    }
  };
  return bindCommands(call);
};

const httpBridge = (): DesktopRuntimeApi => {
  const call = async <T>(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<AppResult<T>> => {
    try {
      const response = await fetch(`/runtime/command/${command}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: "RUNTIME_UNAVAILABLE",
            message: "The game runtime rejected the command.",
            detail: `HTTP ${response.status}`,
          },
        };
      }
      return (await response.json()) as AppResult<T>;
    } catch (error) {
      return runtimeUnavailable<T>(error);
    }
  };
  return bindCommands(call);
};

type CommandCaller = <T>(command: string, args?: Record<string, unknown>) => Promise<AppResult<T>>;

const bindCommands = (call: CommandCaller): DesktopRuntimeApi => ({
  listSaves: () => call<SaveCatalogEntry[]>("listSaves"),
  listStartingClubs: () => call<StartingClubOption[]>("listStartingClubs"),
  createCareer: (command: CareerCreationCommand) =>
    call<DesktopApplicationState>("createCareer", { command }),
  loadCareer: (saveId: EntityId) => call<DesktopApplicationState>("loadCareer", { saveId }),
  closeCareer: () => call<{ closed: boolean }>("closeCareer"),
  getCareerHeader: () => call<CareerHeader>("getCareerHeader"),
  getHomeDashboard: () => call<DesktopApplicationState>("getHomeDashboard"),
  continueCareer: () => call<DesktopApplicationState>("continueCareer"),
  quickSimMatch: (fixtureId?: EntityId) =>
    call<DesktopApplicationState>("quickSimMatch", { fixtureId }),
  saveTactic: (tactic: TacticalSetup) => call<TacticalSetup>("saveTactic", { tactic }),
  saveCareer: () => call<SaveCatalogEntry>("saveCareer"),
  deleteSave: (saveId: EntityId) => call<{ deleted: boolean }>("deleteSave", { saveId }),
});

const runtimeUnavailable = <T>(error: unknown): AppResult<T> => ({
  ok: false,
  error: {
    code: "RUNTIME_UNAVAILABLE",
    message: "The game runtime is not reachable.",
    detail: error instanceof Error ? error.message : undefined,
  },
});
