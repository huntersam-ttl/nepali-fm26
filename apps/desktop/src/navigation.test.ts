// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  defaultDestination,
  destinationsEqual,
  entityDestination,
  initialNavigationState,
  isValidDestinationForRole,
  navigationReducer,
  referenceToDestination,
  useAppNavigation,
  type AppDestination,
  type NavigationState,
} from "./navigation.js";
import type { CareerRole, EntityId, EntityReferenceType } from "@nepal-football-sim/shared-types";

const ws = (role: CareerRole, workspace: string): AppDestination =>
  ({ kind: "workspace", role, workspace }) as AppDestination;
const home = (): AppDestination => ws("MANAGER", "home");
const squad = (): AppDestination => ws("MANAGER", "squad");
const tactics = (): AppDestination => ws("MANAGER", "tactics");
const medical = (): AppDestination => ws("MANAGER", "medical");
const player = (id: string): AppDestination => ({ kind: "entity", entityType: "PLAYER", entityId: id as EntityId });

const nav = (state: NavigationState, destination: AppDestination): NavigationState =>
  navigationReducer(state, { type: "navigate", destination });

/** Workspace ids in history order — a narrowing helper so assertions don't
 * reach `role`/`workspace` across the (future) entity variant. */
const workspaceIds = (state: NavigationState): Array<string | undefined> =>
  state.history.map((d) => (d.kind === "workspace" ? d.workspace : undefined));

describe("application navigation model", () => {
  it("1. initial destination is the role's default workspace", () => {
    const manager = initialNavigationState("MANAGER");
    expect(manager.history).toEqual([home()]);
    expect(manager.index).toBe(0);

    const owner = initialNavigationState("CHAIRMAN_OWNER");
    expect(owner.history[0]).toEqual(ws("CHAIRMAN_OWNER", "dashboard"));
  });

  it("2. navigate appends a destination and moves current forward", () => {
    let state = initialNavigationState("MANAGER");
    state = nav(state, squad());
    state = nav(state, tactics());
    expect(workspaceIds(state)).toEqual(["home", "squad", "tactics"]);
    expect(state.index).toBe(2);
    expect(state.history[state.index]).toEqual(tactics());
  });

  it("3. back moves to the previous destination", () => {
    let state = nav(nav(initialNavigationState("MANAGER"), squad()), tactics());
    state = navigationReducer(state, { type: "back" });
    expect(state.index).toBe(1);
    expect(state.history[state.index]).toEqual(squad());
  });

  it("4. forward moves back to a re-visited destination", () => {
    let state = nav(nav(initialNavigationState("MANAGER"), squad()), tactics());
    state = navigationReducer(state, { type: "back" });
    state = navigationReducer(state, { type: "forward" });
    expect(state.index).toBe(2);
    expect(state.history[state.index]).toEqual(tactics());
  });

  it("5. navigating after Back clears the forward history", () => {
    let state = nav(nav(initialNavigationState("MANAGER"), squad()), tactics());
    state = navigationReducer(state, { type: "back" }); // on squad, index 1
    state = nav(state, medical()); // truncate forward stack
    expect(workspaceIds(state)).toEqual(["home", "squad", "medical"]);
    expect(state.index).toBe(2); // no forward left: index at last entry
  });

  it("6. an identical destination does not duplicate history", () => {
    let state = initialNavigationState("MANAGER");
    state = nav(state, home());
    state = nav(state, home());
    expect(state.history).toEqual([home()]);
    expect(state.index).toBe(0);
  });

  it("7. role destinations validate and fall back to a valid default", () => {
    expect(defaultDestination("MANAGER").workspace).toBe("home");
    expect(defaultDestination("CHAIRMAN_OWNER").workspace).toBe("dashboard");
    expect(defaultDestination("FEDERATION_PRESIDENT").workspace).toBe("dashboard");

    const president = ws("FEDERATION_PRESIDENT", "dashboard");
    expect(isValidDestinationForRole(president, "CHAIRMAN_OWNER")).toBe(false);
    expect(isValidDestinationForRole(home(), "MANAGER")).toBe(true);

    // The shell must never land on an invalid destination: fall back to default.
    const fallback = isValidDestinationForRole(president, "CHAIRMAN_OWNER")
      ? president
      : defaultDestination("CHAIRMAN_OWNER");
    expect(fallback).toEqual(ws("CHAIRMAN_OWNER", "dashboard"));

    // Role switch resets history to a fresh, valid landing destination.
    let state = nav(initialNavigationState("MANAGER"), squad());
    state = navigationReducer(state, { type: "setRole", role: "CHAIRMAN_OWNER" });
    expect(state.history).toEqual([ws("CHAIRMAN_OWNER", "dashboard")]);
    expect(state.index).toBe(0);
  });

  it("8. entity-shaped destinations compare correctly", () => {
    expect(destinationsEqual(player("pl-1"), player("pl-1"))).toBe(true);
    expect(destinationsEqual(player("pl-1"), player("pl-2"))).toBe(false);
    expect(destinationsEqual(player("pl-1"), home())).toBe(false);
    // Entities are role-agnostic in this phase — always valid to render.
    expect(isValidDestinationForRole(player("pl-1"), "FEDERATION_PRESIDENT")).toBe(true);
  });

  it("9. stale / invalid destinations are rejected and fall back", () => {
    const stale = ws("MANAGER", "squad");
    expect(isValidDestinationForRole(stale, "FEDERATION_PRESIDENT")).toBe(false);
    const resolved = isValidDestinationForRole(stale, "FEDERATION_PRESIDENT")
      ? stale
      : defaultDestination("FEDERATION_PRESIDENT");
    expect(resolved).toEqual(ws("FEDERATION_PRESIDENT", "dashboard"));

    // The reducer itself is tolerant (records whatever is handed to it) — the
    // validation boundary is what keeps a stale destination off the screen.
    const recorded = nav(initialNavigationState("MANAGER"), stale);
    expect(recorded.history[recorded.index]).toEqual(stale);
  });
});

describe("useAppNavigation hook", () => {
  it("navigates back/forward and resets when the role changes", () => {
    const { result, rerender } = renderHook(({ role }: { role: CareerRole }) => useAppNavigation(role), {
      initialProps: { role: "MANAGER" },
    });

    expect(result.current.destination).toEqual(home());
    expect(result.current.canBack).toBe(false);
    expect(result.current.canForward).toBe(false);

    act(() => result.current.navigate(squad()));
    act(() => result.current.navigate(tactics()));
    expect(result.current.destination).toEqual(tactics());
    act(() => result.current.back());
    expect(result.current.destination).toEqual(squad());
    act(() => result.current.back());
    expect(result.current.destination).toEqual(home());
    expect(result.current.canBack).toBe(false);
    act(() => result.current.forward());
    expect(result.current.destination).toEqual(squad());
    expect(result.current.canForward).toBe(true);

    rerender({ role: "CHAIRMAN_OWNER" });
    expect(result.current.destination).toEqual(ws("CHAIRMAN_OWNER", "dashboard"));
    expect(result.current.canBack).toBe(false);
  });
});

describe("canonical entity destinations (Phase 1B)", () => {
  const ref = (entityType: EntityReferenceType, id: string, visible = true) => ({
    entityType,
    id: id as EntityId,
    visible,
  });

  it("maps every supported reference to an entity destination", () => {
    const supported: EntityReferenceType[] = [
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
    ];
    for (const type of supported) {
      const destination = referenceToDestination(ref(type, "e1"));
      expect(destination?.kind).toBe("entity");
      expect(destination?.entityType).toBe(type);
      expect(destination?.entityId).toBe("e1");
    }
  });

  it("refuses hidden and unsupported references (no fabricated destination)", () => {
    expect(referenceToDestination(ref("CLUB", "e1", false))).toBeUndefined();
    expect(referenceToDestination(ref("FIXTURE", "f1"))).toBeUndefined();
    expect(referenceToDestination(ref("NATIONAL_TEAM", "n1"))).toBeUndefined();
    expect(referenceToDestination(ref("FEDERATION_PROJECT", "x"))).toBeUndefined();
    expect(referenceToDestination(ref("GOVERNMENT_INSTITUTION", "g1"))).toBeUndefined();
  });

  it("keeps history across workspace -> entity -> entity -> Back", () => {
    let state = initialNavigationState("MANAGER"); // home
    state = nav(state, entityDestination("COMPETITION", "c1" as EntityId));
    state = nav(state, entityDestination("CLUB", "c2" as EntityId));
    state = nav(state, entityDestination("PLAYER", "p1" as EntityId));
    expect(state.history[state.index]).toEqual(entityDestination("PLAYER", "p1" as EntityId));

    state = navigationReducer(state, { type: "back" });
    expect(state.history[state.index]).toEqual(entityDestination("CLUB", "c2" as EntityId));
    state = navigationReducer(state, { type: "back" });
    expect(state.history[state.index]).toEqual(entityDestination("COMPETITION", "c1" as EntityId));
    state = navigationReducer(state, { type: "back" });
    expect(state.history[state.index]).toEqual(home());
  });

  it("entity equality distinguishes kind, type and id (and versus workspace)", () => {
    expect(destinationsEqual(entityDestination("CLUB", "a" as EntityId), entityDestination("CLUB", "a" as EntityId))).toBe(true);
    expect(destinationsEqual(entityDestination("CLUB", "a" as EntityId), entityDestination("CLUB", "b" as EntityId))).toBe(false);
    expect(destinationsEqual(entityDestination("CLUB", "a" as EntityId), entityDestination("PLAYER", "a" as EntityId))).toBe(false);
    expect(destinationsEqual(entityDestination("CLUB", "a" as EntityId), home())).toBe(false);
  });

  it("an identical entity destination does not duplicate history", () => {
    let state = initialNavigationState("MANAGER");
    state = nav(state, entityDestination("CLUB", "a" as EntityId));
    state = nav(state, entityDestination("CLUB", "a" as EntityId));
    expect(state.history.filter((d) => d.kind === "entity")).toHaveLength(1);
  });
});