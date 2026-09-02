import type { EntityId } from "./ids.js";
import type { ClubBudget, InfrastructureProject, ISODate } from "./domain.js";
import type { UniversalInteraction } from "./universal-interactions.js";
import type { EntityReference } from "./entity-reference.js";

export type OwnerPlayerRequestIntent =
  | "CONSIDER_TRANSFER_LIST"
  | "CONSIDER_LOAN_LIST"
  | "CONSIDER_RENEWAL"
  | "REVIEW_SQUAD_ROLE"
  | "STRENGTHEN_POSITION"
  | "CONSIDER_RELEASE";

export type OwnerPlayerRequestContext = {
  playerId: EntityId;
  player: EntityReference;
  clubId: EntityId;
  requestIntent: OwnerPlayerRequestIntent;
  requestedBy: EntityId;
  requestedByReference?: EntityReference;
  managerPersonId: EntityId;
  requestedOn: ISODate;
  deadline?: ISODate;
  contractEndDate?: ISODate;
  transferStatus?: string;
  meeting: UniversalInteraction;
  linkedPromiseId?: EntityId;
};

export type ManagerOwnerPlayerRequest = {
  requestId: EntityId;
  player: EntityReference;
  clubId: EntityId;
  requestIntent: OwnerPlayerRequestIntent;
  requestedBy: EntityId;
  requestedByReference: EntityReference;
  requestedOn: ISODate;
  deadline?: ISODate;
  stage: UniversalInteraction["stage"];
  response?: string;
  linkedPromiseId?: EntityId;
  fulfillmentState: "OPEN" | "FULFILLED" | "DECLINED" | "DEFERRED" | "STALE" | "EXPIRED";
  staleReason?: string;
  fulfillmentSource?: EntityId;
  sourceMeetingId: EntityId;
};

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
