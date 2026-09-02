import type {
  AppResult,
  AutosaveStatusView,
  CareerCreationCommand,
  CareerHeader,
  CareerRole,
  CareerRoleState,
  CareerStartMode,
  ChairmanDashboard,
  FederationDevelopmentSummary,
  GovernmentOverview,
  GovernmentFundingApplication,
  GovernmentFundingType,
  ClubFinanceMeetingOverview,
  ClubDebt,
  FederationPresidentDashboard,
  FederationCandidacyAssessment,
  FederationGovernanceProposal,
  ClubBudget,
  ClubBudgetCategory,
  InfrastructureProject,
  InfrastructureProjectType,
  SponsorshipContract,
  SimulationClubRecord,
  DesktopApplicationState,
  DesktopRuntimeApi,
  EntityId,
  ExecutiveAuthorityDesktopView,
  SaveCatalogEntry,
  SquadRow,
  StaffAppointment,
  StartingClubOption,
  FounderLocationOption,
  OwnerManagerCandidate,
  ManagerContract,
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
  FederationCandidacyAssessment,
  CareerStartMode,
  SimulationClubRecord,
  DesktopApplicationState,
  DesktopRuntimeApi,
  SaveCatalogEntry,
  StartingClubOption,
  FounderLocationOption,
  OwnerManagerCandidate,
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
  listFounderLocations: () => call<FounderLocationOption[]>("listFounderLocations"),
  listOwnerManagerCandidates: () => call<OwnerManagerCandidate[]>("listOwnerManagerCandidates"),
  appointManager: (vacancyId: EntityId, managerProfileId: EntityId) => call<ManagerContract>("appointManager", { vacancyId, managerProfileId }),
  createCareer: (command: CareerCreationCommand) =>
    call<DesktopApplicationState>("createCareer", { command }),
  loadCareer: (saveId: EntityId) => call<DesktopApplicationState>("loadCareer", { saveId }),
  closeCareer: () => call<{ closed: boolean }>("closeCareer"),
  getCareerHeader: () => call<CareerHeader>("getCareerHeader"),
  getCareerRoles: () => call<CareerRoleState>("getCareerRoles"),
  getExecutiveAuthority: (clubId?: EntityId) => call<ExecutiveAuthorityDesktopView | undefined>("getExecutiveAuthority", { clubId }),
  switchActiveCareerRole: (targetRole: CareerRole) => call<CareerHeader>("switchActiveCareerRole", { targetRole }),
  getChairmanDashboard: () => call<ChairmanDashboard>("getChairmanDashboard"),
  getFederationPresidentDashboard: () => call<FederationPresidentDashboard>("getFederationPresidentDashboard"),
  getNationalDevelopment: () => call<FederationDevelopmentSummary>("getNationalDevelopment"),
  getGovernmentOverview: () => call<GovernmentOverview>("getGovernmentOverview"),
  requestGovernmentFunding: (institutionId: EntityId, fundingType: GovernmentFundingType, requestedAmount: number) => call<GovernmentFundingApplication>("requestGovernmentFunding", { institutionId, fundingType, requestedAmount }),
  getClubFinanceMeeting: (clubId?: EntityId) => call<ClubFinanceMeetingOverview>("getClubFinanceMeeting", { clubId }),
  getFederationCandidacy: () => call<FederationCandidacyAssessment>("getFederationCandidacy"),
  declareFederationElectionCandidacy: () => call<FederationCandidacyAssessment>("declareFederationElectionCandidacy"),
  foundClub: (name: string, locationName: string) => call<SimulationClubRecord>("foundClub", { name, locationName }),
  implementFederationGovernanceProposal: (proposalId: EntityId) => call<FederationGovernanceProposal>("implementFederationGovernanceProposal", { proposalId }),
  setClubBudget: (clubId: EntityId, seasonLabel: string, category: ClubBudgetCategory, amount: number) => call<ClubBudget>("setClubBudget", { clubId, seasonLabel, category, amount }),
  createInfrastructureProject: (clubId: EntityId, projectType: InfrastructureProjectType) => call<InfrastructureProject>("createInfrastructureProject", { clubId, projectType }),
  acceptSponsorOffer: (clubId: EntityId, sponsorshipId: EntityId) => call<SponsorshipContract>("acceptSponsorOffer", { clubId, sponsorshipId }),
  rejectSponsorOffer: (clubId: EntityId, sponsorshipId: EntityId) => call<SponsorshipContract>("rejectSponsorOffer", { clubId, sponsorshipId }),
  counterSponsorOffer: (clubId: EntityId, sponsorshipId: EntityId, annualValue: number, endDate?: string) => call<SponsorshipContract>("counterSponsorOffer", { clubId, sponsorshipId, annualValue, endDate }),
  createInvestorStakeOffer: (percentage: number, minimumAmount?: number) => call("createInvestorStakeOffer", { percentage, minimumAmount }),
  decideInvestorBid: (offerId: EntityId, accept: boolean) => call("decideInvestorBid", { offerId, accept }),
  applyClubLoan: (lenderId: EntityId, principal: number, termMonths: number, purpose: string) => call("applyClubLoan", { lenderId, principal, termMonths, purpose }),
  repayClubLoan: (debtId: EntityId, amount?: number) => call("repayClubLoan", { debtId, amount }),
  acceptExecutiveSponsorOffer: (clubId: EntityId, sponsorshipId: EntityId) => call<SponsorshipContract>("acceptExecutiveSponsorOffer", { clubId, sponsorshipId }),
  setExecutiveClubBudget: (clubId: EntityId, seasonLabel: string, category: ClubBudgetCategory, amount: number) => call<ClubBudget>("setExecutiveClubBudget", { clubId, seasonLabel, category, amount }),
  createExecutiveInfrastructureProject: (clubId: EntityId, projectType: InfrastructureProjectType) => call<InfrastructureProject>("createExecutiveInfrastructureProject", { clubId, projectType }),
  applyExecutiveClubLoan: (clubId: EntityId, lenderId: EntityId, principal: number, termMonths: number, purpose: string) => call("applyExecutiveClubLoan", { clubId, lenderId, principal, termMonths, purpose }),
  repayExecutiveClubLoan: (clubId: EntityId, debtId: EntityId, amount?: number) => call<ClubDebt>("repayExecutiveClubLoan", { clubId, debtId, amount }),
  closeExecutiveLicence: (caseId: EntityId) => call("closeExecutiveLicence", { caseId }),
  registerExecutiveCompetitionPlayers: (teamId: EntityId, competitionSeasonId: EntityId) => call("registerExecutiveCompetitionPlayers", { teamId, competitionSeasonId }),
  hireStaffAsExecutive: (clubId: EntityId, personId: EntityId, role: StaffAppointment["role"], salaryAmountMinor: number, teamId?: EntityId, contractMonths?: number) => call("hireStaffAsExecutive", { clubId, personId, role, salaryAmountMinor, teamId, contractMonths }),
  dismissStaffAsExecutive: (clubId: EntityId, appointmentId: EntityId) => call("dismissStaffAsExecutive", { clubId, appointmentId }),
  requestManagerBudget: (seasonLabel: string, category: ClubBudgetCategory, requestedAmount: number) => call("requestManagerBudget", { seasonLabel, category, requestedAmount }),
  decideManagerBudgetRequest: (requestId: EntityId, approve: boolean) => call("decideManagerBudgetRequest", { requestId, approve }),
  purchaseEquipment: (category: string, quantity: number) => call("purchaseEquipment", { category, quantity }),
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
