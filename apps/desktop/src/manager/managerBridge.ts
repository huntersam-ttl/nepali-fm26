import type {
  AdvanceMatchCommand,
  AppResult,
  CalendarEntry,
  ConcernResponseAction,
  ConcernResponseResult,
  ContractList,
  ContractRenewalCommand,
  DesktopApplicationState,
  EntityId,
  FixtureDetail,
  FixtureList,
  JobCentreView,
  LiveMatchView,
  LiveTacticsCommand,
  ManagerCareerHistoryView,
  ManagerCompetitionView,
  ManagerDashboard,
  PostMatchReport,
  PlayerProfile,
  QuickSimSummary,
  RecruitmentSearchCommand,
  RecruitmentSearchPage,
  ScoutingAssignmentCommand,
  ScoutingDashboard,
  StartMatchCommand,
  SubstitutionCommand,
  ScoutingReportView,
  SquadDynamicsView,
  SquadMeetingCommand,
  SquadMeetingResult,
  SquadList,
  CreateDevelopmentPlanCommand,
  MedicalCentreView,
  PlayerDevelopmentView,
  ReturnToPlayDecisionCommand,
  StaffHierarchyView,
  StaffList,
  StaffMarketView,
  StaffResponsibilityDomain,
  StaffResponsibilityOwnerType,
  TacticsUpdateCommand,
  TacticsView,
  TrainingUpdateCommand,
  TrainingView,
  TransferCentre,
  TransferListCommand,
  TransferOfferCommand,
  TransferResponseCommand,
  TransferRequestCommand,
  TransferRequestResponseCommand,
  TransferLoanCommand,
  FederationCandidacyAssessment,
} from "@nepal-football-sim/shared-types";
import { runtimeCall } from "../appBridge.js";

/**
 * Manager-mode command client. Adds nothing but transport typing: every rule,
 * calculation, and validation lives in the runtime service.
 */
export const managerBridge = {
  getFederationCandidacy: () => runtimeCall<FederationCandidacyAssessment>("getFederationCandidacy"),
  declareFederationElectionCandidacy: () => runtimeCall<FederationCandidacyAssessment>("declareFederationElectionCandidacy"),
  getManagerDashboard: () => runtimeCall<ManagerDashboard>("getManagerDashboard"),
  getSquad: () => runtimeCall<SquadList>("getSquad"),
  getSquadConcerns: () => runtimeCall<SquadDynamicsView>("getSquadConcerns"),
  respondToConcern: (concernId: EntityId, action: ConcernResponseAction) =>
    runtimeCall<ConcernResponseResult>("respondToConcern", { concernId, action }),
  holdSquadMeeting: (command: SquadMeetingCommand) =>
    runtimeCall<SquadMeetingResult>("holdSquadMeeting", { command }),
  getPlayerProfile: (playerId: EntityId) =>
    runtimeCall<PlayerProfile>("getPlayerProfile", { playerId }),
  getTactics: () => runtimeCall<TacticsView>("getTactics"),
  updateTactics: (command: TacticsUpdateCommand) =>
    runtimeCall<TacticsView>("updateTactics", { command }),
  getTraining: () => runtimeCall<TrainingView>("getTraining"),
  updateTraining: (command: TrainingUpdateCommand) =>
    runtimeCall<TrainingView>("updateTraining", { command }),
  getPlayerDevelopment: () => runtimeCall<PlayerDevelopmentView>("getPlayerDevelopment"),
  createPlayerDevelopmentPlan: (command: CreateDevelopmentPlanCommand) =>
    runtimeCall<PlayerDevelopmentView>("createPlayerDevelopmentPlan", { command }),
  setPlayerDevelopmentPlanStatus: (planId: EntityId, status: string) =>
    runtimeCall<PlayerDevelopmentView>("setPlayerDevelopmentPlanStatus", { planId, status }),
  getMedicalCentre: () => runtimeCall<MedicalCentreView>("getMedicalCentre"),
  decideReturnToPlay: (command: ReturnToPlayDecisionCommand) =>
    runtimeCall<MedicalCentreView>("decideReturnToPlay", { command }),
  getFixtures: () => runtimeCall<FixtureList>("getFixtures"),
  getFixture: (fixtureId: EntityId) => runtimeCall<FixtureDetail>("getFixture", { fixtureId }),
  getCompetition: () => runtimeCall<ManagerCompetitionView>("getCompetition"),
  getCalendar: () => runtimeCall<CalendarEntry[]>("getCalendar"),
  getScoutingDashboard: () => runtimeCall<ScoutingDashboard>("getScoutingDashboard"),
  createScoutingAssignment: (command: ScoutingAssignmentCommand) =>
    runtimeCall<ScoutingDashboard>("createScoutingAssignment", { command }),
  getScoutingReport: (playerId: EntityId) =>
    runtimeCall<ScoutingReportView>("getScoutingReport", { playerId }),
  toggleShortlist: (playerId: EntityId) =>
    runtimeCall<ScoutingDashboard>("toggleShortlist", { playerId }),
  searchRecruitment: (command: RecruitmentSearchCommand) =>
    runtimeCall<RecruitmentSearchPage>("searchRecruitment", { command }),
  getTransferCentre: () => runtimeCall<TransferCentre>("getTransferCentre"),
  makeTransferOffer: (command: TransferOfferCommand) =>
    runtimeCall<TransferCentre>("makeTransferOffer", { command }),
  respondTransferOffer: (command: TransferResponseCommand) =>
    runtimeCall<TransferCentre>("respondTransferOffer", { command }),
  makeTransferRequest: (command: TransferRequestCommand) =>
    runtimeCall<TransferCentre>("makeTransferRequest", { command }),
  respondTransferRequest: (command: TransferRequestResponseCommand) =>
    runtimeCall<TransferCentre>("respondTransferRequest", { command }),
  negotiateLoan: (command: TransferLoanCommand) =>
    runtimeCall<TransferCentre>("negotiateLoan", { command }),
  setTransferStatus: (command: TransferListCommand) =>
    runtimeCall<TransferCentre>("setTransferStatus", { command }),
  getContracts: () => runtimeCall<ContractList>("getContracts"),
  renewContract: (command: ContractRenewalCommand) =>
    runtimeCall<ContractList>("renewContract", { command }),
  getStaff: (clubId?: EntityId) => runtimeCall<StaffList>("getStaff", { clubId }),
  getStaffMarket: () => runtimeCall<StaffMarketView>("getStaffMarket"),
  applyForStaffRole: (vacancyId: EntityId, personId: EntityId, salaryAmountMinor: number, contractMonths: number) =>
    runtimeCall<StaffMarketView>("applyForStaffRole", { vacancyId, personId, salaryAmountMinor, contractMonths }),
  respondToStaffApplication: (applicationId: EntityId, accept: boolean) =>
    runtimeCall<StaffMarketView>("respondToStaffApplication", { applicationId, accept }),
  offerStaffContractRenewal: (appointmentId: EntityId, salaryAmountMinor: number, contractMonths: number) =>
    runtimeCall<StaffMarketView>("offerStaffContractRenewal", { appointmentId, salaryAmountMinor, contractMonths }),
  respondToStaffRenewal: (offerId: EntityId, accept: boolean) =>
    runtimeCall<StaffMarketView>("respondToStaffRenewal", { offerId, accept }),
  dismissStaffMember: (appointmentId: EntityId) =>
    runtimeCall<StaffMarketView>("dismissStaffMember", { appointmentId }),
  enrolStaffLicenceCourse: (personId: EntityId, clubFunded: boolean) =>
    runtimeCall<StaffMarketView>("enrolStaffLicenceCourse", { personId, clubFunded }),
  getStaffHierarchy: () => runtimeCall<StaffHierarchyView>("getStaffHierarchy"),
  assignStaffResponsibility: (
    domain: StaffResponsibilityDomain,
    ownerType: StaffResponsibilityOwnerType,
    ownerAppointmentId?: EntityId,
  ) => runtimeCall<StaffHierarchyView>("assignStaffResponsibility", { domain, ownerType, ownerAppointmentId }),
  requestStaffBoardApproval: (domain: StaffResponsibilityDomain) =>
    runtimeCall<StaffHierarchyView>("requestStaffBoardApproval", { domain }),
  createStaffDevelopmentPlan: (
    personId: EntityId,
    focus: string,
    targetLicenceType?: string,
    clubFunded?: boolean,
  ) =>
    runtimeCall<StaffHierarchyView>("createStaffDevelopmentPlan", {
      personId,
      focus,
      targetLicenceType,
      clubFunded,
    }),

  // --- Manager Career World --------------------------------------------
  getJobCentre: () => runtimeCall<JobCentreView>("getJobCentre"),
  applyForJob: (vacancyId: EntityId) => runtimeCall<JobCentreView>("applyForJob", { vacancyId }),
  declineJobOffer: (applicationId: EntityId) =>
    runtimeCall<JobCentreView>("declineJobOffer", { applicationId }),
  acceptJobOffer: (applicationId: EntityId) =>
    runtimeCall<DesktopApplicationState>("acceptJobOffer", { applicationId }),
  resignFromClub: () => runtimeCall<DesktopApplicationState>("resignFromClub"),
  getCareerHistory: () => runtimeCall<ManagerCareerHistoryView>("getCareerHistory"),
  getMatchSummary: (fixtureId: EntityId) =>
    runtimeCall<QuickSimSummary | undefined>("getMatchSummary", { fixtureId }),

  // --- Interactive matchday -------------------------------------------------
  startMatch: (command: StartMatchCommand) => runtimeCall<LiveMatchView>("startMatch", { command }),
  getLiveMatch: (fixtureId?: EntityId, since?: number) =>
    runtimeCall<LiveMatchView>("getLiveMatch", { fixtureId, since }),
  advanceMatch: (command: AdvanceMatchCommand, fixtureId?: EntityId) =>
    runtimeCall<LiveMatchView>("advanceMatch", { command, fixtureId }),
  continueFromHalfTime: (fixtureId?: EntityId) =>
    runtimeCall<LiveMatchView>("continueFromHalfTime", { fixtureId }),
  makeSubstitution: (command: SubstitutionCommand, fixtureId?: EntityId) =>
    runtimeCall<LiveMatchView>("makeSubstitution", { command, fixtureId }),
  updateLiveTactics: (command: LiveTacticsCommand, fixtureId?: EntityId) =>
    runtimeCall<LiveMatchView>("updateLiveTactics", { command, fixtureId }),
  quickSimCurrentMatch: (fixtureId?: EntityId) =>
    runtimeCall<LiveMatchView>("quickSimCurrentMatch", { fixtureId }),
  resumeMatch: (fixtureId?: EntityId) =>
    runtimeCall<LiveMatchView | undefined>("resumeMatch", { fixtureId }),
  getPostMatchReport: (fixtureId: EntityId) =>
    runtimeCall<PostMatchReport | undefined>("getPostMatchReport", { fixtureId }),
};

export type ManagerBridge = typeof managerBridge;
export type { AppResult };
