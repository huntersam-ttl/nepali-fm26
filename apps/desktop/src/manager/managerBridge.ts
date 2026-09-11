import type {
  AdvanceMatchCommand,
  AppResult,
  CalendarEntry,
  ClubProfile,
  CompetitionProfile,
  ConcernResponseAction,
  EntityReference,
  EntityReferenceType,
  InfrastructureProjectProfile,
  OrganizationProfile,
  OrganizationProfileEntityType,
  StaffProfileReadModel,
  ConcernResponseResult,
  ContractList,
  ContractRenewalCommand,
  DemandResponseCommand,
  DemandResponseResult,
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
  DressingRoomView,
  MediaCentreView,
  MediaResponseStance,
  PressConferenceView,
  PressResponseStance,
  StructuredPressConferenceView,
  SupporterReadModel,
  PostMatchReport,
  PlayerProfile,
  PlayerPathway,
  StoryThread,
  StoryDetail,
  EntityStoryline,
  PlayerMarketValueView,
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
  TeamMeetingContext,
  CreateDevelopmentPlanCommand,
  MedicalCentreView,
  PlayerDevelopmentView,
  ReturnToPlayDecisionCommand,
  StaffHierarchyView,
  StaffList,
  StaffHireResult,
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
  ClubBudgetCategory,
  ManagerBudgetRequest,
  ActorPlayerActions,
  ManagerOwnerPlayerRequest,
  OwnerManagerMeetingStance,
  OwnerManagerCommitmentInput,
  UniversalInteraction,
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
  getTeamMeetingContext: () => runtimeCall<TeamMeetingContext | undefined>("getTeamMeetingContext"),
  holdSquadMeeting: (command: SquadMeetingCommand) =>
    runtimeCall<SquadMeetingResult>("holdSquadMeeting", { command }),
  appointCaptaincy: (command: { captainPersonId?: EntityId | null; viceCaptainPersonId?: EntityId | null }) =>
    runtimeCall<SquadDynamicsView>("appointCaptaincy", { command }),
  respondToDemand: (command: DemandResponseCommand) =>
    runtimeCall<DemandResponseResult>("respondToDemand", { command }),
  getPlayerProfile: (playerId: EntityId) =>
    runtimeCall<PlayerProfile>("getPlayerProfile", { playerId }),
  getPlayerPathway: (playerId: EntityId) =>
    runtimeCall<PlayerPathway>("getPlayerPathway", { playerId }),
  // These backend commands were always role-agnostic reads (this.withSession,
  // never this.managerCommand) — buildClubProfile/buildCompetitionProfile/
  // etc. already scope their OWN returned data by activeCareerRole
  // internally, so exposing them here is just closing an oversight, not
  // opening a new authority surface. This is what lets a Manager-side
  // storyline/inbox reference to a club, competition, staff member, or
  // infrastructure project open the same generic OrganizationProfilePanel
  // Owner/President already use, instead of silently staying plain text.
  getEntityReference: (entityType: EntityReferenceType, entityId: EntityId) =>
    runtimeCall<EntityReference>("getEntityReference", { entityType, entityId }),
  getOrganizationProfile: (entityType: OrganizationProfileEntityType, entityId: EntityId) =>
    runtimeCall<OrganizationProfile>("getOrganizationProfile", { entityType, entityId }),
  getClubProfile: (clubId: EntityId) => runtimeCall<ClubProfile>("getClubProfile", { clubId }),
  getStaffProfile: (personId: EntityId) =>
    runtimeCall<StaffProfileReadModel>("getStaffProfile", { personId }),
  getCompetitionProfile: (competitionId: EntityId) =>
    runtimeCall<CompetitionProfile>("getCompetitionProfile", { competitionId }),
  getInfrastructureProjectProfile: (projectId: EntityId) =>
    runtimeCall<InfrastructureProjectProfile>("getInfrastructureProjectProfile", { projectId }),
  getStoryThreads: () => runtimeCall<StoryThread[]>("getStoryThreads"),
  getStoryDetail: (eventId: EntityId) => runtimeCall<StoryDetail>("getStoryDetail", { eventId }),
  getEntityStoryline: (entityId: EntityId) => runtimeCall<EntityStoryline>("getEntityStoryline", { entityId }),
  getPlayerMarketValue: (playerId: EntityId) =>
    runtimeCall<PlayerMarketValueView>("getPlayerMarketValue", { playerId }),
  getPlayerActions: (playerId: EntityId) =>
    runtimeCall<ActorPlayerActions>("getPlayerActions", { playerId }),
  getManagerOwnerPlayerRequests: () =>
    runtimeCall<ManagerOwnerPlayerRequest[]>("getManagerOwnerPlayerRequests"),
  respondToOwnerPlayerRequest: (
    interactionId: EntityId,
    stance: OwnerManagerMeetingStance,
    commitment?: OwnerManagerCommitmentInput,
  ) =>
    runtimeCall<UniversalInteraction>("respondToOwnerPlayerRequest", {
      interactionId,
      stance,
      commitment,
    }),
  getMediaCentre: () => runtimeCall<MediaCentreView>("getMediaCentre"),
  requestPressConference: (storyId: EntityId) =>
    runtimeCall<PressConferenceView>("requestPressConference", { storyId }),
  answerPressConference: (input: {
    interviewId: EntityId;
    stance: MediaResponseStance;
    response: string;
  }) => runtimeCall<PressConferenceView>("answerPressConference", { input }),
  requestStructuredPressConference: (input: {
    context: "PRE_MATCH" | "POST_MATCH" | "TRANSFER" | "PLAYER_ISSUE";
    fixtureId?: EntityId;
  }) => runtimeCall<StructuredPressConferenceView>("requestStructuredPressConference", { input }),
  answerStructuredPressQuestion: (input: { interviewId: EntityId; stance: PressResponseStance }) =>
    runtimeCall<StructuredPressConferenceView>("answerStructuredPressQuestion", { input }),
  getStructuredPressConference: (interviewId: EntityId) =>
    runtimeCall<StructuredPressConferenceView>("getStructuredPressConference", { interviewId }),
  evaluatePreMatchPress: (fixtureId: EntityId) =>
    runtimeCall<StructuredPressConferenceView | undefined>("evaluatePreMatchPress", { fixtureId }),
  getSupporterOverview: () =>
    runtimeCall<SupporterReadModel | undefined>("getSupporterOverview"),
  getDressingRoom: () => runtimeCall<DressingRoomView>("getDressingRoom"),
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
  requestManagerBudget: (seasonLabel: string, category: ClubBudgetCategory, requestedAmount: number) => runtimeCall<ManagerBudgetRequest>("requestManagerBudget", { seasonLabel, category, requestedAmount }),
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
  respondLoanOffer: (command: { offerId: EntityId; action: "ACCEPT" | "WITHDRAW" }) =>
    runtimeCall<TransferCentre>("respondLoanOffer", { command }),
  withdrawTransferOffer: (command: { offerId: EntityId }) =>
    runtimeCall<TransferCentre>("withdrawTransferOffer", { command }),
  counterLoanOffer: (command: {
    offerId: EntityId;
    wageContributionPercent?: number;
    durationMonths?: number;
    playingTimeExpectation?: string;
    recallOption?: boolean;
  }) => runtimeCall<TransferCentre>("counterLoanOffer", { command }),
  setTransferStatus: (command: TransferListCommand) =>
    runtimeCall<TransferCentre>("setTransferStatus", { command }),
  getContracts: () => runtimeCall<ContractList>("getContracts"),
  renewContract: (command: ContractRenewalCommand) =>
    runtimeCall<ContractList>("renewContract", { command }),
  getStaff: (clubId?: EntityId) => runtimeCall<StaffList>("getStaff", { clubId }),
  getStaffMarket: () => runtimeCall<StaffMarketView>("getStaffMarket"),
  applyForStaffRole: (vacancyId: EntityId, personId: EntityId, salaryAmountMinor: number, contractMonths: number) =>
    runtimeCall<StaffHireResult>("applyForStaffRole", { vacancyId, personId, salaryAmountMinor, contractMonths }),
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
