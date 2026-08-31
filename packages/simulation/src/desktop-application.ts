import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  CareerWorldRepository,
  ClubEconomyRepository,
  CompetitionRepository,
  ManagerRepository,
  MatchSessionRepository,
  MedicalRepository,
  PlayerRepository,
  SaveRepository,
  SquadDynamicsRepository,
  StaffMarketRepository,
  WorldRepository,
  createNewSave,
  loadSave,
  migrateDatabase,
  openGameDatabase,
  type GameDatabase,
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
import { advanceProcurementContracts, advanceProcurementOrders, advanceProcurementServices, createProcurementRequest, selectProcurementOffer } from "./clubmart.js";
import { advanceClubLoanRepayments, applyForClubLoan, decideManagerBudgetRequest, initializeClubFinanceMarkets, repayClubLoan, submitManagerBudgetRequest } from "./club-finance-markets.js";
import {
  createEntityId,
  createStableEntityId,
  type AppResult,
  type AutosaveSlotView,
  type AutosaveStatusView,
  type CareerCreationCommand,
  type CareerHeader,
  type CareerRole,
  type CareerRoleState,
  type ChairmanDashboard,
  type FederationPresidentDashboard,
  type E2ERoleFixtureResult,
  type FederationGovernanceProposal,
  type ClubBudget,
  type ClubBudgetCategory,
  type ClubLoanApplication,
  type ClubDebt,
  type ManagerBudgetRequest,
  type ProcurementCategory,
  type ProcurementOrder,
  type InfrastructureProject,
  type InfrastructureProjectType,
  type SponsorshipContract,
  type SimulationClubRecord,
  type Club,
  type CompetitionRuleSet,
  type CompetitionSeason,
  type CalendarEntry,
  type CompetitionView,
  type ConcernResponseAction,
  type ConcernResponseResult,
  type ContractList,
  type ContractRenewalCommand,
  type CreateDevelopmentPlanCommand,
  type DesktopAppError,
  type DesktopApplicationState,
  type DesktopErrorCode,
  type EntityId,
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
  type SquadDynamicsView,
  type SquadMeetingCommand,
  type SquadMeetingResult,
  type SquadGroupMemberView,
  type SquadList,
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
  type StaffDevelopmentPlanView,
  type StaffHierarchyEntryView,
  type StaffHierarchyView,
  type StaffRenewalOfferView,
  type StaffResponsibilityDomain,
  type StaffResponsibilityOwnerType,
  type StaffResponsibilityView,
  type StaffRowWithContract,
  type StaffSuccessionPlanView,
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
import { nextFixtureForTeam, quickSimManagerMatch, userMatchRequiresAction } from "./manager-flow.js";
import { ensureNepalFounderLocations, NEPAL_PROVINCE_DISTRICTS } from "./territorial-football.js";
import { ensureLowerLeaguePlayableWorld } from "./workforce-supply.js";
import { reconcilePlayablePlayerProfilesOnce } from "./player-profile-reconciliation.js";
import { initializeTransferMarketForSave, rebalanceNewNepalSaveSquads } from "./transfer-market.js";
import { appointNationalTeamHeadCoachForPresident, FederationPersonnelError } from "./national-team-management.js";
import {
  ConcernActionError,
  evaluateSquadDynamics,
  holdSquadMeeting,
  MeetingActionError,
  respondToConcern as respondToConcernCommand,
  validActionsForConcern,
} from "./squad-dynamics.js";
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
import { suitability } from "./team-selection.js";
import { activeCareerRole, heldCareerRoles, switchActiveCareerRole } from "./career-control.js";
import { buildChairmanDashboard, buildFederationPresidentDashboard } from "./role-desktop.js";
import { initializeFederationGovernanceForSave } from "./federation-governance.js";
import { assessFederationCandidacy, declareFederationElectionCandidacy, implementFederationGovernanceProposalCommand } from "./federation-politics.js";
import { acceptSponsorOfferCommand, createInfrastructureProjectCommand, initializeClubEconomyForSave, rejectSponsorOfferCommand, setClubBudgetCommand } from "./club-economy.js";
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
  searchManagerRecruitment,
  setManagerTransferStatus,
  toggleManagerShortlist,
} from "./manager-desktop.js";
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

  constructor(options: DesktopRuntimeOptions) {
    this.savesDirectory = options.savesDirectory;
    this.worldDatasetPath = options.worldDatasetPath;
    this.gameVersion = options.gameVersion ?? GAME_VERSION;
    this.autosaveIntervalDays = options.autosaveIntervalDays ?? DEFAULT_AUTOSAVE_INTERVAL_DAYS;
    this.autosaveEnabled = options.autosaveEnabled ?? true;
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
    return ok(NEPAL_PROVINCE_DISTRICTS.flatMap(([province, districts]) => districts.map((district) => ({
      id: createStableEntityId("location", district.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
      province,
      district,
      locality: district,
      provenanceStatus: "REPORTED" as const,
    }))));
  }

  listOwnerManagerCandidates(): AppResult<OwnerManagerCandidate[]> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") throw appError("ROLE_NOT_AUTHORIZED", "Only the active chairman/owner may search for a manager.");
      const club = db.prepare("SELECT c.id FROM club_ownership_stakes s JOIN clubs c ON c.id=s.club_id WHERE s.holder_id=? AND s.holder_type='PERSON' AND s.status='ACTIVE' AND s.percentage>=51 ORDER BY s.percentage DESC LIMIT 1").get(personId) as { id?: EntityId } | undefined;
      if (!club?.id) return [];
      const vacancy = db.prepare("SELECT j.id, c.name AS competition_name FROM manager_job_vacancies j JOIN teams t ON t.id=j.team_id LEFT JOIN club_memberships cm ON cm.team_id=t.id AND cm.status='ACTIVE' LEFT JOIN competition_seasons cs ON cs.id=cm.competition_season_id LEFT JOIN competitions c ON c.id=cs.competition_id WHERE j.club_id=? AND j.status='OPEN' ORDER BY j.opened_on LIMIT 1").get(club.id) as { id?: EntityId; competition_name?: string } | undefined;
      if (!vacancy?.id) return [];
      const division = vacancy.competition_name?.toLowerCase().includes("a-division") ? "A" : vacancy.competition_name?.toLowerCase().includes("b-division") ? "B" : "C";
      const wageExpectation = division === "A" ? 8_000_000 : division === "B" ? 5_000_000 : 2_500_000;
      return new ManagerRepository(db).unemployedManagerProfiles().slice(0, 8).map((profile) => {
        const person = db.prepare("SELECT p.full_name, p.display_name, co.name AS nationality FROM persons p LEFT JOIN countries co ON co.id=p.nationality_country_id WHERE p.id=?").get(profile.personId) as { full_name?: string; display_name?: string; nationality?: string } | undefined;
        const reputation = profile.attributes.personality.reputation;
        return { vacancyId: vacancy.id!, managerProfileId: profile.id, personId: profile.personId, name: person?.display_name ?? person?.full_name ?? profile.personId, nationality: person?.nationality ?? "Unknown", qualification: profile.reputationProfile.replaceAll("_", " "), reputation, wageExpectation, available: true };
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
      : founderMode ? undefined : options[0];
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
        ensureNepalFounderLocations(db);
        ensurePlayableClubVenues(db, `${dataset.meta.targetDatabaseDate}-01`);
        const candidateCountry = db.prepare("SELECT id FROM countries WHERE iso_code IN ('NP','NPL') ORDER BY id LIMIT 1").get() as { id?: EntityId } | undefined;
        if (candidateCountry?.id) ensureOwnerManagerCandidateSupply(db, { date: `${dataset.meta.targetDatabaseDate}-01`, seed: `career:${command.saveName}`, countryId: candidateCountry.id });
        ensureLowerLeaguePlayableWorld({ db, date: `${dataset.meta.targetDatabaseDate}-01`, seed: `career:${command.saveName}` });
        initializeTransferMarketForSave({ db, worldDate: `${dataset.meta.targetDatabaseDate}-01`, seed: `career:${command.saveName}:market` });
        rebalanceNewNepalSaveSquads(db, `${dataset.meta.targetDatabaseDate}-01`);
        const season = target ? seasonForTeam(db, target.teamId) : (() => {
          const row = db!.prepare(`SELECT cs.* FROM competition_seasons cs JOIN competitions c ON c.id=cs.competition_id WHERE lower(c.name) LIKE '%c-division%' ORDER BY cs.start_date LIMIT 1`).get() as Record<string, string> | undefined;
          if (!row) throw appError("SAVE_CORRUPT", "The lowest supported Nepal division is unavailable.");
          return { id: row.id as EntityId, competitionId: row.competition_id as EntityId, name: row.name!, startDate: row.start_date!, endDate: row.end_date! };
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
          const location = db.prepare("SELECT id FROM locations WHERE country_id=(SELECT id FROM countries WHERE iso_code IN ('NP','NPL') ORDER BY id LIMIT 1) AND kind='district' AND lower(name)=lower(?) LIMIT 1").get(founder.locationName ?? founder.clubName) as { id?: EntityId } | undefined;
          if (!location?.id) throw appError("INVALID_SELECTION", "Choose one of Nepal's canonical districts.");
          const founded = foundSimulationClub(db, { name: founder.clubName, locationId: location.id, foundedOn: careerStartDate, seed: `desktop:${command.saveName}:founder`, groundName: founder.groundName ?? `${founder.clubName} Ground`, competitionSeasonId: season.id, founderPersonId: career.person.id, founderName: displayName(career.person), callerRole: "CHAIRMAN_OWNER" });
          const founderTeam = db.prepare("SELECT id FROM teams WHERE club_id=? AND level='senior' ORDER BY id LIMIT 1").get(founded.clubId) as { id?: EntityId } | undefined;
          if (!founderTeam?.id) throw appError("SAVE_CORRUPT", "The founded club has no senior team.");
          team = getTeam(db, founderTeam.id);
          initializeClubEconomyForSave({ db, worldDate: careerStartDate, seed: `career:${command.saveName}:founder-economy` });
          ensureLowerLeaguePlayableWorld({ db, date: careerStartDate, seed: `career:${command.saveName}:founder` });
          initializeTransferMarketForSave({ db, worldDate: careerStartDate, seed: `career:${command.saveName}:founder-market` });
          rebalanceNewNepalSaveSquads(db, careerStartDate);
          db.prepare("DELETE FROM fixtures WHERE competition_season_id=?").run(season.id);
          scheduleSeasonFixtures(db, season, ruleSet);
        }
        if (!team) throw appError("SAVE_CORRUPT", "The career team is missing.");
        if ((command.careerMode ?? "MANAGER") === "MANAGER") managers.insertContract(
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
          if (!team.clubId) throw appError("INVALID_SELECTION", "Owner careers require a club-backed senior team.");
          initializeClubEconomyForSave({ db, worldDate: careerStartDate, seed: `career:${command.saveName}:economy` });
          const club = getClub(db, team.clubId);
          if (!club || ["DEPARTMENTAL", "MUNICIPALITY_BACKED"].includes(club.ownershipType)) {
            throw appError("INVALID_SELECTION", "This club does not permit a controlling owner career start.");
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
        }
        const players = new PlayerRepository(db).attributesForTeam(team.id);
        if ((command.careerMode ?? "MANAGER") === "MANAGER") managers.insertTacticalSetup(defaultSetup(team.id, players, career.managerProfile.id));
        managers.insertInboxItem({
          id: createEntityId(),
          createdOn: careerStartDate,
          type: "FIXTURE_UPCOMING",
          title: founderMode ? `Welcome to ${command.founder!.clubName}` : `Welcome to ${target!.clubName}`,
          body: founderMode ? `You founded ${command.founder!.clubName} in the ${season.name}.` : `You have taken charge of ${target!.teamName} in the ${target!.competitionName}.`,
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
      const heldRoles = heldCareerRoles(db, personId).map((entry) => entry.role);
      return { activeRole: activeCareerRole(db, personId), heldRoles };
    });
  }

  switchActiveCareerRole(targetRole: CareerRole): AppResult<CareerHeader> {
    return this.withSession((db, save, filePath) => {
      const personId = careerPersonId(db, save);
      try {
        switchActiveCareerRole(db, personId, targetRole);
      } catch (error) {
        throw appError("ROLE_NOT_AUTHORIZED", error instanceof Error ? error.message : "Role is not held.");
      }
      const updated = loadSave(db, save.id);
      this.writeCatalogEntry(this.catalogEntry(db, updated, filePath));
      return careerHeader(db, updated);
    });
  }

  getChairmanDashboard(): AppResult<ChairmanDashboard> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "You do not currently hold the Chairman role.");
      }
      return buildChairmanDashboard(db, save);
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

  getFederationCandidacy(): AppResult<import("@nepal-football-sim/shared-types").FederationCandidacyAssessment> {
    return this.withSession((db, save) => assessFederationCandidacy(db, { personId: careerPersonId(db, save), date: save.worldDate }));
  }

  declareFederationElectionCandidacy(): AppResult<import("@nepal-football-sim/shared-types").FederationCandidacyAssessment> {
    return this.withSession((db, save) => {
      try { return declareFederationElectionCandidacy(db, { personId: careerPersonId(db, save), date: save.worldDate, seed: save.randomSeed }); }
      catch (error) { throw appError("ROLE_NOT_AUTHORIZED", error instanceof Error ? error.message : "You are not eligible to stand."); }
    });
  }

  /** Test-only fixture hook; the desktop server gates exposure with an E2E env flag. */
  seedE2ERoleFixture(): AppResult<E2ERoleFixtureResult> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      const manager = db.prepare("SELECT t.club_id FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id WHERE mc.person_id=? AND mc.status='ACTIVE' LIMIT 1").get(personId) as { club_id?: EntityId } | undefined;
      const federation = manager?.club_id ? db.prepare("SELECT f.id FROM federations f JOIN clubs c ON c.country_id=f.country_id WHERE c.id=? ORDER BY f.id LIMIT 1").get(manager.club_id) as { id?: EntityId } | undefined : undefined;
      if (!manager?.club_id || !federation?.id) throw appError("SAVE_CORRUPT", "Role fixture requires a manager club and federation.");
      initializeFederationGovernanceForSave({ db, worldDate: save.worldDate, seed: save.randomSeed });
      const person = db.prepare("SELECT display_name, full_name FROM persons WHERE id=?").get(personId) as { display_name?: string; full_name?: string } | undefined;
      db.prepare("INSERT OR IGNORE INTO club_ownership_stakes (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(createStableEntityId("e2e-role-owner", `${save.id}:${personId}`), manager.club_id, "PERSON", personId, person?.display_name ?? person?.full_name ?? personId, "MAJORITY_OWNER", 75, 75, save.worldDate, "ACTIVE", "PARTIALLY_BUYABLE", "SIMULATION_ONLY");
      db.prepare("INSERT OR IGNORE INTO federation_leadership_tenures (id,person_id,federation_id,role,term_start,term_end,status,provenance_status) VALUES (?,?,?,?,?,?,?,?)").run(createStableEntityId("e2e-role-president", `${save.id}:${personId}`), personId, federation.id, "FEDERATION_PRESIDENT", save.worldDate, "2030-01-01", "ACTIVE", "SIMULATION_ONLY");
      return { ready: true };
    });
  }

  foundClub(name: string, locationName: string): AppResult<SimulationClubRecord> {
    return this.withSession((db, save, filePath) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active chairman/owner may found a club.");
      }
      const location = db.prepare(
        `SELECT l.id FROM locations l JOIN countries co ON co.id = l.country_id
         WHERE co.iso_code IN ('NP', 'NPL') AND l.kind IN ('district', 'municipality', 'city')
           AND lower(trim(l.name)) = lower(trim(?)) ORDER BY l.id LIMIT 1`,
      ).get(locationName) as { id?: EntityId } | undefined;
      if (!location?.id) throw appError("INVALID_SELECTION", "Choose a Nepal district, municipality, or city.");
      const person = db.prepare("SELECT display_name, full_name FROM persons WHERE id = ?").get(personId) as { display_name?: string; full_name?: string } | undefined;
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
        throw appError("INVALID_SELECTION", error instanceof Error ? error.message : "Club could not be founded.");
      }
      this.writeCatalogEntry(this.catalogEntry(db, loadSave(db, save.id), filePath));
      return founded;
    });
  }

  implementFederationGovernanceProposal(proposalId: EntityId): AppResult<FederationGovernanceProposal> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "FEDERATION_PRESIDENT") {
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active federation president may implement proposals.");
      }
      try {
        return implementFederationGovernanceProposalCommand(db, {
          proposalId,
          personId,
          callerRole: "FEDERATION_PRESIDENT",
          date: save.worldDate,
        });
      } catch (error) {
        throw appError("INVALID_SELECTION", error instanceof Error ? error.message : "Proposal could not be implemented.");
      }
    });
  }

  appointNationalTeamHeadCoach(nationalTeamId: EntityId, candidatePersonId: EntityId): AppResult<StaffAppointment> {
    return this.withSession((db, save) => {
      const presidentPersonId = careerPersonId(db, save);
      if (activeCareerRole(db, presidentPersonId) !== "FEDERATION_PRESIDENT") {
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active federation president may appoint national-team staff.");
      }
      const federationId = db.prepare("SELECT federation_id FROM teams WHERE id=?").get(nationalTeamId) as { federation_id?: EntityId } | undefined;
      if (!federationId?.federation_id) throw appError("INVALID_SELECTION", "The national team was not found.");
      try {
        return appointNationalTeamHeadCoachForPresident(db, { federationId: federationId.federation_id, nationalTeamId, presidentPersonId, candidatePersonId, date: save.worldDate });
      } catch (error) {
        if (error instanceof FederationPersonnelError && error.code === "NOT_AUTHORIZED") throw appError("ROLE_NOT_AUTHORIZED", error.message);
        throw appError("INVALID_SELECTION", error instanceof Error ? error.message : "National-team staff could not be appointed.");
      }
    });
  }

  setClubBudget(clubId: EntityId, seasonLabel: string, category: ClubBudgetCategory, amount: number): AppResult<ClubBudget> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active chairman/owner may set club budgets.");
      }
      try {
        return setClubBudgetCommand(db, { clubId, personId, callerRole: "CHAIRMAN_OWNER", seasonLabel, category, amount });
      } catch (error) {
        throw appError("INVALID_SELECTION", error instanceof Error ? error.message : "Club budget could not be set.");
      }
    });
  }

  appointManager(vacancyId: EntityId, managerProfileId: EntityId): AppResult<ManagerContract> {
    return this.withSession((db, save, filePath) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active chairman/owner may appoint a manager.");
      }
      try {
        const contract = appointManagerForChairman(db, { ownerPersonId: personId, vacancyId, managerProfileId, date: save.worldDate });
        this.writeCatalogEntry(this.catalogEntry(db, loadSave(db, save.id), filePath));
        return contract;
      } catch (error) {
        if (error instanceof ChairmanManagerError) throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
    });
  }

  createInfrastructureProject(clubId: EntityId, projectType: InfrastructureProjectType): AppResult<InfrastructureProject> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active chairman/owner may approve infrastructure projects.");
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
        throw appError("INVALID_SELECTION", error instanceof Error ? error.message : "Infrastructure project could not be created.");
      }
    });
  }

  acceptSponsorOffer(clubId: EntityId, sponsorshipId: EntityId): AppResult<SponsorshipContract> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active chairman/owner may approve sponsorships.");
      }
      try {
        return acceptSponsorOfferCommand(db, { clubId, sponsorshipId, personId, callerRole: "CHAIRMAN_OWNER", date: save.worldDate });
      } catch (error) {
        throw appError("INVALID_SELECTION", error instanceof Error ? error.message : "Sponsorship offer could not be accepted.");
      }
    });
  }

  rejectSponsorOffer(clubId: EntityId, sponsorshipId: EntityId): AppResult<SponsorshipContract> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") {
        throw appError("ROLE_NOT_AUTHORIZED", "Only the active chairman/owner may reject sponsorships.");
      }
      try {
        return rejectSponsorOfferCommand(db, { clubId, sponsorshipId, personId, callerRole: "CHAIRMAN_OWNER" });
      } catch (error) {
        throw appError("INVALID_SELECTION", error instanceof Error ? error.message : "Sponsorship offer could not be rejected.");
      }
    });
  }

  applyClubLoan(lenderId: EntityId, principal: number, termMonths: number, purpose: string): AppResult<ClubLoanApplication> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") throw appError("ROLE_NOT_AUTHORIZED", "Only the active chairman/owner may apply for club loans.");
      const clubId = heldCareerRoles(db, personId).find((role) => role.role === "CHAIRMAN_OWNER")?.targetId;
      if (!clubId) throw appError("ROLE_NOT_AUTHORIZED", "No controlled club is available.");
      try { return applyForClubLoan(db, { clubId, lenderId, principal, termMonths, purpose, date: save.worldDate }); }
      catch (error) { throw appError("INVALID_SELECTION", error instanceof Error ? error.message : "Loan application failed."); }
    });
  }

  repayClubLoan(debtId: EntityId, amount?: number): AppResult<ClubDebt> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") throw appError("ROLE_NOT_AUTHORIZED", "Only the active chairman/owner may repay club loans.");
      try { return repayClubLoan(db, { debtId, amount, date: save.worldDate }); }
      catch (error) { throw appError("INVALID_SELECTION", error instanceof Error ? error.message : "Loan repayment failed."); }
    });
  }

  requestManagerBudget(seasonLabel: string, category: ClubBudgetCategory, requestedAmount: number): AppResult<ManagerBudgetRequest> {
    return this.withSession((db, save) => {
      const context = managerContext(db, save);
      if (!context.club) throw appError("ROLE_NOT_AUTHORIZED", "The active manager has no club budget.");
      try { return submitManagerBudgetRequest(db, { clubId: context.club.id, managerPersonId: context.managerPerson.id, seasonLabel, category, requestedAmount, date: save.worldDate }); }
      catch (error) { throw appError("INVALID_SELECTION", error instanceof Error ? error.message : "Budget request failed."); }
    });
  }

  decideManagerBudgetRequest(requestId: EntityId, approve: boolean): AppResult<ManagerBudgetRequest> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") throw appError("ROLE_NOT_AUTHORIZED", "Only the active chairman/owner may decide manager budget requests.");
      try {
        const economy = new ClubEconomyRepository(db);
        const request = economy.budgetRequests().find((item) => item.id === requestId);
        const controlled = request && heldCareerRoles(db, personId).some((role) => role.role === "CHAIRMAN_OWNER" && role.targetId === request.clubId);
        if (!controlled) throw new Error("Budget request is outside the controlled club");
        return decideManagerBudgetRequest(db, { requestId, date: save.worldDate, approve });
      } catch (error) { throw appError("INVALID_SELECTION", error instanceof Error ? error.message : "Budget request decision failed."); }
    });
  }

  purchaseEquipment(category: ProcurementCategory, quantity: number): AppResult<ProcurementOrder> {
    return this.withSession((db, save) => {
      const personId = careerPersonId(db, save);
      if (activeCareerRole(db, personId) !== "CHAIRMAN_OWNER") throw appError("ROLE_NOT_AUTHORIZED", "Only the active chairman/owner may purchase equipment.");
      const clubId = heldCareerRoles(db, personId).find((role) => role.role === "CHAIRMAN_OWNER")?.targetId;
      if (!clubId) throw appError("ROLE_NOT_AUTHORIZED", "No controlled club is available.");
      try {
        const request = createProcurementRequest(db, { clubId, category, quantity, date: save.worldDate, seed: `${save.randomSeed}:owner-equipment` });
        const offer = request.offers.sort((a, b) => a.unitPrice - b.unitPrice)[0];
        if (!offer) throw new Error("No equipment supplier offer is available");
        return selectProcurementOffer(db, { offerId: offer.id, date: save.worldDate, chairmanApproved: true });
      } catch (error) { throw appError("INVALID_SELECTION", error instanceof Error ? error.message : "Equipment purchase failed."); }
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
      const context = tryManagerContext(db, save);
      let updated: SaveMetadata;
      let stopReason: string | undefined;

      if (!context) {
        const personId = careerPersonId(db, save);
        const ownerRole = activeCareerRole(db, personId) === "CHAIRMAN_OWNER"
          ? heldCareerRoles(db, personId).find((role) => role.role === "CHAIRMAN_OWNER")
          : undefined;
        if (ownerRole?.targetId) {
          const outcome = advanceOwnerCareer(db, save, ownerRole.targetId);
          updated = { ...save, worldDate: outcome.worldDate, lastSavedAt: new Date().toISOString() };
          new SaveRepository(db).upsert(updated);
          new ManagerRepository(db).insertInboxItem({ id: createEntityId(), createdOn: updated.worldDate, type: "COMPETITION_UPDATE", title: "Club operations advanced", body: outcome.message, read: false });
        } else {
        // No club to advance fixtures for — let the wider world (AI managers,
        // board confidence, vacancies) move on until something new appears.
        const outcome = advanceUnemployedCareer(db, save);
        updated = { ...save, worldDate: outcome.worldDate, lastSavedAt: new Date().toISOString() };
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
        const currentMatch = userMatchRequiresAction(context.fixtures, context.team.id, save.worldDate);
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
            type: outcome.stopReason === "NEXT_FIXTURE" ? "FIXTURE_UPCOMING" : "COMPETITION_UPDATE",
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
        evaluateAllStaffContracts(db, updated);
        if (context.club?.id) evaluateStaffPerformance(db, updated, context.club.id);
        evaluateLicenceCourses(db, updated);
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
                medicalRepo.activeRehabilitationPlan(attributes.personId)?.stage === "MATCH_READY",
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
          const kept = promise.status === "KEPT";
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
        throw appError("ROLE_NOT_AUTHORIZED", "The active career role cannot use manager commands.");
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

  getSquad(): AppResult<SquadList> {
    return this.managerCommand(buildSquadList);
  }

  getSquadConcerns(): AppResult<SquadDynamicsView> {
    return this.managerCommand((db, save, context) => buildSquadDynamicsView(db, context.team.id));
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

  getPlayerProfile(playerId: EntityId): AppResult<PlayerProfile> {
    return this.managerCommand((db, save, context) =>
      buildPlayerProfile(db, save, context, playerId),
    );
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

  setTransferStatus(command: TransferListCommand): AppResult<TransferCentre> {
    return this.managerCommand(
      (db, save, context) => setManagerTransferStatus(db, save, context, command),
      true,
    );
  }

  getContracts(): AppResult<ContractList> {
    return this.managerCommand(buildContractList);
  }

  renewContract(command: ContractRenewalCommand): AppResult<ContractList> {
    return this.managerCommand((db, save, context) => {
      requireDomainPermission(db, save, context, "CONTRACTS", "renewContract");
      return renewManagerContract(db, save, context, command);
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
  ): AppResult<StaffMarketView> {
    return this.managerCommand((db, save, context) => {
      try {
        applyForStaffVacancy(db, save, vacancyId, personId, salaryAmountMinor, contractMonths);
      } catch (error) {
        if (error instanceof StaffNegotiationError)
          throw appError("INVALID_SELECTION", error.message);
        throw error;
      }
      return buildStaffMarketView(db, save, context);
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
            organisation: activeCareerRole(db, person.id) === "CHAIRMAN_OWNER"
              ? (db.prepare("SELECT c.name FROM club_ownership_stakes s JOIN clubs c ON c.id=s.club_id WHERE s.holder_id=? AND s.holder_type='PERSON' AND s.status='ACTIVE' AND s.percentage>=51 ORDER BY s.percentage DESC LIMIT 1").get(person.id) as { name?: string } | undefined)?.name ?? "Owner / Founder"
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
  const membershipByTeam = new Map<string, { competitionKey: string; name: string }>();
  for (const membership of dataset.clubMemberships ?? []) {
    if (membership.status !== "ACTIVE" || !membership.teamKey?.value) continue;
    const teamKey = membership.teamKey?.value;
    const competition = dataset.competitions.find((item) => item.key === membership.competitionKey);
    if (!competition || competition.category !== "PYRAMID_LEAGUE") continue;
    const current = membershipByTeam.get(teamKey);
    if (!current || /[ABC]-DIVISION/i.test(competition.name)) membershipByTeam.set(teamKey, { competitionKey: membership.competitionKey, name: competition.name });
  }

  return dataset.teams
    .filter((team) => team.level === "senior" && team.gender === "men" && membershipByTeam.has(team.key))
    .map((team) => {
      const clubKey = team.clubKey?.value;
      const membership = membershipByTeam.get(team.key)!;
      const club = clubKey ? dataset.clubs.find((item) => item.key === clubKey) : undefined;
      const locationName = club?.locationKey.value ? dataset.locations.find((item) => item.key === club.locationKey.value)?.name : undefined;
      return {
        teamId: createStableEntityId("team", team.key),
        clubId: clubKey ? createStableEntityId("club", clubKey) : undefined,
        clubName: (clubKey ? clubNames.get(clubKey) : undefined) ?? team.name,
        teamName: team.name,
        competitionName: membership.name ?? competitionNames.get(membership.competitionKey) ?? "Nepal football",
        squadSize: squadSizes.get(team.key) ?? 0,
        division: membership.name.match(/([ABC])-DIVISION/i)?.[1] ?? "Other playable Nepal competition",
        locationName,
        professionalStatus: club?.ownershipType.value === "DEPARTMENTAL" ? "Departmental" : "Club",
      };
    })
    .sort((a, b) => {
      const rank = (division: string): number => ({ A: 0, B: 1, C: 2 }[division] ?? 3);
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

const advanceOwnerCareer = (db: GameDatabase, save: SaveMetadata, clubId: EntityId, maxDays = 5): { worldDate: string; message: string } => {
  let date = save.worldDate;
  let previousMonth = date.slice(0, 7);
  for (let day = 0; day < maxDays; day += 1) {
    const next = addWorldDays(date, 1);
    const tick = { ...save, worldDate: next };
    ensureAiManagersAssigned(db, tick, undefined);
    evaluateBoardConfidence(db, tick);
    advanceInfrastructureProjects(db, { date: next, seed: `${save.randomSeed}:owner:${clubId}` });
    advanceProcurementContracts(db, next);
    advanceProcurementServices(db, { date: next });
    advanceProcurementOrders(db, { date: next, seed: `${save.randomSeed}:owner:${clubId}` });
    advanceClubLoanRepayments(db, next);
    if (next.slice(0, 7) !== previousMonth) {
      advanceMacroEconomyForWorldDate(db, { date: next, seed: `${save.randomSeed}:economy:${next.slice(0, 7)}` });
      processClubEconomyMonth(db, { date: next, seed: `${save.randomSeed}:economy:${next.slice(0, 7)}` });
      previousMonth = next.slice(0, 7);
    }
    date = next;
  }
  const account = db.prepare("SELECT cash_balance FROM club_financial_accounts WHERE club_id = ?").get(clubId) as { cash_balance?: number } | undefined;
  return { worldDate: date, message: `Club operations advanced to ${date}. Cash balance: NPR ${Math.round(account?.cash_balance ?? 0).toLocaleString("en-IN")}. Budget, sponsorship, procurement, and infrastructure systems are now progressing with the world.` };
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

const toPromiseView = (promise: ManagerPromise): SquadPromiseView => ({
  id: promise.id,
  type: promise.type,
  description: promise.description,
  madeOn: promise.madeOn,
  dueOn: promise.dueOn,
  status: promise.status,
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

  return { hierarchy, responsibilities, developmentPlans, successionPlans };
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
      .map((promise) => [promise.concernId, toPromiseView(promise)]),
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
  const cohesion: TeamCohesionView = {
    score: cohesionRecord?.score ?? 70,
    level: cohesionRecord?.level ?? "STABLE",
    captainName: captainEntry ? displayName(getPerson(db, captainEntry.personId)) : undefined,
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
    promises: activePromises.map(toPromiseView),
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
    ? db.prepare("SELECT c.name, t.name AS team_name, cs.name AS competition_name FROM club_ownership_stakes s JOIN clubs c ON c.id=s.club_id LEFT JOIN teams t ON t.club_id=c.id AND t.level='senior' LEFT JOIN club_memberships cm ON cm.team_id=t.id AND cm.status='ACTIVE' LEFT JOIN competition_seasons cs ON cs.id=cm.competition_season_id WHERE s.holder_id=? AND s.holder_type='PERSON' AND s.status='ACTIVE' AND s.percentage>=51 ORDER BY s.percentage DESC LIMIT 1").get(person.id) as { name?: string; team_name?: string; competition_name?: string } | undefined
    : undefined;
  return {
    saveId: save.id,
    saveName: save.name,
    worldDate: save.worldDate,
    characterName: person ? displayName(person) : "Manager",
    activeRole: person ? activeCareerRole(db, person.id) : "MANAGER",
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

const careerHeaderFromContext = (db: GameDatabase, save: SaveMetadata, context: ManagerContext): CareerHeader => ({
  saveId: save.id,
  saveName: save.name,
  worldDate: save.worldDate,
  characterName: displayName(context.managerPerson),
  activeRole: activeCareerRole(db, context.managerPerson.id),
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
    const opponentTactic = defaultSetup(
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
