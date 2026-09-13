import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  AppResult,
  CareerRole,
  CareerCreationCommand,
  AdvanceMatchCommand,
  ConcernResponseAction,
  ContractRenewalCommand,
  DemandResponseCommand,
  SquadMeetingCommand,
  EntityId,
  OrganizationProfileEntityType,
  LiveTacticsCommand,
  MediaResponseStance,
  PressResponseStance,
  RecruitmentSearchCommand,
  ScoutingAssignmentCommand,
  CreateDevelopmentPlanCommand,
  ReturnToPlayDecisionCommand,
  StaffResponsibilityDomain,
  StaffResponsibilityOwnerType,
  StartMatchCommand,
  SubstitutionCommand,
  TacticalSetup,
  TacticsUpdateCommand,
  TrainingUpdateCommand,
  TransferListCommand,
  TransferOfferCommand,
  TransferResponseCommand,
  TransferRequestCommand,
  TransferRequestResponseCommand,
  TransferLoanCommand,
  ClubBudgetCategory,
  InfrastructureProjectType,
  GovernmentFundingType,
  OwnerManagerCommitmentInput,
  OwnerManagerMeetingStance,
  OwnerManagerMeetingTopic,
  OwnerPlayerRequestIntent,
} from "@nepal-football-sim/shared-types";
import { DesktopApplicationService, type DesktopRuntimeOptions } from "./desktop-application.js";

export type DesktopServerOptions = DesktopRuntimeOptions & {
  /** 0 asks the OS for a free port; the chosen port is reported back. */
  port?: number;
  /** Shared secret the UI must present. Generated when omitted. */
  token?: string;
};

export type DesktopServerHandle = {
  port: number;
  token: string;
  service: DesktopApplicationService;
  close: () => Promise<void>;
};

const MAX_BODY_BYTES = 4_000_000;

/**
 * Loopback-only command transport in front of DesktopApplicationService.
 *
 * This exists because the simulation engine and SQLite layer are TypeScript/Node.
 * Tauri launches this as a managed sidecar; Vite dev launches the same process.
 * It holds no game logic of its own — every route is a direct service call.
 */
export const startDesktopServer = async (
  options: DesktopServerOptions,
): Promise<DesktopServerHandle> => {
  const service = new DesktopApplicationService(options);
  const token = options.token ?? randomToken();

  const server = createServer((request, response) => {
    void handle(request, response, service, token);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    port: (server.address() as AddressInfo).port,
    token,
    service,
    close: () => closeServer(server, service),
  };
};

const closeServer = async (server: Server, service: DesktopApplicationService): Promise<void> => {
  service.closeCareer();
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

const handle = async (
  request: IncomingMessage,
  response: ServerResponse,
  service: DesktopApplicationService,
  token: string,
): Promise<void> => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/health") {
    return send(response, 200, { ok: true, data: { status: "ready" } });
  }

  if (request.headers["x-runtime-token"] !== token) {
    return send(response, 401, {
      ok: false,
      error: { code: "RUNTIME_UNAVAILABLE", message: "Invalid runtime token." },
    });
  }

  if (request.method !== "POST" || !url.pathname.startsWith("/command/")) {
    return send(response, 404, {
      ok: false,
      error: { code: "RUNTIME_UNAVAILABLE", message: "Unknown runtime route." },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return send(response, 400, {
      ok: false,
      error: {
        code: "RUNTIME_UNAVAILABLE",
        message: "Malformed command payload.",
        detail: error instanceof Error ? error.message : undefined,
      },
    });
  }

  const command = url.pathname.slice("/command/".length);
  if (process.env.NEPAL_RUNTIME_TRACE) process.stderr.write(`[trace] ${command}\n`);
  const result = dispatch(service, command, body);
  return send(response, 200, result);
};

const dispatch = (
  service: DesktopApplicationService,
  command: string,
  body: Record<string, unknown>,
): AppResult<unknown> => {
  switch (command) {
    case "listSaves":
      return service.listSaves();
    case "listStartingClubs":
      return service.listStartingClubs();
    case "listFounderLocations":
      return service.listFounderLocations();
    case "listOwnerManagerCandidates":
      return service.listOwnerManagerCandidates();
    case "appointManager":
      return service.appointManager(body.vacancyId as EntityId, body.managerProfileId as EntityId);
    case "createCareer":
      return service.createCareer(body.command as CareerCreationCommand);
    case "loadCareer":
      return service.loadCareer(body.saveId as EntityId);
    case "closeCareer":
      return service.closeCareer();
    case "getCareerHeader":
      return service.getCareerHeader();
    case "getCareerRoles":
      return service.getCareerRoles();
    case "getSecretaryOperationsDesk":
      return service.getSecretaryOperationsDesk(body.clubId as EntityId);
    case "getExecutiveRecruitmentDesk":
      return service.getExecutiveRecruitmentDesk(body.clubId as EntityId);
    case "getExecutiveAuthority":
      return service.getExecutiveAuthority(body.clubId as EntityId | undefined);
    case "switchActiveCareerRole":
      return service.switchActiveCareerRole(body.targetRole as CareerRole);
    case "getChairmanDashboard":
      return service.getChairmanDashboard();
    case "getOwnerMatchday":
      return service.getOwnerMatchday();
    case "getOwnerFixtures":
      return service.getOwnerFixtures();
    case "attendOwnerFixture":
      return service.attendOwnerFixture(body.fixtureId as EntityId | undefined);
    case "getOwnerPostMatchSuggestion":
      return service.getOwnerPostMatchSuggestion();
    case "getFacilityPlanning":
      return service.getFacilityPlanning(body.clubId as EntityId | undefined);
    case "getFacilitySiteOptions":
      return service.getFacilitySiteOptions(
        body.clubId as EntityId,
        body.districtId as EntityId | undefined,
        body.municipalityName as string | undefined,
      );
    case "createFacilityProjectPlan":
      return service.createFacilityProjectPlan(body.input as any);
    case "getClubInfrastructureGovernmentContext":
      return service.getClubInfrastructureGovernmentContext(body.projectId as EntityId);
    case "openClubInfrastructureGovernmentRequest":
      return service.openClubInfrastructureGovernmentRequest(body.input as any);
    case "openFacilitySiteGovernmentRequest":
      return service.openFacilitySiteGovernmentRequest(body.input as any);
    case "getGovernmentSupportMeeting":
      return service.getGovernmentSupportMeeting(body.input as any);
    case "submitGovernmentSupportCase":
      return service.submitGovernmentSupportCase(body.applicationId as EntityId);
    case "watchOwnerFixture":
      return service.watchOwnerFixture(body.fixtureId as EntityId | undefined);
    case "advanceOwnerFixture":
      return service.advanceOwnerFixture(
        body.command as AdvanceMatchCommand,
        body.fixtureId as EntityId | undefined,
        body.viewMode as "TEXT_LIVE" | "KEY_EVENTS" | "QUICK_SIM" | undefined,
      );
    case "continueOwnerFixture":
      return service.continueOwnerFixture(
        body.fixtureId as EntityId | undefined,
        body.viewMode as "TEXT_LIVE" | "KEY_EVENTS" | "QUICK_SIM" | undefined,
      );
    case "quickSimOwnerFixture":
      return service.quickSimOwnerFixture(body.fixtureId as EntityId | undefined);
    case "getFederationPresidentDashboard":
      return service.getFederationPresidentDashboard();
    case "getNationalDevelopment":
      return service.getNationalDevelopment();
    case "getNationDevelopmentScorecard":
      return service.getNationDevelopmentScorecard();
    case "getFederationRefereeContext":
      return service.getFederationRefereeContext();
    case "getPlayerPathway":
      return service.getPlayerPathway(body.playerId as EntityId);
    case "getStoryThreads":
      return service.getStoryThreads();
    case "getStoryDetail":
      return service.getStoryDetail(body.eventId as EntityId);
    case "getEntityStoryline":
      return service.getEntityStoryline(body.entityId as EntityId);
    case "getFederationMap":
      return service.getFederationMap();
    case "getDistrictDetail":
      return service.getDistrictDetail(body.districtId as EntityId);
    case "getDistrictStoryline":
      return service.getDistrictStoryline(body.districtId as EntityId);
    case "getCompetitionPyramid":
      return service.getCompetitionPyramid();
    case "getGovernmentOverview":
      return service.getGovernmentOverview();
    case "requestGovernmentFunding":
      return service.requestGovernmentFunding(
        body.institutionId as EntityId,
        body.fundingType as GovernmentFundingType,
        body.requestedAmount as number,
      );
    case "getClubFinanceMeeting":
      return service.getClubFinanceMeeting(body.clubId as EntityId | undefined);
    case "getFederationCandidacy":
      return service.getFederationCandidacy();
    case "declareFederationElectionCandidacy":
      return service.declareFederationElectionCandidacy();
    case "seedE2ERoleFixture":
      return process.env.NEPAL_E2E_ROLE_FIXTURE === "1"
        ? service.seedE2ERoleFixture()
        : {
            ok: false,
            error: { code: "ROLE_NOT_AUTHORIZED", message: "The E2E role fixture is disabled." },
          };
    case "foundClub":
      return service.foundClub(body.name as string, body.locationName as string);
    case "implementFederationGovernanceProposal":
      return service.implementFederationGovernanceProposal(body.proposalId as EntityId);
    case "setClubBudget":
      return service.setClubBudget(
        body.clubId as EntityId,
        body.seasonLabel as string,
        body.category as ClubBudgetCategory,
        body.amount as number,
      );
    case "createInfrastructureProject":
      return service.createInfrastructureProject(
        body.clubId as EntityId,
        body.projectType as InfrastructureProjectType,
      );
    case "acceptSponsorOffer":
      return service.acceptSponsorOffer(body.clubId as EntityId, body.sponsorshipId as EntityId);
    case "rejectSponsorOffer":
      return service.rejectSponsorOffer(body.clubId as EntityId, body.sponsorshipId as EntityId);
    case "counterSponsorOffer":
      return service.counterSponsorOffer(
        body.clubId as EntityId,
        body.sponsorshipId as EntityId,
        body.annualValue as number,
        body.endDate as string | undefined,
      );
    case "getSponsorMeeting":
      return service.getSponsorMeeting(body.clubId as EntityId | undefined);
    case "rejectExecutiveSponsorOffer":
      return service.rejectExecutiveSponsorOffer(
        body.clubId as EntityId,
        body.sponsorshipId as EntityId,
      );
    case "counterExecutiveSponsorOffer":
      return service.counterExecutiveSponsorOffer(
        body.clubId as EntityId,
        body.sponsorshipId as EntityId,
        body.annualValue as number,
        body.endDate as string | undefined,
      );
    case "getFederationCommercialOverview":
      return service.getFederationCommercialOverview();
    case "getDatasetAttribution":
      return service.getDatasetAttribution();
    case "negotiateFederationCommercialOffer":
      return service.negotiateFederationCommercialOffer(body.offerId as EntityId);
    case "counterFederationCommercialOffer":
      return service.counterFederationCommercialOffer(body.offerId as EntityId, body.annualValue as number, body.termYears as number | undefined);
    case "acceptFederationCommercialOffer":
      return service.acceptFederationCommercialOffer(body.offerId as EntityId);
    case "rejectFederationCommercialOffer":
      return service.rejectFederationCommercialOffer(body.offerId as EntityId);
    case "createInvestorStakeOffer":
      return service.createInvestorStakeOffer(
        body.percentage as number,
        body.minimumAmount as number | undefined,
      );
    case "decideInvestorBid":
      return service.decideInvestorBid(body.offerId as EntityId, body.accept as boolean);
    case "counterInvestorBid":
      return service.counterInvestorBid(
        body.offerId as EntityId,
        body.terms as { amount: number; percentage?: number; boardSeatRequested?: boolean },
      );
    case "withdrawInvestorBidResponse":
      return service.withdrawInvestorBidResponse(body.offerId as EntityId);
    case "acknowledgeBoardOppositionForInvestorBid":
      return service.acknowledgeBoardOppositionForInvestorBid(body.offerId as EntityId);
    case "getInvestorMeeting":
      return service.getInvestorMeeting();
    case "injectOwnerCapital":
      return service.injectOwnerCapital(body.amount as number);
    case "getOwnerManagerMeeting":
      return service.getOwnerManagerMeeting(body.clubId as EntityId | undefined);
    case "openOwnerManagerMeeting":
      return service.openOwnerManagerMeeting(
        body.clubId as EntityId,
        body.topic as OwnerManagerMeetingTopic,
      );
    case "resolveOwnerManagerMeeting":
      return service.resolveOwnerManagerMeeting(
        body.interactionId as EntityId,
        body.stance as OwnerManagerMeetingStance,
        body.commitment as OwnerManagerCommitmentInput | undefined,
      );
    case "applyClubLoan":
      return service.applyClubLoan(
        body.lenderId as EntityId,
        body.principal as number,
        body.termMonths as number,
        body.purpose as string,
      );
    case "repayClubLoan":
      return service.repayClubLoan(body.debtId as EntityId, body.amount as number | undefined);
    case "acceptExecutiveSponsorOffer":
      return service.acceptExecutiveSponsorOffer(
        body.clubId as EntityId,
        body.sponsorshipId as EntityId,
      );
    case "setExecutiveClubBudget":
      return service.setExecutiveClubBudget(
        body.clubId as EntityId,
        body.seasonLabel as string,
        body.category as ClubBudgetCategory,
        body.amount as number,
      );
    case "createExecutiveInfrastructureProject":
      return service.createExecutiveInfrastructureProject(
        body.clubId as EntityId,
        body.projectType as InfrastructureProjectType,
      );
    case "applyExecutiveClubLoan":
      return service.applyExecutiveClubLoan(
        body.clubId as EntityId,
        body.lenderId as EntityId,
        body.principal as number,
        body.termMonths as number,
        body.purpose as string,
      );
    case "repayExecutiveClubLoan":
      return service.repayExecutiveClubLoan(
        body.clubId as EntityId,
        body.debtId as EntityId,
        body.amount as number | undefined,
      );
    case "closeExecutiveLicence":
      return service.closeExecutiveLicence(body.caseId as EntityId);
    case "registerExecutiveCompetitionPlayers":
      return service.registerExecutiveCompetitionPlayers(
        body.teamId as EntityId,
        body.competitionSeasonId as EntityId,
      );
    case "hireStaffAsExecutive":
      return service.hireStaffAsExecutive(
        body.clubId as EntityId,
        body.personId as EntityId,
        body.role as any,
        body.salaryAmountMinor as number,
        body.teamId as EntityId | undefined,
        body.contractMonths as number | undefined,
      );
    case "dismissStaffAsExecutive":
      return service.dismissStaffAsExecutive(
        body.clubId as EntityId,
        body.appointmentId as EntityId,
      );
    case "requestManagerBudget":
      return service.requestManagerBudget(
        body.seasonLabel as string,
        body.category as ClubBudgetCategory,
        body.requestedAmount as number,
      );
    case "decideManagerBudgetRequest":
      return service.decideManagerBudgetRequest(
        body.requestId as EntityId,
        body.approve as boolean,
      );
    case "purchaseEquipment":
      return service.purchaseEquipment(body.category as any, body.quantity as number);
    case "getHomeDashboard":
      return service.getHomeDashboard();
    case "continueCareer":
      return service.continueCareer();
    case "quickSimMatch":
      return service.quickSimMatch(body.fixtureId as EntityId | undefined);
    case "saveTactic":
      return service.saveTactic(body.tactic as TacticalSetup);
    case "saveCareer":
      return service.saveCareer();
    case "saveCareerAs":
      return service.saveCareerAs(body.saveName as string);
    case "deleteSave":
      return service.deleteSave(body.saveId as EntityId);
    case "getAutosaveStatus":
      return service.getAutosaveStatus();
    case "loadAutosaveSlot":
      return service.loadAutosaveSlot(body.slotIndex as number);
    // Manager gameplay (Step 3).
    case "getManagerDashboard":
      return service.getManagerDashboard();
    case "getSquad":
      return service.getSquad();
    case "getSquadConcerns":
      return service.getSquadConcerns();
    case "respondToConcern":
      return service.respondToConcern(
        body as { concernId: EntityId; action: ConcernResponseAction },
      );
    case "getTeamMeetingContext":
      return service.getTeamMeetingContext();
    case "holdSquadMeeting":
      return service.holdSquadMeeting(body.command as SquadMeetingCommand);
    case "respondToDemand":
      return service.respondToDemand(body.command as DemandResponseCommand);
    case "appointCaptaincy":
      return service.appointCaptaincy(
        body.command as { captainPersonId?: EntityId | null; viceCaptainPersonId?: EntityId | null },
      );
    case "getPlayerProfile":
      return service.getPlayerProfile(body.playerId as EntityId);
    case "getPlayerActions":
      return service.getPlayerActions(body.playerId as EntityId);
    case "getPlayerActionAvailability":
      return service.getPlayerActionAvailability(body.playerId as EntityId);
    case "getOwnerPlayerRequestContext":
      return service.getOwnerPlayerRequestContext(body.playerId as EntityId);
    case "openOwnerPlayerRequest":
      return service.openOwnerPlayerRequest(
        body.playerId as EntityId,
        body.intent as OwnerPlayerRequestIntent,
        body.deadline as string | undefined,
      );
    case "respondToOwnerPlayerRequest":
      return service.respondToOwnerPlayerRequest(
        body.interactionId as EntityId,
        body.stance as OwnerManagerMeetingStance,
        body.commitment as OwnerManagerCommitmentInput | undefined,
      );
    case "getManagerOwnerPlayerRequests":
      return service.getManagerOwnerPlayerRequests();
    case "getPlayerContractContext":
      return service.getPlayerContractContext(body.playerId as EntityId);
    case "getPlayerTransferContext":
      return service.getPlayerTransferContext(body.playerId as EntityId);
    case "getPlayerMarketValue":
      return service.getPlayerMarketValue(body.playerId as EntityId);
    case "getEntityReference":
      return service.getEntityReference(body.entityType as any, body.entityId as EntityId);
    case "getOrganizationProfile":
      return service.getOrganizationProfile(
        body.entityType as OrganizationProfileEntityType,
        body.entityId as EntityId,
      );
    case "getClubProfile":
      return service.getClubProfile(body.clubId as EntityId);
    case "getStaffProfile":
      return service.getStaffProfile(body.personId as EntityId);
    case "getCompetitionProfile":
      return service.getCompetitionProfile(body.competitionId as EntityId);
    case "getInfrastructureProjectProfile":
      return service.getInfrastructureProjectProfile(body.projectId as EntityId);
    case "getNationalTeamSquad":
      return service.getNationalTeamSquad(body.nationalTeamId as EntityId, body.programme as string | undefined);
    case "getTactics":
      return service.getTactics();
    case "updateTactics":
      return service.updateTactics(body.command as TacticsUpdateCommand);
    case "getTraining":
      return service.getTraining();
    case "updateTraining":
      return service.updateTraining(body.command as TrainingUpdateCommand);
    case "getPlayerDevelopment":
      return service.getPlayerDevelopment();
    case "createPlayerDevelopmentPlan":
      return service.createPlayerDevelopmentPlan(body.command as CreateDevelopmentPlanCommand);
    case "setPlayerDevelopmentPlanStatus":
      return service.setPlayerDevelopmentPlanStatus(body.planId as EntityId, body.status as string);
    case "getMedicalCentre":
      return service.getMedicalCentre();
    case "decideReturnToPlay":
      return service.decideReturnToPlay(body.command as ReturnToPlayDecisionCommand);
    case "getFixtures":
      return service.getFixtures();
    case "getFixture":
      return service.getFixture(body.fixtureId as EntityId);
    case "getCompetition":
      return service.getCompetition();
    case "getCalendar":
      return service.getCalendar();
    case "getScoutingDashboard":
      return service.getScoutingDashboard();
    case "createScoutingAssignment":
      return service.createScoutingAssignment(body.command as ScoutingAssignmentCommand);
    case "getScoutingReport":
      return service.getScoutingReport(body.playerId as EntityId);
    case "toggleShortlist":
      return service.toggleShortlist(body.playerId as EntityId);
    case "searchRecruitment":
      return service.searchRecruitment(body.command as RecruitmentSearchCommand);
    case "getTransferCentre":
      return service.getTransferCentre();
    case "makeTransferOffer":
      return service.makeTransferOffer(body.command as TransferOfferCommand);
    case "respondTransferOffer":
      return service.respondTransferOffer(body.command as TransferResponseCommand);
    case "makeTransferRequest":
      return service.makeTransferRequest(body.command as TransferRequestCommand);
    case "respondTransferRequest":
      return service.respondTransferRequest(body.command as TransferRequestResponseCommand);
    case "negotiateLoan":
      return service.negotiateLoan(body.command as TransferLoanCommand);
    case "respondLoanOffer":
      return service.respondLoanOffer(body.command as { offerId: EntityId; action: "ACCEPT" | "WITHDRAW" });
    case "withdrawTransferOffer":
      return service.withdrawTransferOffer(body.command as { offerId: EntityId });
    case "counterLoanOffer":
      return service.counterLoanOffer(
        body.command as {
          offerId: EntityId;
          wageContributionPercent?: number;
          durationMonths?: number;
          playingTimeExpectation?: string;
          recallOption?: boolean;
        },
      );
    case "setTransferStatus":
      return service.setTransferStatus(body.command as TransferListCommand);
    case "getContracts":
      return service.getContracts();
    case "renewContract":
      return service.renewContract(body.command as ContractRenewalCommand);
    // Interactive matchday (Step 4C).
    case "startMatch":
      return service.startMatch(body.command as StartMatchCommand);
    case "getLiveMatch":
      return service.getLiveMatch(
        body.fixtureId as EntityId | undefined,
        body.since as number | undefined,
      );
    case "advanceMatch":
      return service.advanceMatch(
        body.command as AdvanceMatchCommand,
        body.fixtureId as EntityId | undefined,
      );
    case "continueFromHalfTime":
      return service.continueFromHalfTime(body.fixtureId as EntityId | undefined);
    case "makeSubstitution":
      return service.makeSubstitution(
        body.command as SubstitutionCommand,
        body.fixtureId as EntityId | undefined,
      );
    case "updateLiveTactics":
      return service.updateLiveTactics(
        body.command as LiveTacticsCommand,
        body.fixtureId as EntityId | undefined,
      );
    case "quickSimCurrentMatch":
      return service.quickSimCurrentMatch(body.fixtureId as EntityId | undefined);
    case "resumeMatch":
      return service.resumeMatch(body.fixtureId as EntityId | undefined);
    case "getPostMatchReport":
      return service.getPostMatchReport(body.fixtureId as EntityId);
    case "getMatchSummary":
      return service.getMatchSummary(body.fixtureId as EntityId);
    case "getStaff":
      return service.getStaff(body.clubId as EntityId | undefined);
    case "getStaffMarket":
      return service.getStaffMarket();
    case "applyForStaffRole":
      return service.applyForStaffRole(
        body.vacancyId as EntityId,
        body.personId as EntityId,
        body.salaryAmountMinor as number,
        body.contractMonths as number,
      );
    case "respondToStaffApplication":
      return service.respondToStaffApplication(
        body.applicationId as EntityId,
        body.accept as boolean,
      );
    case "offerStaffContractRenewal":
      return service.offerStaffContractRenewal(
        body.appointmentId as EntityId,
        body.salaryAmountMinor as number,
        body.contractMonths as number,
      );
    case "respondToStaffRenewal":
      return service.respondToStaffRenewal(body.offerId as EntityId, body.accept as boolean);
    case "dismissStaffMember":
      return service.dismissStaffMember(body.appointmentId as EntityId);
    case "enrolStaffLicenceCourse":
      return service.enrolStaffLicenceCourse(body.personId as EntityId, body.clubFunded as boolean);
    // Staff Market Phase C.
    case "getStaffHierarchy":
      return service.getStaffHierarchy();
    case "assignStaffResponsibility":
      return service.assignStaffResponsibility(
        body.domain as StaffResponsibilityDomain,
        body.ownerType as StaffResponsibilityOwnerType,
        body.ownerAppointmentId as EntityId | undefined,
      );
    case "requestStaffBoardApproval":
      return service.requestStaffBoardApproval(body.domain as StaffResponsibilityDomain);
    case "createStaffDevelopmentPlan":
      return service.createStaffDevelopmentPlan(
        body.personId as EntityId,
        body.focus as string,
        body.targetLicenceType as string | undefined,
        body.clubFunded as boolean | undefined,
      );
    // Manager Career World (Step 5).
    case "getJobCentre":
      return service.getJobCentre();
    case "applyForJob":
      return service.applyForJob(body.vacancyId as EntityId);
    case "declineJobOffer":
      return service.declineJobOffer(body.applicationId as EntityId);
    case "acceptJobOffer":
      return service.acceptJobOffer(body.applicationId as EntityId);
    case "resignFromClub":
      return service.resignFromClub();
    case "getCareerHistory":
      return service.getCareerHistory();
    case "getMediaCentre":
      return service.getMediaCentre();
    case "requestPressConference":
      return service.requestPressConference(body.storyId as EntityId);
    case "answerPressConference":
      return service.answerPressConference(
        body.input as { interviewId: EntityId; stance: MediaResponseStance; response: string },
      );
    case "requestStructuredPressConference":
      return service.requestStructuredPressConference(
        body.input as { context: "PRE_MATCH" | "POST_MATCH" | "TRANSFER" | "PLAYER_ISSUE"; fixtureId?: EntityId },
      );
    case "answerStructuredPressQuestion":
      return service.answerStructuredPressQuestion(
        body.input as { interviewId: EntityId; stance: PressResponseStance },
      );
    case "getStructuredPressConference":
      return service.getStructuredPressConference(body.interviewId as EntityId);
    case "evaluatePreMatchPress":
      return service.evaluatePreMatchPress(body.fixtureId as EntityId);
    case "evaluateOwnerBusinessPress":
      return service.evaluateOwnerBusinessPress();
    case "answerOwnerStructuredPressQuestion":
      return service.answerOwnerStructuredPressQuestion(
        body.input as { interviewId: EntityId; stance: PressResponseStance },
      );
    case "getOwnerStructuredPressConference":
      return service.getOwnerStructuredPressConference(body.interviewId as EntityId);
    case "getSupporterOverview":
      return service.getSupporterOverview();
    case "getDressingRoom":
      return service.getDressingRoom();
    default:
      return {
        ok: false,
        error: { code: "RUNTIME_UNAVAILABLE", message: `Unknown command ${command}.` },
      };
  }
};

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Command payload is too large.");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
};

const send = (response: ServerResponse, status: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
};

const randomToken = (): string =>
  Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join("");
