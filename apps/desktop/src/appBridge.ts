import type {
  AppResult,
  AutosaveStatusView,
  CareerCreationCommand,
  CareerHeader,
  CareerRole,
  CareerRoleState,
  FederationGovernanceProposal,
  ClubBudget,
  ClubBudgetCategory,
  InfrastructureProject,
  InfrastructureProjectType,
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
  AutosaveStatusView,
  CareerCreationCommand,
  CareerHeader,
  CareerRole,
  CareerRoleState,
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

/**
 * Raw command escape hatch, used by mode-specific bridges (Manager, and later
 * other roles) so they do not each re-implement transport selection.
 */
export const runtimeCall = <T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<AppResult<T>> => {
  const tauri = (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  return tauri ? tauriCall<T>(command, args) : httpCall<T>(command, args);
};

const tauriCall = async <T>(
  command: string,
  args: Record<string, unknown>,
): Promise<AppResult<T>> => {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<AppResult<T>>("runtime_command", { command, args });
  } catch (error) {
    return runtimeUnavailable<T>(error);
  }
};

const httpCall = async <T>(
  command: string,
  args: Record<string, unknown>,
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

const tauriBridge = (): DesktopRuntimeApi =>
  bindCommands(<T>(command: string, args: Record<string, unknown> = {}) =>
    tauriCall<T>(command, args),
  );

const httpBridge = (): DesktopRuntimeApi =>
  bindCommands(<T>(command: string, args: Record<string, unknown> = {}) =>
    httpCall<T>(command, args),
  );

type CommandCaller = <T>(command: string, args?: Record<string, unknown>) => Promise<AppResult<T>>;

const bindCommands = (call: CommandCaller): DesktopRuntimeApi => ({
  listSaves: () => call<SaveCatalogEntry[]>("listSaves"),
  listStartingClubs: () => call<StartingClubOption[]>("listStartingClubs"),
  createCareer: (command: CareerCreationCommand) =>
    call<DesktopApplicationState>("createCareer", { command }),
  loadCareer: (saveId: EntityId) => call<DesktopApplicationState>("loadCareer", { saveId }),
  closeCareer: () => call<{ closed: boolean }>("closeCareer"),
  getCareerHeader: () => call<CareerHeader>("getCareerHeader"),
  getCareerRoles: () => call<CareerRoleState>("getCareerRoles"),
  switchActiveCareerRole: (targetRole: CareerRole) => call<CareerHeader>("switchActiveCareerRole", { targetRole }),
  implementFederationGovernanceProposal: (proposalId: EntityId) => call<FederationGovernanceProposal>("implementFederationGovernanceProposal", { proposalId }),
  setClubBudget: (clubId: EntityId, seasonLabel: string, category: ClubBudgetCategory, amount: number) => call<ClubBudget>("setClubBudget", { clubId, seasonLabel, category, amount }),
  createInfrastructureProject: (clubId: EntityId, projectType: InfrastructureProjectType) => call<InfrastructureProject>("createInfrastructureProject", { clubId, projectType }),
  getHomeDashboard: () => call<DesktopApplicationState>("getHomeDashboard"),
  continueCareer: () => call<DesktopApplicationState>("continueCareer"),
  quickSimMatch: (fixtureId?: EntityId) =>
    call<DesktopApplicationState>("quickSimMatch", { fixtureId }),
  saveTactic: (tactic: TacticalSetup) => call<TacticalSetup>("saveTactic", { tactic }),
  saveCareer: () => call<SaveCatalogEntry>("saveCareer"),
  saveCareerAs: (saveName: string) => call<SaveCatalogEntry>("saveCareerAs", { saveName }),
  deleteSave: (saveId: EntityId) => call<{ deleted: boolean }>("deleteSave", { saveId }),
  getAutosaveStatus: () => call<AutosaveStatusView>("getAutosaveStatus"),
  loadAutosaveSlot: (slotIndex: number) => call<DesktopApplicationState>("loadAutosaveSlot", { slotIndex }),
});

const runtimeUnavailable = <T>(error: unknown): AppResult<T> => ({
  ok: false,
  error: {
    code: "RUNTIME_UNAVAILABLE",
    message: "The game runtime is not reachable.",
    detail: error instanceof Error ? error.message : undefined,
  },
});
