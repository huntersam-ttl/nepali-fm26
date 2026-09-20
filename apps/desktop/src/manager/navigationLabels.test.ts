import { describe, expect, it } from "vitest";
import type { EntityId, EntityReferenceType } from "@nepal-football-sim/shared-types";
import type { AppDestination } from "../navigation.js";
import {
  contextTrail,
  contextualNavItems,
  entityCategoryLabel,
  dailyOpsNavItems,
  workspaceLabel,
} from "./navigationLabels.js";

const ws = (role: string, workspace: string): AppDestination =>
  ({ kind: "workspace", role, workspace }) as unknown as AppDestination;
const ent = (entityType: EntityReferenceType, id: string): AppDestination =>
  ({ kind: "entity", entityType, entityId: id as unknown as EntityId }) as AppDestination;

const trailLabels = (trail: AppDestination[]): string[] => trail.map(workspaceLabel);

describe("destination labels", () => {
  it("labels workspaces per role", () => {
    expect(workspaceLabel(ws("MANAGER", "squad"))).toBe("Squad");
    expect(workspaceLabel(ws("MANAGER", "home"))).toBe("Home / Inbox");
    expect(workspaceLabel(ws("CHAIRMAN_OWNER", "finance"))).toBe("Finances");
    expect(workspaceLabel(ws("FEDERATION_PRESIDENT", "finance"))).toBe("Federation Finance");
    expect(workspaceLabel(ws("CEO", "dashboard"))).toBe("Dashboard");
  });

  it("labels entity categories without fabricating a name", () => {
    expect(entityCategoryLabel("PLAYER")).toBe("Player");
    expect(entityCategoryLabel("CLUB")).toBe("Club");
    expect(entityCategoryLabel("COMPETITION")).toBe("Competition");
    expect(workspaceLabel(ent("CLUB", "c1"))).toBe("Club");
  });
});

describe("context trail (breadcrumbs)", () => {
  it("a workspace destination is a single-crumb trail (never the whole history)", () => {
    const history = [ws("MANAGER", "home"), ws("MANAGER", "squad")];
    expect(contextTrail(ws("MANAGER", "squad"), history)).toEqual([ws("MANAGER", "squad")]);
  });

  it("walks back from the current entity to the nearest workspace", () => {
    const history = [ws("MANAGER", "home"), ws("MANAGER", "competition"), ent("CLUB", "c1")];
    expect(trailLabels(contextTrail(ent("CLUB", "c1"), history))).toEqual(["Competition", "Club"]);
  });

  it("keeps the workspace context across entity hops", () => {
    const history = [ws("MANAGER", "home"), ws("MANAGER", "squad"), ent("PLAYER", "p1"), ent("CLUB", "c1")];
    expect(trailLabels(contextTrail(ent("CLUB", "c1"), history))).toEqual(["Squad", "Player", "Club"]);
  });

  it("caps the trail instead of replaying every historical hop", () => {
    const history = [
      ws("MANAGER", "home"),
      ws("MANAGER", "squad"),
      ent("PLAYER", "p1"),
      ent("PLAYER", "p2"),
      ent("PLAYER", "p3"),
      ent("CLUB", "c1"),
    ];
    const trail = contextTrail(ent("CLUB", "c1"), history);
    expect(trail.length).toBeLessThanOrEqual(4);
    // Root stays the workspace; the current entity is preserved.
    expect(trail[0]).toEqual(ws("MANAGER", "squad"));
    expect(trail[trail.length - 1]).toEqual(ent("CLUB", "c1"));
  });

  it("resets cleanly to a single crumb after a role switch", () => {
    const history = [ws("MANAGER", "home"), ws("MANAGER", "squad"), ent("PLAYER", "p1")];
    const afterRoleSwitch = [ws("CHAIRMAN_OWNER", "dashboard")];
    expect(contextTrail(ws("CHAIRMAN_OWNER", "dashboard"), afterRoleSwitch)).toEqual([
      ws("CHAIRMAN_OWNER", "dashboard"),
    ]);
    expect(trailLabels(contextTrail(ws("CHAIRMAN_OWNER", "dashboard"), history))).not.toContain("Squad");
  });
});

describe("contextual secondary nav", () => {
  it("lists the current workspace family for the manager", () => {
    const items = contextualNavItems("MANAGER", "squad");
    expect(items.map((item) => item.label)).toEqual(["Home / Inbox", "Squad", "Dressing Room", "Tactics", "Training", "Medical"]);
    expect(items.find((item) => item.current)?.id).toBe("squad");
  });

  it("reflects owner and president workspaces", () => {
    expect(contextualNavItems("CHAIRMAN_OWNER", "finance").map((item) => item.label)).toContain("Finances");
    expect(contextualNavItems("FEDERATION_PRESIDENT", "governance").map((item) => item.label)).toContain("Governance");
  });

  it("returns nothing for executive roles and unknown workspaces", () => {
    expect(contextualNavItems("CEO", "dashboard")).toEqual([]);
    expect(contextualNavItems("MANAGER", "unknown")).toEqual([]);
  });
});

describe("daily operations family nav", () => {
  it("12. returns the family for a member with the current item marked", () => {
    const items = dailyOpsNavItems("messages");
    expect(items.map((item) => item.label)).toEqual([
      "Overview",
      "Messages",
      "News",
      "Calendar",
      "Fixture schedule",
      "League table",
    ]);
    expect(items.find((item) => item.current)?.id).toBe("messages");
  });

  it("13. is empty outside the family", () => {
    expect(dailyOpsNavItems("squad")).toEqual([]);
    expect(dailyOpsNavItems("tactics")).toEqual([]);
  });
});