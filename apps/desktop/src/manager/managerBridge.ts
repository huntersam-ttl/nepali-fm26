import type {
  AppResult,
  CalendarEntry,
  ContractList,
  ContractRenewalCommand,
  EntityId,
  FixtureDetail,
  FixtureList,
  ManagerCompetitionView,
  ManagerDashboard,
  PlayerProfile,
  QuickSimSummary,
  RecruitmentSearchCommand,
  RecruitmentSearchPage,
  ScoutingAssignmentCommand,
  ScoutingDashboard,
  ScoutingReportView,
  SquadList,
  StaffList,
  TacticsUpdateCommand,
  TacticsView,
  TrainingUpdateCommand,
  TrainingView,
  TransferCentre,
  TransferListCommand,
  TransferOfferCommand,
  TransferResponseCommand,
} from "@nepal-football-sim/shared-types";
import { runtimeCall } from "../appBridge.js";

/**
 * Manager-mode command client. Adds nothing but transport typing: every rule,
 * calculation, and validation lives in the runtime service.
 */
export const managerBridge = {
  getManagerDashboard: () => runtimeCall<ManagerDashboard>("getManagerDashboard"),
  getSquad: () => runtimeCall<SquadList>("getSquad"),
  getPlayerProfile: (playerId: EntityId) =>
    runtimeCall<PlayerProfile>("getPlayerProfile", { playerId }),
  getTactics: () => runtimeCall<TacticsView>("getTactics"),
  updateTactics: (command: TacticsUpdateCommand) =>
    runtimeCall<TacticsView>("updateTactics", { command }),
  getTraining: () => runtimeCall<TrainingView>("getTraining"),
  updateTraining: (command: TrainingUpdateCommand) =>
    runtimeCall<TrainingView>("updateTraining", { command }),
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
  setTransferStatus: (command: TransferListCommand) =>
    runtimeCall<TransferCentre>("setTransferStatus", { command }),
  getContracts: () => runtimeCall<ContractList>("getContracts"),
  renewContract: (command: ContractRenewalCommand) =>
    runtimeCall<ContractList>("renewContract", { command }),
  getStaff: (clubId?: EntityId) => runtimeCall<StaffList>("getStaff", { clubId }),
  getMatchSummary: (fixtureId: EntityId) =>
    runtimeCall<QuickSimSummary | undefined>("getMatchSummary", { fixtureId }),
};

export type ManagerBridge = typeof managerBridge;
export type { AppResult };
