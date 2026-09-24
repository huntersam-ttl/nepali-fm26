import { describe, expect, it } from "vitest";
import type { EntityId, EntityReferenceType } from "@nepal-football-sim/shared-types";
import type { AppDestination } from "../navigation.js";
import {
  contextTrail,
  contextualNavItems,
  entityCategoryLabel,
  dailyOpsNavItems,
  squadNavItems,
  clubNavItems,
  mediaNavItems,
  careerNavItems,
  PRESIDENT_FAMILIES,
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
    expect(workspaceLabel(ws("FEDERATION_PRESIDENT", "federation-overview"))).toBe("Federation Overview");
    expect(workspaceLabel(ws("FEDERATION_PRESIDENT", "federation-projects"))).toBe("Federation Projects");
    expect(
      contextualNavItems("FEDERATION_PRESIDENT", "federation-overview").map((item) => item.label),
    ).toEqual(expect.arrayContaining(["Federation Overview", "Governance", "Federation Projects"]));
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

describe("squad family nav", () => {
  it("lists Overview | First Team | Training | Dynamics | Medical | Loans with current marked", () => {
    const items = squadNavItems("loans");
    expect(items.map((item) => item.label)).toEqual(["Overview", "First Team", "Training", "Dynamics", "Medical", "Loans"]);
    expect(items.find((item) => item.current)?.id).toBe("loans");
    expect(squadNavItems("dressing-room").find((item) => item.current)?.id).toBe("dressing-room");
  });

  it("is empty outside the squad family", () => {
    expect(squadNavItems("tactics")).toEqual([]);
  });
});

describe("club governance family nav (Phase 6B)", () => {
  it("30. lists the final Club family with the current marked", () => {
    const items = clubNavItems("club-supporters");
    expect(items.map((item) => item.label)).toEqual([
      "Overview",
      "Profile",
      "Finances",
      "Board",
      "Responsibilities",
      "Facilities",
      "Projects",
      "Supporters",
      "Commercial",
      "History & Honours",
    ]);
    expect(items.find((item) => item.current)?.id).toBe("club-supporters");
    expect(clubNavItems("club-board").find((item) => item.current)?.id).toBe("club-board");
  });

  it("marks Facilities, Projects, Supporters, Commercial and History current when active (6C/6D)", () => {
    for (const id of ["club-facilities", "club-projects", "club-supporters", "club-commercial", "club-history"]) {
      expect(clubNavItems(id).find((item) => item.current)?.id).toBe(id);
    }
  });

  it("is empty outside the club family", () => {
    expect(clubNavItems("staff")).toEqual([]);
    expect(clubNavItems("home")).toEqual([]);
  });

  it("labels the final Club workspaces for the manager", () => {
    expect(workspaceLabel(ws("MANAGER", "club-finances"))).toBe("Club Finances");
    expect(workspaceLabel(ws("MANAGER", "club-board"))).toBe("Club Board");
    expect(workspaceLabel(ws("MANAGER", "club-responsibilities"))).toBe("Responsibilities");
    expect(workspaceLabel(ws("MANAGER", "club-facilities"))).toBe("Facilities");
    expect(workspaceLabel(ws("MANAGER", "club-projects"))).toBe("Infrastructure Projects");
    expect(workspaceLabel(ws("MANAGER", "club-supporters"))).toBe("Supporters");
    expect(workspaceLabel(ws("MANAGER", "club-commercial"))).toBe("Commercial");
    expect(workspaceLabel(ws("MANAGER", "club-history"))).toBe("History & Honours");
  });

  it("exposes the club family through the shared contextual nav", () => {
    const items = contextualNavItems("MANAGER", "club-board");
    expect(items.map((item) => item.label)).toContain("Club Board");
    expect(items.find((item) => item.current)?.id).toBe("club-board");
    expect(contextualNavItems("MANAGER", "club-facilities").map((item) => item.label)).toContain("Facilities");
    expect(contextualNavItems("MANAGER", "club-commercial").map((item) => item.label)).toContain("Commercial");
  });
});

describe("media family nav (Phase 7A/7B)", () => {
  it("lists Newsroom | Media Outlets | Journalists | Press Requests with the current marked", () => {
    const items = mediaNavItems("media-outlets");
    expect(items.map((item) => item.label)).toEqual([
      "Newsroom",
      "Media Outlets",
      "Journalists",
      "Press Requests",
    ]);
    expect(items.find((item) => item.current)?.id).toBe("media-outlets");
    expect(mediaNavItems("media-requests").find((item) => item.current)?.id).toBe("media-requests");
  });

  it("is empty outside the media family", () => {
    expect(mediaNavItems("media")).toEqual([]);
    expect(mediaNavItems("club-overview")).toEqual([]);
  });

  it("labels the media workspaces and exposes them via the shared contextual nav", () => {
    expect(workspaceLabel(ws("MANAGER", "newsroom"))).toBe("Newsroom");
    expect(workspaceLabel(ws("MANAGER", "media-outlets"))).toBe("Media Outlets");
    expect(workspaceLabel(ws("MANAGER", "media-journalists"))).toBe("Journalists");
    expect(workspaceLabel(ws("MANAGER", "media-requests"))).toBe("Press Requests");
    expect(contextualNavItems("MANAGER", "newsroom").map((item) => item.label)).toContain("Newsroom");
  });
describe("career family nav (Phase 8A)", () => {
  it("lists Overview | History | Reputation | Jobs with the current marked", () => {
    const items = careerNavItems("career-history");
    expect(items.map((item) => item.label)).toEqual(["Overview", "History", "Reputation", "Jobs"]);
    expect(items.find((item) => item.current)?.id).toBe("career-history");
  });

  it("is empty outside the career family", () => {
    expect(careerNavItems("home")).toEqual([]);
    expect(careerNavItems("media-outlets")).toEqual([]);
  });

  it("labels the career workspaces and exposes them via the shared contextual nav", () => {
    expect(workspaceLabel(ws("MANAGER", "career-overview"))).toBe("Career Overview");
    expect(workspaceLabel(ws("MANAGER", "career-history"))).toBe("Career History");
    expect(workspaceLabel(ws("MANAGER", "career-reputation"))).toBe("Career Reputation");
    expect(workspaceLabel(ws("MANAGER", "career-jobs"))).toBe("Career Jobs");
    expect(contextualNavItems("MANAGER", "career-overview").map((item) => item.label)).toContain("Career Overview");
  });
});
});

describe("final Federation President family (Phase 9D)", () => {
  it("is exactly the supported destinations, each labelled, with no placeholder", () => {
    expect(PRESIDENT_FAMILIES.flatMap((family) => family.items)).toEqual([
      "dashboard",
      "federation-overview",
      "governance",
      "federation-projects",
      "finance",
      "commercial",
      "national-teams",
      "national-development",
      "competition-pyramid",
      "nepal-map",
      "government-relations",
      "tenure",
    ]);
    const labels = PRESIDENT_FAMILIES.flatMap((family) => family.items).map((id) =>
      workspaceLabel(ws("FEDERATION_PRESIDENT", id)),
    );
    expect(labels).toEqual([
      "Dashboard",
      "Federation Overview",
      "Governance",
      "Federation Projects",
      "Federation Finance",
      "Commercial",
      "National Teams",
      "National Development",
      "Domestic Pyramid",
      "Nepal Map",
      "Government",
      "Election / Tenure",
    ]);
  });
});