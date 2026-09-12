// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import type { ClubProfile, EntityId, EntityReference } from "@nepal-football-sim/shared-types";
import { ClubEnvironmentScene } from "./ClubEnvironmentScene.js";
import { resetWebglSupportCache, writeScenePreferences } from "./scenePreferences.js";

/**
 * The 3D layer must never be the only way to read the club's state, and must
 * never be required to use the game. happy-dom has no WebGL, so every render
 * here takes the fallback path — which is exactly the path a player without a
 * GPU gets, and it has to be complete on its own.
 */

const eid = (value: string): EntityId => value as unknown as EntityId;

const clubRef: EntityReference = {
  entityType: "CLUB",
  id: eid("club-1"),
  label: "Himalayan United",
  destination: "club",
  visible: true,
  allowedActions: ["OPEN_PROFILE"],
  provenanceStatus: "SIMULATION_ONLY",
};

const projectRef: EntityReference = {
  entityType: "INFRASTRUCTURE_PROJECT",
  id: eid("project-1"),
  label: "Academy expansion",
  destination: "project",
  visible: true,
  allowedActions: ["OPEN_PROJECT"],
  provenanceStatus: "SIMULATION_ONLY",
};

const profile: ClubProfile = {
  entityReference: clubRef,
  recentFixtures: [],
  squad: [],
  activeSponsors: [],
  infrastructureProjects: [],
  infrastructureHistory: [],
  stadium: {
    venueId: eid("venue-1"),
    name: "Valley Stadium",
    capacity: 18000,
    floodlights: true,
    coveredStands: true,
    confirmedHomeGround: true,
  },
  reputation: { footballReputation: 61, commercialReputation: 48 },
  facilitySnapshot: {
    trainingFacilityQuality: 14,
    youthFacilityQuality: 11,
    medicalFacilityQuality: 7,
    analyticsFacilityQuality: 4,
    academyCapacity: 30,
  },
  campusProjects: [
    {
      id: eid("project-1"),
      projectType: "ACADEMY",
      status: "CONSTRUCTION",
      reference: projectRef,
    } as ClubProfile["campusProjects"][number],
  ],
};

const fallback = <figure aria-label="Valley Stadium 2D view">2D stadium view</figure>;

beforeEach(() => {
  resetWebglSupportCache();
  globalThis.localStorage?.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Club environment scene — accessibility and fallback", () => {
  it("falls back to the 2D club view when the runtime has no WebGL, with no dead space", () => {
    render(<ClubEnvironmentScene profile={profile} fallback={fallback} />);
    expect(screen.getByLabelText("Valley Stadium 2D view")).toBeTruthy();
  });

  it("renders the 2D view when the player has turned 3D off, even on a capable machine", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      getExtension: () => null,
    } as unknown as RenderingContext);
    writeScenePreferences({ enabled3d: false, quality: "HIGH", motion: "FULL" });
    render(<ClubEnvironmentScene profile={profile} fallback={fallback} />);
    expect(screen.getByLabelText("Valley Stadium 2D view")).toBeTruthy();
  });

  it("states every fact the scene depicts as real text, not only inside the canvas", () => {
    render(<ClubEnvironmentScene profile={profile} fallback={fallback} />);
    // The stadium line, each facility block, and the reputation are all text.
    expect(screen.getByText(/Valley Stadium/)).toBeTruthy();
    expect(screen.getByText(/capacity 18,000/)).toBeTruthy();
    expect(screen.getByText(/Training ground: advanced/i)).toBeTruthy();
    expect(screen.getByText(/Academy: under construction/i)).toBeTruthy();
    expect(screen.getByText(/Medical centre: modest/i)).toBeTruthy();
    expect(screen.getByText(/Club football reputation 61 of 100/i)).toBeTruthy();
  });

  it("is honest that the accent colours are simulation-only, never the club's real kit", () => {
    render(<ClubEnvironmentScene profile={profile} fallback={fallback} />);
    expect(screen.getByText(/simulation-only accents, not the club's real kit colours/i)).toBeTruthy();
  });

  it("says plainly when the venue is only the nearest known ground", () => {
    render(
      <ClubEnvironmentScene
        profile={{
          ...profile,
          stadium: { ...profile.stadium!, confirmedHomeGround: false },
        }}
        fallback={fallback}
      />,
    );
    // Stated both on the stadium line itself and as a plain explanation.
    expect(screen.getAllByText(/not a confirmed home ground/i).length).toBeGreaterThanOrEqual(2);
  });

  it("offers every clickable destination as a real named button, never only as a 3D object", () => {
    const onOpenReference = vi.fn();
    render(<ClubEnvironmentScene profile={profile} fallback={fallback} onOpenReference={onOpenReference} />);
    const button = screen.getByRole("button", { name: /open academy project/i });
    button.click();
    expect(onOpenReference).toHaveBeenCalledWith(projectRef);
  });

  it("never renders a clickable div or span in place of a real control", () => {
    const { container } = render(
      <ClubEnvironmentScene profile={profile} fallback={fallback} onOpenReference={vi.fn()} />,
    );
    expect(container.querySelectorAll("span[onclick], div[onclick]").length).toBe(0);
    for (const element of container.querySelectorAll("[role=button], [role=link]")) {
      expect(["BUTTON", "A"]).toContain(element.tagName);
    }
  });

  it("has no serious or critical axe violations", async () => {
    const { container } = render(
      <ClubEnvironmentScene profile={profile} fallback={fallback} onOpenReference={vi.fn()} />,
    );
    const results = await axe.run(container, {
      rules: {
        region: { enabled: false },
        "page-has-heading-one": { enabled: false },
        "landmark-one-main": { enabled: false },
      },
    });
    expect(
      results.violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map((violation) => `${violation.id} (${violation.impact})`),
    ).toEqual([]);
  });
});
