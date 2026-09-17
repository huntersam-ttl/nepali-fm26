import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  CareerControlRepository,
  CareerWorldRepository,
  ClubEconomyRepository,
  CommercialRightsRepository,
  EventRepository,
  FacilityPlanningRepository,
  FederationGovernanceRepository,
  ClubLicensingRepository,
  CompetitionRepository,
  GovernmentRepository,
  ManagerRepository,
  MatchSessionRepository,
  MedicalRepository,
  PeopleFoundationRepository,
  PlayerRepository,
  SaveRepository,
  SquadDynamicsRepository,
  StaffMarketRepository,
  TransferMarketRepository,
  ClubVisualIdentityRepository,
  WorldRepository,
  createNewSave,
  loadSave,
  migrateDatabase,
  openGameDatabase,
  type GameDatabase,
  type PublicEventRole,
} from "@nepal-football-sim/database";
import {
  assertSchemaCompatible,
  atomicCopyDatabase,
  AUTOSAVE_SLOT_COUNT,
  backupBeforeMigrationIfNeeded,
  checkSaveIntegrity,
  DEFAULT_AUTOSAVE_INTERVAL_DAYS,
  isAutosaveDue,
  listAutosaveSlots,
  performAutosave,
  SaveIncompatibleError,
  withAutosaveStamp,
} from "./save-management.js";
import { advanceMacroEconomyForWorldDate } from "./macro-economy.js";
import { advanceInfrastructureProjects, processClubEconomyMonth } from "./club-economy.js";
import {
  advanceProcurementContracts,
  advanceProcurementOrders,
  advanceProcurementServices,
  createProcurementRequest,
  selectProcurementOffer,
} from "./clubmart.js";
import {
  advanceClubLoanRepayments,
  applyForClubLoanCommand,
  clubFinanceMeetingOverview,
  decideManagerBudgetRequest,
  initializeClubFinanceMarkets,
  repayClubLoanCommand,
  submitManagerBudgetRequest,
} from "./club-finance-markets.js";
import {
  createEntityId,
  createStableEntityId,
  type AppResult,
  type AutosaveSlotView,
  type AutosaveStatusView,
  type BaseCareerRole,
  type CareerCreationCommand,
  type CareerHeader,
  type CareerRole,
  type CareerRoleState,
  type ChairmanDashboard,
  type ClubFinanceMeetingOverview,
  type InvestorMeetingOverview,
  type OwnerManagerCommitmentInput,
  type OwnerManagerMeetingOverview,
  type OwnerManagerMeetingStance,
  type OwnerManagerMeetingTopic,
  type OwnerPlayerRequestContext,
  type ManagerOwnerPlayerRequest,
  type OwnerPlayerRequestIntent,
  type UniversalInteraction,
  type SponsorMeetingOverview,
  type FederationCommercialOverview,
  type OwnerInvestmentTransaction,
  type FederationDevelopmentSummary,
  type NationDevelopmentScorecard,
  type FederationRefereeContext,
  type PlayerPathway,
  type StoryThread,
  type StoryDetail,
  type EntityStoryline,
  type FederationMap,
  type DistrictDetail,
  type CompetitionPyramid,
  type GovernmentOverview,
  type GovernmentFundingApplication,
  type ClubInfrastructureGovernmentContext,
  type GovernmentSupportMeetingContext,
  type GovernmentFundingType,
  type FederationPresidentDashboard,
  type E2ERoleFixtureResult,
  type E2EDecisionPresentationFixtureResult,
  type FederationGovernanceProposal,
  type ClubBudget,
  type ClubBudgetCategory,
  type ClubLoanApplication,
  type ClubDebt,
  type ManagerBudgetRequest,
  type OwnershipAcquisitionOffer,
  type ProcurementCategory,
  type ProcurementOrder,
  type InfrastructureProject,
  type InfrastructureProjectType,
  type FacilityProjectPlan,
  type FacilitySiteOption,
  type SponsorshipContract,
  type SimulationClubRecord,
  type Club,
  type ClubProfile,
  type ClubVisualIdentityView,
  type ClubKitHistorySeason,
  type ClubBadgeShape,
  type ClubBadgeSymbol,
  type ClubKitDesignOverride,
  type InfrastructureProjectProfile,
  type StaffProfileReadModel,
  type CompetitionProfile,
  type NationalTeamSquadReadModel,
  type CompetitionRuleSet,
  type CompetitionSeason,
  type CalendarEntry,
  type CompetitionView,
  type ConcernResponseAction,
  type ConcernResponseResult,
  type DemandResponseCommand,
  type DemandResponseResult,
  type ContractList,
  type ContractRenewalCommand,
  type CreateDevelopmentPlanCommand,
  type DesktopAppError,
  type DesktopApplicationState,
  type DesktopErrorCode,
  type DatasetAttributionSummary,
  type EntityId,
  type EntityReference,
  type EntityReferenceType,
  type OrganizationProfile,
  type OrganizationProfileEntityType,
  type AdvanceMatchCommand,
  type FixtureDetail,
  type FixtureList,
  type FixtureReadModel,
  type FixtureRecord,
  type JobApplicationView,
  type JobCentreView,
  type JobVacancyView,
  type LiveMatchView,
  type LiveTacticsCommand,
  type ManagerCareerHistoryView,
  type ManagerCompetitionView,
  type ManagerContract,
  type ManagerDashboard,
  type ManagerProfile,
  type ManagerPromise,
  type MatchEvent,
  type MatchSessionRecord,
  type MatchViewMode,
  type MediaCentreView,
  type MediaInterview,
  type MediaResponseStance,
  type PressConferenceView,
  type PressResponseStance,
  type StructuredPressConferenceView,
  type SupporterReadModel,
  type DressingRoomView,
  type Person,
  type PlayerAttributeSet,
  type PlayerProfile,
  type PostMatchReadModel,
  type PostMatchReport,
  type QuickSimSummary,
  type RecruitmentSearchCommand,
  type RecruitmentSearchPage,
  type SaveCatalogEntry,
  type SaveMetadata,
  type ScoutingAssignmentCommand,
  type ScoutingDashboard,
  type ScoutingReportView,
  type SquadConcernView,
  type SquadDemandView,
  type SquadDynamicsView,
  type SquadMeetingCommand,
  type SquadMeetingResult,
  type SquadGroupMemberView,
  type SquadList,
  type TeamMeetingContext,
  type MedicalCentreEntryView,
  type MedicalCentreView,
  type ReturnToPlayDecisionCommand,
  type SquadPromiseView,
  type SquadRow,
  type StaffApplicationView,
  type StaffAppointment,
  type StaffApproachView,
  type StaffList,
  type StaffMarketView,
  type StaffHireResult,
  type StaffHireOutcomeView,
  type StaffDevelopmentPlanView,
  type StaffHierarchyEntryView,
  type StaffHierarchyView,
  type StaffRenewalOfferView,
  type StaffResponsibilityDomain,
  type StaffResponsibilityOwnerType,
  type StaffResponsibilityView,
  type StaffRowWithContract,
  type StaffSuccessionPlanView,
  type ExecutiveAuthorityDesktopView,
  type ExecutiveRecruitmentDesk,
  type ExecutiveRoleReadModel,
  type SecretaryOperationsDesk,
  type ExecutiveRole,
  type StartMatchCommand,
  type StartingClubOption,
  type FounderLocationOption,
  type OwnerManagerCandidate,
  type SubstitutionCommand,
  type TacticalAssignment,
  type TacticalSetup,
  type TacticsUpdateCommand,
  type TacticsView,
  type Team,
  type TeamCohesionView,
  type PlayerDevelopmentView,
  type TrainingUpdateCommand,
  type TrainingView,
  type TransferCentre,
  type TransferListCommand,
  type TransferOfferCommand,
  type TransferResponseCommand,
  type TransferRequestCommand,
  type TransferRequestResponseCommand,
  type TransferLoanCommand,
} from "@nepal-football-sim/shared-types";
import { validateNepalWorldDataset, type NepalWorldDataset } from "@nepal-football-sim/data-import";
import { generateLeagueFixtures } from "./fixture-generation.js";
import { importNepalWorld } from "./nepal-save.js";
import { applyCanonicalGlobalDatasetSeed } from "./global-football-seed.js";
import { createCareerCharacter, createManagerContract, testLicence } from "./manager-career.js";
import {
  acceptJobOffer as acceptJobOfferCommand,
  appointManagerForChairman,
  ChairmanManagerError,
  applyForJob as applyForJobCommand,
  careerHistory,
  declineJobOffer as declineJobOfferCommand,
  ensureAiManagersAssigned,
  evaluateBoardConfidence,
  JobApplicationError,
  JobOfferError,
  listVacancies,
  resignFromClub as resignFromClubCommand,
  advanceUnemployedCareer,
  ensureOwnerManagerCandidateSupply,
} from "./manager-career-world.js";
import {
  nextFixtureForTeam,
  quickSimManagerMatch,
  userMatchRequiresAction,
} from "./manager-flow.js";
import { ensureNepalFounderLocations, NEPAL_PROVINCE_DISTRICTS } from "./territorial-football.js";
import { ensureLowerLeaguePlayableWorld, reconcileWorkforceSupply } from "./workforce-supply.js";
import { initializePeopleFoundation } from "./people-foundation.js";
import { reconcilePlayablePlayerProfilesOnce } from "./player-profile-reconciliation.js";
import { initializeTransferMarketForSave, rebalanceNewNepalSaveSquads } from "./transfer-market.js";
import {
  BADGE_SHAPES,
  BADGE_SYMBOLS,
  KIT_PATTERNS,
  deterministicClubColours,
  deterministicClubKits,
  isValidHexColour,
} from "./club-visual-identity-colours.js";
import {
  appointNationalTeamHeadCoachForPresident,
  FederationPersonnelError,
} from "./national-team-management.js";
import {
  appointCaptaincy,
  CaptaincyActionError,
  ConcernActionError,
  DemandActionError,
  evaluateSquadDynamics,
  holdSquadMeeting,
  MeetingActionError,
  respondToConcern as respondToConcernCommand,
  respondToDemand as respondToDemandCommand,
  validActionsForConcern,
} from "./squad-dynamics.js";
import { evaluateTeamMeetingContext } from "./team-meeting-context.js";
import {
  acceptStaffApplication,
  acceptStaffRenewalCounter,
  applyForStaffVacancy,
  assertResponsibilityPermits,
  assignResponsibility,
  createStaffDevelopmentPlan,
  declineStaffApplication,
  declineStaffRenewalOffer,
  defaultResponsibilitiesForClub,
  dismissStaff,
  enrolInLicenceCourse,
  ensureAiStaffAssigned,
  evaluateAiStaffDevelopment,
  evaluateAllStaffContracts,
  evaluateLicenceCourses,
  completeTechnicalPartnershipPlacements,
  planTechnicalPartnershipPlacements,
  evaluateStaffDevelopmentPlans,
  evaluateStaffPerformance,
  evaluateStaffPoaching,
  evaluateSuccessionNeeds,
  hireStaff,
  LicenceCourseError,
  offerStaffRenewal,
  requestBoardApproval,
  RESPONSIBILITY_DOMAINS,
  ResponsibilityError,
  responsibilityOwner,
  staffCareerHistory,
  StaffActionError,
  staffHierarchyForClub,
  StaffNegotiationError,
  staffInterestScore,
  staffWorkloadForClub,
} from "./staff-market.js";
import {
  MatchAlreadyPlayedError,
  MatchCommandError,
  advanceMatch,
  continueFromHalfTime,
  finalizeMatch,
  loadMatchSession,
  makeSubstitution,
  quickSimFromCurrentState,
  simulateAndFinalizeMatch,
  startMatchSession,
  updateLiveTactics,
  type AdvanceTarget,
  type MatchFinalizationContext,
} from "./match-session.js";
import { requireFixtureOfficials } from "./referee-assignment.js";
import {
  applyTacticsCommand,
  buildLiveMatchView,
  buildPostMatchReport,
} from "./manager-matchday.js";
import type { LiveMatchState, SimulateMatchInput } from "./match-engine.js";
import {
  FORMATION_PRESETS,
  TACTICAL_STYLE_PRESETS,
  createTacticalSetup,
  tacticalPositionToPlayerPosition,
} from "./tactics.js";
import { resolveTeamTacticalSetup } from "./ai-tactics.js";
import { suitability } from "./team-selection.js";
import {
  activeCareerRole,
  heldCareerRoles,
  playableCareerRoles,
  switchActiveCareerRole,
} from "./career-control.js";

const EXECUTIVE_ROLES_TUPLE = ["SPORTING_DIRECTOR", "DIRECTOR_OF_FOOTBALL", "CEO", "GENERAL_SECRETARY"] as const;

/**
 * The NPC executive job (Sporting Director, Director of Football, CEO,
 * General Secretary) this person genuinely holds an active appointment for
 * — never derived from `activeCareerRole`/the career picker, since those
 * NPC jobs are no longer player-switchable. A human Owner who has
 * delegated a domain to (or personally been assigned as, in an unusual
 * save) one of these executives still reaches that executive's own
 * authority/desk commands through this held-appointment lookup, exactly as
 * before this migration — they simply never "become" the role to get
 * there. When `clubId` is given, only an appointment at that specific club
 * counts.
 */
const heldExecutiveRole = (
  db: GameDatabase,
  personId: EntityId,
  clubId?: EntityId,
): { role: ExecutiveRole; clubId: EntityId } | undefined => {
  const match = heldCareerRoles(db, personId).find(
    (entry) =>
      (EXECUTIVE_ROLES_TUPLE as readonly string[]).includes(entry.role) &&
      entry.targetId &&
      (!clubId || entry.targetId === clubId),
  );
  return match?.targetId ? { role: match.role as ExecutiveRole, clubId: match.targetId } : undefined;
};
import {
  ExecutiveRoleError,
  executiveHasAuthority,
  executiveRoleReadModel,
} from "./executive-roles.js";
import {
  acceptSponsorshipForExecutive,
  applyClubLoanForExecutive,
  repayClubLoanForExecutive,
  rejectSponsorshipForExecutive,
  counterSponsorshipForExecutive,
  closeLicenceForSecretary,
  dismissStaffForExecutive,
  hireStaffForExecutive,
  registerCompetitionPlayersForSecretary,
  setBudgetForExecutive,
} from "./executive-authority.js";
import { buildExecutiveRecruitmentDesk } from "./executive-recruitment.js";
import { buildSecretaryOperationsDesk } from "./executive-secretary.js";
import { backroomSummary } from "./career-market-deepening.js";
import {
  createInvestorStakeOffer,
  decideInvestorBid,
  counterInvestorBid,
  withdrawInvestorBidResponse,
  acknowledgeBoardOpposition,
  investorMeetingOverview,
  processDueOwnershipOffers,
  ensureOwnerPersonalFinancialProfile,
} from "./ownership.js";
import {
  createOwnerManagerMeeting,
  ownerManagerMeetingOverview,
  resolveOwnerManagerMeeting as resolveOwnerManagerMeetingCommand,
  createOwnerPlayerRequest,
  ownerPlayerRequestContext,
  managerOwnerPlayerRequests,
  respondToOwnerPlayerRequest,
  resolveOwnerPlayerRequestAfterAction,
} from "./owner-manager-meetings.js";
import { capitalInjectionFromInvestor } from "./investor.js";
import { buildChairmanDashboard, buildFederationPresidentDashboard } from "./role-desktop.js";
import {
  answerOwnerStructuredPressQuestion,
  evaluateOwnerBusinessPress,
  getOwnerStructuredPressConference,
} from "./owner-media-desktop.js";
import {
  answerPresidentStructuredPressQuestion,
  evaluatePresidentPress,
  getPresidentStructuredPressConference,
} from "./federation-media-desktop.js";
import {
  answerSportingDirectorStructuredPressQuestion,
  evaluateSportingDirectorPress,
  getSportingDirectorStructuredPressConference,
  sportingDirectorPressInboxItems,
} from "./sporting-director-media-desktop.js";
import { buildOwnerMatchday, type OwnerMatchdayView } from "./owner-matchday.js";
import { buildActorPlayerActions, type ActorPlayerActions } from "./player-actions.js";
import { buildEntityReference } from "./entity-reference.js";
import { buildOrganizationProfile } from "./organization-profile.js";
import { buildClubProfile, buildCompetitionProfile, buildInfrastructureProjectProfile, buildStaffProfile } from "./entity-profiles.js";
import { buildNationalTeamSquad } from "./national-team-squad.js";
import { buildPlayerContractContext, buildPlayerTransferContext } from "./player-context.js";
import { playerMarketValueView, type PlayerMarketValueView } from "./player-market-value.js";
import { buildOwnerPostMatchSuggestion } from "./owner-meeting-suggestion.js";
import {
  createFacilityProjectPlan,
  facilityComponentCatalog,
  generateFacilitySiteOptions,
  resolveClubDistrict,
  type FacilityPlanningInput,
} from "./facility-planning.js";
import {
  initializeFederationGovernanceForSave,
  federationCommercialOverview,
  createFederationProject,
} from "./federation-governance.js";
import {
  awardCommercialRightsForPresident,
  counterCommercialRights,
  negotiateCommercialRights,
} from "./commercial-rights.js";
import { federationDevelopmentSummary } from "./federation-policy.js";
import { buildNationDevelopmentScorecard } from "./federation-scorecard.js";
import { buildFederationRefereeContext } from "./federation-referee-context.js";
import { buildFederationMap, buildDistrictDetail } from "./federation-map.js";
import { initializeNepalTerritorialStructure } from "./territorial-football.js";
import { SeededRandom } from "./rng.js";
import { PLAUSIBLE_CLUB_LOCALITY_HUBS } from "./club-location.js";
import { buildPlayerPathway } from "./player-pathway.js";
import { roleStoryThreads, deriveStoryThreadsFromEvents, findThreadForEvent, buildEntityStoryline, currentEntityThread } from "./story-threads.js";
import { buildStoryDetail } from "./story-detail.js";
import { buildDistrictStoryline } from "./story-territory.js";
import { roleInboxEvents } from "./media.js";
import { buildCompetitionPyramid } from "./competition-pyramid-view.js";
import { governmentOverview, requestGovernmentFunding, requestClubInfrastructureGovernmentSupport, requestFacilitySiteGovernmentSupport, resolveGovernmentInstitutionForClub, clubInfrastructureGovernmentContext, advanceGovernmentApplications, buildGovernmentSupportMeeting, submitGovernmentFunding } from "./government.js";
import { publishMediaForDate } from "./media.js";
import {
  assessFederationCandidacy,
  declareFederationElectionCandidacy,
  implementFederationGovernanceProposalCommand,
} from "./federation-politics.js";
import {
  acceptSponsorOfferCommand,
  counterSponsorOffer,
  createInfrastructureProjectCommand,
  generateSponsorOffers,
  initializeClubEconomyForSave,
  rejectSponsorOfferCommand,
  setClubBudgetCommand,
  sponsorMeetingOverview,
} from "./club-economy.js";
import { ensurePlayableClubVenues, foundSimulationClub } from "./club-creation.js";
import {
  ManagerCommandError,
  advanceManagerCareer,
  applyTacticsUpdate,
  applyTrainingUpdate,
  buildCalendar,
  buildCompetitionView,
  buildContractList,
  buildFixtureDetail,
  buildFixtureList,
  buildManagerDashboard,
  buildPlayerDevelopmentView,
  buildPlayerProfile,
  managerProfileViewer,
  buildQuickSimSummary,
  buildScoutingDashboard,
  buildScoutingReport,
  buildSquadList,
  buildStaffList,
  buildTacticsView,
  buildTrainingView,
  buildTransferCentre,
  createDevelopmentPlan,
  createManagerScoutingAssignment,
  DevelopmentPlanError,
  setDevelopmentPlanStatus,
  assertManagerAuthority,
  ensureManagerSystems,
  makeManagerTransferOffer,
  renewManagerContract,
  respondToTransferOffer,
  makeManagerTransferRequest,
  respondManagerTransferRequest,
  negotiateManagerLoan,
  respondToLoanOffer,
  withdrawManagerTransferOffer,
  counterManagerLoanOffer,
  searchManagerRecruitment,
  setManagerTransferStatus,
  toggleManagerShortlist,
} from "./manager-desktop.js";
import {
  answerManagerPressConference,
  answerManagerStructuredPressQuestion,
  buildMediaCentreView,
  buildSupporterOverview,
  evaluateManagerPreMatchPress,
  getManagerStructuredPressConference,
  requestManagerPressConference,
  requestManagerStructuredPressConference,
} from "./manager-media-desktop.js";
import { buildDressingRoomView } from "./manager-people-desktop.js";
import {
  advanceAllRehabilitationPlans,
  buildMedicalCentreEntry,
  MedicalDecisionError,
  recordReturnToPlayDecision,
} from "./medical-rehab.js";

export type { DesktopAppError, AppResult };

export const GAME_VERSION = "0.2.0";

export type DesktopRuntimeOptions = {
  savesDirectory: string;
  worldDatasetPath: string;
  gameVersion?: string;
  /** Configurable autosave cadence, in in-game days. Also autosaves on season transitions regardless. */
  autosaveIntervalDays?: number;
  autosaveEnabled?: boolean;
};

/** Raw sqlite row. Column access is unchecked, exactly as in the repositories. */
type SqlRow = Record<string, any>;

type CareerSession = {
  saveId: EntityId;
  filePath: string;
  db: GameDatabase;
};

/** Resolved manager working set. Exported so Manager-mode modules can reuse it. */
export type ManagerContext = ReturnType<typeof managerContext>;

export { managerContext };

/**
 * Authoritative desktop runtime. Owns the SQLite career session and is the only
 * place that turns UI commands into simulation + repository work.
 */
export class DesktopApplicationService {
  private readonly savesDirectory: string;
  private readonly worldDatasetPath: string;
  private readonly gameVersion: string;
  private readonly autosaveIntervalDays: number;
  private readonly autosaveEnabled: boolean;
  private dataset?: NepalWorldDataset;
  private session?: CareerSession;
  /** Test-only deterministic fault injection for setClubVisualIdentity,
   * armed via armE2ENextIdentitySaveFailure — itself gated behind
   * NEPAL_E2E_ROLE_FIXTURE at the server layer, same as every other E2E
   * fixture command, so this can never be reached outside a dev/test
   * run. Consumed (reset to false) by the very next
   * setClubVisualIdentity call, so it fails exactly once and never
   * again — real production behaviour is completely unaffected when
   * this is never armed. */
  private e2eNextIdentitySaveShouldFail = false;

  constructor(options: DesktopRuntimeOptions) {
    this.savesDirectory = options.savesDirectory;
    this.worldDatasetPath = options.worldDatasetPath;
    this.gameVersion = options.gameVersion ?? GAME_VERSION;
    this.autosaveIntervalDays = options.autosaveIntervalDays ?? DEFAULT_AUTOSAVE_INTERVAL_DAYS;
    this.autosaveEnabled = options.autosaveEnabled ?? true;
  }

  getDatasetAttribution(): AppResult<DatasetAttributionSummary> {
    return ok({
      datasetVersion: "football_world_import_v16_reconciled_final",
      provenanceCategories: ["VERIFIED", "REPORTED", "ESTIMATED", "UNKNOWN", "SIMULATION_ONLY"],
      factualDataNotice:
        "Factual seed data retains source and provenance classifications; it is not a claim of unrestricted redistribution rights.",
      simulationOnlyNotice:
        "Generated businesses, offers, estimates, and other generated terms are SIMULATION_ONLY and are not factual claims.",
      externalWorldPolicy: "Nepal is simulated in full; outside-Nepal entities and outcomes remain CONTEXT_ONLY unless explicitly supported.",
      licensingNotice:
        "Source-specific redistribution permissions remain UNKNOWN or UNRESOLVED. Review the full attribution and licensing record before redistribution.",
      fullDocumentLabel: "Dataset Attribution and Licensing",
    });
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

  listFounderLocations(): AppResult<FounderLocationOption[]> {
    return ok(
      NEPAL_PROVINCE_DISTRICTS.flatMap(([province, districts]) =>
        districts.map((district) => ({
          id: createStableEntityId("location", district.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
          province,
          district,
          locality: district,
          provenanceStatus: "REPORTED" as const,
        })),
      ),
    );
  }

  listOwnerManagerCandidates(): AppResult<OwnerManagerCandidate[]> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may search for a manager.",
        );
      const club = db
        .prepare(
          "SELECT c.id FROM club_ownership_stakes s JOIN clubs c ON c.id=s.club_id WHERE s.holder_id=? AND s.holder_type='PERSON' AND s.status='ACTIVE' AND s.percentage>=51 ORDER BY s.percentage DESC LIMIT 1",
        )
        .get(personId) as { id?: EntityId } | undefined;
      if (!club?.id) return [];
      const vacancy = db
        .prepare(
          "SELECT j.id, c.name AS competition_name FROM manager_job_vacancies j JOIN teams t ON t.id=j.team_id LEFT JOIN club_memberships cm ON cm.team_id=t.id AND cm.status='ACTIVE' LEFT JOIN competition_seasons cs ON cs.id=cm.competition_season_id LEFT JOIN competitions c ON c.id=cs.competition_id WHERE j.club_id=? AND j.status='OPEN' ORDER BY j.opened_on LIMIT 1",
        )
        .get(club.id) as { id?: EntityId; competition_name?: string } | undefined;
      if (!vacancy?.id) return [];
      const division = vacancy.competition_name?.toLowerCase().includes("a-division")
        ? "A"
        : vacancy.competition_name?.toLowerCase().includes("b-division")
          ? "B"
          : "C";
      const wageExpectation =
        division === "A" ? 8_000_000 : division === "B" ? 5_000_000 : 2_500_000;
      return new ManagerRepository(db)
        .unemployedManagerProfiles()
        .slice(0, 8)
        .map((profile) => {
          const person = db
            .prepare(
              "SELECT p.full_name, p.display_name, co.name AS nationality FROM persons p LEFT JOIN countries co ON co.id=p.nationality_country_id WHERE p.id=?",
            )
            .get(profile.personId) as
            { full_name?: string; display_name?: string; nationality?: string } | undefined;
          const reputation = profile.attributes.personality.reputation;
          return {
            vacancyId: vacancy.id!,
            managerProfileId: profile.id,
            personId: profile.personId,
            name: person?.display_name ?? person?.full_name ?? profile.personId,
            nationality: person?.nationality ?? "Unknown",
            qualification: profile.reputationProfile.replaceAll("_", " "),
            reputation,
            wageExpectation,
            available: true,
          };
        });
    });
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
    const founderMode = command.careerMode === "OWNER" && Boolean(command.founder);
    const target = command.joinTeamId
      ? options.find((option) => option.teamId === command.joinTeamId)
      : founderMode
        ? undefined
        : options[0];
    if (!target && !founderMode) {
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
        initializeNepalTerritorialStructure(db, `${dataset.meta.targetDatabaseDate}-01`);
        ensureNepalFounderLocations(db);
        ensurePlayableClubVenues(db, `${dataset.meta.targetDatabaseDate}-01`);
        const candidateCountry = db
          .prepare("SELECT id FROM countries WHERE iso_code IN ('NP','NPL') ORDER BY id LIMIT 1")
          .get() as { id?: EntityId } | undefined;
        if (candidateCountry?.id)
          ensureOwnerManagerCandidateSupply(db, {
            date: `${dataset.meta.targetDatabaseDate}-01`,
            seed: `career:${command.saveName}`,
            countryId: candidateCountry.id,
          });
        ensureLowerLeaguePlayableWorld({
          db,
          date: `${dataset.meta.targetDatabaseDate}-01`,
          seed: `career:${command.saveName}`,
        });
        initializeTransferMarketForSave({
          db,
          worldDate: `${dataset.meta.targetDatabaseDate}-01`,
          seed: `career:${command.saveName}:market`,
        });
        rebalanceNewNepalSaveSquads(db, `${dataset.meta.targetDatabaseDate}-01`);
        const season = target
          ? seasonForTeam(db, target.teamId)
          : (() => {
              const row = db!
                .prepare(
                  `SELECT cs.* FROM competition_seasons cs JOIN competitions c ON c.id=cs.competition_id WHERE lower(c.name) LIKE '%c-division%' ORDER BY cs.start_date LIMIT 1`,
                )
                .get() as Record<string, string> | undefined;
              if (!row)
                throw appError(
                  "SAVE_CORRUPT",
                  "The lowest supported Nepal division is unavailable.",
                );
              return {
                id: row.id as EntityId,
                competitionId: row.competition_id as EntityId,
                name: row.name!,
                startDate: row.start_date!,
                endDate: row.end_date!,
              };
            })();
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

        let team = target ? getTeam(db, target.teamId) : undefined;
        if (founderMode) {
          const founder = command.founder!;
          const location = db
            .prepare(
              "SELECT id FROM locations WHERE country_id=(SELECT id FROM countries WHERE iso_code IN ('NP','NPL') ORDER BY id LIMIT 1) AND kind='district' AND lower(name)=lower(?) LIMIT 1",
            )
            .get(founder.locationName ?? founder.clubName) as { id?: EntityId } | undefined;
          if (!location?.id)
            throw appError("INVALID_SELECTION", "Choose one of Nepal's canonical districts.");
          const founded = foundSimulationClub(db, {
            name: founder.clubName,
            locationId: location.id,
            foundedOn: careerStartDate,
            seed: `desktop:${command.saveName}:founder`,
            groundName: founder.groundName ?? `${founder.clubName} Ground`,
            competitionSeasonId: season.id,
            founderPersonId: career.person.id,
            founderName: displayName(career.person),
            callerRole: "CHAIRMAN_OWNER",
          });
          const founderTeam = db
            .prepare("SELECT id FROM teams WHERE club_id=? AND level='senior' ORDER BY id LIMIT 1")
            .get(founded.clubId) as { id?: EntityId } | undefined;
          if (!founderTeam?.id)
            throw appError("SAVE_CORRUPT", "The founded club has no senior team.");
          team = getTeam(db, founderTeam.id);
          initializeClubEconomyForSave({
            db,
            worldDate: careerStartDate,
            seed: `career:${command.saveName}:founder-economy`,
          });
          ensureLowerLeaguePlayableWorld({
            db,
            date: careerStartDate,
            seed: `career:${command.saveName}:founder`,
          });
          initializeTransferMarketForSave({
            db,
            worldDate: careerStartDate,
            seed: `career:${command.saveName}:founder-market`,
          });
          rebalanceNewNepalSaveSquads(db, careerStartDate);
          db.prepare("DELETE FROM fixtures WHERE competition_season_id=?").run(season.id);
          scheduleSeasonFixtures(db, season, ruleSet);
          ensureOwnerPersonalFinancialProfile(db, career.person.id, founded.clubId, careerStartDate);
        }
        if (!team) throw appError("SAVE_CORRUPT", "The career team is missing.");
        if ((command.careerMode ?? "MANAGER") === "MANAGER")
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
        if ((command.careerMode ?? "MANAGER") === "OWNER" && !founderMode) {
          if (!team.clubId)
            throw appError("INVALID_SELECTION", "Owner careers require a club-backed senior team.");
          initializeClubEconomyForSave({
            db,
            worldDate: careerStartDate,
            seed: `career:${command.saveName}:economy`,
          });
          const club = getClub(db, team.clubId);
          if (!club || ["DEPARTMENTAL", "MUNICIPALITY_BACKED"].includes(club.ownershipType)) {
            throw appError(
              "INVALID_SELECTION",
              "This club does not permit a controlling owner career start.",
            );
          }
          const person = getPerson(db, career.person.id);
          new ClubEconomyRepository(db).upsertOwnershipStake({
            id: createStableEntityId("career-start-owner", `${team.clubId}:${career.person.id}`),
            clubId: team.clubId,
            holderType: "PERSON",
            holderId: career.person.id,
            holderName: displayName(person),
            role: "MAJORITY_OWNER",
            percentage: 75,
            votingPercentage: 75,
            startDate: careerStartDate,
            status: "ACTIVE",
            ownershipModel: "PARTIALLY_BUYABLE",
            provenanceStatus: "SIMULATION_ONLY",
          });
          ensureOwnerPersonalFinancialProfile(db, career.person.id, team.clubId, careerStartDate);
        }
        initializePeopleFoundation({
          db,
          date: careerStartDate,
          seed: `career:${command.saveName}`,
        });
        const players = new PlayerRepository(db).attributesForTeam(team.id);
        if ((command.careerMode ?? "MANAGER") === "MANAGER")
          managers.insertTacticalSetup(defaultSetup(team.id, players, career.managerProfile.id));
        managers.insertInboxItem({
          id: createEntityId(),
          createdOn: careerStartDate,
          type: "FIXTURE_UPCOMING",
          title: founderMode
            ? `Welcome to ${command.founder!.clubName}`
            : `Welcome to ${target!.clubName}`,
          body: founderMode
            ? `You founded ${command.founder!.clubName} in the ${season.name}.`
            : `You have taken charge of ${target!.teamName} in the ${target!.competitionName}.`,
          relatedEntity: { type: "team", id: team.id },
          read: false,
        });
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }

      // Global context (foreign clubs/competitions/players) is applied after
      // the Nepal-only transaction commits, in its own transaction — the
      // importer manages that itself and is idempotent by dataset version,
      // so this can never duplicate world data. A world built without the
      // committed dataset artifact present (e.g. a stripped-down test
      // environment) simply stays Nepal-only rather than failing the career.
      applyCanonicalGlobalDatasetSeed(db);

      const opened = loadSave(db);
      this.session = { saveId: opened.id, filePath, db };
      this.warmManagerSystems(db, opened);
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
      const integrity = checkSaveIntegrity(db);
      if (!integrity.ok) {
        throw new SaveIncompatibleError(
          "SAVE_CORRUPT",
          `This save file is corrupt: ${integrity.detail}`,
        );
      }
      assertSchemaCompatible(db);
      backupBeforeMigrationIfNeeded(db, filePath);
      migrateDatabase(db);
      const save = loadSave(db);
      this.session = { saveId: save.id, filePath, db };
      this.warmManagerSystems(db, save);
      const state = this.buildState(db, save, filePath);
      this.writeCatalogEntry(state.catalogEntry);
      return ok(state);
    } catch (error) {
      db?.close();
      this.session = undefined;
      if (error instanceof SaveIncompatibleError) return fail(error.code, error.message);
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

  getCareerRoles(): AppResult<CareerRoleState> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      // heldRoles is the player-facing role picker surface: it must never
      // offer an NPC executive job (SPORTING_DIRECTOR/DIRECTOR_OF_FOOTBALL/
      // CEO/GENERAL_SECRETARY) as something to switch into, even when this
      // person genuinely holds one. Those stay reachable only through their
      // own dedicated executive-authority APIs.
      const heldRoles = playableCareerRoles(db, personId);
      return { activeRole: activeCareerRole(db, personId), heldRoles };
    });
  }

  getExecutiveAuthority(clubId?: EntityId): AppResult<ExecutiveAuthorityDesktopView | undefined> {
    return this.withSession((db, save) => {
      const actorPersonId = careerPersonId(db, save);
      // Resolved from a genuinely held executive appointment, never from
      // activeCareerRole/the career picker — SPORTING_DIRECTOR, DIRECTOR_OF_
      // FOOTBALL, CEO and GENERAL_SECRETARY are NPC jobs, never something a
      // player switches into, even when this same person happens to hold
      // one (e.g. a delegated appointment). The player reaches this data by
      // staying in their real playable role (Owner/Manager/President), not
      // by impersonating the executive.
      const held = heldExecutiveRole(db, actorPersonId, clubId);
      if (!held) return undefined;
      const actorRole = held.role;
      const targetClubId = held.clubId;
      const assignment = executiveRoleReadModel(db, targetClubId, actorRole);
      const isRecruitmentExecutive = actorRole === "SPORTING_DIRECTOR" || actorRole === "DIRECTOR_OF_FOOTBALL";
      return {
        actorPersonId,
        actorRole,
        clubId: targetClubId,
        assignment,
        permittedActions: assignment.status === "FILLED" ? assignment.authorities : [],
        blockedReason:
          assignment.status === "FILLED" ? undefined : "This executive role is vacant.",
        // CEO/General Secretary own no distinct press-worthy authority of
        // their own (see the CEO/GS audit) — always empty for them.
        inbox:
          isRecruitmentExecutive && assignment.status === "FILLED"
            ? sportingDirectorPressInboxItems(db, actorPersonId, actorRole)
            : [],
      };
    });
  }

  /**
   * The recruitment desk a sporting director / director of football works
   * from. Authority is resolved per-authority through the canonical
   * delegation check inside the builder, so an executive with no recruitment
   * authority gets an honest empty desk rather than a hidden screen.
   */
  getExecutiveRecruitmentDesk(clubId: EntityId): AppResult<ExecutiveRecruitmentDesk> {
    return this.withSession((db, save) =>
      buildExecutiveRecruitmentDesk(db, save, clubId, careerPersonId(db, save)),
    );
  }

  /**
   * The general secretary's administrative desk. Like the recruitment desk,
   * authority is resolved per-section through the canonical delegation check,
   * so a role without a given authority gets an honest empty section.
   */
  getSecretaryOperationsDesk(clubId: EntityId): AppResult<SecretaryOperationsDesk> {
    return this.withSession((db, save) =>
      buildSecretaryOperationsDesk(db, save, clubId, careerPersonId(db, save)),
    );
  }

  acceptExecutiveSponsorOffer(
    clubId: EntityId,
    sponsorshipId: EntityId,
  ): AppResult<ReturnType<typeof acceptSponsorshipForExecutive>> {
    return this.withSession((db, save) =>
      acceptSponsorshipForExecutive(db, {
        clubId,
        sponsorshipId,
        actor: this.executiveActor(db, save, clubId),
        date: save.worldDate,
      }),
    );
  }

  setExecutiveClubBudget(
    clubId: EntityId,
    seasonLabel: string,
    category: ClubBudgetCategory,
    amount: number,
  ): AppResult<ReturnType<typeof setBudgetForExecutive>> {
    return this.withSession((db, save) =>
      setBudgetForExecutive(db, {
        clubId,
        seasonLabel,
        category,
        amount,
        actor: this.executiveActor(db, save, clubId),
      }),
    );
  }

  createExecutiveInfrastructureProject(
    clubId: EntityId,
    projectType: InfrastructureProjectType,
  ): AppResult<ReturnType<typeof createInfrastructureProjectCommand>> {
    return this.withSession((db, save) =>
      createInfrastructureProjectCommand(db, {
        clubId,
        personId: this.executiveActor(db, save, clubId).personId,
        callerRole: "CEO",
        projectType,
        date: save.worldDate,
        seed: `${save.randomSeed}:executive-project`,
      }),
    );
  }

  applyExecutiveClubLoan(
    clubId: EntityId,
    lenderId: EntityId,
    principal: number,
    termMonths: number,
    purpose: string,
  ): AppResult<ReturnType<typeof applyClubLoanForExecutive>> {
    return this.withSession((db, save) =>
      applyClubLoanForExecutive(db, {
        clubId,
        lenderId,
        principal,
        termMonths,
        purpose,
        date: save.worldDate,
        actor: this.executiveActor(db, save, clubId),
      }),
    );
  }

  repayExecutiveClubLoan(
    clubId: EntityId,
    debtId: EntityId,
    amount?: number,
  ): AppResult<ReturnType<typeof repayClubLoanForExecutive>> {
    return this.withSession((db, save) =>
      repayClubLoanForExecutive(db, {
        clubId,
        debtId,
        amount,
        date: save.worldDate,
        actor: this.executiveActor(db, save, clubId),
      }),
    );
  }

  closeExecutiveLicence(caseId: EntityId): AppResult<ReturnType<typeof closeLicenceForSecretary>> {
    return this.withSession((db, save) => {
      const actor = this.executiveActorForCase(db, save, caseId);
      return closeLicenceForSecretary(db, { caseId, date: save.worldDate, actor });
    });
  }

  registerExecutiveCompetitionPlayers(
    teamId: EntityId,
    competitionSeasonId: EntityId,
  ): AppResult<ReturnType<typeof registerCompetitionPlayersForSecretary>> {
    return this.withSession((db, save) => {
      const clubId = (
        db.prepare("SELECT club_id AS clubId FROM teams WHERE id=?").get(teamId) as
          { clubId?: EntityId } | undefined
      )?.clubId;
      if (!clubId) throw appError("INVALID_SELECTION", "Competition registration team not found.");
      return registerCompetitionPlayersForSecretary(db, {
        teamId,
        competitionSeasonId,
        date: save.worldDate,
        actor: this.executiveActor(db, save, clubId),
      });
    });
  }

  hireStaffAsExecutive(
    clubId: EntityId,
    personId: EntityId,
    role: StaffAppointment["role"],
    salaryAmountMinor: number,
    teamId?: EntityId,
    contractMonths?: number,
  ): AppResult<ReturnType<typeof hireStaffForExecutive>> {
    return this.withSession((db, save) =>
      hireStaffForExecutive(db, save, {
        clubId,
        teamId,
        personId,
        role,
        salaryAmountMinor,
        contractMonths,
        actor: this.executiveActor(db, save, clubId),
      }),
    );
  }

  dismissStaffAsExecutive(
    clubId: EntityId,
    appointmentId: EntityId,
  ): AppResult<ReturnType<typeof dismissStaffForExecutive>> {
    return this.withSession((db, save) =>
      dismissStaffForExecutive(db, save, {
        clubId,
        appointmentId,
        actor: this.executiveActor(db, save, clubId),
      }),
    );
  }

  switchActiveCareerRole(targetRole: CareerRole): AppResult<CareerHeader> {
    return this.withSession((db, save, filePath) => {
      const personId = careerPersonId(db, save);
      try {
        switchActiveCareerRole(db, personId, targetRole);
      } catch (error) {
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          error instanceof Error ? error.message : "Role is not held.",
        );
      }
      const updated = loadSave(db, save.id);
      this.writeCatalogEntry(this.catalogEntry(db, updated, filePath));
      return careerHeader(db, updated);
    });
  }

  /**
   * Owner supervision read model: every executive role at the owned club
   * (SPORTING_DIRECTOR, DIRECTOR_OF_FOOTBALL, CEO, GENERAL_SECRETARY),
   * showing its current holder or vacancy and delegated authorities —
   * regardless of who holds it. Unlike getExecutiveAuthority (which only
   * resolves for a person genuinely holding the job themselves), this is
   * the Owner's own supervision surface: they never need to become the
   * executive to see who is doing the job.
   */
  getClubExecutiveOverview(clubId?: EntityId): AppResult<ExecutiveRoleReadModel[]> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "You do not currently hold the Chairman role.");
      }
      const targetClubId =
        clubId ?? heldCareerRoles(db, personId).find((role) => role.role === "CHAIRMAN_OWNER")?.targetId;
      if (!targetClubId) throw appError("ROLE_NOT_AUTHORIZED", "No club is available.");
      if (!heldCareerRoles(db, personId).some((entry) => entry.role === "CHAIRMAN_OWNER" && entry.targetId === targetClubId))
        throw appError("ROLE_NOT_AUTHORIZED", "The owner does not control this club.");
      return EXECUTIVE_ROLES_TUPLE.map((role) => executiveRoleReadModel(db, targetClubId, role));
    });
  }

  getChairmanDashboard(): AppResult<ChairmanDashboard> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "You do not currently hold the Chairman role.");
      }
      // Same backfill as getInvestorMeeting — the dashboard is the other
      // common first stop for a returning owner from an older save.
      const clubId = heldCareerRoles(db, personId).find(
        (role) => role.role === "CHAIRMAN_OWNER",
      )?.targetId;
      if (clubId) ensureOwnerPersonalFinancialProfile(db, personId, clubId, save.worldDate);
      return buildChairmanDashboard(db, save);
    });
  }

  /** The single natural Owner press entry point — called once when the
   * owner opens their dashboard. Creates an OWNER_BUSINESS interview only
   * from a genuinely new, real club-business fact (never a recurring
   * schedule); returns undefined when there is nothing new to ask about.
   * Idempotent per fact. */
  evaluateOwnerBusinessPress(): AppResult<StructuredPressConferenceView | undefined> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "You do not currently hold the Chairman role.");
      }
      const clubId = heldCareerRoles(db, personId).find(
        (role) => role.role === "CHAIRMAN_OWNER",
      )?.targetId;
      if (!clubId) throw appError("ROLE_NOT_AUTHORIZED", "No controlled club is available.");
      return evaluateOwnerBusinessPress(db, save, { clubId, ownerPersonId: personId });
    });
  }

  answerOwnerStructuredPressQuestion(input: {
    interviewId: EntityId;
    stance: PressResponseStance;
  }): AppResult<StructuredPressConferenceView> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "You do not currently hold the Chairman role.");
      }
      return answerOwnerStructuredPressQuestion(db, save, {
        ownerPersonId: personId,
        interviewId: input.interviewId,
        stance: input.stance,
      });
    });
  }

  getOwnerStructuredPressConference(interviewId: EntityId): AppResult<StructuredPressConferenceView> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "You do not currently hold the Chairman role.");
      }
      return getOwnerStructuredPressConference(db, { ownerPersonId: personId, interviewId });
    });
  }

  /** The single natural Federation President press entry point — called
   * once when the President opens their federation dashboard. Creates a
   * FEDERATION_GOVERNANCE interview only from a genuinely new, real
   * federation-governance fact (never a recurring schedule); returns
   * undefined when there is nothing new to ask about. Idempotent per
   * fact. */
  evaluatePresidentPress(): AppResult<StructuredPressConferenceView | undefined> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const federationId = this.currentFederationId(db, personId);
      return evaluatePresidentPress(db, save, { federationId, presidentPersonId: personId });
    });
  }

  answerPresidentStructuredPressQuestion(input: {
    interviewId: EntityId;
    stance: PressResponseStance;
  }): AppResult<StructuredPressConferenceView> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      this.currentFederationId(db, personId);
      return answerPresidentStructuredPressQuestion(db, save, {
        presidentPersonId: personId,
        interviewId: input.interviewId,
        stance: input.stance,
      });
    });
  }

  getPresidentStructuredPressConference(interviewId: EntityId): AppResult<StructuredPressConferenceView> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      this.currentFederationId(db, personId);
      return getPresidentStructuredPressConference(db, { presidentPersonId: personId, interviewId });
    });
  }

  /** Authority gate shared by the three Sporting Director / Director of
   * Football press commands below — mirrors currentFederationId(). Both
   * roles carry identical recruitment authority (executiveAuthorities), so
   * either is accepted; heldCareerRoles already only returns a role backed
   * by a genuinely FILLED, ACTIVE executive assignment. */
  private currentRecruitmentActor(
    db: GameDatabase,
    personId: EntityId,
  ): { clubId: EntityId; actorRole: CareerRole } {
    // Resolved from a genuinely held SD/DoF appointment, never from
    // activeCareerRole — these are NPC jobs, never something the player
    // switches into. Reachable while the player stays in their real
    // playable role, exactly like getExecutiveAuthority above.
    const held = heldExecutiveRole(db, personId);
    if (!held || (held.role !== "SPORTING_DIRECTOR" && held.role !== "DIRECTOR_OF_FOOTBALL")) {
      throw appError(
        "ROLE_NOT_AUTHORIZED",
        "You do not currently hold recruitment authority at a club.",
      );
    }
    return { clubId: held.clubId, actorRole: held.role };
  }

  /** The single natural Sporting Director / Director of Football press
   * entry point — called once when the executive dashboard opens. Creates
   * a RECRUITMENT interview only from a genuinely new, real transfer-
   * business fact (never a recurring schedule), and only once the club has
   * actually delegated the TRANSFERS domain away from its Manager; returns
   * undefined when there is nothing new to ask about. Idempotent per
   * fact. */
  evaluateSportingDirectorPress(): AppResult<StructuredPressConferenceView | undefined> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const { clubId, actorRole } = this.currentRecruitmentActor(db, personId);
      return evaluateSportingDirectorPress(db, save, { clubId, sdPersonId: personId, actorRole });
    });
  }

  answerSportingDirectorStructuredPressQuestion(input: {
    interviewId: EntityId;
    stance: PressResponseStance;
  }): AppResult<StructuredPressConferenceView> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const { actorRole } = this.currentRecruitmentActor(db, personId);
      return answerSportingDirectorStructuredPressQuestion(db, save, {
        sdPersonId: personId,
        actorRole,
        interviewId: input.interviewId,
        stance: input.stance,
      });
    });
  }

  getSportingDirectorStructuredPressConference(interviewId: EntityId): AppResult<StructuredPressConferenceView> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const { actorRole } = this.currentRecruitmentActor(db, personId);
      return getSportingDirectorStructuredPressConference(db, { sdPersonId: personId, actorRole, interviewId });
    });
  }

  getOwnerMatchday(): AppResult<OwnerMatchdayView> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may view matchday operations.",
        );
      const clubId = heldCareerRoles(db, personId).find(
        (role) => role.role === "CHAIRMAN_OWNER",
      )?.targetId;
      if (!clubId) throw appError("ROLE_NOT_AUTHORIZED", "No controlled club is available.");
      return buildOwnerMatchday(db, save, clubId);
    });
  }

  getFacilityPlanning(clubId?: EntityId): AppResult<{
    clubId: EntityId;
    worldDate: string;
    projects: InfrastructureProject[];
    plans: FacilityProjectPlan[];
    sites: FacilitySiteOption[];
    componentCatalog: Record<string, readonly string[]>;
    homeDistrict?: { districtId: EntityId; districtName: string; municipalityName: string };
    governmentApplications: GovernmentFundingApplication[];
    managerFacilityRequests: ManagerPromise[];
  }> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const role = activeCareerRole(db, personId);
      const target =
        clubId ??
        heldCareerRoles(db, personId).find((entry) =>
          ["CHAIRMAN_OWNER", "CEO", "GENERAL_SECRETARY"].includes(entry.role),
        )?.targetId;
      if (!target)
        throw appError("ROLE_NOT_AUTHORIZED", "No club facility responsibility is available.");
      const facilityExecutive = heldExecutiveRole(db, personId, target);
      if (role === "CHAIRMAN_OWNER") {
        if (
          !heldCareerRoles(db, personId).some(
            (entry) => entry.role === role && entry.targetId === target,
          )
        )
          throw appError("ROLE_NOT_AUTHORIZED", "The owner does not control this club.");
      } else if (facilityExecutive?.role === "CEO" || facilityExecutive?.role === "GENERAL_SECRETARY") {
        this.executiveActor(db, save, target);
      } else if (role !== "MANAGER") {
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "The active role cannot view club facility planning.",
        );
      }
      const planning = new FacilityPlanningRepository(db);
      const team = db
        .prepare("SELECT id FROM teams WHERE club_id=? AND level='senior' ORDER BY id LIMIT 1")
        .get(target) as { id?: EntityId } | undefined;
      const managerFacilityRequests = team?.id
        ? new SquadDynamicsRepository(db)
            .activePromisesForTeam(team.id)
            .filter((promise) => promise.type === "FACILITY_PROJECT")
        : [];
      return {
        clubId: target,
        worldDate: save.worldDate,
        projects: new ClubEconomyRepository(db).infrastructureProjects(target),
        plans: planning.plans(target),
        sites: planning.siteOptions(target),
        componentCatalog: facilityComponentCatalog,
        homeDistrict: resolveClubDistrict(db, target),
        // Federation-wide applications are the only source of a real
        // governmentApplicationId — none are ever created against this club
        // today (requestGovernmentFunding is federation-president-only and
        // takes no clubId), so this is filtered honestly rather than faked.
        governmentApplications: new GovernmentRepository(db)
          .applications()
          .filter((application) => application.clubId === target),
        managerFacilityRequests,
        resolvedInstitution: (() => {
          const institution = resolveGovernmentInstitutionForClub(db, target);
          return institution
            ? buildEntityReference(db, "GOVERNMENT_INSTITUTION", institution.id, role)
            : undefined;
        })(),
      };
    });
  }

  getFacilitySiteOptions(
    clubId: EntityId,
    districtId?: EntityId,
    municipalityName?: string,
  ): AppResult<FacilitySiteOption[]> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const role = activeCareerRole(db, personId);
      const executive = heldExecutiveRole(db, personId, clubId);
      if (role === "CHAIRMAN_OWNER") {
        if (
          !heldCareerRoles(db, personId).some(
            (entry) => entry.role === role && entry.targetId === clubId,
          )
        )
          throw appError("ROLE_NOT_AUTHORIZED", "The owner does not control this club.");
      } else if (executive?.role === "CEO" || executive?.role === "GENERAL_SECRETARY")
        this.executiveActor(db, save, clubId);
      else
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the owner or authorized executive may plan a new site.",
        );
      const resolvedDistrict =
        districtId && municipalityName
          ? { districtId, municipalityName }
          : resolveClubDistrict(db, clubId);
      if (!resolvedDistrict)
        throw appError(
          "INVALID_SELECTION",
          "This club has no district on record to site a new project in.",
        );
      return generateFacilitySiteOptions(db, {
        clubId,
        districtId: resolvedDistrict.districtId,
        municipalityName: resolvedDistrict.municipalityName,
        date: save.worldDate,
        seed: `${save.randomSeed}:facility-sites`,
      });
    });
  }

  createFacilityProjectPlan(
    input: Omit<FacilityPlanningInput, "personId" | "callerRole">,
  ): AppResult<ReturnType<typeof createFacilityProjectPlan>> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const role = activeCareerRole(db, personId);
      let callerRole: FacilityPlanningInput["callerRole"];
      if (role === "CHAIRMAN_OWNER") {
        if (
          !heldCareerRoles(db, personId).some(
            (entry) => entry.role === role && entry.targetId === input.clubId,
          )
        )
          throw appError("ROLE_NOT_AUTHORIZED", "The owner does not control this club.");
        callerRole = "CHAIRMAN_OWNER";
      } else if (heldExecutiveRole(db, personId, input.clubId)?.role === "CEO") {
        this.executiveActor(db, save, input.clubId);
        callerRole = "CEO";
      } else {
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the owner or authorized CEO may create a facility project plan.",
        );
      }
      try {
        return createFacilityProjectPlan(db, {
          ...input,
          personId,
          callerRole,
          date: save.worldDate,
          seed: `${save.randomSeed}:facility-plan`,
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Facility project plan could not be created.",
        );
      }
    });
  }

  getClubInfrastructureGovernmentContext(projectId: EntityId): AppResult<ClubInfrastructureGovernmentContext> {
    return this.withSession((db) => clubInfrastructureGovernmentContext(db, projectId));
  }

  openClubInfrastructureGovernmentRequest(input: {
    projectId: EntityId;
    institutionId: EntityId;
    fundingType: "INFRASTRUCTURE" | "REGIONAL_GROUND" | "MUNICIPAL_LAND_OR_VENUE";
    requestedAmount: number;
  }): AppResult<GovernmentFundingApplication> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const role = activeCareerRole(db, personId);
      const project = db.prepare("SELECT club_id FROM infrastructure_projects WHERE id=?").get(input.projectId) as { club_id?: EntityId } | undefined;
      if (!project?.club_id) throw appError("INVALID_SELECTION", "Infrastructure project is unavailable.");
      if (role === "CHAIRMAN_OWNER") {
        if (!heldCareerRoles(db, personId).some((entry) => entry.role === role && entry.targetId === project.club_id))
          throw appError("ROLE_NOT_AUTHORIZED", "The owner does not control this club.");
      } else if (heldExecutiveRole(db, personId, project.club_id)?.role === "CEO") {
        this.executiveActor(db, save, project.club_id);
      } else {
        throw appError("ROLE_NOT_AUTHORIZED", "Only the owner or authorized CEO may request club government support.");
      }
      try {
        return requestClubInfrastructureGovernmentSupport(db, { ...input, clubId: project.club_id, date: save.worldDate });
      } catch (error) {
        throw appError("INVALID_SELECTION", error instanceof Error ? error.message : "Government support request could not be opened.");
      }
    });
  }

  openFacilitySiteGovernmentRequest(input: {
    clubId: EntityId;
    siteOptionId: EntityId;
    fundingType: "INFRASTRUCTURE" | "REGIONAL_GROUND" | "MUNICIPAL_LAND_OR_VENUE";
    requestedAmount: number;
  }): AppResult<GovernmentFundingApplication> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const role = activeCareerRole(db, personId);
      if (role === "CHAIRMAN_OWNER") {
        if (!heldCareerRoles(db, personId).some((entry) => entry.role === role && entry.targetId === input.clubId))
          throw appError("ROLE_NOT_AUTHORIZED", "The owner does not control this club.");
      } else if (heldExecutiveRole(db, personId, input.clubId)?.role === "CEO") {
        this.executiveActor(db, save, input.clubId);
      } else {
        throw appError("ROLE_NOT_AUTHORIZED", "Only the owner or authorized CEO may request club government support.");
      }
      try {
        return requestFacilitySiteGovernmentSupport(db, { ...input, date: save.worldDate });
      } catch (error) {
        throw appError("INVALID_SELECTION", error instanceof Error ? error.message : "Government support request could not be opened.");
      }
    });
  }

  getGovernmentSupportMeeting(input: {
    clubId?: EntityId;
    siteOptionId?: EntityId;
    projectId?: EntityId;
  }): AppResult<GovernmentSupportMeetingContext> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const role = activeCareerRole(db, personId);
      const target =
        input.clubId ??
        heldCareerRoles(db, personId).find((entry) =>
          ["CHAIRMAN_OWNER", "CEO", "GENERAL_SECRETARY"].includes(entry.role),
        )?.targetId;
      if (!target) throw appError("ROLE_NOT_AUTHORIZED", "No club facility responsibility is available.");
      const executive = heldExecutiveRole(db, personId, target);
      let meetingRole: "CEO" | "GENERAL_SECRETARY" | "CHAIRMAN_OWNER";
      if (role === "CHAIRMAN_OWNER") {
        if (!heldCareerRoles(db, personId).some((entry) => entry.role === role && entry.targetId === target))
          throw appError("ROLE_NOT_AUTHORIZED", "The owner does not control this club.");
        meetingRole = role;
      } else if (executive?.role === "CEO" || executive?.role === "GENERAL_SECRETARY") {
        this.executiveActor(db, save, target);
        meetingRole = executive.role;
      } else {
        throw appError("ROLE_NOT_AUTHORIZED", "The active role cannot view club government support.");
      }
      return buildGovernmentSupportMeeting(db, { ...input, clubId: target }, meetingRole);
    });
  }

  submitGovernmentSupportCase(applicationId: EntityId): AppResult<GovernmentFundingApplication> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const role = activeCareerRole(db, personId);
      const application = db
        .prepare("SELECT club_id FROM government_funding_applications WHERE id=?")
        .get(applicationId) as { club_id?: EntityId } | undefined;
      if (!application?.club_id) throw appError("INVALID_SELECTION", "Government funding application is unavailable.");
      const applicationExecutive = heldExecutiveRole(db, personId, application.club_id);
      if (role === "CHAIRMAN_OWNER") {
        if (!heldCareerRoles(db, personId).some((entry) => entry.role === role && entry.targetId === application.club_id))
          throw appError("ROLE_NOT_AUTHORIZED", "The owner does not control this club.");
      } else if (applicationExecutive?.role === "CEO" || applicationExecutive?.role === "GENERAL_SECRETARY") {
        this.executiveActor(db, save, application.club_id);
      } else {
        throw appError("ROLE_NOT_AUTHORIZED", "Only the owner or authorized executive may submit this case.");
      }
      return submitGovernmentFunding(db, applicationId);
    });
  }

  watchOwnerFixture(fixtureId?: EntityId): AppResult<LiveMatchView> {
    return this.withSession((db, save) => {
      const { teamId } = ownerMatchdayContext(db, save);
      const existing = fixtureId ? loadMatchSession(db, fixtureId) : undefined;
      if (existing?.record.status === "COMPLETED") {
        const fixture = ownerFixtureForSpectator(db, teamId, existing.state.fixtureId);
        return buildLiveMatchView(db, existing.state, {
          competitionName: ownerCompetitionName(db, fixture),
          managedTeamId: teamId,
          viewMode: existing.record.viewMode ?? "TEXT_LIVE",
          finalized: true,
        });
      }
      const fixture = ownerFixture(db, teamId, fixtureId);
      const input = ownerMatchInput(db, save, fixture, teamId);
      const state =
        loadMatchSession(db, fixture.id)?.state ?? startMatchSession(db, input, "TEXT_LIVE");
      return buildLiveMatchView(db, state, {
        competitionName: ownerCompetitionName(db, fixture),
        managedTeamId: teamId,
        viewMode: "TEXT_LIVE",
        finalized: fixture.status === "played",
      });
    });
  }

  /** Owner-only spectator progression through the canonical match session. */
  advanceOwnerFixture(
    command: AdvanceMatchCommand = {},
    fixtureId?: EntityId,
    viewMode: MatchViewMode = "TEXT_LIVE",
  ): AppResult<LiveMatchView> {
    return this.withSession((db, save) => {
      const { teamId } = ownerMatchdayContext(db, save);
      const session = fixtureId ? loadMatchSession(db, fixtureId) : undefined;
      const fixture = session
        ? ownerFixtureForSpectator(db, teamId, session.state.fixtureId)
        : ownerFixture(db, teamId, fixtureId);
      const state =
        session?.state ??
        startMatchSession(db, ownerMatchInput(db, save, fixture, teamId), viewMode);
      const period = (): LiveMatchState["period"] => state.period;
      if (period() !== "FULL_TIME") {
        advanceMatch(db, state, advanceTargetFor(command));
        if (period() === "FULL_TIME") {
          finalizeMatch(db, state, ownerFinalizationContext(db, save, fixture));
        }
      }
      return buildLiveMatchView(db, state, {
        competitionName: ownerCompetitionName(db, fixture),
        managedTeamId: teamId,
        viewMode,
        since: command.since,
        finalized: state.period === "FULL_TIME",
      });
    });
  }

  /** Owner may acknowledge the half-time break, but cannot alter either team. */
  continueOwnerFixture(
    fixtureId?: EntityId,
    viewMode: MatchViewMode = "TEXT_LIVE",
  ): AppResult<LiveMatchView> {
    return this.withSession((db, save) => {
      const { teamId } = ownerMatchdayContext(db, save);
      const session = fixtureId ? loadMatchSession(db, fixtureId) : undefined;
      const fixture = session
        ? ownerFixtureForSpectator(db, teamId, session.state.fixtureId)
        : ownerFixture(db, teamId, fixtureId);
      if (!session) throw appError("FIXTURE_MISSING", "That match has not been started.");
      const period = (): LiveMatchState["period"] => session.state.period;
      if (period() !== "FULL_TIME") {
        continueFromHalfTime(db, session.state);
        if (period() === "FULL_TIME") {
          finalizeMatch(db, session.state, ownerFinalizationContext(db, save, fixture));
        }
      }
      return buildLiveMatchView(db, session.state, {
        competitionName: ownerCompetitionName(db, fixture),
        managedTeamId: teamId,
        viewMode,
        finalized: session.state.period === "FULL_TIME",
      });
    });
  }

  quickSimOwnerFixture(fixtureId?: EntityId): AppResult<LiveMatchView> {
    return this.withSession((db, save) => {
      const { teamId } = ownerMatchdayContext(db, save);
      const fixture = ownerFixture(db, teamId, fixtureId);
      const input = ownerMatchInput(db, save, fixture, teamId);
      const session = loadMatchSession(db, fixture.id);
      const state = session?.state ?? startMatchSession(db, input, "QUICK_SIM");
      if (state.period !== "FULL_TIME")
        quickSimFromCurrentState(db, state, ownerFinalizationContext(db, save, fixture));
      const completed = loadMatchSession(db, fixture.id)?.state ?? state;
      return buildLiveMatchView(db, completed, {
        competitionName: ownerCompetitionName(db, fixture),
        managedTeamId: teamId,
        viewMode: "QUICK_SIM",
        finalized: completed.period === "FULL_TIME",
      });
    });
  }

  getFederationPresidentDashboard(): AppResult<FederationPresidentDashboard> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "FEDERATION_PRESIDENT") {
        throw appError("ROLE_NOT_AUTHORIZED", "You are not the active Federation President.");
      }
      return buildFederationPresidentDashboard(db, save);
    });
  }

  getNationalDevelopment(): AppResult<FederationDevelopmentSummary> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "FEDERATION_PRESIDENT") {
        throw appError("ROLE_NOT_AUTHORIZED", "You are not the active Federation President.");
      }
      const federationId = heldCareerRoles(db, personId).find(
        (entry) => entry.role === "FEDERATION_PRESIDENT",
      )?.targetId;
      if (!federationId) throw appError("ROLE_NOT_AUTHORIZED", "No federation is available.");
      return federationDevelopmentSummary(db, federationId, save.worldDate);
    });
  }

  getNationDevelopmentScorecard(): AppResult<NationDevelopmentScorecard> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "FEDERATION_PRESIDENT") {
        throw appError("ROLE_NOT_AUTHORIZED", "You are not the active Federation President.");
      }
      const federationId = heldCareerRoles(db, personId).find(
        (entry) => entry.role === "FEDERATION_PRESIDENT",
      )?.targetId;
      if (!federationId) throw appError("ROLE_NOT_AUTHORIZED", "No federation is available.");
      const scorecard = buildNationDevelopmentScorecard(db, federationId, save.worldDate);
      if (!scorecard) throw appError("WORLD_DATA_UNAVAILABLE", "No development profile is on record for this federation yet.");
      return scorecard;
    });
  }

  getFederationRefereeContext(): AppResult<FederationRefereeContext> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "FEDERATION_PRESIDENT") {
        throw appError("ROLE_NOT_AUTHORIZED", "You are not the active Federation President.");
      }
      const federationId = heldCareerRoles(db, personId).find(
        (entry) => entry.role === "FEDERATION_PRESIDENT",
      )?.targetId;
      if (!federationId) throw appError("ROLE_NOT_AUTHORIZED", "No federation is available.");
      return buildFederationRefereeContext(db, federationId, save.worldDate);
    });
  }

  private currentFederationId(db: GameDatabase, personId: EntityId): EntityId {
    if (activeCareerRole(db, personId) !== "FEDERATION_PRESIDENT") {
      throw appError("ROLE_NOT_AUTHORIZED", "You are not the active Federation President.");
    }
    const federationId = heldCareerRoles(db, personId).find(
      (entry) => entry.role === "FEDERATION_PRESIDENT",
    )?.targetId;
    if (!federationId) throw appError("ROLE_NOT_AUTHORIZED", "No federation is available.");
    return federationId;
  }

  getFederationMap(): AppResult<FederationMap> {
    return this.withSession((db, save) => {
      const federationId = this.currentFederationId(db, careerPersonId(db, save));
      // Self-healing for saves created before the territorial-football
      // structure was wired into career creation: upsertDistrict/Province
      // never overwrite an existing row's tracked stats, so this is a
      // no-op on any save that already has the structure.
      initializeNepalTerritorialStructure(db, save.worldDate);
      return buildFederationMap(db, federationId);
    });
  }

  getDistrictDetail(districtId: EntityId): AppResult<DistrictDetail> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const federationId = this.currentFederationId(db, personId);
      initializeNepalTerritorialStructure(db, save.worldDate);
      const detail = buildDistrictDetail(db, federationId, districtId, "FEDERATION_PRESIDENT");
      if (!detail) throw appError("INVALID_SELECTION", "That district is not on record.");
      return detail;
    });
  }

  getDistrictStoryline(districtId: EntityId): AppResult<EntityStoryline> {
    return this.withSession((db, save) => {
      const role = activeCareerRole(db, careerPersonId(db, save));
      return buildDistrictStoryline(db, districtId, role);
    });
  }

  getCompetitionPyramid(): AppResult<CompetitionPyramid> {
    return this.withSession((db, save) => {
      const federationId = this.currentFederationId(db, careerPersonId(db, save));
      return buildCompetitionPyramid(db, federationId, "FEDERATION_PRESIDENT", save.worldDate);
    });
  }

  getGovernmentOverview(): AppResult<GovernmentOverview> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "FEDERATION_PRESIDENT") {
        throw appError("ROLE_NOT_AUTHORIZED", "You are not the active Federation President.");
      }
      const federationId = heldCareerRoles(db, personId).find(
        (entry) => entry.role === "FEDERATION_PRESIDENT",
      )?.targetId;
      if (!federationId) throw appError("ROLE_NOT_AUTHORIZED", "No federation is available.");
      return governmentOverview(db, federationId);
    });
  }

  requestGovernmentFunding(
    institutionId: EntityId,
    fundingType: GovernmentFundingType,
    requestedAmount: number,
  ): AppResult<GovernmentFundingApplication> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "FEDERATION_PRESIDENT") {
        throw appError("ROLE_NOT_AUTHORIZED", "You are not the active Federation President.");
      }
      const federationId = heldCareerRoles(db, personId).find(
        (entry) => entry.role === "FEDERATION_PRESIDENT",
      )?.targetId;
      if (!federationId) throw appError("ROLE_NOT_AUTHORIZED", "No federation is available.");
      return requestGovernmentFunding(db, {
        federationId,
        institutionId,
        fundingType,
        requestedAmount,
        date: save.worldDate,
      });
    });
  }

  /**
   * Read model behind the bank-meeting UI. Reachable by the same two actors
   * applyForClubLoanCommand/repayClubLoanCommand already authorize: the
   * controlling owner, or a CEO the owner has delegated BUDGET_ADMINISTRATION
   * to — everyone else gets a clean, explained rejection rather than a
   * silent fallback to someone else's club finances.
   */
  getClubFinanceMeeting(clubId?: EntityId): AppResult<ClubFinanceMeetingOverview> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const role = activeCareerRole(db, personId);
      let targetClubId: EntityId | undefined;
      if (role === "CHAIRMAN_OWNER") {
        targetClubId =
          clubId ??
          heldCareerRoles(db, personId).find((entry) => entry.role === "CHAIRMAN_OWNER")?.targetId;
        if (!targetClubId) throw appError("ROLE_NOT_AUTHORIZED", "No club is available.");
      } else if (heldExecutiveRole(db, personId, clubId)?.role === "CEO") {
        targetClubId =
          clubId ?? heldCareerRoles(db, personId).find((entry) => entry.role === "CEO")?.targetId;
        if (!targetClubId) throw appError("ROLE_NOT_AUTHORIZED", "No club is available.");
        if (!executiveHasAuthority(db, targetClubId, personId, "BUDGET_ADMINISTRATION")) {
          throw appError(
            "ROLE_NOT_AUTHORIZED",
            "You do not have budget administration authority for this club.",
          );
        }
      } else {
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the controlling owner or a CEO with budget authority may view club finance.",
        );
      }
      return clubFinanceMeetingOverview(db, targetClubId, save.worldDate);
    });
  }

  getFederationCandidacy(): AppResult<
    import("@nepal-football-sim/shared-types").FederationCandidacyAssessment
  > {
    return this.withSession((db, save) =>
      assessFederationCandidacy(db, { personId: careerPersonId(db, save), date: save.worldDate }),
    );
  }

  declareFederationElectionCandidacy(): AppResult<
    import("@nepal-football-sim/shared-types").FederationCandidacyAssessment
  > {
    return this.withSession((db, save) => {
      try {
        return declareFederationElectionCandidacy(db, {
          personId: careerPersonId(db, save),
          date: save.worldDate,
          seed: save.randomSeed,
        });
      } catch (error) {
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          error instanceof Error ? error.message : "You are not eligible to stand.",
        );
      }
    });
  }

  /** Test-only fixture hook; the desktop server gates exposure with an E2E env flag. */
  /** Test-only: arms a deterministic one-time failure for the very next
   * setClubVisualIdentity call (any club, any session) — used to verify
   * the Create-a-Club wizard's identity-persistence failure UI (visible
   * error, Retry, Continue without saving) without any random/flaky
   * failure. Does not require an open session, since the founder wizard
   * arms this before the club (and therefore the session) exists. */
  armE2ENextIdentitySaveFailure(): AppResult<E2ERoleFixtureResult> {
    this.e2eNextIdentitySaveShouldFail = true;
    return ok({ ready: true });
  }

  seedE2ERoleFixture(): AppResult<E2ERoleFixtureResult> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const manager = db
        .prepare(
          "SELECT t.club_id FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id WHERE mc.person_id=? AND mc.status='ACTIVE' LIMIT 1",
        )
        .get(personId) as { club_id?: EntityId } | undefined;
      const ownerClubId = heldCareerRoles(db, personId).find(
        (role) => role.role === "CHAIRMAN_OWNER",
      )?.targetId;
      const clubId = manager?.club_id ?? ownerClubId;
      const federation = clubId
        ? (db
            .prepare(
              "SELECT f.id FROM federations f JOIN clubs c ON c.country_id=f.country_id WHERE c.id=? ORDER BY f.id LIMIT 1",
            )
            .get(clubId) as { id?: EntityId } | undefined)
        : undefined;
      if (!clubId || !federation?.id)
        throw appError("SAVE_CORRUPT", "Role fixture requires a manager club and federation.");
      initializeFederationGovernanceForSave({
        db,
        worldDate: save.worldDate,
        seed: save.randomSeed,
      });
      generateSponsorOffers(db, {
        clubId,
        date: save.worldDate,
        seed: `${save.randomSeed}:e2e-sponsor-offers`,
        count: 4,
      });
      const person = db
        .prepare("SELECT display_name, full_name FROM persons WHERE id=?")
        .get(personId) as { display_name?: string; full_name?: string } | undefined;
      const hasOwnerStake = db
        .prepare(
          "SELECT 1 FROM club_ownership_stakes WHERE club_id=? AND holder_type='PERSON' AND holder_id=? AND status='ACTIVE' LIMIT 1",
        )
        .get(clubId, personId);
      if (!hasOwnerStake)
        db.prepare(
          "INSERT OR IGNORE INTO club_ownership_stakes (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          createStableEntityId("e2e-role-owner", `${save.id}:${personId}`),
          clubId,
          "PERSON",
          personId,
          person?.display_name ?? person?.full_name ?? personId,
          "MAJORITY_OWNER",
          75,
          75,
          save.worldDate,
          "ACTIVE",
          "PARTIALLY_BUYABLE",
          "SIMULATION_ONLY",
        );
      db.prepare(
        "INSERT OR IGNORE INTO federation_leadership_tenures (id,person_id,federation_id,role,term_start,term_end,status,provenance_status) VALUES (?,?,?,?,?,?,?,?)",
      ).run(
        createStableEntityId("e2e-role-president", `${save.id}:${personId}`),
        personId,
        federation.id,
        "FEDERATION_PRESIDENT",
        save.worldDate,
        "2030-01-01",
        "ACTIVE",
        "SIMULATION_ONLY",
      );
      // Real, grounded facts for the Owner/President press E2E specs to
      // exercise — the same club infrastructure project and federation
      // project shape owner-press.test.ts/president-press.test.ts already
      // use, never a press-specific fixture format.
      new ClubEconomyRepository(db).upsertInfrastructureProject({
        id: createStableEntityId("e2e-role-owner-project", `${save.id}:${personId}`),
        clubId,
        projectType: "STAND",
        planningStart: save.worldDate,
        expectedCompletion: "2027-01-01",
        capitalCost: 5_000_000,
        ongoingCost: 100_000,
        currency: "NPR",
        status: "APPROVED",
        financingJson: {},
        provenanceStatus: "SIMULATION_ONLY",
      });
      const federationProject = createFederationProject(db, {
        federationId: federation.id,
        projectType: "NATIONAL_TRAINING_CENTRE",
        name: "National Training Centre",
        date: save.worldDate,
        seed: `${save.randomSeed}:e2e-federation-project`,
      });
      new FederationGovernanceRepository(db).upsertProject({ ...federationProject, status: "CONSTRUCTION" });
      // The same physical person also holds every NPC executive job at the
      // club — the deliberate stress case for the role picker: none of
      // these may ever appear as a selectable career, no matter how many
      // NPC jobs this person happens to hold.
      for (const role of EXECUTIVE_ROLES_TUPLE) {
        const alreadyHeld = db
          .prepare("SELECT 1 FROM club_executive_roles WHERE club_id=? AND role=? AND status='FILLED' LIMIT 1")
          .get(clubId, role);
        if (alreadyHeld) continue;
        const appointmentId = createStableEntityId("e2e-role-exec-appointment", `${save.id}:${personId}:${role}`);
        db.prepare(
          `INSERT INTO staff_appointments (id, person_id, organisation_type, club_id, role, start_date, employment_status)
           VALUES (?, ?, 'CLUB', ?, ?, ?, 'ACTIVE')`,
        ).run(appointmentId, personId, clubId, role, save.worldDate);
        db.prepare(
          `INSERT INTO club_executive_roles (id, club_id, role, person_id, appointment_id, status, assigned_on, provenance_status)
           VALUES (?, ?, ?, ?, ?, 'FILLED', ?, 'SIMULATION_ONLY')`,
        ).run(
          createStableEntityId("e2e-role-exec-role", `${save.id}:${personId}:${role}`),
          clubId,
          role,
          personId,
          appointmentId,
          save.worldDate,
        );
      }
      return { ready: true };
    });
  }

  /** Test-only: writes a career_control_context row shaped like a save from
   * before the executive-role cleanup (active_role stored as an NPC
   * executive job, or a base_role predating the base-career model), so E2E
   * can drive the real load path and prove the UI reconciles it safely.
   * Gated behind NEPAL_E2E_ROLE_FIXTURE, same as seedE2ERoleFixture. */
  seedE2EStaleExecutiveRole(activeRole: string, baseRole?: string): AppResult<{ ready: true }> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      new CareerControlRepository(db).upsert({
        personId,
        activeRole: activeRole as CareerRole,
        baseRole: baseRole as BaseCareerRole | undefined,
      });
      return { ready: true };
    });
  }

  /**
   * Test-only fixture for the off-pitch decision-presentation E2E suite:
   * creates one real, still-open incoming permanent transfer offer (for the
   * live NEGOTIATION scene) and one real completed incoming permanent
   * transfer offer whose fee is set to exactly the club's remaining budget
   * (so it deterministically reads MAJOR, qualifying the SIGNING scene) —
   * both built through the same canonical `makeManagerTransferOffer`/
   * `completePermanentTransfer` engine code the real UI calls, not a
   * bespoke fixture shape. Gated behind NEPAL_E2E_ROLE_FIXTURE, same as the
   * other seedE2E* fixtures.
   */
  seedE2EDecisionPresentationFixture(): AppResult<E2EDecisionPresentationFixtureResult> {
    return this.managerCommand((db, save, context) => {
      const clubId = context.club?.id;
      if (!clubId) throw new ManagerCommandError("ROLE_NOT_AUTHORIZED", "Manager has no club.");
      const targets = db
        .prepare(
          `SELECT pc.player_id AS playerId FROM player_contracts pc
           WHERE pc.status = 'ACTIVE' AND pc.club_id != ?
           ORDER BY pc.player_id LIMIT 2`,
        )
        .all(clubId) as Array<{ playerId: EntityId }>;
      if (targets.length < 2) {
        throw new ManagerCommandError(
          "FIXTURE_MISSING",
          "Decision-presentation fixture requires at least two externally contracted players.",
        );
      }
      const [negotiationTarget, signingTarget] = targets;

      let centre = makeManagerTransferOffer(db, save, context, {
        playerId: negotiationTarget.playerId,
        fee: 100_000,
      });
      const negotiationOffer = centre.incoming.find((offer) => offer.playerId === negotiationTarget.playerId);
      if (!negotiationOffer) {
        throw new ManagerCommandError("FIXTURE_MISSING", "Failed to seed the active negotiation offer.");
      }

      // Exactly the remaining budget after the first offer — guarantees this
      // offer is real-signal MAJOR under transferNegotiationImportance
      // (fee >= transferRemaining) without inventing a fake "record fee".
      centre = makeManagerTransferOffer(db, save, context, {
        playerId: signingTarget.playerId,
        fee: centre.budget.transferRemaining,
      });
      const signingOfferView = centre.incoming.find((offer) => offer.playerId === signingTarget.playerId);
      if (!signingOfferView) {
        throw new ManagerCommandError("FIXTURE_MISSING", "Failed to seed the signing offer.");
      }
      const market = new TransferMarketRepository(db);
      const signingOfferRaw = market.transferOffers().find((offer) => offer.id === signingOfferView.id);
      if (!signingOfferRaw) {
        throw new ManagerCommandError("FIXTURE_MISSING", "Failed to read back the seeded signing offer.");
      }
      // completePermanentTransfer runs the real AI personal-terms
      // negotiation, which can genuinely stall/reject/withdraw depending on
      // player preferences and wage affordability — real behaviour, but not
      // a deterministic fixture. This test-only fixture instead writes the
      // same real completed-state shape that function writes on success
      // (offer COMPLETED, a real contract at the buying club, a real
      // transfer-history event, the player's club updated) directly through
      // the same public repository methods it calls, so the E2E suite gets
      // a guaranteed-COMPLETED offer without depending on that negotiation's
      // outcome.
      const previousContract = market.activeContract(signingTarget.playerId, save.worldDate);
      market.updateOfferStatus(signingOfferRaw.id, "COMPLETED");
      if (previousContract) market.markContractStatus(previousContract.id, "TERMINATED");
      market.upsertPlayerContract({
        id: createStableEntityId("player-contract", `${signingTarget.playerId}:e2e-signing:${save.worldDate}`),
        playerId: signingTarget.playerId,
        clubId,
        startDate: save.worldDate,
        endDate: addDays(save.worldDate, 24 * 30),
        contractType: previousContract?.contractType ?? "PROFESSIONAL",
        salary: previousContract?.salary ?? 50_000,
        appearanceFee: 0,
        goalBonus: 0,
        cleanSheetBonus: 0,
        signingBonus: 0,
        loyaltyBonus: 0,
        currency: signingOfferRaw.currency,
        squadRole: previousContract?.squadRole ?? "ROTATION",
        status: "ACTIVE",
        provenance: {
          sourceName: "Nepal football simulation",
          lastVerifiedDate: save.worldDate,
          confidence: 0,
          confidenceLevel: "LOW",
          status: "SIMULATION_ONLY",
          notes: "E2E decision-presentation fixture",
        },
      });
      market.updatePlayerClub(signingTarget.playerId, clubId);
      market.insertTransferHistoryEvent({
        id: createStableEntityId("transfer-history", `${signingTarget.playerId}:e2e-signing:${save.worldDate}`),
        playerId: signingTarget.playerId,
        clubId,
        relatedClubId: signingOfferRaw.sellingClubId,
        eventType: "TRANSFER_COMPLETED",
        occurredOn: save.worldDate,
        data: { fee: signingOfferRaw.transferFee, currency: signingOfferRaw.currency },
      });
      const finalOffer = market.transferOffers().find((offer) => offer.id === signingOfferView.id);
      return {
        negotiationOfferId: negotiationOffer.id,
        signingOfferId: signingOfferView.id,
        signingOfferStatus: finalOffer?.status ?? "UNKNOWN",
      };
    }, true);
  }

  foundClub(name: string, locationName: string): AppResult<SimulationClubRecord> {
    return this.withSession((db, save, filePath) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active chairman/owner may found a club.");
      }
      const location = db
        .prepare(
          `SELECT l.id FROM locations l JOIN countries co ON co.id = l.country_id
         WHERE co.iso_code IN ('NP', 'NPL') AND l.kind IN ('district', 'municipality', 'city')
           AND lower(trim(l.name)) = lower(trim(?)) ORDER BY l.id LIMIT 1`,
        )
        .get(locationName) as { id?: EntityId } | undefined;
      if (!location?.id)
        throw appError("INVALID_SELECTION", "Choose a Nepal district, municipality, or city.");
      const person = db
        .prepare("SELECT display_name, full_name FROM persons WHERE id = ?")
        .get(personId) as { display_name?: string; full_name?: string } | undefined;
      if (!person) throw appError("SAVE_CORRUPT", "The founding owner is missing.");
      db.exec("BEGIN IMMEDIATE;");
      let founded: SimulationClubRecord;
      try {
        founded = foundSimulationClub(db, {
          name,
          locationId: location.id,
          foundedOn: save.worldDate,
          seed: `${save.randomSeed}:found-club`,
          founderPersonId: personId,
          founderName: person.display_name ?? person.full_name ?? personId,
          callerRole: "CHAIRMAN_OWNER",
        });
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Club could not be founded.",
        );
      }
      this.writeCatalogEntry(this.catalogEntry(db, loadSave(db, save.id), filePath));
      return founded;
    });
  }

  implementFederationGovernanceProposal(
    proposalId: EntityId,
  ): AppResult<FederationGovernanceProposal> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "FEDERATION_PRESIDENT") {
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active federation president may implement proposals.",
        );
      }
      try {
        return implementFederationGovernanceProposalCommand(db, {
          proposalId,
          personId,
          callerRole: "FEDERATION_PRESIDENT",
          date: save.worldDate,
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Proposal could not be implemented.",
        );
      }
    });
  }

  appointNationalTeamHeadCoach(
    nationalTeamId: EntityId,
    candidatePersonId: EntityId,
  ): AppResult<StaffAppointment> {
    return this.withSession((db, save) => {
      const presidentPersonId = careerPersonId(db, save);
      if (activeCareerRole(db, presidentPersonId) !== "FEDERATION_PRESIDENT") {
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active federation president may appoint national-team staff.",
        );
      }
      const federationId = db
        .prepare("SELECT federation_id FROM teams WHERE id=?")
        .get(nationalTeamId) as { federation_id?: EntityId } | undefined;
      if (!federationId?.federation_id)
        throw appError("INVALID_SELECTION", "The national team was not found.");
      try {
        return appointNationalTeamHeadCoachForPresident(db, {
          federationId: federationId.federation_id,
          nationalTeamId,
          presidentPersonId,
          candidatePersonId,
          date: save.worldDate,
        });
      } catch (error) {
        if (error instanceof FederationPersonnelError && error.code === "NOT_AUTHORIZED")
          throw appError("ROLE_NOT_AUTHORIZED", error.message);
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "National-team staff could not be appointed.",
        );
      }
    });
  }

  setClubBudget(
    clubId: EntityId,
    seasonLabel: string,
    category: ClubBudgetCategory,
    amount: number,
  ): AppResult<ClubBudget> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may set club budgets.",
        );
      }
      try {
        return setClubBudgetCommand(db, {
          clubId,
          personId,
          callerRole: "CHAIRMAN_OWNER",
          seasonLabel,
          category,
          amount,
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Club budget could not be set.",
        );
      }
    });
  }

  appointManager(vacancyId: EntityId, managerProfileId: EntityId): AppResult<ManagerContract> {
    return this.withSession((db, save, filePath) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may appoint a manager.",
        );
      }
      try {
        const contract = appointManagerForChairman(db, {
          ownerPersonId: personId,
          vacancyId,
          managerProfileId,
          date: save.worldDate,
        });
        this.writeCatalogEntry(this.catalogEntry(db, loadSave(db, save.id), filePath));
        return contract;
      } catch (error) {
        if (error instanceof ChairmanManagerError)
          throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
    });
  }

  createInfrastructureProject(
    clubId: EntityId,
    projectType: InfrastructureProjectType,
  ): AppResult<InfrastructureProject> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may approve infrastructure projects.",
        );
      }
      try {
        return createInfrastructureProjectCommand(db, {
          clubId,
          personId,
          callerRole: "CHAIRMAN_OWNER",
          projectType,
          date: save.worldDate,
          seed: `${save.randomSeed}:chairman-project`,
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Infrastructure project could not be created.",
        );
      }
    });
  }

  acceptSponsorOffer(clubId: EntityId, sponsorshipId: EntityId): AppResult<SponsorshipContract> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may approve sponsorships.",
        );
      }
      try {
        return acceptSponsorOfferCommand(db, {
          clubId,
          sponsorshipId,
          personId,
          callerRole: "CHAIRMAN_OWNER",
          date: save.worldDate,
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Sponsorship offer could not be accepted.",
        );
      }
    });
  }

  rejectSponsorOffer(clubId: EntityId, sponsorshipId: EntityId): AppResult<SponsorshipContract> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may reject sponsorships.",
        );
      }
      try {
        return rejectSponsorOfferCommand(db, {
          clubId,
          sponsorshipId,
          personId,
          callerRole: "CHAIRMAN_OWNER",
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Sponsorship offer could not be rejected.",
        );
      }
    });
  }

  counterSponsorOffer(
    clubId: EntityId,
    sponsorshipId: EntityId,
    annualValue: number,
    endDate?: string,
  ): AppResult<SponsorshipContract> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may negotiate sponsorships.",
        );
      try {
        return counterSponsorOffer(db, {
          sponsorshipId,
          annualValue,
          endDate,
          date: save.worldDate,
          seed: save.randomSeed,
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Sponsorship counter could not be submitted.",
        );
      }
    });
  }

  /**
   * Read model behind the sponsor-meeting UI, shared by the controlling
   * owner and a CEO with delegated COMMERCIAL_OVERSIGHT — the same two
   * actors acceptSponsorOfferCommand/rejectSponsorOfferCommand already
   * authorize.
   */
  getSponsorMeeting(clubId?: EntityId): AppResult<SponsorMeetingOverview> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const role = activeCareerRole(db, personId);
      let targetClubId: EntityId | undefined;
      if (role === "CHAIRMAN_OWNER") {
        targetClubId =
          clubId ??
          heldCareerRoles(db, personId).find((entry) => entry.role === "CHAIRMAN_OWNER")?.targetId;
        if (!targetClubId) throw appError("ROLE_NOT_AUTHORIZED", "No club is available.");
      } else if (heldExecutiveRole(db, personId, clubId)?.role === "CEO") {
        targetClubId =
          clubId ?? heldCareerRoles(db, personId).find((entry) => entry.role === "CEO")?.targetId;
        if (!targetClubId) throw appError("ROLE_NOT_AUTHORIZED", "No club is available.");
        if (!executiveHasAuthority(db, targetClubId, personId, "COMMERCIAL_OVERSIGHT")) {
          throw appError(
            "ROLE_NOT_AUTHORIZED",
            "You do not have commercial oversight authority for this club.",
          );
        }
      } else {
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the controlling owner or a CEO with commercial authority may view club sponsorship.",
        );
      }
      return sponsorMeetingOverview(db, targetClubId);
    });
  }

  rejectExecutiveSponsorOffer(
    clubId: EntityId,
    sponsorshipId: EntityId,
  ): AppResult<ReturnType<typeof rejectSponsorshipForExecutive>> {
    return this.withSession((db, save) =>
      rejectSponsorshipForExecutive(db, {
        clubId,
        sponsorshipId,
        actor: this.executiveActor(db, save, clubId),
      }),
    );
  }

  counterExecutiveSponsorOffer(
    clubId: EntityId,
    sponsorshipId: EntityId,
    annualValue: number,
    endDate?: string,
  ): AppResult<ReturnType<typeof counterSponsorshipForExecutive>> {
    return this.withSession((db, save) =>
      counterSponsorshipForExecutive(db, {
        clubId,
        sponsorshipId,
        annualValue,
        endDate,
        date: save.worldDate,
        seed: save.randomSeed,
        actor: this.executiveActor(db, save, clubId),
      }),
    );
  }

  getFederationCommercialOverview(): AppResult<FederationCommercialOverview> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "FEDERATION_PRESIDENT") {
        throw appError("ROLE_NOT_AUTHORIZED", "You are not the active Federation President.");
      }
      const federationId = heldCareerRoles(db, personId).find(
        (entry) => entry.role === "FEDERATION_PRESIDENT",
      )?.targetId;
      if (!federationId) throw appError("ROLE_NOT_AUTHORIZED", "No federation is available.");
      return federationCommercialOverview(db, federationId);
    });
  }

  negotiateFederationCommercialOffer(offerId: EntityId): AppResult<ReturnType<typeof negotiateCommercialRights>> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "FEDERATION_PRESIDENT")
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active Federation President may negotiate commercial rights.");
      return negotiateCommercialRights(db, offerId);
    });
  }

  counterFederationCommercialOffer(offerId: EntityId, annualValue: number, termYears?: number): AppResult<ReturnType<typeof counterCommercialRights>> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "FEDERATION_PRESIDENT")
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active Federation President may counter commercial rights.");
      return counterCommercialRights(db, { offerId, annualValue, termYears });
    });
  }

  acceptFederationCommercialOffer(offerId: EntityId): AppResult<ReturnType<typeof awardCommercialRightsForPresident>> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "FEDERATION_PRESIDENT")
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active Federation President may accept commercial rights.");
      const federationId = heldCareerRoles(db, personId).find((entry) => entry.role === "FEDERATION_PRESIDENT")?.targetId;
      if (!federationId) throw appError("ROLE_NOT_AUTHORIZED", "No federation is available.");
      return awardCommercialRightsForPresident(db, { offerId, presidentPersonId: personId, federationId, date: save.worldDate, startDate: save.worldDate });
    });
  }

  rejectFederationCommercialOffer(offerId: EntityId): AppResult<ReturnType<typeof negotiateCommercialRights>> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "FEDERATION_PRESIDENT")
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active Federation President may reject commercial rights.");
      const repo = new CommercialRightsRepository(db);
      const offer = repo.offers().find((item) => item.id === offerId);
      if (!offer || !["OFFERED", "NEGOTIATED"].includes(offer.status)) throw appError("INVALID_SELECTION", "Commercial-rights offer is not rejectable.");
      const rejected = { ...offer, status: "EXPIRED" as const };
      repo.upsertOffer(rejected);
      return rejected;
    });
  }

  createInvestorStakeOffer(
    percentage: number,
    minimumAmount?: number,
  ): AppResult<ChairmanDashboard["investorMarket"]> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may offer club shares.",
        );
      const clubId = heldCareerRoles(db, personId).find(
        (role) => role.role === "CHAIRMAN_OWNER",
      )?.targetId;
      if (!clubId) throw appError("ROLE_NOT_AUTHORIZED", "No controlled club is available.");
      try {
        return createInvestorStakeOffer(db, {
          clubId,
          sellerHolderId: personId,
          percentage,
          minimumAmount,
          date: save.worldDate,
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Investor offer could not be created.",
        );
      }
    });
  }

  decideInvestorBid(offerId: EntityId, accept: boolean): AppResult<OwnershipAcquisitionOffer> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only a controlling chairman/owner may decide investor bids.",
        );
      try {
        return decideInvestorBid(db, { offerId, date: save.worldDate, accept });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Investor bid could not be decided.",
        );
      }
    });
  }

  counterInvestorBid(
    offerId: EntityId,
    terms: { amount: number; percentage?: number; boardSeatRequested?: boolean },
  ): AppResult<OwnershipAcquisitionOffer> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only a controlling chairman/owner may counter investor bids.",
        );
      try {
        return counterInvestorBid(db, { offerId, ...terms, date: save.worldDate });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Investor bid could not be countered.",
        );
      }
    });
  }

  withdrawInvestorBidResponse(offerId: EntityId): AppResult<OwnershipAcquisitionOffer> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only a controlling chairman/owner may withdraw from a negotiation.",
        );
      try {
        return withdrawInvestorBidResponse(db, { offerId, date: save.worldDate });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "This negotiation could not be withdrawn from.",
        );
      }
    });
  }

  acknowledgeBoardOppositionForInvestorBid(offerId: EntityId): AppResult<OwnershipAcquisitionOffer> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only a controlling chairman/owner may confirm a deal despite board opposition.",
        );
      try {
        return acknowledgeBoardOpposition(db, { offerId, date: save.worldDate });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "This deal is not waiting on your confirmation.",
        );
      }
    });
  }

  getInvestorMeeting(): AppResult<InvestorMeetingOverview> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may view the investor meeting.",
        );
      const clubId = heldCareerRoles(db, personId).find(
        (role) => role.role === "CHAIRMAN_OWNER",
      )?.targetId;
      if (!clubId) throw appError("ROLE_NOT_AUTHORIZED", "No controlled club is available.");
      // Backfill for a save created before ensureOwnerPersonalFinancialProfile
      // was wired into career creation — a no-op once the profile exists, so
      // this is safe to call on every read. Without it, an owner from an
      // older save reads a real (not a crash) but permanently stuck NPR 0
      // personal balance, since nothing else ever creates the row for them.
      ensureOwnerPersonalFinancialProfile(db, personId, clubId, save.worldDate);
      return investorMeetingOverview(db, clubId, personId, save.worldDate);
    });
  }

  /**
   * The owner injecting more of their own money into the club, diluting
   * every stake (their own included) by the same real formula
   * capitalInjectionFromInvestor already uses for any stakeholder. This is
   * genuinely distinct from decideInvestorBid: money moves into club cash,
   * not between two people's personal wealth.
   */
  injectOwnerCapital(amount: number): AppResult<OwnerInvestmentTransaction> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may inject personal capital.",
        );
      const clubId = heldCareerRoles(db, personId).find(
        (role) => role.role === "CHAIRMAN_OWNER",
      )?.targetId;
      if (!clubId) throw appError("ROLE_NOT_AUTHORIZED", "No controlled club is available.");
      try {
        return capitalInjectionFromInvestor(db, {
          clubId,
          personId,
          date: save.worldDate,
          amount,
          form: "EQUITY",
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Capital injection could not be completed.",
        );
      }
    });
  }

  /**
   * Read model behind the owner-manager meeting UI. Owner-only: the
   * underlying interaction's own authority map requires initiator.type
   * === "CHAIRMAN" — there is no CEO or manager-initiated path today.
   */
  getOwnerManagerMeeting(clubId?: EntityId): AppResult<OwnerManagerMeetingOverview> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may hold an owner-manager meeting.",
        );
      const targetClubId =
        clubId ??
        heldCareerRoles(db, personId).find((role) => role.role === "CHAIRMAN_OWNER")?.targetId;
      if (!targetClubId) throw appError("ROLE_NOT_AUTHORIZED", "No controlled club is available.");
      try {
        return ownerManagerMeetingOverview(db, targetClubId, save.worldDate);
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Owner-manager meeting overview is unavailable.",
        );
      }
    });
  }

  openOwnerManagerMeeting(
    clubId: EntityId,
    topic: OwnerManagerMeetingTopic,
  ): AppResult<UniversalInteraction> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may open an owner-manager meeting.",
        );
      try {
        return createOwnerManagerMeeting(db, { clubId, date: save.worldDate, topic });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Owner-manager meeting could not be opened.",
        );
      }
    });
  }

  resolveOwnerManagerMeeting(
    interactionId: EntityId,
    stance: OwnerManagerMeetingStance,
    commitment?: OwnerManagerCommitmentInput,
  ): AppResult<UniversalInteraction> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may resolve an owner-manager meeting.",
        );
      try {
        return resolveOwnerManagerMeetingCommand(db, {
          interactionId,
          date: save.worldDate,
          seed: save.randomSeed,
          stance,
          commitment,
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Owner-manager meeting could not be resolved.",
        );
      }
    });
  }

  getOwnerPlayerRequestContext(
    playerId: EntityId,
  ): AppResult<OwnerPlayerRequestContext | undefined> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may raise player requests.",
        );
      const clubId = heldCareerRoles(db, personId).find(
        (role) => role.role === "CHAIRMAN_OWNER",
      )?.targetId;
      if (!clubId) throw appError("ROLE_NOT_AUTHORIZED", "No controlled club is available.");
      return ownerPlayerRequestContext(db, {
        clubId,
        playerId,
        requestedBy: personId,
        date: save.worldDate,
      });
    });
  }

  openOwnerPlayerRequest(
    playerId: EntityId,
    intent: OwnerPlayerRequestIntent,
    deadline?: string,
  ): AppResult<UniversalInteraction> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may raise player requests.",
        );
      const clubId = heldCareerRoles(db, personId).find(
        (role) => role.role === "CHAIRMAN_OWNER",
      )?.targetId;
      if (!clubId) throw appError("ROLE_NOT_AUTHORIZED", "No controlled club is available.");
      try {
        return createOwnerPlayerRequest(db, {
          clubId,
          playerId,
          date: save.worldDate,
          requestedBy: personId,
          intent,
          deadline,
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Player request could not be opened.",
        );
      }
    });
  }

  respondToOwnerPlayerRequest(
    interactionId: EntityId,
    stance: OwnerManagerMeetingStance,
    commitment?: OwnerManagerCommitmentInput,
  ): AppResult<UniversalInteraction> {
    return this.managerCommand((db, save, context) => {
      if (!context.club?.id) throw appError("ROLE_NOT_AUTHORIZED", "Manager has no club.");
      try {
        return respondToOwnerPlayerRequest(db, {
          interactionId,
          managerPersonId: context.manager.personId,
          clubId: context.club.id,
          date: save.worldDate,
          seed: save.randomSeed,
          stance,
          commitment,
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Player request could not be answered.",
        );
      }
    }, true);
  }

  getManagerOwnerPlayerRequests(): AppResult<ManagerOwnerPlayerRequest[]> {
    return this.managerCommand((db, save, context) => {
      if (!context.club?.id) throw appError("ROLE_NOT_AUTHORIZED", "Manager has no club.");
      return managerOwnerPlayerRequests(db, {
        clubId: context.club.id,
        managerPersonId: context.manager.personId,
        date: save.worldDate,
      });
    });
  }

  applyClubLoan(
    lenderId: EntityId,
    principal: number,
    termMonths: number,
    purpose: string,
  ): AppResult<ClubLoanApplication> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may apply for club loans.",
        );
      const clubId = heldCareerRoles(db, personId).find(
        (role) => role.role === "CHAIRMAN_OWNER",
      )?.targetId;
      if (!clubId) throw appError("ROLE_NOT_AUTHORIZED", "No controlled club is available.");
      try {
        return applyForClubLoanCommand(db, {
          clubId,
          personId,
          callerRole: "CHAIRMAN_OWNER",
          lenderId,
          principal,
          termMonths,
          purpose,
          date: save.worldDate,
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Loan application failed.",
        );
      }
    });
  }

  repayClubLoan(debtId: EntityId, amount?: number): AppResult<ClubDebt> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may repay club loans.",
        );
      try {
        return repayClubLoanCommand(db, {
          debtId,
          personId,
          callerRole: "CHAIRMAN_OWNER",
          amount,
          date: save.worldDate,
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Loan repayment failed.",
        );
      }
    });
  }

  requestManagerBudget(
    seasonLabel: string,
    category: ClubBudgetCategory,
    requestedAmount: number,
  ): AppResult<ManagerBudgetRequest> {
    return this.withSession((db, save) => {
      const context = managerContext(db, save);
      if (!context.club)
        throw appError("ROLE_NOT_AUTHORIZED", "The active manager has no club budget.");
      try {
        return submitManagerBudgetRequest(db, {
          clubId: context.club.id,
          managerPersonId: context.managerPerson.id,
          seasonLabel,
          category,
          requestedAmount,
          date: save.worldDate,
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Budget request failed.",
        );
      }
    });
  }

  decideManagerBudgetRequest(
    requestId: EntityId,
    approve: boolean,
  ): AppResult<ManagerBudgetRequest> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may decide manager budget requests.",
        );
      try {
        const economy = new ClubEconomyRepository(db);
        const request = economy.budgetRequests().find((item) => item.id === requestId);
        const controlled =
          request &&
          heldCareerRoles(db, personId).some(
            (role) => role.role === "CHAIRMAN_OWNER" && role.targetId === request.clubId,
          );
        if (!controlled) throw new Error("Budget request is outside the controlled club");
        return decideManagerBudgetRequest(db, { requestId, date: save.worldDate, approve });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Budget request decision failed.",
        );
      }
    });
  }

  purchaseEquipment(category: ProcurementCategory, quantity: number): AppResult<ProcurementOrder> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "Only the active chairman/owner may purchase equipment.",
        );
      const clubId = heldCareerRoles(db, personId).find(
        (role) => role.role === "CHAIRMAN_OWNER",
      )?.targetId;
      if (!clubId) throw appError("ROLE_NOT_AUTHORIZED", "No controlled club is available.");
      try {
        const request = createProcurementRequest(db, {
          clubId,
          category,
          quantity,
          date: save.worldDate,
          seed: `${save.randomSeed}:owner-equipment`,
        });
        const offer = request.offers.sort((a, b) => a.unitPrice - b.unitPrice)[0];
        if (!offer) throw new Error("No equipment supplier offer is available");
        return selectProcurementOffer(db, {
          offerId: offer.id,
          date: save.worldDate,
          chairmanApproved: true,
        });
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Equipment purchase failed.",
        );
      }
    });
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
      // A played fixture is never the current matchday, so report the real
      // reason before the matchday gate can mask it.
      if (fixture.status === "played") {
        throw appError("MATCH_ALREADY_PLAYED", "That fixture has already been played.");
      }
      const current = userMatchRequiresAction(context.fixtures, context.team.id, save.worldDate);
      if (!current || fixture.id !== current.id) {
        throw appError("MATCHDAY_REQUIRED", "This fixture is not yet playable.");
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
      const opponentTactic = resolveTeamTacticalSetup(
        db,
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
      // Quick Sim is the same session engine run straight to full time; it does
      // not bypass match persistence.
      const validation = quickSimManagerMatch(input);
      const { outcome } = simulateAndFinalizeMatch(
        db,
        {
          fixture,
          homePlayers,
          awayPlayers,
          homeTacticalSetup: input.homeTacticalSetup,
          awayTacticalSetup: input.awayTacticalSetup,
          seed: input.seed,
          substitutionLimit: substitutionLimitFor(context.ruleSet),
        },
        {
          fixture,
          competitionTeamIds: input.competitionTeamIds,
          ruleSet: context.ruleSet,
          seed: input.seed,
          save,
          inboxItems: validation.inboxItems,
        },
      );
      if (outcome.status === "ALREADY_FINALIZED") {
        throw appError("MATCH_ALREADY_PLAYED", "That fixture has already been played.");
      }
      const state = this.buildState(db, loadSave(db, save.id), filePath);
      this.writeCatalogEntry(state.catalogEntry);
      return state;
    });
  }

  continueCareer(): AppResult<DesktopApplicationState> {
    return this.withSession((db, save, filePath) => {
      const personId = careerPersonId(db, save);
      const context =
        activeCareerRole(db, personId) === "MANAGER" ? tryManagerContext(db, save) : undefined;
      let updated: SaveMetadata;
      let stopReason: string | undefined;

      if (!context) {
        const personId = careerPersonId(db, save);
        const ownerRole =
          activeCareerRole(db, personId) === "CHAIRMAN_OWNER"
            ? heldCareerRoles(db, personId).find((role) => role.role === "CHAIRMAN_OWNER")
            : undefined;
        if (ownerRole?.targetId) {
          const outcome = advanceOwnerCareer(db, save, ownerRole.targetId);
          updated = {
            ...save,
            worldDate: outcome.worldDate,
            lastSavedAt: new Date().toISOString(),
          };
          new SaveRepository(db).upsert(updated);
          new ManagerRepository(db).insertInboxItem({
            id: createEntityId(),
            createdOn: updated.worldDate,
            type: "COMPETITION_UPDATE",
            title: "Club operations advanced",
            body: outcome.message,
            read: false,
          });
        } else {
          // No club to advance fixtures for — let the wider world (AI managers,
          // board confidence, vacancies) move on until something new appears.
          const outcome = advanceUnemployedCareer(db, save);
          updated = {
            ...save,
            worldDate: outcome.worldDate,
            lastSavedAt: new Date().toISOString(),
          };
          new SaveRepository(db).upsert(updated);
          new ManagerRepository(db).insertInboxItem({
            id: createEntityId(),
            createdOn: updated.worldDate,
            type: "COMPETITION_UPDATE",
            title: outcome.newVacancies > 0 ? "New vacancies available" : "Time passes",
            body: outcome.message,
            read: false,
          });
        }
      } else {
        const currentMatch = userMatchRequiresAction(
          context.fixtures,
          context.team.id,
          save.worldDate,
        );
        if (currentMatch) {
          // Continue is intentionally idempotent on matchday. The manager must
          // choose a match action before the calendar can move again.
          updated = save;
          stopReason = "MATCHDAY";
        } else {
          if (!nextFixtureForTeam(context.fixtures, context.team.id, save.worldDate)) {
            throw appError("FIXTURE_MISSING", "There is no further fixture to advance to.");
          }
          ensureManagerSystems(db, save, context);
          db.exec("BEGIN;");
          try {
            // Day-by-day advance that runs scouting and training and stops at the
            // first meaningful decision, rather than jumping blindly to the fixture.
            const outcome = advanceManagerCareer(db, save, context);
            stopReason = outcome.stopReason;
            updated = {
              ...save,
              worldDate: outcome.worldDate,
              lastSavedAt: new Date().toISOString(),
            };
            new SaveRepository(db).upsert(updated);
            new ManagerRepository(db).insertInboxItem({
              id: createEntityId(),
              createdOn: updated.worldDate,
              type:
                outcome.stopReason === "NEXT_FIXTURE" ? "FIXTURE_UPCOMING" : "COMPETITION_UPDATE",
              title: continueTitle(outcome.stopReason),
              body: outcome.message,
              relatedEntity: { type: "team", id: context.team.id },
              read: false,
            });
            db.exec("COMMIT;");
          } catch (error) {
            db.exec("ROLLBACK;");
            throw error;
          }
          // World-level tick: AI clubs fill vacancies, boards judge every
          // manager (including the player) on results. May end the player's
          // own contract — `buildState` below picks that up automatically.
          ensureAiManagersAssigned(db, updated, context.team.id);
          evaluateBoardConfidence(db, updated);

          // Staff market: AI clubs fill their own support-staff vacancies from
          // need/budget; every club's staff contracts near expiry are renewed
          // or lapse; performance reviews drift reputation from real proxies;
          // licence courses complete; rivals occasionally poach staff. The
          // player's own club is staffed and renewed by hand via the UI.
          ensureAiStaffAssigned(db, updated, context.club?.id);

          // Tops up the shared free-agent staff pool once per season (idempotent
          // via workforce_intake_events; a no-op on every other tick). Built and
          // tested, but previously only reachable from the offline career-cli
          // simulator, never from real desktop play — every division's staff
          // pool could run dry with nothing ever refilling it.
          //
          // Runs AFTER ensureAiStaffAssigned above, not before: AI demand
          // (every other club's open core roles, every tick) vastly exceeds
          // the season's bounded intake, so a top-up placed before the AI
          // fill-in is hired away in the same synchronous tick and the human
          // never sees it — confirmed empirically (0 visible candidates even
          // immediately after the top-up ran, with this call before AI
          // fill-in). Placing it after means this season's newly generated
          // candidates sit unemployed until the *next* tick, giving the human
          // the same real window any AI club gets on its next opportunity —
          // same market, same rules, just observed a tick later.
          reconcileWorkforceSupply({
            db,
            date: updated.worldDate,
            seed: updated.randomSeed,
            seasonLabel: context.ruleSet.seasonStartDate.slice(0, 4),
          });
          evaluateAllStaffContracts(db, updated);
          if (context.club?.id) evaluateStaffPerformance(db, updated, context.club.id);
          evaluateLicenceCourses(db, updated);
          // AI clubs use the same enrolInLicenceCourse pipeline the human
          // path does — bounded per-tick chance, real course dates, same
          // affordability/willingness/max-licence rejections.
          evaluateAiStaffDevelopment(db, updated, context.club?.id);
          completeTechnicalPartnershipPlacements(db, updated);
          if (context.club?.id) planTechnicalPartnershipPlacements(db, updated, context.club.id);
          evaluateStaffPoaching(db, updated, context.club?.id);
          if (context.club?.id) {
            defaultResponsibilitiesForClub(db, updated, context.club.id);
            evaluateStaffDevelopmentPlans(db, context.club.id);
            evaluateSuccessionNeeds(db, updated, context.club.id);
          }

          // Medical: every club's active rehab plans progress on the natural
          // staged schedule (protection -> rehab -> partial -> full ->
          // match-ready). Absent an explicit manager decision this IS
          // "follow medical advice" — the sensible default AI clubs use.
          // Only the player's own squad gets inbox notifications since only
          // they read one.
          const medicalRepo = new MedicalRepository(db);
          const beforeReady = new Set(
            new PlayerRepository(db)
              .attributesForTeam(context.team.id)
              .filter(
                (attributes) =>
                  medicalRepo.activeRehabilitationPlan(attributes.personId)?.stage ===
                  "MATCH_READY",
              )
              .map((attributes) => attributes.personId),
          );
          advanceAllRehabilitationPlans(db, updated);
          for (const attributes of new PlayerRepository(db).attributesForTeam(context.team.id)) {
            const plan = medicalRepo.activeRehabilitationPlan(attributes.personId);
            if (plan?.stage === "MATCH_READY" && !beforeReady.has(attributes.personId)) {
              const player = getPerson(db, attributes.personId);
              new ManagerRepository(db).insertInboxItem({
                id: createEntityId(),
                createdOn: updated.worldDate,
                type: "INJURY",
                title: `${displayName(player)} is match-ready`,
                body: `${displayName(player)} has completed rehabilitation and is available for selection.`,
                relatedEntity: { type: "person", id: attributes.personId },
                read: false,
              });
            }
          }

          // Squad dynamics: only the player's own squad, since only they read
          // an inbox — raised/escalated concerns become inbox items, resolved
          // ones do not, so the inbox reacts to real change, not every tick.
          const dynamicsOutcome = evaluateSquadDynamics(
            db,
            updated,
            context.team.id,
            context.club?.id,
            context.manager.id,
          );
          for (const concern of [
            ...dynamicsOutcome.raisedConcerns,
            ...dynamicsOutcome.escalatedConcerns,
          ]) {
            const player = getPerson(db, concern.personId);
            new ManagerRepository(db).insertInboxItem({
              id: createEntityId(),
              createdOn: updated.worldDate,
              type: "COMPETITION_UPDATE",
              title: `${displayName(player)}: ${concernTitle(concern.type)}`,
              body: concern.note ?? "A squad concern needs your attention.",
              relatedEntity: { type: "person", id: concern.personId },
              read: false,
            });
          }
          for (const promise of [
            ...dynamicsOutcome.keptPromises,
            ...dynamicsOutcome.brokenPromises,
          ]) {
            const player = getPerson(db, promise.personId);
            const kept = promise.status === "FULFILLED" || promise.status === "KEPT";
            new ManagerRepository(db).insertInboxItem({
              id: createEntityId(),
              createdOn: updated.worldDate,
              type: "COMPETITION_UPDATE",
              title: `${displayName(player)}: promise ${kept ? "kept" : "broken"}`,
              body: kept
                ? `You followed through on your promise to ${displayName(player)}.`
                : `You did not follow through on your promise to ${displayName(player)} — trust has taken a hit.`,
              relatedEntity: { type: "person", id: promise.personId },
              read: false,
            });
          }
          for (const promise of dynamicsOutcome.atRiskPromises) {
            const player = getPerson(db, promise.personId);
            new ManagerRepository(db).insertInboxItem({
              id: createEntityId(),
              createdOn: updated.worldDate,
              type: "COMPETITION_UPDATE",
              title: `${displayName(player)}: promise at risk`,
              body: `Your ${promise.description.toLowerCase()} commitment needs attention before ${promise.dueOn}.`,
              relatedEntity: { type: "person", id: promise.personId },
              read: false,
            });
          }
        }
      }

      advanceMacroEconomyForWorldDate(db, { date: updated.worldDate, seed: save.randomSeed });

      // Autosave foundation: after a configurable number of in-game days, or
      // at a major season transition, into a rotating ring of slot files
      // that never touches the primary save file itself.
      if (
        this.autosaveEnabled &&
        isAutosaveDue({
          lastAutosaveWorldDate: updated.lastAutosaveWorldDate,
          createdAt: updated.createdAt,
          currentWorldDate: updated.worldDate,
          stopReason,
          intervalDays: this.autosaveIntervalDays,
        })
      ) {
        try {
          performAutosave(db, this.savesDirectory, updated.id, AUTOSAVE_SLOT_COUNT);
          updated = withAutosaveStamp(updated, updated.worldDate);
          new SaveRepository(db).upsert(updated);
        } catch {
          // An autosave failure must never interrupt play or the manual save path.
        }
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
      // The metadata write below is the save; a checkpoint failure afterward
      // must not be reported as a failed save when the data already committed.
      new SaveRepository(db).upsert(stamped);
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      } catch {
        // Non-fatal: the WAL still holds the committed write.
      }
      const entry = this.catalogEntry(db, stamped, filePath);
      this.writeCatalogEntry(entry);
      return entry;
    });
  }

  /**
   * Save-as / new slot: copies the live world into a brand-new file via
   * VACUUM INTO (atomic — fully written or not at all) and only switches the
   * active session to it once the new slot is verified, so a failure here
   * never disturbs the still-open original save.
   */
  saveCareerAs(saveName: string): AppResult<SaveCatalogEntry> {
    return this.withSession((db, save, filePath) => {
      mkdirSync(this.savesDirectory, { recursive: true });
      const newFilePath = join(
        this.savesDirectory,
        `${slug(saveName)}-${Date.now().toString(36)}.sqlite`,
      );
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      } catch {
        // Non-fatal: VACUUM INTO below reads the live database regardless.
      }
      atomicCopyDatabase(db, newFilePath);

      let newDb: GameDatabase | undefined;
      try {
        newDb = openGameDatabase(newFilePath);
        const integrity = checkSaveIntegrity(newDb);
        if (!integrity.ok)
          throw appError(
            "DATABASE_ERROR",
            `New save slot failed an integrity check: ${integrity.detail}`,
          );
        const now = new Date().toISOString();
        const newSave: SaveMetadata = {
          ...save,
          id: createEntityId(),
          name: saveName,
          createdAt: now,
          lastSavedAt: now,
          lastAutosaveAt: undefined,
          lastAutosaveWorldDate: undefined,
        };
        new SaveRepository(newDb).upsert(newSave);
        newDb.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        const entry = this.catalogEntry(newDb, newSave, newFilePath);

        // Everything above succeeded — only now do we retire the old session.
        this.session!.db.close();
        this.session = { saveId: newSave.id, filePath: newFilePath, db: newDb };
        this.writeCatalogEntry(entry);
        return entry;
      } catch (error) {
        newDb?.close();
        discardFile(newFilePath);
        if (isAppError(error)) throw error;
        throw appError(
          "DATABASE_ERROR",
          "Could not create the new save slot.",
          error instanceof Error ? error.message : String(error),
        );
      }
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

  getAutosaveStatus(): AppResult<AutosaveStatusView> {
    return this.withSession((_db, save) => {
      const slots = listAutosaveSlots(this.savesDirectory, save.id)
        .map((slot): AutosaveSlotView => ({ slotIndex: slot.slotIndex, savedAt: slot.savedAt }))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      return {
        enabled: this.autosaveEnabled,
        intervalDays: this.autosaveIntervalDays,
        lastAutosaveAt: save.lastAutosaveAt,
        lastAutosaveWorldDate: save.lastAutosaveWorldDate,
        slots,
        slotCount: AUTOSAVE_SLOT_COUNT,
      };
    });
  }

  /**
   * Restores an autosave slot as the active session. The slot file itself is
   * left untouched (read-only source for the copy), so this is safe to
   * retry and never destroys the autosave being restored from.
   */
  loadAutosaveSlot(slotIndex: number): AppResult<DesktopApplicationState> {
    const listResult = this.withSession((_db, save) => {
      const slot = listAutosaveSlots(this.savesDirectory, save.id).find(
        (candidate) => candidate.slotIndex === slotIndex,
      );
      if (!slot) throw appError("SAVE_NOT_FOUND", `Autosave slot ${slotIndex} was not found.`);
      return slot.filePath;
    });
    if (!listResult.ok) return listResult;
    return this.loadCareerByPath(listResult.data);
  }

  // -------------------------------------------------------------------------
  // Manager gameplay commands (Step 3).
  //
  // Each one is a thin delegation: the read models and rules live in
  // `manager-desktop.ts`, and every command re-checks manager authority there.
  // -------------------------------------------------------------------------

  /**
   * Recruitment, transfer, economy, and training records are created once per
   * save. It is several seconds of work, so it runs while the career is being
   * opened rather than inside the first gameplay request. A career without a
   * manager appointment simply skips it.
   */
  private warmManagerSystems(db: GameDatabase, save: SaveMetadata): void {
    db.exec("BEGIN;");
    try {
      reconcilePlayablePlayerProfilesOnce(db, { worldDate: save.worldDate, seed: save.randomSeed });
      initializeClubFinanceMarkets(db);
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
    try {
      const context = managerContext(db, save);
      db.exec("BEGIN;");
      try {
        ensureManagerSystems(db, save, context);
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
    } catch {
      // Not a manager career, or the world cannot support manager systems yet.
    }
  }

  private managerCommand<T>(
    action: (db: GameDatabase, save: SaveMetadata, context: ManagerContext) => T,
    mutates = false,
  ): AppResult<T> {
    return this.withSession((db, save, filePath) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "MANAGER") {
        throw appError(
          "ROLE_NOT_AUTHORIZED",
          "The active career role cannot use manager commands.",
        );
      }
      const context = managerContext(db, save);
      ensureManagerSystems(db, save, context);
      if (!mutates) return action(db, save, context);
      db.exec("BEGIN;");
      let result: T;
      try {
        result = action(db, save, context);
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
      const stamped = loadSave(db, save.id);
      this.writeCatalogEntry(this.catalogEntry(db, stamped, filePath));
      return result;
    });
  }

  getManagerDashboard(): AppResult<ManagerDashboard> {
    return this.withSession((db, save) => {
      const context = tryManagerContext(db, save);
      if (!context) return buildUnemployedDashboard(db, save);
      ensureManagerSystems(db, save, context);
      return buildManagerDashboard(db, save, context);
    });
  }

  getJobCentre(): AppResult<JobCentreView> {
    return this.withSession((db, save) =>
      buildJobCentreView(db, requirePlayerManagerProfile(db, save)),
    );
  }

  applyForJob(vacancyId: EntityId): AppResult<JobCentreView> {
    return this.withSession((db, save) => {
      const managerProfile = requirePlayerManagerProfile(db, save);
      try {
        applyForJobCommand(db, save, managerProfile, vacancyId);
      } catch (error) {
        if (error instanceof JobApplicationError)
          throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return buildJobCentreView(db, managerProfile);
    });
  }

  declineJobOffer(applicationId: EntityId): AppResult<JobCentreView> {
    return this.withSession((db, save) => {
      const managerProfile = requirePlayerManagerProfile(db, save);
      try {
        declineJobOfferCommand(db, save, applicationId);
      } catch (error) {
        if (error instanceof JobOfferError) throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return buildJobCentreView(db, managerProfile);
    });
  }

  acceptJobOffer(applicationId: EntityId): AppResult<DesktopApplicationState> {
    return this.withSession((db, save, filePath) => {
      const managerProfile = requirePlayerManagerProfile(db, save);
      try {
        acceptJobOfferCommand(db, save, managerProfile, applicationId);
      } catch (error) {
        if (error instanceof JobOfferError) throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      const state = this.buildState(db, save, filePath);
      this.writeCatalogEntry(state.catalogEntry);
      return state;
    });
  }

  resignFromClub(): AppResult<DesktopApplicationState> {
    return this.withSession((db, save, filePath) => {
      const context = managerContext(db, save);
      resignFromClubCommand(db, save, context.contract);
      const updated = { ...save, lastSavedAt: new Date().toISOString() };
      new SaveRepository(db).upsert(updated);
      const state = this.buildState(db, updated, filePath);
      this.writeCatalogEntry(state.catalogEntry);
      return state;
    });
  }

  getCareerHistory(): AppResult<ManagerCareerHistoryView> {
    return this.withSession((db, save) => {
      if (!save.playerCharacterId) throw appError("SAVE_CORRUPT", "Save has no player character.");
      const character = new WorldRepository(db).getCareerCharacter(save.playerCharacterId);
      if (!character) throw appError("SAVE_CORRUPT", "Career character record is missing.");
      const managerProfile = requirePlayerManagerProfile(db, save);
      const person = getPerson(db, character.personId);
      const { history, trophies } = careerHistory(db, character.personId);
      return {
        managerName: displayName(person),
        reputationProfile: managerProfile.reputationProfile,
        jobsHeld: history.length,
        history: history.map((entry) => ({
          contractId: entry.contract.id,
          clubName: entry.clubName,
          teamName: entry.teamName,
          jobTitle: entry.contract.jobTitle,
          start: entry.contract.contractStart,
          end: entry.contract.contractEnd,
          outcome: entry.contract.status,
        })),
        trophies: trophies.map((trophy) => ({
          competitionName: trophy.competitionName,
          teamName: trophy.teamName,
          wonOn: trophy.wonOn,
        })),
      };
    });
  }

  getMediaCentre(): AppResult<MediaCentreView> {
    return this.managerCommand((db, save, context) => buildMediaCentreView(db, save, context));
  }

  requestPressConference(storyId: EntityId): AppResult<PressConferenceView> {
    return this.managerCommand(
      (db, save, context) => requestManagerPressConference(db, save, context, storyId),
      true,
    );
  }

  answerPressConference(input: {
    interviewId: EntityId;
    stance: MediaResponseStance;
    response: string;
  }): AppResult<PressConferenceView> {
    return this.managerCommand(
      (db, _save, context) => answerManagerPressConference(db, context, input),
      true,
    );
  }

  /** Opens (or returns the already-open) structured, multi-question press
   * conference for the manager's own team — the richer sibling of
   * requestPressConference above, sharing the same MediaInterview pipeline. */
  requestStructuredPressConference(input: {
    context: "PRE_MATCH" | "POST_MATCH" | "TRANSFER" | "PLAYER_ISSUE";
    fixtureId?: EntityId;
  }): AppResult<StructuredPressConferenceView> {
    return this.managerCommand(
      (db, save, context) => requestManagerStructuredPressConference(db, save, context, input),
      true,
    );
  }

  answerStructuredPressQuestion(input: {
    interviewId: EntityId;
    stance: PressResponseStance;
  }): AppResult<StructuredPressConferenceView> {
    return this.managerCommand(
      (db, save, context) => answerManagerStructuredPressQuestion(db, save, context, input),
      true,
    );
  }

  /** Re-fetches the current view of an already-open/completed structured
   * interview — used to resume mid-conference after a reload and to open a
   * completed one from history, without answering anything. */
  getStructuredPressConference(interviewId: EntityId): AppResult<StructuredPressConferenceView> {
    return this.managerCommand(
      (db, _save, context) => getManagerStructuredPressConference(db, context, interviewId),
      false,
    );
  }

  /** The single natural pre-match press entry point — called once when the
   * manager opens the pre-match screen for a fixture. Creates a PRE_MATCH
   * interview only when the fixture is genuinely material (real table
   * stakes, an active player concern/demand, or active transfer interest);
   * returns undefined for an ordinary fixture. Idempotent per fixture. */
  evaluatePreMatchPress(fixtureId: EntityId): AppResult<StructuredPressConferenceView | undefined> {
    return this.managerCommand(
      (db, save, context) => evaluateManagerPreMatchPress(db, save, context, fixtureId),
      true,
    );
  }

  getSupporterOverview(): AppResult<SupporterReadModel | undefined> {
    return this.managerCommand((db, _save, context) => buildSupporterOverview(db, context));
  }

  getDressingRoom(): AppResult<DressingRoomView> {
    return this.managerCommand((db, save, context) => buildDressingRoomView(db, save, context));
  }

  getSquad(): AppResult<SquadList> {
    return this.managerCommand(buildSquadList);
  }

  getSquadConcerns(): AppResult<SquadDynamicsView> {
    return this.managerCommand((db, save, context) => buildSquadDynamicsView(db, context.team.id));
  }

  /**
   * The real, currently-warranted reason (if any) a team meeting is called
   * for — fetched by the UI before opening the Team Meeting panel so it can
   * show genuine evidence and contextual message choices rather than an
   * arbitrary picker. Returns undefined when nothing calls for one.
   */
  getTeamMeetingContext(): AppResult<TeamMeetingContext | undefined> {
    return this.managerCommand((db, save, context) =>
      evaluateTeamMeetingContext(db, save.worldDate, context.team.id),
    );
  }

  respondToConcern(command: {
    concernId: EntityId;
    action: ConcernResponseAction;
  }): AppResult<ConcernResponseResult> {
    return this.managerCommand((db, save, context) => {
      let outcome: ConcernResponseResult["outcome"];
      try {
        outcome = respondToConcernCommand(
          db,
          save,
          context.manager.id,
          command.concernId,
          command.action,
        ).outcome;
      } catch (error) {
        if (error instanceof ConcernActionError || error instanceof MeetingActionError) {
          throw appError("INVALID_SELECTION", error.message);
        }
        throw error;
      }
      return { outcome, squad: buildSquadDynamicsView(db, context.team.id) };
    }, true);
  }

  respondToDemand(command: DemandResponseCommand): AppResult<DemandResponseResult> {
    return this.managerCommand((db, save, context) => {
      let status: DemandResponseResult["status"];
      try {
        status = respondToDemandCommand(
          db,
          save,
          context.manager.id,
          command.demandId,
          command.response,
          command.responseNote,
        ).demand.status;
      } catch (error) {
        if (error instanceof DemandActionError) throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return { status, squad: buildSquadDynamicsView(db, context.team.id) };
    }, true);
  }

  holdSquadMeeting(command: SquadMeetingCommand): AppResult<SquadMeetingResult> {
    return this.managerCommand((db, save, context) => {
      try {
        const meeting = holdSquadMeeting(db, save, context.manager.id, context.team.id, command);
        return { meeting, squad: buildSquadDynamicsView(db, context.team.id) };
      } catch (error) {
        if (error instanceof MeetingActionError) throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
    }, true);
  }

  /**
   * The manager's own captaincy call — never available to Owner/President/
   * executive roles, since `managerCommand` only authorizes the active
   * Manager. Either slot may be omitted (leave as-is) or set to `null`
   * (clear the override, returning that role to influence-derived
   * selection).
   */
  appointCaptaincy(command: {
    captainPersonId?: EntityId | null;
    viceCaptainPersonId?: EntityId | null;
  }): AppResult<SquadDynamicsView> {
    return this.managerCommand((db, save, context) => {
      try {
        appointCaptaincy(db, save.worldDate, context.manager.id, context.team.id, command);
      } catch (error) {
        if (error instanceof CaptaincyActionError) throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return buildSquadDynamicsView(db, context.team.id);
    }, true);
  }

  /**
   * The Player Profile is a shared world entity view: any legitimate career
   * role may OPEN it, because every story surface can link to a player. What
   * it shows is still gated by the viewer's own club — scouting knowledge and
   * scouting reports come from a real appointment, never from the role name —
   * and mutating a player remains a separate, manager-authority command.
   */
  getPlayerProfile(playerId: EntityId): AppResult<PlayerProfile> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const role = activeCareerRole(db, personId);
      const context = role === "MANAGER" ? tryManagerContext(db, save) : undefined;
      const viewer = context
        ? managerProfileViewer(context)
        : { role, ...this.viewerClubAndTeam(db, personId, role) };
      return buildPlayerProfile(db, save, viewer, playerId);
    });
  }

  /** The viewer's own club/team, when their held role actually has one. A
   * federation president has neither, which is what withholds club scouting
   * knowledge from them. */
  private viewerClubAndTeam(
    db: GameDatabase,
    personId: EntityId,
    role: CareerRole,
  ): { clubId?: EntityId; teamId?: EntityId } {
    const held = heldCareerRoles(db, personId).find((entry) => entry.role === role);
    if (!held?.targetId) return {};
    // CHAIRMAN_OWNER/CEO/GENERAL_SECRETARY/SPORTING_DIRECTOR/DoF hold a
    // club; the team is that club's senior side when one exists. A club
    // fielding both a senior men's and women's team is common in this
    // dataset (see teamIdForClub in transfer-market.ts, root-caused from
    // the exact same ambiguity) — the senior men's first team is the
    // club's flagship; fall back to any senior team only if the club
    // genuinely has no men's side, never an unfiltered/youth pick.
    const clubRow = db.prepare("SELECT id FROM clubs WHERE id=?").get(held.targetId) as
      | { id?: EntityId }
      | undefined;
    if (!clubRow?.id) return {};
    const mensTeam = db
      .prepare("SELECT id FROM teams WHERE club_id = ? AND level = 'senior' AND gender = 'men' LIMIT 1")
      .get(clubRow.id) as { id?: EntityId } | undefined;
    const team =
      mensTeam ??
      (db
        .prepare("SELECT id FROM teams WHERE club_id = ? AND level = 'senior' ORDER BY id LIMIT 1")
        .get(clubRow.id) as { id?: EntityId } | undefined);
    return { clubId: clubRow.id, teamId: team?.id };
  }

  getClubProfile(clubId: EntityId): AppResult<ClubProfile> {
    return this.withSession((db, save) => buildClubProfile(db, clubId, activeCareerRole(db, careerPersonId(db, save))));
  }

  /** Resolves this club's real, current visual-identity colours: a saved
   * override if one exists, else the same deterministic SIMULATION_ONLY
   * fallback the client itself would compute — so a club with no override
   * never has to distinguish "not customised" from "customised to look
   * exactly like the default" at the UI layer. */
  getClubVisualIdentity(clubId: EntityId): AppResult<ClubVisualIdentityView> {
    return this.withSession((db, save) => {
      const record = new ClubVisualIdentityRepository(db).get(clubId);
      const colours = record
        ? { primaryColour: record.primaryColour, secondaryColour: record.secondaryColour, accentColour: record.accentColour }
        : deterministicClubColours(clubId);
      const deterministicKits = deterministicClubKits(clubId, colours);
      // There is no live, per-save season-rollover event to hook a kit-
      // history snapshot to — season transitions in this codebase only
      // happen inside the offline career-world generator that builds the
      // starting world before any save exists, never during a player's
      // own interactive play. So the snapshot is taken here instead, on
      // the season's first real identity read during play: idempotent
      // (snapshotSeasonIfAbsent is INSERT OR IGNORE, unique on
      // club_id+season_key), and safe to call on every read since only
      // the season's very first call ever inserts anything.
      new ClubVisualIdentityRepository(db).snapshotSeasonIfAbsent({
        id: createStableEntityId("club-kit-history", `${clubId}:${save.worldDate.slice(0, 4)}`),
        clubId,
        seasonKey: save.worldDate.slice(0, 4),
        homeKitJson: JSON.stringify(record?.homeKit ?? deterministicKits.home),
        awayKitJson: JSON.stringify(record?.awayKit ?? deterministicKits.away),
        thirdKitJson: JSON.stringify(record?.thirdKit ?? deterministicKits.third),
        createdAt: save.worldDate,
      });
      if (record) {
        return {
          clubId,
          primaryColour: record.primaryColour,
          secondaryColour: record.secondaryColour,
          accentColour: record.accentColour,
          // A club may have only ever saved colours (Phase 1C) — merge in
          // its real badge override when one exists, and leave it
          // undefined otherwise so the client derives the deterministic
          // default shape/symbol/initials instead of a fabricated one.
          badgeShape: record.badgeDesign?.shape as ClubBadgeShape | undefined,
          badgeSymbol: record.badgeDesign?.symbol as ClubBadgeSymbol | undefined,
          badgeInitials: record.badgeDesign?.initials,
          // Each kit slot is independently undefined when that slot has
          // never been saved — the client derives the deterministic
          // default for exactly that slot, never all three at once just
          // because one was customised.
          homeKit: record.homeKit as ClubKitDesignOverride | undefined,
          awayKit: record.awayKit as ClubKitDesignOverride | undefined,
          thirdKit: record.thirdKit as ClubKitDesignOverride | undefined,
          isCustom: true,
          provenanceStatus: "SIMULATION_ONLY",
        };
      }
      return { clubId, ...colours, isCustom: false, provenanceStatus: "SIMULATION_ONLY" };
    });
  }

  /** One row per season a snapshot exists for, oldest first — each
   * season's kit designs are immutable once recorded (see
   * getClubVisualIdentity's snapshot-on-read comment) even if the club's
   * current kits are edited afterward. */
  getClubKitHistory(clubId: EntityId): AppResult<ClubKitHistorySeason[]> {
    return this.withSession((db) =>
      new ClubVisualIdentityRepository(db).kitHistory(clubId).map((entry) => ({
        seasonKey: entry.seasonKey,
        homeKit: JSON.parse(entry.homeKitJson) as ClubKitDesignOverride,
        awayKit: JSON.parse(entry.awayKitJson) as ClubKitDesignOverride,
        thirdKit: JSON.parse(entry.thirdKitJson) as ClubKitDesignOverride,
        createdAt: entry.createdAt,
      })),
    );
  }

  /** Full identity write (colours + badge design). Superset of
   * setClubColours, which remains for compatibility with saves/tests that
   * only ever call it. */
  setClubVisualIdentity(
    clubId: EntityId,
    identity: {
      primaryColour: string;
      secondaryColour: string;
      accentColour: string;
      badgeShape: ClubBadgeShape;
      badgeSymbol: ClubBadgeSymbol;
      badgeInitials: string;
      homeKit?: ClubKitDesignOverride;
      awayKit?: ClubKitDesignOverride;
      thirdKit?: ClubKitDesignOverride;
    },
  ): AppResult<ClubVisualIdentityView> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active chairman/owner may edit club identity.");
      }
      const ownedClubId = heldCareerRoles(db, personId).find((role) => role.role === "CHAIRMAN_OWNER")?.targetId;
      if (ownedClubId !== clubId) {
        throw appError("ROLE_NOT_AUTHORIZED", "You may only edit your own club's identity.");
      }
      if (this.e2eNextIdentitySaveShouldFail) {
        this.e2eNextIdentitySaveShouldFail = false;
        throw appError("SAVE_CORRUPT", "Simulated identity persistence failure (E2E test fixture).");
      }
      for (const value of [identity.primaryColour, identity.secondaryColour, identity.accentColour]) {
        if (!isValidHexColour(value)) {
          throw appError("INVALID_SELECTION", `"${value}" is not a valid colour.`);
        }
      }
      if (!BADGE_SHAPES.includes(identity.badgeShape)) {
        throw appError("INVALID_SELECTION", `"${identity.badgeShape}" is not a real badge shape.`);
      }
      if (!BADGE_SYMBOLS.includes(identity.badgeSymbol)) {
        throw appError("INVALID_SELECTION", `"${identity.badgeSymbol}" is not a real badge symbol.`);
      }
      const initials = identity.badgeInitials.trim().toUpperCase().slice(0, 4);
      if (initials.length === 0) {
        throw appError("INVALID_SELECTION", "Initials cannot be empty.");
      }
      for (const kit of [identity.homeKit, identity.awayKit, identity.thirdKit]) {
        if (!kit) continue;
        for (const value of [kit.baseColour, kit.secondaryColour, kit.trimColour, kit.shortsColour, kit.socksColour]) {
          if (!isValidHexColour(value)) {
            throw appError("INVALID_SELECTION", `"${value}" is not a valid kit colour.`);
          }
        }
        if (!KIT_PATTERNS.includes(kit.pattern)) {
          throw appError("INVALID_SELECTION", `"${kit.pattern}" is not a real kit pattern.`);
        }
      }
      new ClubVisualIdentityRepository(db).upsertFull({
        clubId,
        primaryColour: identity.primaryColour,
        secondaryColour: identity.secondaryColour,
        accentColour: identity.accentColour,
        badgeDesign: { shape: identity.badgeShape, symbol: identity.badgeSymbol, initials },
        homeKit: identity.homeKit,
        awayKit: identity.awayKit,
        thirdKit: identity.thirdKit,
        updatedAt: save.worldDate,
      });
      const stored = new ClubVisualIdentityRepository(db).get(clubId)!;
      return {
        clubId,
        primaryColour: identity.primaryColour,
        secondaryColour: identity.secondaryColour,
        accentColour: identity.accentColour,
        badgeShape: identity.badgeShape,
        badgeSymbol: identity.badgeSymbol,
        badgeInitials: initials,
        homeKit: stored.homeKit as ClubKitDesignOverride | undefined,
        awayKit: stored.awayKit as ClubKitDesignOverride | undefined,
        thirdKit: stored.thirdKit as ClubKitDesignOverride | undefined,
        isCustom: true,
        provenanceStatus: "SIMULATION_ONLY",
      };
    });
  }

  /** Only the club's own controlling Chairman/Owner may repaint it. */
  setClubColours(
    clubId: EntityId,
    colours: { primaryColour: string; secondaryColour: string; accentColour: string },
  ): AppResult<ClubVisualIdentityView> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active chairman/owner may edit club colours.");
      }
      const ownedClubId = heldCareerRoles(db, personId).find((role) => role.role === "CHAIRMAN_OWNER")?.targetId;
      if (ownedClubId !== clubId) {
        throw appError("ROLE_NOT_AUTHORIZED", "You may only edit your own club's identity.");
      }
      for (const value of [colours.primaryColour, colours.secondaryColour, colours.accentColour]) {
        if (!isValidHexColour(value)) {
          throw appError("INVALID_SELECTION", `"${value}" is not a valid colour.`);
        }
      }
      new ClubVisualIdentityRepository(db).upsertColours({
        clubId,
        primaryColour: colours.primaryColour,
        secondaryColour: colours.secondaryColour,
        accentColour: colours.accentColour,
        updatedAt: save.worldDate,
      });
      return {
        clubId,
        primaryColour: colours.primaryColour,
        secondaryColour: colours.secondaryColour,
        accentColour: colours.accentColour,
        isCustom: true,
        provenanceStatus: "SIMULATION_ONLY",
      };
    });
  }

  getPlayerPathway(playerId: EntityId): AppResult<PlayerPathway> {
    return this.withSession((db, save) => {
      const pathway = buildPlayerPathway(db, playerId, activeCareerRole(db, careerPersonId(db, save)));
      if (!pathway) throw appError("INVALID_SELECTION", "This player has no national-team call-up history on record.");
      return pathway;
    });
  }

  private publicEventRoleForStories(db: GameDatabase, personId: EntityId): PublicEventRole {
    const role = activeCareerRole(db, personId);
    if (role === "CHAIRMAN_OWNER") return "OWNER";
    if (role === "FEDERATION_PRESIDENT") return "PRESIDENT";
    return "MANAGER";
  }

  getStoryThreads(): AppResult<StoryThread[]> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      return roleStoryThreads(db, { personId, role: this.publicEventRoleForStories(db, personId) });
    });
  }

  getStoryDetail(eventId: EntityId): AppResult<StoryDetail> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const role = activeCareerRole(db, personId);
      const allEvents = new EventRepository(db).historicalEvents();
      const event = allEvents.find((candidate) => candidate.id === eventId);
      if (!event) throw appError("INVALID_SELECTION", "This story could not be found.");
      // Thread context comes from every event sharing an involved entity with
      // this one — bounded to what's actually relevant, still fully derived.
      const relatedEvents = allEvents.filter((candidate) =>
        candidate.involvedEntities.some((ref) => event.involvedEntities.some((own) => own.id === ref.id)),
      );
      const threads = deriveStoryThreadsFromEvents(db, relatedEvents, role);
      const thread = findThreadForEvent(threads, eventId);
      return buildStoryDetail(db, event, role, thread, personId);
    });
  }

  getEntityStoryline(entityId: EntityId): AppResult<EntityStoryline> {
    return this.withSession((db, save) => {
      const role = activeCareerRole(db, careerPersonId(db, save));
      return {
        entries: buildEntityStoryline(db, entityId),
        currentStory: currentEntityThread(db, entityId, role),
      };
    });
  }

  getStaffProfile(personId: EntityId): AppResult<StaffProfileReadModel> {
    return this.withSession((db, save) => buildStaffProfile(db, personId, activeCareerRole(db, careerPersonId(db, save))));
  }

  getCompetitionProfile(competitionId: EntityId): AppResult<CompetitionProfile> {
    return this.withSession((db, save) => buildCompetitionProfile(db, competitionId, activeCareerRole(db, careerPersonId(db, save))));
  }

  getInfrastructureProjectProfile(projectId: EntityId): AppResult<InfrastructureProjectProfile> {
    return this.withSession((db, save) =>
      buildInfrastructureProjectProfile(db, projectId, activeCareerRole(db, careerPersonId(db, save)), save.worldDate),
    );
  }

  getNationalTeamSquad(nationalTeamId: EntityId, programme?: string): AppResult<NationalTeamSquadReadModel> {
    return this.withSession((db, save) => {
      const role = activeCareerRole(db, careerPersonId(db, save));
      if (role !== "FEDERATION_PRESIDENT" && role !== "MANAGER")
        throw appError("ROLE_NOT_AUTHORIZED", "Only a Federation President or Manager may view national-team squads.");
      return buildNationalTeamSquad(db, nationalTeamId, save.worldDate, role, programme);
    });
  }

  getPlayerActions(playerId: EntityId): AppResult<ActorPlayerActions> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      return buildActorPlayerActions(db, save, activeCareerRole(db, personId), personId, playerId);
    });
  }

  getPlayerActionAvailability(playerId: EntityId): AppResult<ActorPlayerActions> {
    return this.getPlayerActions(playerId);
  }

  getPlayerContractContext(
    playerId: EntityId,
  ): AppResult<ReturnType<typeof buildPlayerContractContext>> {
    return this.withSession((db, save) => buildPlayerContractContext(db, save, playerId));
  }

  getPlayerTransferContext(
    playerId: EntityId,
  ): AppResult<ReturnType<typeof buildPlayerTransferContext>> {
    return this.withSession((db, save) => buildPlayerTransferContext(db, save, playerId));
  }

  getPlayerMarketValue(playerId: EntityId): AppResult<PlayerMarketValueView> {
    return this.withSession((db, save) => playerMarketValueView(db, playerId, save.worldDate));
  }

  getOwnerFixtures(): AppResult<OwnerMatchdayView> {
    return this.getOwnerMatchday();
  }

  attendOwnerFixture(fixtureId?: EntityId): AppResult<LiveMatchView> {
    return this.watchOwnerFixture(fixtureId);
  }

  getOwnerPostMatchSuggestion(): AppResult<ReturnType<typeof buildOwnerPostMatchSuggestion>> {
    return this.withSession((db, save) => {
      const { clubId } = ownerMatchdayContext(db, save);
      return buildOwnerPostMatchSuggestion(db, save, clubId);
    });
  }

  getEntityReference(
    entityType: EntityReferenceType,
    entityId: EntityId,
  ): AppResult<EntityReference> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      return buildEntityReference(db, entityType, entityId, activeCareerRole(db, personId));
    });
  }

  getOrganizationProfile(
    entityType: OrganizationProfileEntityType,
    entityId: EntityId,
  ): AppResult<OrganizationProfile> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      try {
        return buildOrganizationProfile(db, entityType, entityId, activeCareerRole(db, personId), personId);
      } catch (error) {
        throw appError(
          "INVALID_SELECTION",
          error instanceof Error ? error.message : "Organization profile is unavailable.",
        );
      }
    });
  }

  getTactics(): AppResult<TacticsView> {
    return this.managerCommand(buildTacticsView);
  }

  updateTactics(command: TacticsUpdateCommand): AppResult<TacticsView> {
    return this.managerCommand((db, save, context) => {
      applyTacticsUpdate(db, save, context, command);
      return buildTacticsView(db, save, context);
    }, true);
  }

  getTraining(): AppResult<TrainingView> {
    return this.managerCommand(buildTrainingView);
  }

  updateTraining(command: TrainingUpdateCommand): AppResult<TrainingView> {
    return this.managerCommand((db, save, context) => {
      requireDomainPermission(db, save, context, "TRAINING", "updateTraining");
      applyTrainingUpdate(db, save, context, command);
      return buildTrainingView(db, save, context);
    }, true);
  }

  getPlayerDevelopment(): AppResult<PlayerDevelopmentView> {
    return this.managerCommand(buildPlayerDevelopmentView);
  }

  createPlayerDevelopmentPlan(
    command: CreateDevelopmentPlanCommand,
  ): AppResult<PlayerDevelopmentView> {
    return this.managerCommand((db, save, context) => {
      requireDomainPermission(db, save, context, "TRAINING", "createPlayerDevelopmentPlan");
      try {
        createDevelopmentPlan(db, save, context, command);
      } catch (error) {
        if (error instanceof DevelopmentPlanError)
          throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return buildPlayerDevelopmentView(db, save, context);
    }, true);
  }

  setPlayerDevelopmentPlanStatus(
    planId: EntityId,
    status: string,
  ): AppResult<PlayerDevelopmentView> {
    return this.managerCommand((db, save, context) => {
      requireDomainPermission(db, save, context, "TRAINING", "setPlayerDevelopmentPlanStatus");
      setDevelopmentPlanStatus(db, save, planId, status as "ACTIVE" | "PAUSED" | "COMPLETED");
      return buildPlayerDevelopmentView(db, save, context);
    }, true);
  }

  getMedicalCentre(): AppResult<MedicalCentreView> {
    return this.managerCommand((db, save, context) => buildMedicalCentreView(db, save, context));
  }

  decideReturnToPlay(command: ReturnToPlayDecisionCommand): AppResult<MedicalCentreView> {
    return this.managerCommand((db, save, context) => {
      requireDomainPermission(db, save, context, "MEDICAL", "decideReturnToPlay");
      try {
        recordReturnToPlayDecision(db, save, {
          personId: command.personId,
          decision: command.decision as "FOLLOW_ADVICE" | "DELAY" | "ACCEPT_RISK",
        });
      } catch (error) {
        if (error instanceof MedicalDecisionError)
          throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return buildMedicalCentreView(db, save, context);
    }, true);
  }

  getFixtures(): AppResult<FixtureList> {
    return this.managerCommand(buildFixtureList);
  }

  getFixture(fixtureId: EntityId): AppResult<FixtureDetail> {
    return this.managerCommand((db, save, context) =>
      buildFixtureDetail(db, save, context, fixtureId),
    );
  }

  getCompetition(): AppResult<ManagerCompetitionView> {
    return this.managerCommand(buildCompetitionView);
  }

  getCalendar(): AppResult<CalendarEntry[]> {
    return this.withSession((db, save) => {
      const context = tryManagerContext(db, save);
      if (!context) return [];
      ensureManagerSystems(db, save, context);
      return buildCalendar(db, save, context);
    });
  }

  getScoutingDashboard(): AppResult<ScoutingDashboard> {
    return this.managerCommand(buildScoutingDashboard);
  }

  createScoutingAssignment(command: ScoutingAssignmentCommand): AppResult<ScoutingDashboard> {
    return this.managerCommand((db, save, context) => {
      requireDomainPermission(db, save, context, "SCOUTING", "createScoutingAssignment");
      return createManagerScoutingAssignment(db, save, context, command);
    }, true);
  }

  getScoutingReport(playerId: EntityId): AppResult<ScoutingReportView> {
    return this.managerCommand(
      (db, save, context) => buildScoutingReport(db, save, context, playerId),
      true,
    );
  }

  toggleShortlist(playerId: EntityId): AppResult<ScoutingDashboard> {
    return this.managerCommand(
      (db, save, context) => toggleManagerShortlist(db, save, context, playerId),
      true,
    );
  }

  searchRecruitment(command: RecruitmentSearchCommand): AppResult<RecruitmentSearchPage> {
    return this.managerCommand((db, save, context) =>
      searchManagerRecruitment(db, save, context, command),
    );
  }

  getTransferCentre(): AppResult<TransferCentre> {
    return this.managerCommand(buildTransferCentre);
  }

  makeTransferOffer(command: TransferOfferCommand): AppResult<TransferCentre> {
    return this.managerCommand((db, save, context) => {
      requireDomainPermission(db, save, context, "TRANSFERS", "makeTransferOffer");
      return makeManagerTransferOffer(db, save, context, command);
    }, true);
  }

  respondTransferOffer(command: TransferResponseCommand): AppResult<TransferCentre> {
    return this.managerCommand(
      (db, save, context) => respondToTransferOffer(db, save, context, command),
      true,
    );
  }

  makeTransferRequest(command: TransferRequestCommand): AppResult<TransferCentre> {
    return this.managerCommand(
      (db, save, context) => makeManagerTransferRequest(db, save, context, command),
      true,
    );
  }

  respondTransferRequest(command: TransferRequestResponseCommand): AppResult<TransferCentre> {
    return this.managerCommand(
      (db, save, context) => respondManagerTransferRequest(db, save, context, command),
      true,
    );
  }

  negotiateLoan(command: TransferLoanCommand): AppResult<TransferCentre> {
    return this.managerCommand(
      (db, save, context) => negotiateManagerLoan(db, save, context, command),
      true,
    );
  }

  respondLoanOffer(command: { offerId: EntityId; action: "ACCEPT" | "WITHDRAW" }): AppResult<TransferCentre> {
    return this.managerCommand(
      (db, save, context) => respondToLoanOffer(db, save, context, command),
      true,
    );
  }

  withdrawTransferOffer(command: { offerId: EntityId }): AppResult<TransferCentre> {
    return this.managerCommand(
      (db, save, context) => withdrawManagerTransferOffer(db, save, context, command),
      true,
    );
  }

  counterLoanOffer(command: {
    offerId: EntityId;
    wageContributionPercent?: number;
    durationMonths?: number;
    playingTimeExpectation?: string;
    recallOption?: boolean;
  }): AppResult<TransferCentre> {
    return this.managerCommand(
      (db, save, context) => counterManagerLoanOffer(db, save, context, command),
      true,
    );
  }

  setTransferStatus(command: TransferListCommand): AppResult<TransferCentre> {
    return this.managerCommand((db, save, context) => {
      requireDomainPermission(db, save, context, "TRANSFERS", "setTransferStatus");
      const result = setManagerTransferStatus(db, save, context, command);
      resolveOwnerPlayerRequestAfterAction(db, {
        clubId: context.club!.id,
        playerId: command.playerId,
        intent: command.status === "LOAN_LISTED" ? "CONSIDER_LOAN_LIST" : "CONSIDER_TRANSFER_LIST",
        date: save.worldDate,
        sourceId: command.playerId,
      });
      return result;
    }, true);
  }

  getContracts(): AppResult<ContractList> {
    return this.managerCommand(buildContractList);
  }

  renewContract(command: ContractRenewalCommand): AppResult<ContractList> {
    return this.managerCommand((db, save, context) => {
      requireDomainPermission(db, save, context, "CONTRACTS", "renewContract");
      const result = renewManagerContract(db, save, context, command);
      resolveOwnerPlayerRequestAfterAction(db, {
        clubId: context.club!.id,
        playerId: command.playerId,
        intent: "CONSIDER_RENEWAL",
        date: save.worldDate,
        sourceId: command.playerId,
      });
      return result;
    }, true);
  }

  // -------------------------------------------------------------------------
  // Interactive matchday (Step 4C).
  //
  // Each command resolves the manager context first, so authority is checked in
  // the service rather than implied by the UI having shown a button.
  // -------------------------------------------------------------------------

  private matchCommand<T>(
    action: (
      db: GameDatabase,
      save: SaveMetadata,
      context: ManagerContext,
      helpers: MatchCommandHelpers,
    ) => T,
  ): AppResult<T> {
    return this.managerCommand((db, save, context) => {
      assertManagerAuthority(context, undefined, "SELECT_SQUAD");
      return action(db, save, context, matchHelpers(db, save, context));
    }, true);
  }

  startMatch(command: StartMatchCommand = {}): AppResult<LiveMatchView> {
    return this.matchCommand((db, save, context, helpers) => {
      const fixture = helpers.resolveFixture(command.fixtureId);
      const state = startMatchSession(
        db,
        helpers.simulateInput(fixture),
        command.viewMode ?? "TEXT_LIVE",
      );
      return helpers.view(state, command.viewMode ?? "TEXT_LIVE");
    });
  }

  getLiveMatch(fixtureId?: EntityId, since?: number): AppResult<LiveMatchView> {
    return this.matchCommand((db, save, context, helpers) => {
      const { state, record } = helpers.requireSession(fixtureId);
      return helpers.view(
        state,
        record.viewMode ?? "TEXT_LIVE",
        since,
        record.status === "COMPLETED",
      );
    });
  }

  advanceMatch(command: AdvanceMatchCommand = {}, fixtureId?: EntityId): AppResult<LiveMatchView> {
    return this.matchCommand((db, save, context, helpers) => {
      const { state, record } = helpers.requireSession(fixtureId);
      advanceMatch(db, state, advanceTargetFor(command));
      const finalized = helpers.finalizeIfComplete(state);
      return helpers.view(state, record.viewMode ?? "TEXT_LIVE", command.since, finalized);
    });
  }

  continueFromHalfTime(fixtureId?: EntityId): AppResult<LiveMatchView> {
    return this.matchCommand((db, save, context, helpers) => {
      const { state, record } = helpers.requireSession(fixtureId);
      continueFromHalfTime(db, state);
      const finalized = helpers.finalizeIfComplete(state);
      return helpers.view(state, record.viewMode ?? "TEXT_LIVE", undefined, finalized);
    });
  }

  makeSubstitution(command: SubstitutionCommand, fixtureId?: EntityId): AppResult<LiveMatchView> {
    return this.matchCommand((db, save, context, helpers) => {
      const { state, record } = helpers.requireSession(fixtureId);
      // A manager may only substitute for the team they manage.
      makeSubstitution(db, state, {
        teamId: context.team.id,
        playerOffId: command.playerOffId,
        playerOnId: command.playerOnId,
      });
      return helpers.view(state, record.viewMode ?? "TEXT_LIVE");
    });
  }

  updateLiveTactics(command: LiveTacticsCommand, fixtureId?: EntityId): AppResult<LiveMatchView> {
    return this.matchCommand((db, save, context, helpers) => {
      const { state, record } = helpers.requireSession(fixtureId);
      const team = state.home.teamId === context.team.id ? state.home : state.away;
      if (!team.setup) {
        throw appError("INVALID_SELECTION", "Your team has no tactical setup in this match.");
      }
      updateLiveTactics(db, state, {
        teamId: context.team.id,
        setup: applyTacticsCommand(team.setup, command),
      });
      return helpers.view(state, record.viewMode ?? "TEXT_LIVE");
    });
  }

  /** Finishes an interactive match from where it stands, never from kickoff. */
  quickSimCurrentMatch(fixtureId?: EntityId): AppResult<LiveMatchView> {
    return this.matchCommand((db, save, context, helpers) => {
      // A fixture that already finished (a previous quick sim, or a live
      // match played to full time) is no longer "the current matchday" per
      // requireSession/managerFixture, since there is nothing left to
      // action. Repeating the call is meant to be a safe no-op that reports
      // the persisted result, so check for that case directly before
      // requiring an actionable session.
      if (fixtureId) {
        const existing = loadMatchSession(db, fixtureId);
        if (existing && existing.state.period === "FULL_TIME") {
          return helpers.view(existing.state, existing.record.viewMode ?? "QUICK_SIM", undefined, true);
        }
      }
      const { state, record } = helpers.requireSession(fixtureId);
      const fixture = helpers.resolveFixture(state.fixtureId);
      quickSimFromCurrentState(db, state, helpers.finalizationContext(fixture));
      return helpers.view(state, record.viewMode ?? "QUICK_SIM", undefined, true);
    });
  }

  resumeMatch(fixtureId?: EntityId): AppResult<LiveMatchView | undefined> {
    return this.matchCommand((db, save, context, helpers) => {
      const session = loadMatchSession(db, fixtureId ?? helpers.activeFixtureId());
      if (!session) return undefined;
      return helpers.view(
        session.state,
        session.record.viewMode ?? "TEXT_LIVE",
        undefined,
        session.record.status === "COMPLETED",
      );
    });
  }

  getPostMatchReport(fixtureId: EntityId): AppResult<PostMatchReport | undefined> {
    return this.managerCommand((db, _save, context) => {
      assertManagerAuthority(context);
      return buildPostMatchReport(db, fixtureId, context.team.id, context.season.name);
    });
  }

  /** Post-match summary for a played fixture, built from persisted match state. */
  getMatchSummary(fixtureId: EntityId): AppResult<QuickSimSummary | undefined> {
    return this.managerCommand((db, _save, context) =>
      buildQuickSimSummary(db, context, fixtureId),
    );
  }

  getStaff(clubId?: EntityId): AppResult<StaffList> {
    return this.managerCommand((db, save, context) => buildStaffList(db, save, context, clubId));
  }

  getStaffMarket(): AppResult<StaffMarketView> {
    return this.managerCommand((db, save, context) => buildStaffMarketView(db, save, context));
  }

  applyForStaffRole(
    vacancyId: EntityId,
    personId: EntityId,
    salaryAmountMinor: number,
    contractMonths: number,
  ): AppResult<StaffHireResult> {
    return this.managerCommand((db, save, context) => {
      let outcome: StaffHireOutcomeView;
      try {
        const { application, reason } = applyForStaffVacancy(
          db,
          save,
          vacancyId,
          personId,
          salaryAmountMinor,
          contractMonths,
          context.club?.id,
        );
        outcome = {
          status: application.status,
          reason,
          offeredSalaryMinor: application.offeredSalaryMinor,
          counterSalaryMinor: application.counterSalaryMinor,
        };
      } catch (error) {
        if (error instanceof StaffNegotiationError)
          throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return { outcome, market: buildStaffMarketView(db, save, context) };
    }, true);
  }

  respondToStaffApplication(applicationId: EntityId, accept: boolean): AppResult<StaffMarketView> {
    return this.managerCommand((db, save, context) => {
      try {
        if (accept) acceptStaffApplication(db, save, applicationId);
        else declineStaffApplication(db, save, applicationId);
      } catch (error) {
        if (error instanceof StaffNegotiationError)
          throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return buildStaffMarketView(db, save, context);
    }, true);
  }

  offerStaffContractRenewal(
    appointmentId: EntityId,
    salaryAmountMinor: number,
    contractMonths: number,
  ): AppResult<StaffMarketView> {
    return this.managerCommand((db, save, context) => {
      try {
        offerStaffRenewal(db, save, appointmentId, salaryAmountMinor, contractMonths);
      } catch (error) {
        if (error instanceof StaffNegotiationError)
          throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return buildStaffMarketView(db, save, context);
    }, true);
  }

  respondToStaffRenewal(offerId: EntityId, accept: boolean): AppResult<StaffMarketView> {
    return this.managerCommand((db, save, context) => {
      try {
        if (accept) acceptStaffRenewalCounter(db, save, offerId);
        else declineStaffRenewalOffer(db, save, offerId);
      } catch (error) {
        if (error instanceof StaffNegotiationError)
          throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return buildStaffMarketView(db, save, context);
    }, true);
  }

  dismissStaffMember(appointmentId: EntityId): AppResult<StaffMarketView> {
    return this.managerCommand((db, save, context) => {
      try {
        dismissStaff(db, save, appointmentId);
      } catch (error) {
        if (error instanceof StaffActionError) throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return buildStaffMarketView(db, save, context);
    }, true);
  }

  enrolStaffLicenceCourse(personId: EntityId, clubFunded: boolean): AppResult<StaffMarketView> {
    return this.managerCommand((db, save, context) => {
      try {
        enrolInLicenceCourse(db, save, personId, clubFunded ? context.club?.id : undefined);
      } catch (error) {
        if (error instanceof LicenceCourseError) throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return buildStaffMarketView(db, save, context);
    }, true);
  }

  // Staff Market Phase C.
  getStaffHierarchy(): AppResult<StaffHierarchyView> {
    return this.managerCommand((db, save, context) => {
      return buildStaffHierarchyView(db, context.club!.id);
    }, false);
  }

  assignStaffResponsibility(
    domain: StaffResponsibilityDomain,
    ownerType: StaffResponsibilityOwnerType,
    ownerAppointmentId?: EntityId,
  ): AppResult<StaffHierarchyView> {
    return this.managerCommand((db, save, context) => {
      try {
        assignResponsibility(db, save, context.club!.id, domain, ownerType, ownerAppointmentId);
      } catch (error) {
        if (error instanceof ResponsibilityError)
          throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return buildStaffHierarchyView(db, context.club!.id);
    }, true);
  }

  requestStaffBoardApproval(domain: StaffResponsibilityDomain): AppResult<StaffHierarchyView> {
    return this.managerCommand((db, save, context) => {
      try {
        requestBoardApproval(db, save, context.club!.id, domain);
      } catch (error) {
        if (error instanceof ResponsibilityError)
          throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return buildStaffHierarchyView(db, context.club!.id);
    }, true);
  }

  createStaffDevelopmentPlan(
    personId: EntityId,
    focus: string,
    targetLicenceType?: string,
    clubFunded = true,
  ): AppResult<StaffHierarchyView> {
    return this.managerCommand((db, save, context) => {
      try {
        createStaffDevelopmentPlan(
          db,
          save,
          context.club!.id,
          personId,
          focus,
          targetLicenceType,
          clubFunded,
        );
      } catch (error) {
        if (error instanceof LicenceCourseError) throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return buildStaffHierarchyView(db, context.club!.id);
    }, true);
  }

  private executiveActor(
    db: GameDatabase,
    save: SaveMetadata,
    clubId: EntityId,
  ): { role: "CEO" | "GENERAL_SECRETARY"; personId: EntityId } {
    // Resolved from a genuinely held CEO/General Secretary appointment,
    // never from activeCareerRole/the career picker — these are NPC jobs,
    // never something a player switches into, even when this same person
    // happens to hold one (e.g. a delegated appointment).
    const personId = careerPersonId(db, save);
    const held = heldExecutiveRole(db, personId, clubId);
    if (!held || (held.role !== "CEO" && held.role !== "GENERAL_SECRETARY"))
      throw appError("ROLE_NOT_AUTHORIZED", "An active CEO or General Secretary role is required.");
    return { role: held.role, personId };
  }

  private executiveActorForCase(
    db: GameDatabase,
    save: SaveMetadata,
    caseId: EntityId,
  ): { role: "CEO" | "GENERAL_SECRETARY"; personId: EntityId } {
    const clubId = new ClubLicensingRepository(db).get(caseId)?.clubId;
    if (!clubId) throw appError("INVALID_SELECTION", "Licence case not found.");
    return this.executiveActor(db, save, clubId);
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
      if (error instanceof MatchAlreadyPlayedError) return fail(error.code, error.message);
      if (error instanceof MatchCommandError) return fail(error.code, error.message);
      if (error instanceof ManagerCommandError) return fail(error.code, error.message);
      if (error instanceof ExecutiveRoleError) return fail("ROLE_NOT_AUTHORIZED", error.message);
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
    const context = tryManagerContext(db, save);
    if (!context) return this.buildUnemployedState(db, save, filePath);
    const squad = squadReadModel(db, context.team.id, save.worldDate);
    const managers = new ManagerRepository(db);
    const tactics = managers.tacticalSetups(context.team.id);
    const fixtures = fixtureReadModels(db, context, save);
    return {
      save,
      header: careerHeaderFromContext(db, save, context),
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

  private buildUnemployedState(
    db: GameDatabase,
    save: SaveMetadata,
    filePath: string,
  ): DesktopApplicationState {
    const managerProfile = requirePlayerManagerProfile(db, save);
    const character = new WorldRepository(db).getCareerCharacter(save.playerCharacterId!)!;
    const person = getPerson(db, character.personId);
    const managers = new ManagerRepository(db);
    return {
      save,
      header: unemployedCareerHeader(db, save),
      catalogEntry: this.catalogEntry(db, save, filePath),
      home: {
        save,
        manager: managerProfile,
        managerName: displayName(person),
        inbox: managers.inboxItems(),
        unavailablePlayers: [],
      },
      squad: [],
      tactics: [],
      fixtures: [],
      competition: { name: "Unemployed", table: [] },
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
      const context = tryManagerContext(db, save);
      if (context) {
        return {
          ...base,
          characterName: displayName(context.managerPerson),
          activeRole: activeCareerRole(db, context.managerPerson.id),
          organisation: context.club?.name ?? context.team.name,
        };
      }
      if (save.playerCharacterId) {
        const character = new WorldRepository(db).getCareerCharacter(save.playerCharacterId);
        const person = character ? getPerson(db, character.personId) : undefined;
        if (person) {
          return {
            ...base,
            characterName: displayName(person),
            activeRole: activeCareerRole(db, person.id),
            organisation:
              activeCareerRole(db, person.id) === "CHAIRMAN_OWNER"
                ? ((
                    db
                      .prepare(
                        "SELECT c.name FROM club_ownership_stakes s JOIN clubs c ON c.id=s.club_id WHERE s.holder_id=? AND s.holder_type='PERSON' AND s.status='ACTIVE' AND s.percentage>=51 ORDER BY s.percentage DESC LIMIT 1",
                      )
                      .get(person.id) as { name?: string } | undefined
                  )?.name ?? "Owner / Founder")
                : "Unemployed",
          };
        }
      }
      return base;
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

/** Deterministic per-club setup-screen estimate — same hub list and same
 * SIMULATION_ONLY intent as presentClubLocation's fallback (club-location.ts),
 * keyed by dataset club key here since no database row exists yet at setup
 * time. The same club key always gets the same plausible hub. */
const estimatedClubLocality = (clubKey: string): string => {
  const random = new SeededRandom(`club-locality-estimate:${clubKey}`);
  const index = Math.floor(random.next() * PLAUSIBLE_CLUB_LOCALITY_HUBS.length);
  return `${PLAUSIBLE_CLUB_LOCALITY_HUBS[index]} (estimated)`;
};

export const startingClubOptions = (dataset: NepalWorldDataset): StartingClubOption[] => {
  const squadSizes = new Map<string, number>();
  for (const assignment of dataset.teamPersonAssignments) {
    if (assignment.role !== "PLAYER") continue;
    squadSizes.set(assignment.teamKey, (squadSizes.get(assignment.teamKey) ?? 0) + 1);
  }
  const competitionNames = new Map(
    dataset.competitions.map((competition) => [competition.key, competition.name]),
  );
  const clubNames = new Map(dataset.clubs.map((club) => [club.key, club.name]));
  const membershipByTeam = new Map<string, { competitionKey: string; name: string }>();
  for (const membership of dataset.clubMemberships ?? []) {
    if (membership.status !== "ACTIVE" || !membership.teamKey?.value) continue;
    const teamKey = membership.teamKey?.value;
    const competition = dataset.competitions.find((item) => item.key === membership.competitionKey);
    if (!competition || competition.category !== "PYRAMID_LEAGUE") continue;
    const current = membershipByTeam.get(teamKey);
    if (!current || /[ABC]-DIVISION/i.test(competition.name))
      membershipByTeam.set(teamKey, {
        competitionKey: membership.competitionKey,
        name: competition.name,
      });
  }

  return dataset.teams
    .filter(
      (team) => team.level === "senior" && team.gender === "men" && membershipByTeam.has(team.key),
    )
    .map((team) => {
      const clubKey = team.clubKey?.value;
      const membership = membershipByTeam.get(team.key)!;
      const club = clubKey ? dataset.clubs.find((item) => item.key === clubKey) : undefined;
      const locationName =
        (club?.locationKey.value
          ? dataset.locations.find((item) => item.key === club.locationKey.value)?.name
          : undefined) ?? (clubKey ? estimatedClubLocality(clubKey) : undefined);
      return {
        teamId: createStableEntityId("team", team.key),
        clubId: clubKey ? createStableEntityId("club", clubKey) : undefined,
        clubName: (clubKey ? clubNames.get(clubKey) : undefined) ?? team.name,
        teamName: team.name,
        competitionName:
          membership.name ?? competitionNames.get(membership.competitionKey) ?? "Nepal football",
        squadSize: squadSizes.get(team.key) ?? 0,
        division:
          membership.name.match(/([ABC])-DIVISION/i)?.[1] ?? "Other playable Nepal competition",
        locationName,
        professionalStatus: club?.ownershipType.value === "DEPARTMENTAL" ? "Departmental" : "Club",
      };
    })
    .sort((a, b) => {
      const rank = (division: string): number => ({ A: 0, B: 1, C: 2 })[division] ?? 3;
      return rank(a.division) - rank(b.division) || a.clubName.localeCompare(b.clubName);
    });
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
      JOIN competitions c ON c.id = cs.competition_id
      WHERE cm.team_id = ? AND cm.status = 'ACTIVE'
      ORDER BY CASE WHEN lower(c.name) LIKE '%a-division%' OR lower(c.name) LIKE '%b-division%' OR lower(c.name) LIKE '%c-division%' THEN 0 ELSE 1 END, cs.start_date LIMIT 1`,
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

const careerPersonId = (db: GameDatabase, save: SaveMetadata): EntityId => {
  if (!save.playerCharacterId) throw appError("SAVE_CORRUPT", "Save has no player character.");
  const character = new WorldRepository(db).getCareerCharacter(save.playerCharacterId);
  if (!character) throw appError("SAVE_CORRUPT", "Career character record is missing.");
  return character.personId;
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

/**
 * Same lookups as `managerContext`, but returns `undefined` instead of
 * throwing when the manager simply has no active contract — the normal,
 * expected shape of an unemployed career rather than a corrupt save.
 */
const tryManagerContext = (db: GameDatabase, save: SaveMetadata): ManagerContext | undefined => {
  if (!save.playerCharacterId) return undefined;
  const world = new WorldRepository(db);
  const managers = new ManagerRepository(db);
  const character = world.getCareerCharacter(save.playerCharacterId);
  if (!character) return undefined;
  const manager = managers.getProfileByPerson(character.personId);
  if (!manager) return undefined;
  const contract = managers.activeContract(manager.id);
  if (!contract?.teamId) return undefined;
  return managerContext(db, save);
};

const advanceOwnerCareer = (
  db: GameDatabase,
  save: SaveMetadata,
  clubId: EntityId,
  maxDays = 5,
): { worldDate: string; message: string } => {
  let date = save.worldDate;
  let previousMonth = date.slice(0, 7);
  for (let day = 0; day < maxDays; day += 1) {
    const next = addWorldDays(date, 1);
    const tick = { ...save, worldDate: next };
    ensureAiManagersAssigned(db, tick, undefined);
    evaluateBoardConfidence(db, tick);
    advanceInfrastructureProjects(db, { date: next, seed: `${save.randomSeed}:owner:${clubId}` });
    advanceGovernmentApplications(db, { date: next });
    publishMediaForDate(db, { date: next });
    advanceProcurementContracts(db, next);
    advanceProcurementServices(db, { date: next });
    advanceProcurementOrders(db, { date: next, seed: `${save.randomSeed}:owner:${clubId}` });
    advanceClubLoanRepayments(db, next);
    // Any ownership/investor negotiation decision due today happens here —
    // due diligence, board review, and final settlement all take real
    // simulated days rather than resolving the instant the owner clicks
    // Accept (see processDueOwnershipOffer).
    const ownershipOutcomes = processDueOwnershipOffers(db, next);
    for (const outcome of ownershipOutcomes) {
      if (outcome.clubId !== clubId) continue;
      new ManagerRepository(db).insertInboxItem({
        id: createStableEntityId("inbox", `ownership:${outcome.clubId}:${next}:${outcome.title}`),
        createdOn: next,
        type: "COMPETITION_UPDATE",
        title: outcome.title,
        body: outcome.body,
        read: false,
      });
    }
    if (next.slice(0, 7) !== previousMonth) {
      advanceMacroEconomyForWorldDate(db, {
        date: next,
        seed: `${save.randomSeed}:economy:${next.slice(0, 7)}`,
      });
      processClubEconomyMonth(db, {
        date: next,
        seed: `${save.randomSeed}:economy:${next.slice(0, 7)}`,
      });
      previousMonth = next.slice(0, 7);
    }
    date = next;
  }
  const account = db
    .prepare("SELECT cash_balance FROM club_financial_accounts WHERE club_id = ?")
    .get(clubId) as { cash_balance?: number } | undefined;
  return {
    worldDate: date,
    message: `Club operations advanced to ${date}. Cash balance: NPR ${Math.round(account?.cash_balance ?? 0).toLocaleString("en-IN")}. Budget, sponsorship, procurement, and infrastructure systems are now progressing with the world.`,
  };
};

const addWorldDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const requirePlayerManagerProfile = (db: GameDatabase, save: SaveMetadata): ManagerProfile => {
  if (!save.playerCharacterId) throw appError("SAVE_CORRUPT", "Save has no player character.");
  const character = new WorldRepository(db).getCareerCharacter(save.playerCharacterId);
  if (!character) throw appError("SAVE_CORRUPT", "Career character record is missing.");
  const manager = new ManagerRepository(db).getProfileByPerson(character.personId);
  if (!manager) throw appError("SAVE_CORRUPT", "Manager profile record is missing.");
  return manager;
};

const buildJobCentreView = (db: GameDatabase, managerProfile: ManagerProfile): JobCentreView => {
  const careerWorld = new CareerWorldRepository(db);
  const vacancies: JobVacancyView[] = listVacancies(db, managerProfile).map((listing) => ({
    id: listing.vacancy.id,
    clubName: listing.clubName,
    teamName: listing.teamName,
    competitionName: listing.competitionName,
    openedOn: listing.vacancy.openedOn,
    reason: listing.vacancy.reason,
    boardExpectation: listing.vacancy.boardExpectation,
    eligible: listing.eligible,
    eligibilityNote: listing.eligibilityNote,
  }));
  const applications: JobApplicationView[] = careerWorld
    .applicationsForManager(managerProfile.id)
    .map((application) => {
      const vacancy = careerWorld.vacancy(application.vacancyId);
      const team = vacancy ? getTeam(db, vacancy.teamId) : undefined;
      const club = vacancy?.clubId ? getClub(db, vacancy.clubId) : undefined;
      return {
        id: application.id,
        vacancyId: application.vacancyId,
        clubName: club?.name ?? team?.name ?? "Unknown club",
        teamName: team?.name ?? "Unknown team",
        status: application.status,
        createdOn: application.createdOn,
        decidedOn: application.decidedOn,
        offeredSalaryMinor: application.offeredSalaryMinor,
        offeredContractEnd: application.offeredContractEnd,
      };
    });
  return { reputationProfile: managerProfile.reputationProfile, vacancies, applications };
};

const toPromiseView = (db: GameDatabase, promise: ManagerPromise): SquadPromiseView => ({
  id: promise.id,
  personId: promise.personId,
  playerName: displayName(getPerson(db, promise.personId)),
  type: promise.type,
  description: promise.description,
  madeOn: promise.madeOn,
  dueOn: promise.dueOn,
  status: promise.status,
  commitmentSource: promise.commitmentSource,
  recipientType: promise.recipientType,
  targetCriteria: promise.targetCriteria,
  importance: promise.importance,
});

const buildStaffMarketView = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): StaffMarketView => {
  const clubId = context.club?.id;
  const base = buildStaffList(db, save, context, clubId);
  const market = new StaffMarketRepository(db);

  const staff: StaffRowWithContract[] = base.staff.map((row) => {
    const appointment = market.appointmentById(row.appointmentId);
    const employmentContract = appointment?.contractId
      ? market.employmentContractById(appointment.contractId)
      : undefined;
    const performance = market.performanceHistoryForPerson(row.personId);
    return {
      ...row,
      salaryAmountMinor: employmentContract?.salaryAmountMinor,
      contractEnd: employmentContract?.contractEnd,
      lastPerformanceScore: performance[performance.length - 1]?.score,
    };
  });

  const applications: StaffApplicationView[] = clubId
    ? base.vacancies
        .flatMap((vacancy) => market.applicationsForVacancy(vacancy.id))
        .filter(
          (application) =>
            application.status === "OFFERED" ||
            application.status === "COUNTERED" ||
            application.status === "PENDING",
        )
        .map((application) => {
          const vacancy = market.vacancyById(application.vacancyId);
          return {
            id: application.id,
            vacancyId: application.vacancyId,
            personId: application.personId,
            personName: displayName(getPerson(db, application.personId)),
            role: vacancy?.role ?? "",
            status: application.status,
            offeredSalaryMinor: application.offeredSalaryMinor,
            counterSalaryMinor: application.counterSalaryMinor,
            createdOn: application.createdOn,
          };
        })
    : [];

  const renewalOffers: StaffRenewalOfferView[] = base.staff
    .flatMap((row) => market.renewalOffersForAppointment(row.appointmentId))
    .filter((offer) => offer.status === "COUNTERED")
    .map((offer) => ({
      id: offer.id,
      appointmentId: offer.appointmentId,
      personId: offer.personId,
      personName: displayName(getPerson(db, offer.personId)),
      role: market.appointmentById(offer.appointmentId)?.role ?? "",
      status: offer.status,
      proposedSalaryMinor: offer.proposedSalaryMinor,
      counterSalaryMinor: offer.counterSalaryMinor,
      createdOn: offer.createdOn,
    }));

  const approaches: StaffApproachView[] = clubId
    ? market.approachesForClub(clubId).map((approach) => ({
        id: approach.id,
        personId: approach.personId,
        personName: displayName(getPerson(db, approach.personId)),
        fromClubName: getClub(db, approach.fromClubId).name,
        role: approach.role,
        offeredSalaryMinor: approach.offeredSalaryMinor,
        status: approach.status,
        createdOn: approach.createdOn,
      }))
    : [];

  return {
    staff,
    vacancies: base.vacancies,
    candidates: base.candidates,
    applications,
    renewalOffers,
    approaches,
  };
};

const buildStaffHierarchyView = (db: GameDatabase, clubId: EntityId): StaffHierarchyView => {
  const market = new StaffMarketRepository(db);

  const hierarchy: StaffHierarchyEntryView[] = staffHierarchyForClub(db, clubId).map((entry) => ({
    appointmentId: entry.appointmentId,
    personId: entry.personId,
    personName: displayName(getPerson(db, entry.personId)),
    role: entry.role,
    seniorityRank: entry.seniorityRank,
    domains: entry.domains,
    workload: entry.workload,
  }));

  const responsibilities: StaffResponsibilityView[] = RESPONSIBILITY_DOMAINS.map((domain) => {
    const owner = responsibilityOwner(db, clubId, domain);
    return {
      domain: owner.domain,
      ownerType: owner.ownerType,
      ownerAppointmentId: owner.ownerAppointmentId,
      ownerName: owner.ownerAppointmentId
        ? displayName(getPerson(db, market.appointmentById(owner.ownerAppointmentId)!.personId))
        : undefined,
      boardApprovalGrantedUntil: owner.boardApprovalGrantedUntil,
    };
  });

  const developmentPlans: StaffDevelopmentPlanView[] = market
    .developmentPlansForClub(clubId)
    .map((plan) => ({
      id: plan.id,
      personId: plan.personId,
      personName: displayName(getPerson(db, plan.personId)),
      focus: plan.focus,
      targetLicenceType: plan.targetLicenceType,
      targetDate: plan.targetDate,
      status: plan.status,
    }));

  const successionPlans: StaffSuccessionPlanView[] = market
    .successionPlansForClub(clubId)
    .map((plan) => ({
      id: plan.id,
      outgoingAppointmentId: plan.outgoingAppointmentId,
      personName: displayName(getPerson(db, plan.outgoingPersonId)),
      role: plan.role,
      candidateName: plan.candidatePersonId
        ? displayName(getPerson(db, plan.candidatePersonId))
        : undefined,
      reason: plan.reason,
    }));

  // Advisory only — the same aligned/strained relationship math that already
  // feeds staff cooperation elsewhere (recruitment/course/retention
  // modifiers), just surfaced here as a read-only backroom-atmosphere
  // summary. Never exposes the underlying trust/respect/tension scores.
  const people = new PeopleFoundationRepository(db);
  const backroom = backroomSummary({
    clubId,
    activeStaff: hierarchy.length,
    relationships: hierarchy.flatMap((entry) => people.relationshipsForPerson(entry.personId)),
  });

  return { hierarchy, responsibilities, developmentPlans, successionPlans, backroom };
};

const buildMedicalCentreView = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): MedicalCentreView => {
  const players = new PlayerRepository(db)
    .attributesForTeam(context.team.id)
    .map((attributes) => attributes.personId);
  const entries: MedicalCentreEntryView[] = players.map((personId) => {
    const entry = buildMedicalCentreEntry(
      db,
      { clubId: context.club?.id ?? ("" as EntityId), personId, date: save.worldDate },
      context.fixtures,
      context.team.id,
    );
    return {
      personId,
      name: displayName(getPerson(db, personId)),
      stage: entry.assessment.stage,
      estimatedReturnStart: entry.assessment.estimatedReturnStart,
      estimatedReturnEnd: entry.assessment.estimatedReturnEnd,
      confidence: entry.assessment.confidence,
      recurrenceRisk: entry.assessment.recurrenceRisk,
      fatigue: entry.assessment.fatigue,
      workloadFlag: entry.assessment.workloadFlag,
      availabilityRecommendation: entry.assessment.availabilityRecommendation,
      clearanceStatus: entry.assessment.clearanceStatus,
      rationale: entry.assessment.rationale,
      chronicRisk: entry.chronicRisk,
      trainingAvailability: entry.trainingAvailability,
      congestionMultiplier: entry.congestionMultiplier,
      rehabPlan: entry.plan
        ? {
            id: entry.plan.id,
            stage: entry.plan.stage,
            stageStartedOn: entry.plan.stageStartedOn,
            startedOn: entry.plan.startedOn,
            targetReturnDate: entry.plan.targetReturnDate,
            status: entry.plan.status,
          }
        : undefined,
      decisionHistory: entry.decisionHistory.map((record) => ({
        id: record.id,
        decidedOn: record.decidedOn,
        decision: record.decision,
        medicalRecommendation: record.medicalRecommendation,
        outcome: record.outcome,
        rationale: record.rationale,
      })),
    };
  });
  return {
    players: entries.filter(
      (entry) => entry.rehabPlan || entry.trainingAvailability !== "FULL" || entry.chronicRisk,
    ),
    decisionOptions: ["FOLLOW_ADVICE", "DELAY", "ACCEPT_RISK"],
  };
};

const buildSquadDynamicsView = (db: GameDatabase, teamId: EntityId): SquadDynamicsView => {
  const dynamics = new SquadDynamicsRepository(db);
  const hierarchyByPerson = new Map(
    dynamics.hierarchyForTeam(teamId).map((entry) => [entry.personId, entry.role]),
  );
  const activePromises = dynamics.activePromisesForTeam(teamId);
  const promiseByConcernId = new Map(
    activePromises
      .filter((promise): promise is ManagerPromise & { concernId: EntityId } =>
        Boolean(promise.concernId),
      )
      .map((promise) => [promise.concernId, toPromiseView(db, promise)]),
  );

  const concerns: SquadConcernView[] = dynamics
    .concernsForTeam(teamId)
    .filter((concern) => concern.status !== "RESOLVED")
    .map((concern) => ({
      id: concern.id,
      personId: concern.personId,
      playerName: displayName(getPerson(db, concern.personId)),
      hierarchyRole: hierarchyByPerson.get(concern.personId),
      type: concern.type,
      status: concern.status,
      severity: concern.severity,
      raisedOn: concern.raisedOn,
      updatedOn: concern.updatedOn,
      note: concern.note,
      validActions: validActionsForConcern(concern.type),
      activePromise: promiseByConcernId.get(concern.id),
    }));

  const demands: SquadDemandView[] = dynamics
    .demandsForTeam(teamId)
    .filter((demand) => demand.status === "OPEN")
    .map((demand) => ({
      id: demand.id,
      personId: demand.personId,
      playerName: displayName(getPerson(db, demand.personId)),
      type: demand.type,
      status: demand.status,
      severity: demand.severity,
      openedOn: demand.openedOn,
      reviewOn: demand.reviewOn,
      trigger: demand.trigger,
      requestedOutcome: demand.requestedOutcome,
    }));

  const hierarchy = dynamics.hierarchyForTeam(teamId);
  const groupByPerson = new Map(
    dynamics.groupsForTeam(teamId).map((entry) => [entry.personId, entry.groupType]),
  );
  const groups: SquadGroupMemberView[] = hierarchy.map((entry) => ({
    personId: entry.personId,
    playerName: displayName(getPerson(db, entry.personId)),
    groupType: groupByPerson.get(entry.personId) ?? "MAIN_GROUP",
    hierarchyRole: entry.role,
    influence: entry.influence,
  }));

  const cohesionRecord = dynamics.cohesion(teamId);
  const captainEntry = hierarchy.find((entry) => entry.role === "CAPTAIN");
  const viceCaptainEntry = hierarchy.find((entry) => entry.role === "VICE_CAPTAIN");
  const cohesion: TeamCohesionView = {
    score: cohesionRecord?.score ?? 70,
    level: cohesionRecord?.level ?? "STABLE",
    captainPersonId: captainEntry?.personId,
    captainName: captainEntry ? displayName(getPerson(db, captainEntry.personId)) : undefined,
    viceCaptainPersonId: viceCaptainEntry?.personId,
    viceCaptainName: viceCaptainEntry
      ? displayName(getPerson(db, viceCaptainEntry.personId))
      : undefined,
    captainInfluence: cohesionRecord?.captainInfluence ?? "NEUTRAL",
    topIssue: cohesionRecord?.topIssue,
  };

  const disputes = dynamics.openDisputesForTeam(teamId).map((dispute) => ({
    ...dispute,
    playerName: displayName(getPerson(db, dispute.personId)),
    withPlayerName: dispute.withPersonId
      ? displayName(getPerson(db, dispute.withPersonId))
      : undefined,
  }));
  return {
    concerns,
    demands,
    promises: activePromises.map((promise) => toPromiseView(db, promise)),
    cohesion,
    groups,
    disputes,
    meetings: dynamics.meetingsForTeam(teamId).slice(0, 10),
  };
};

const unemployedCareerHeader = (db: GameDatabase, save: SaveMetadata): CareerHeader => {
  const character = save.playerCharacterId
    ? new WorldRepository(db).getCareerCharacter(save.playerCharacterId)
    : undefined;
  const person = character ? getPerson(db, character.personId) : undefined;
  const ownedClub = person
    ? (db
        .prepare(
          "SELECT c.name, t.name AS team_name, cs.name AS competition_name FROM club_ownership_stakes s JOIN clubs c ON c.id=s.club_id LEFT JOIN teams t ON t.club_id=c.id AND t.level='senior' LEFT JOIN club_memberships cm ON cm.team_id=t.id AND cm.status='ACTIVE' LEFT JOIN competition_seasons cs ON cs.id=cm.competition_season_id WHERE s.holder_id=? AND s.holder_type='PERSON' AND s.status='ACTIVE' AND s.percentage>=51 ORDER BY s.percentage DESC LIMIT 1",
        )
        .get(person.id) as
        { name?: string; team_name?: string; competition_name?: string } | undefined)
    : undefined;
  return {
    saveId: save.id,
    saveName: save.name,
    worldDate: save.worldDate,
    characterName: person ? displayName(person) : "Manager",
    activeRole: person ? activeCareerRole(db, person.id) : "MANAGER",
    personId: person?.id,
    personAge: person?.dateOfBirth ? ageOn(person.dateOfBirth, save.worldDate) : undefined,
    clubName: ownedClub?.name,
    teamName: ownedClub?.team_name,
    competitionName: ownedClub?.competition_name,
  };
};

const buildUnemployedDashboard = (db: GameDatabase, save: SaveMetadata): ManagerDashboard => {
  const managerProfile = requirePlayerManagerProfile(db, save);
  return {
    employmentStatus: "UNEMPLOYED",
    teamName: "Unemployed",
    competitionName: "Nepal football",
    worldDate: save.worldDate as ManagerDashboard["worldDate"],
    played: 0,
    points: 0,
    form: [],
    recentResults: [],
    jobCentre: buildJobCentreView(db, managerProfile),
    squadAvailability: { total: 0, available: 0, injured: 0, suspended: 0, unavailable: 0 },
    moraleSummary: "No club",
    trainingSummary: "No club",
    scoutingUpdates: 0,
    transferActivity: 0,
    contractIssues: 0,
    staffIssues: 0,
    inbox: new ManagerRepository(db).inboxItems().slice(0, 12),
  };
};

const careerHeader = (db: GameDatabase, save: SaveMetadata): CareerHeader => {
  const context = tryManagerContext(db, save);
  return context ? careerHeaderFromContext(db, save, context) : unemployedCareerHeader(db, save);
};

const careerHeaderFromContext = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): CareerHeader => ({
  saveId: save.id,
  saveName: save.name,
  worldDate: save.worldDate,
  characterName: displayName(context.managerPerson),
  activeRole: activeCareerRole(db, context.managerPerson.id),
  personId: context.managerPerson.id,
  personAge: context.managerPerson.dateOfBirth
    ? ageOn(context.managerPerson.dateOfBirth, save.worldDate)
    : undefined,
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

/**
 * Picks the best available player for each slot using the engine's own
 * `suitability` scoring, so a new career starts with a goalkeeper in goal
 * rather than whoever happened to sort first.
 */
const defaultSetup = (
  teamId: EntityId,
  players: readonly PlayerAttributeSet[],
  managerProfileId?: EntityId,
): TacticalSetup => {
  const formation = FORMATION_PRESETS[0]!;
  const taken = new Set<EntityId>();
  const pickFor = (position: string): PlayerAttributeSet | undefined => {
    const candidate = players
      .filter((player) => !taken.has(player.personId))
      .map((player) => ({
        player,
        score: suitability(player, tacticalPositionToPlayerPosition(position as never)),
      }))
      .sort((a, b) => b.score - a.score)[0]?.player;
    if (candidate) taken.add(candidate.personId);
    return candidate;
  };

  const assignments = formation.slots.map<TacticalAssignment>((slot) => ({
    slotId: slot.id,
    playerId: pickFor(slot.position)?.personId,
    roleId:
      slot.position === "GK"
        ? "GOALKEEPER"
        : slot.zone === "forward"
          ? "PRESSING_FORWARD"
          : slot.zone === "defense"
            ? "BALL_PLAYING_DEFENDER"
            : "CENTRAL_MIDFIELDER",
  }));

  const setup = createTacticalSetup({
    teamId,
    managerProfileId,
    name: "4-3-3",
    formation,
    style: "BALANCED",
    assignments,
    bench: players
      .filter((player) => !taken.has(player.personId))
      .slice(0, 7)
      .map((player) => player.personId),
  });
  const outfield = assignments
    .filter((assignment) => assignment.slotId !== "GK")
    .flatMap((assignment) => (assignment.playerId ? [assignment.playerId] : []));
  return {
    ...setup,
    instructions: TACTICAL_STYLE_PRESETS.BALANCED,
    setPieces: {
      penaltyTaker: outfield.at(-1),
      directFreeKickTaker: outfield.at(-4),
      leftCornerTaker: outfield.at(-2),
      rightCornerTaker: outfield.at(-3),
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

/** Thin wrapper so existing manager actions can be gated by delegation without touching their own logic. */
const requireDomainPermission = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  domain: StaffResponsibilityDomain,
  action: string,
): void => {
  if (!context.club?.id) return;
  try {
    assertResponsibilityPermits(db, save, context.club.id, domain, action);
  } catch (error) {
    if (error instanceof ResponsibilityError) throw appError("INVALID_SELECTION", error.message);
    throw error;
  }
};

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

const continueTitle = (reason: string): string => {
  switch (reason) {
    case "NEXT_FIXTURE":
      return "Next fixture reached";
    case "SCOUT_REPORT":
      return "Scouting report ready";
    case "TRANSFER_RESPONSE":
      return "Transfer negotiation update";
    case "CONTRACT_EXPIRY":
      return "Contract needs attention";
    default:
      return "World advanced";
  }
};

const concernTitle = (type: string): string => {
  switch (type) {
    case "PLAYING_TIME":
      return "Unhappy with playing time";
    case "CONTRACT":
      return "Wants to discuss their contract";
    case "ROLE_STATUS":
      return "Unhappy with their squad status";
    case "TRANSFER_INTEREST":
      return "Attracting transfer interest";
    default:
      return "Squad concern";
  }
};

// ---------------------------------------------------------------------------
// Matchday helpers
// ---------------------------------------------------------------------------

const ownerMatchdayContext = (
  db: GameDatabase,
  save: SaveMetadata,
): { clubId: EntityId; teamId: EntityId } => {
  const personId = careerPersonId(db, save);
  if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER")
    throw appError(
      "ROLE_NOT_AUTHORIZED",
      "Only the active chairman/owner may participate in matchday.",
    );
  const clubId = heldCareerRoles(db, personId).find(
    (role) => role.role === "CHAIRMAN_OWNER",
  )?.targetId;
  if (!clubId) throw appError("ROLE_NOT_AUTHORIZED", "No controlled club is available.");
  // Same resolution as buildOwnerMatchday: the senior men's first team, then
  // any senior team. Bare id order could land on a women's or youth team, so
  // watching a fixture the matchday view listed failed with FIXTURE_MISSING.
  const team = (db
    .prepare(
      "SELECT id FROM teams WHERE club_id=? AND level='senior' AND gender='men' ORDER BY id LIMIT 1",
    )
    .get(clubId) ??
    db
      .prepare("SELECT id FROM teams WHERE club_id=? AND level='senior' ORDER BY id LIMIT 1")
      .get(clubId)) as { id?: EntityId } | undefined;
  if (!team?.id) throw appError("FIXTURE_MISSING", "The controlled club has no senior team.");
  return { clubId, teamId: team.id };
};

const ownerFixture = (db: GameDatabase, teamId: EntityId, fixtureId?: EntityId): FixtureRecord => {
  const row = fixtureId
    ? db
        .prepare("SELECT * FROM fixtures WHERE id=? AND (home_team_id=? OR away_team_id=?)")
        .get(fixtureId, teamId, teamId)
    : db
        .prepare(
          "SELECT * FROM fixtures WHERE status='scheduled' AND (home_team_id=? OR away_team_id=?) ORDER BY scheduled_date, id LIMIT 1",
        )
        .get(teamId, teamId);
  if (!row) throw appError("FIXTURE_MISSING", "No fixture is available for the controlled club.");
  if (row.status === "played")
    throw appError("MATCH_ALREADY_PLAYED", "That fixture has already been played.");
  return {
    id: row.id,
    competitionSeasonId: row.competition_season_id,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    scheduledDate: row.scheduled_date,
    status: row.status,
    round: row.round,
    venueId: row.venue_id,
    tieId: row.tie_id,
    leg: row.leg,
  } as FixtureRecord;
};

const ownerFixtureForSpectator = (
  db: GameDatabase,
  teamId: EntityId,
  fixtureId: EntityId,
): FixtureRecord => {
  const row = db
    .prepare("SELECT * FROM fixtures WHERE id=? AND (home_team_id=? OR away_team_id=?)")
    .get(fixtureId, teamId, teamId) as Record<string, any> | undefined;
  if (!row)
    throw appError("FIXTURE_MISSING", "That fixture is not available for the controlled club.");
  return {
    id: row.id,
    competitionSeasonId: row.competition_season_id,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    scheduledDate: row.scheduled_date,
    status: row.status,
    round: row.round,
    venueId: row.venue_id,
    tieId: row.tie_id,
    leg: row.leg,
  } as FixtureRecord;
};

const ownerCompetitionName = (db: GameDatabase, fixture: FixtureRecord): string => {
  if (!fixture.competitionSeasonId) return "Competition";
  const row = db
    .prepare(
      "SELECT c.name FROM competition_seasons cs JOIN competitions c ON c.id=cs.competition_id WHERE cs.id=?",
    )
    .get(fixture.competitionSeasonId) as { name?: string } | undefined;
  return row?.name ?? "Competition";
};

const ownerMatchInput = (
  db: GameDatabase,
  save: SaveMetadata,
  fixture: FixtureRecord,
  controlledTeamId: EntityId,
): SimulateMatchInput => {
  if (!fixture.competitionSeasonId)
    throw appError("FIXTURE_MISSING", "Fixture has no competition season.");
  const competition = new CompetitionRepository(db);
  const ruleSet = competition.getRuleSet(fixture.competitionSeasonId);
  if (!ruleSet) throw appError("SAVE_CORRUPT", "Competition rules are missing for this fixture.");
  const homePlayers = new PlayerRepository(db).attributesForTeam(fixture.homeTeamId);
  const awayPlayers = new PlayerRepository(db).attributesForTeam(fixture.awayTeamId);
  const homeTactic = resolveTeamTacticalSetup(db, fixture.homeTeamId, homePlayers);
  const awayTactic = resolveTeamTacticalSetup(db, fixture.awayTeamId, awayPlayers);
  return {
    fixture,
    refereeAssignment: requireFixtureOfficials(db, fixture, {
      seed: `${save.randomSeed}:officials:${fixture.id}`,
      competitionLevel: ruleSet.competitionType,
      usesVar: Boolean((ruleSet.specialRules as Record<string, unknown> | undefined)?.usesVAR),
    }),
    homePlayers,
    awayPlayers,
    homeTacticalSetup: homeTactic,
    awayTacticalSetup: awayTactic,
    seed: `${save.randomSeed}:${fixture.id}`,
    substitutionLimit: substitutionLimitFor(ruleSet),
    requiresWinner: Boolean(ruleSet.matchesRequireWinner && (!fixture.tieId || fixture.leg === 2)),
    winnerResolution: ruleSet.winnerResolution,
    allowExtraTime: ruleSet.allowExtraTime,
    allowPenalties: ruleSet.allowPenalties,
    aggregateFirstLeg: firstLegScoreFor(db, fixture),
  };
};

const ownerFinalizationContext = (
  db: GameDatabase,
  save: SaveMetadata,
  fixture: FixtureRecord,
): MatchFinalizationContext => {
  if (!fixture.competitionSeasonId)
    throw appError("FIXTURE_MISSING", "Fixture has no competition season.");
  const competition = new CompetitionRepository(db);
  const ruleSet = competition.getRuleSet(fixture.competitionSeasonId);
  if (!ruleSet) throw appError("SAVE_CORRUPT", "Competition rules are missing for this fixture.");
  return {
    fixture,
    competitionTeamIds: new WorldRepository(db)
      .teamsForCompetitionSeason(fixture.competitionSeasonId)
      .map((team) => team.id),
    ruleSet,
    seed: `${save.randomSeed}:${fixture.id}`,
    save,
  };
};

type MatchCommandHelpers = {
  resolveFixture(fixtureId?: EntityId): FixtureRecord;
  activeFixtureId(): EntityId;
  simulateInput(fixture: FixtureRecord): SimulateMatchInput;
  finalizationContext(fixture: FixtureRecord): MatchFinalizationContext;
  requireSession(fixtureId?: EntityId): { state: LiveMatchState; record: MatchSessionRecord };
  /** Commits the match if it has reached full time. Safe to call repeatedly. */
  finalizeIfComplete(state: LiveMatchState): boolean;
  view(
    state: LiveMatchState,
    viewMode: MatchViewMode,
    since?: number,
    finalized?: boolean,
  ): LiveMatchView;
};

const matchHelpers = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): MatchCommandHelpers => {
  const managerFixture = (fixtureId?: EntityId): FixtureRecord => {
    const fixture = fixtureId
      ? context.fixtures.find((candidate) => candidate.id === fixtureId)
      : context.fixtures.find(
          (candidate) =>
            candidate.status === "scheduled" &&
            (candidate.homeTeamId === context.team.id || candidate.awayTeamId === context.team.id),
        );
    if (!fixture) throw appError("FIXTURE_MISSING", "No such fixture for your team.");
    // Authority: the manager may only control their own team's matches.
    if (fixture.homeTeamId !== context.team.id && fixture.awayTeamId !== context.team.id) {
      throw appError("ROLE_NOT_AUTHORIZED", "That match does not involve your team.");
    }
    if (fixture.status === "played") {
      throw appError("MATCH_ALREADY_PLAYED", "That fixture has already been played.");
    }
    const current = userMatchRequiresAction(context.fixtures, context.team.id, save.worldDate);
    if (!current || fixture.id !== current.id) {
      throw appError("MATCHDAY_REQUIRED", "This fixture is not yet playable.");
    }
    return fixture;
  };

  const buildInput = (fixture: FixtureRecord): SimulateMatchInput => {
    const players = new PlayerRepository(db);
    const homePlayers = players.attributesForTeam(fixture.homeTeamId);
    const awayPlayers = players.attributesForTeam(fixture.awayTeamId);
    const tactic = new ManagerRepository(db).tacticalSetups(context.team.id)[0];
    if (!tactic) throw appError("INVALID_SELECTION", "No saved tactic exists for your team.");
    const managerIsHome = fixture.homeTeamId === context.team.id;
    const opponentTactic = resolveTeamTacticalSetup(
      db,
      managerIsHome ? fixture.awayTeamId : fixture.homeTeamId,
      managerIsHome ? awayPlayers : homePlayers,
    );
    return {
      fixture,
      refereeAssignment: requireFixtureOfficials(db, fixture, {
        seed: `${save.randomSeed}:officials:${fixture.id}`,
        competitionLevel: context.ruleSet.competitionType,
        usesVar: Boolean(
          (context.ruleSet.specialRules as Record<string, unknown> | undefined)?.usesVAR,
        ),
      }),
      homePlayers,
      awayPlayers,
      homeTacticalSetup: managerIsHome ? tactic : opponentTactic,
      awayTacticalSetup: managerIsHome ? opponentTactic : tactic,
      seed: `${save.randomSeed}:${fixture.id}`,
      substitutionLimit: substitutionLimitFor(context.ruleSet),
      requiresWinner: Boolean(
        context.ruleSet.matchesRequireWinner && (!fixture.tieId || fixture.leg === 2),
      ),
      winnerResolution: context.ruleSet.winnerResolution,
      allowExtraTime: context.ruleSet.allowExtraTime,
      allowPenalties: context.ruleSet.allowPenalties,
      aggregateFirstLeg: firstLegScoreFor(db, fixture),
    };
  };

  return {
    resolveFixture: managerFixture,
    activeFixtureId: () => {
      const active = new MatchSessionRepository(db)
        .activeSessions()
        .find((session) => context.fixtures.some((fixture) => fixture.id === session.fixtureId));
      if (!active) throw appError("FIXTURE_MISSING", "No match is currently in progress.");
      return active.fixtureId;
    },
    simulateInput: buildInput,
    finalizationContext: (fixture) => ({
      fixture,
      competitionTeamIds: context.teams.map((team) => team.id),
      ruleSet: context.ruleSet,
      seed: `${save.randomSeed}:${fixture.id}`,
      save,
    }),
    requireSession: (fixtureId) => {
      const fixture = managerFixture(fixtureId ?? undefined);
      const session = loadMatchSession(db, fixture.id);
      if (!session) throw appError("FIXTURE_MISSING", "That match has not been started.");
      return session;
    },
    finalizeIfComplete: (state) => {
      if (state.period !== "FULL_TIME") return false;
      const fixture = managerFixture(state.fixtureId);
      const outcome = finalizeMatch(db, state, {
        fixture,
        competitionTeamIds: context.teams.map((team) => team.id),
        ruleSet: context.ruleSet,
        seed: `${save.randomSeed}:${fixture.id}`,
        save,
      });
      return outcome.status === "FINALIZED" || outcome.status === "ALREADY_FINALIZED";
    },
    view: (state, viewMode, since, finalized) =>
      buildLiveMatchView(db, state, {
        competitionName: context.season.name,
        managedTeamId: context.team.id,
        viewMode,
        since,
        finalized,
      }),
  };
};

const advanceTargetFor = (command: AdvanceMatchCommand): AdvanceTarget => {
  if (command.toHalfTime) return { kind: "HALF_TIME" };
  if (command.toNextEvent) {
    return { kind: "NEXT_EVENT", minImportance: command.minImportance ?? "MAJOR" };
  }
  return { kind: "MINUTES", minutes: Math.max(1, Math.min(120, command.minutes ?? 1)) };
};

/**
 * Competition substitution allowance. The Nepal rule sets do not yet carry a
 * researched figure, so this falls back to the engine's long-standing 3.
 */
const substitutionLimitFor = (ruleSet: CompetitionRuleSet): number =>
  Number((ruleSet.specialRules as Record<string, unknown> | undefined)?.substitutionLimit ?? 3);

/**
 * The completed first leg's score for a two-leg tie, translated into this
 * fixture's home/away frame. Undefined unless a fixture generator has already
 * paired two fixtures via `tieId`.
 */
const firstLegScoreFor = (
  db: GameDatabase,
  fixture: FixtureRecord,
): { homeGoals: number; awayGoals: number } | undefined => {
  if (!fixture.tieId || fixture.leg !== 2) return undefined;
  const row = db
    .prepare(
      `SELECT m.home_goals AS home_goals, m.away_goals AS away_goals, f.home_team_id AS home_team_id
       FROM fixtures f JOIN matches m ON m.fixture_id = f.id
       WHERE f.tie_id = ? AND f.leg = 1 AND f.id != ? LIMIT 1`,
    )
    .get(fixture.tieId, fixture.id) as
    { home_goals: number | null; away_goals: number | null; home_team_id: string } | undefined;
  if (!row) return undefined;
  const homeGoals = row.home_goals ?? 0;
  const awayGoals = row.away_goals ?? 0;
  return row.home_team_id === fixture.homeTeamId
    ? { homeGoals, awayGoals }
    : { homeGoals: awayGoals, awayGoals: homeGoals };
};

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

const DESKTOP_ERROR_CODES = new Set<string>([
  "SAVE_NOT_FOUND",
  "SAVE_CORRUPT",
  "MIGRATION_FAILED",
  "CAREER_CREATION_FAILED",
  "DATABASE_ERROR",
  "SESSION_NOT_OPEN",
  "SIMULATION_ERROR",
  "FIXTURE_MISSING",
  "PLAYER_MISSING",
  "INVALID_SELECTION",
  "WORLD_DATA_UNAVAILABLE",
  "RUNTIME_UNAVAILABLE",
  "ROLE_NOT_AUTHORIZED",
  "MATCH_ALREADY_PLAYED",
  "MATCHDAY_REQUIRED",
  "MATCH_NOT_ACTIVE",
  "MATCH_ALREADY_COMPLETE",
  "INVALID_SUBSTITUTION",
  "SUBSTITUTION_LIMIT_REACHED",
  "PLAYER_NOT_ON_PITCH",
  "PLAYER_NOT_ON_BENCH",
  "INVALID_TACTICAL_CHANGE",
  "MATCH_NOT_AT_HALF_TIME",
]);

/**
 * Only our own structured errors pass through. Driver errors also carry a
 * string `code` (for example ERR_SQLITE_ERROR) and must not reach the UI as if
 * they were part of the contract.
 */
const isAppError = (error: unknown): error is DesktopAppError =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof (error as { code: unknown }).code === "string" &&
  DESKTOP_ERROR_CODES.has((error as { code: string }).code);
