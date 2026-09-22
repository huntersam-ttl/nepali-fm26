import { useCallback, useEffect, useReducer } from "react";
import type { CareerRole } from "@nepal-football-sim/shared-types";
import type { EntityId, EntityReferenceType } from "@nepal-football-sim/shared-types";
import type { ChairmanScreen, PresidentScreen } from "./manager/RoleDetailScreen.js";

/**
 * Application navigation model (UI Phase 1A — Navigation Foundation).
 *
 * Distinguishes a WORKSPACE destination (a named surface inside the career
 * shell, role-qualified so a shared id like "dashboard" is unambiguous across
 * Manager / Chairman-Owner / Federation-President) from a future ENTITY
 * destination (a canonical club/person/fixture/etc. — modelled now so the
 * history layer can carry them in Phase 1B, but not rendered by the shell
 * yet).
 *
 * History is pure UI navigation state: it never touches a career save. The
 * reducer is a plain, side-effect-free function so it can be unit-tested in
 * isolation, and a thin hook (useAppNavigation) drives it from React.
 */

/** The manager's own workspace set — deliberately managed here so the shell
 * and the navigation model share one source of truth for workspace ids. */
export const MANAGER_WORKSPACES = [
  "home",
  "squad",
  "squad-overview",
  "training",
  "loans",
  "club-overview",
  "club-profile",
  "club-finances",
  "club-board",
  "club-responsibilities",
  "dressing-room",
  "tactics",
  "training",
  "fixtures",
  "competition",
  "scouting",
  "recruitment-overview",
  "player-database",
  "recommendations",
  "recruitment-focuses",
  "shortlists",
  "squad-planner",
  "transfers",
  "contracts",
  "staff",
  "medical",
  "media",
  "messages",
  "news",
  "calendar",
] as const;
export type ManagerWorkspace = (typeof MANAGER_WORKSPACES)[number];

/** Owner / President workspace ids reuse the canonical unions already defined
 * by RoleDetailScreen — no duplicated definition. */
export type OwnerWorkspace = ChairmanScreen;
export type PresidentWorkspace = PresidentScreen;

export const EXECUTIVE_WORKSPACE = "dashboard";
export type ExecutiveRole = Extract<
  CareerRole,
  "CEO" | "GENERAL_SECRETARY" | "SPORTING_DIRECTOR" | "DIRECTOR_OF_FOOTBALL"
>;

/** A role-qualified workspace: the role is part of the destination so a
 * workspace id alone can never be ambiguous across the three experiences. */
export type WorkspaceDestination =
  | { readonly kind: "workspace"; readonly role: "MANAGER"; readonly workspace: ManagerWorkspace }
  | { readonly kind: "workspace"; readonly role: "CHAIRMAN_OWNER"; readonly workspace: OwnerWorkspace }
  | {
      readonly kind: "workspace";
      readonly role: "FEDERATION_PRESIDENT";
      readonly workspace: PresidentWorkspace;
    }
  | { readonly kind: "workspace"; readonly role: ExecutiveRole; readonly workspace: typeof EXECUTIVE_WORKSPACE };

/** A canonical entity destination (Phase 1B): typed so the history layer can
 * carry it, and equality can compare it, without the shell rendering it yet. */
export type EntityDestination = {
  readonly kind: "entity";
  readonly entityType: EntityReferenceType;
  readonly entityId: EntityId;
};

export type AppDestination = WorkspaceDestination | EntityDestination;

/** Entity kinds that have a real canonical destination surface in Phase 1B.
 * Anything else (e.g. FIXTURE, NATIONAL_TEAM, FEDERATION_PROJECT) intentionally
 * maps to nothing — callers fall back to their existing non-destination
 * behaviour instead of fabricating a blank profile page. */
export const CANONICAL_ENTITY_TYPES = new Set<EntityReferenceType>([
  "PLAYER",
  "CLUB",
  "STAFF",
  "COMPETITION",
  "INFRASTRUCTURE_PROJECT",
  "SPONSOR",
  "LENDER",
  "INVESTOR",
  "JOURNALIST",
  "MEDIA_OUTLET",
]);

export const entityDestination = (entityType: EntityReferenceType, entityId: EntityId): EntityDestination => ({
  kind: "entity",
  entityType,
  entityId,
});

/** Whether an entity kind can be opened as a canonical Phase 1B destination. */
export const isCanonicalEntityType = (entityType: EntityReferenceType): boolean =>
  CANONICAL_ENTITY_TYPES.has(entityType);

/** The single central translation from a clickable world reference into the
 * navigation model. Returns undefined for references that must stay local
 * (hidden, or a kind with no destination yet) rather than fabricating one. */
export const referenceToDestination = (reference: {
  entityType: EntityReferenceType;
  id: EntityId;
  visible: boolean;
}): EntityDestination | undefined => {
  if (!reference.visible) return undefined;
  if (!isCanonicalEntityType(reference.entityType)) return undefined;
  return entityDestination(reference.entityType, reference.id);
};

/** Human title for an entity destination page header. */
export const entityTypeTitle = (entityType: EntityReferenceType): string => {
  switch (entityType) {
    case "PLAYER":
      return "Player";
    case "CLUB":
      return "Club";
    case "STAFF":
      return "Staff";
    case "COMPETITION":
      return "Competition";
    case "INFRASTRUCTURE_PROJECT":
      return "Project";
    case "SPONSOR":
      return "Sponsor";
    case "LENDER":
      return "Lender";
    case "INVESTOR":
      return "Investor";
    case "JOURNALIST":
      return "Journalist";
    case "MEDIA_OUTLET":
      return "Media outlet";
    default:
      return "Entity";
  }
};

/** The workspace a role lands on when a career (or that role) opens. */
export const defaultDestination = (role: CareerRole): WorkspaceDestination => {
  switch (role) {
    case "MANAGER":
      return { kind: "workspace", role, workspace: "home" };
    default:
      return { kind: "workspace", role, workspace: "dashboard" };
  }
};

/** Whether a destination may be rendered by the given role. Entity
 * destinations are role-agnostic (their future resolvers decide reachability
 * independently), so they are always considered valid here. */
export const isValidDestinationForRole = (destination: AppDestination, role: CareerRole): boolean =>
  destination.kind === "entity" || destination.role === role;

/** Value equality for destinations — used to avoid duplicate history entries
 * and to test that entity-shaped destinations compare correctly. */
export const destinationsEqual = (a: AppDestination, b: AppDestination): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "entity" && b.kind === "entity") {
    return a.entityType === b.entityType && a.entityId === b.entityId;
  }
  if (a.kind === "workspace" && b.kind === "workspace") {
    return a.role === b.role && a.workspace === b.workspace;
  }
  return false;
};

export type NavigationState = { readonly history: AppDestination[]; readonly index: number };

export const initialNavigationState = (role: CareerRole): NavigationState => ({
  history: [defaultDestination(role)],
  index: 0,
});

export type NavigationAction =
  | { readonly type: "navigate"; readonly destination: AppDestination }
  | { readonly type: "back" }
  | { readonly type: "forward" }
  | { readonly type: "setRole"; readonly role: CareerRole };

export const navigationReducer = (state: NavigationState, action: NavigationAction): NavigationState => {
  switch (action.type) {
    case "setRole":
      // Role switch: collapse to a single, valid landing destination for the
      // new role so history never starts on an invalid/previous-role surface.
      return initialNavigationState(action.role);
    case "navigate": {
      const current = state.history[state.index];
      if (current && destinationsEqual(current, action.destination)) return state;
      // Truncate the forward stack (navigating clears Forward), then append.
      const history = [...state.history.slice(0, state.index + 1), action.destination];
      return { history, index: history.length - 1 };
    }
    case "back":
      if (state.index <= 0) return state;
      return { ...state, index: state.index - 1 };
    case "forward":
      if (state.index >= state.history.length - 1) return state;
      return { ...state, index: state.index + 1 };
    default:
      return state;
  }
};

export type AppNavigation = {
  readonly destination: AppDestination;
  /** The full destination history (UI state only) — breadcrumbs read this to
   * derive a bounded context trail, never to replay every click. */
  readonly history: readonly AppDestination[];
  navigate: (destination: AppDestination) => void;
  back: () => void;
  forward: () => void;
  readonly canBack: boolean;
  readonly canForward: boolean;
  reset: (role: CareerRole) => void;
};

/**
 * The shell's navigation hook. It owns the destination + history stack, resets
 * to the role's default workspace when the role changes, and is deliberately
 * decoupled from any given screen so both the sidebar and future global
 * navigation can drive one shared history.
 */
export const useAppNavigation = (role: CareerRole): AppNavigation => {
  const [state, dispatch] = useReducer(navigationReducer, undefined, () => initialNavigationState(role));

  useEffect(() => {
    dispatch({ type: "setRole", role });
  }, [role]);

  const navigate = useCallback((destination: AppDestination): void => {
    dispatch({ type: "navigate", destination });
  }, []);
  const back = useCallback((): void => dispatch({ type: "back" }), []);
  const forward = useCallback((): void => dispatch({ type: "forward" }), []);
  const reset = useCallback((nextRole: CareerRole): void => dispatch({ type: "setRole", role: nextRole }), []);

  return {
    destination: state.history[state.index],
    history: state.history,
    navigate,
    back,
    forward,
    canBack: state.index > 0,
    canForward: state.index < state.history.length - 1,
    reset,
  };
};