import type { EntityId } from "./ids.js";
import type { ClubBudget, InfrastructureProject, ISODate } from "./domain.js";
import type { UniversalInteraction } from "./universal-interactions.js";

/**
 * The exact topic/stance/commitment vocabulary owner-manager-meetings.ts and
 * universal-interaction-adapters.ts already accept — declared once here so
 * the desktop UI can never drift from what the backend actually supports.
 */
export type OwnerManagerMeetingTopic =
  | "FORM"
  | "TRANSFER_BUDGET"
  | "SQUAD_STRENGTHENING"
  | "YOUTH_USAGE"
  | "PLAYING_PHILOSOPHY"
  | "STAFF_BUDGET"
  | "FACILITIES"
  | "OBJECTIVES"
  | "CONTRACT_SECURITY";

export type OwnerManagerMeetingStance = "SUPPORT" | "REQUEST" | "CONCERN";

export type OwnerManagerCommitmentType =
  | "PROMOTION_CHALLENGE"
  | "YOUTH_USAGE"
  | "FINANCIAL_DISCIPLINE"
  | "SQUAD_STRENGTHENING"
  | "FACILITY_PROJECT"
  | "TACTICAL_STYLE";

export type OwnerManagerBoardPressure = "LOW" | "MEDIUM" | "HIGH";

/**
 * Read model behind the owner-manager meeting UI. Every field is either a
 * real, already-computed value (board confidence, club vision, league
 * standing, budgets, infrastructure) or explicitly optional/undefined when
 * the underlying system has nothing to report yet — never a fabricated
 * placeholder for a manager relationship or club vision that doesn't exist.
 */
export type OwnerManagerMeetingOverview = {
  clubId: EntityId;
  clubName: string;
  managerPersonId: EntityId;
  managerProfileId: EntityId;
  managerName: string;
  boardConfidence: number;
  boardExpectation?: string;
  pressure?: OwnerManagerBoardPressure;
  relationshipTrust?: number;
  relationshipTension?: number;
  activePromises?: number;
  brokenPromises?: number;
  vision?: {
    objective: string;
    identity?: string;
    transferPhilosophy?: string;
    financialHealth?: string;
    youthPriority?: number;
  };
  leaguePosition?: number;
  played?: number;
  points?: number;
  recentForm: Array<"W" | "D" | "L">;
  budgets: ClubBudget[];
  infrastructure: InfrastructureProject[];
  openMeeting?: UniversalInteraction;
  history: UniversalInteraction[];
};

export type OwnerManagerCommitmentInput = {
  type: OwnerManagerCommitmentType;
  targetCriteria: string;
  description: string;
  dueOn: ISODate;
  importance?: number;
};
