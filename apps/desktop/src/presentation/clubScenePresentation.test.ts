import { describe, expect, it } from "vitest";
import type { ClubProfile, EntityId, EntityReference } from "@nepal-football-sim/shared-types";
import {
  buildClubSceneProfile,
  facilityTierForQuality,
  siteGeographyForLocation,
  stadiumTierForVenue,
} from "./clubScenePresentation.js";

const eid = (value: string): EntityId => value as unknown as EntityId;

const reference = (id: string, label: string): EntityReference => ({
  entityType: "CLUB",
  id: eid(id),
  label,
  destination: "club",
  visible: true,
  allowedActions: ["OPEN_PROFILE"],
  provenanceStatus: "SIMULATION_ONLY",
});

const clubProfile = (overrides: Partial<ClubProfile> = {}): ClubProfile => ({
  entityReference: reference("club-1", "Test Club"),
  recentFixtures: [],
  squad: [],
  activeSponsors: [],
  infrastructureProjects: [],
  campusProjects: [],
  infrastructureHistory: [],
  ...overrides,
});

describe("facility visual tiers", () => {
  it("treats missing and zero facility quality as genuinely undeveloped, never as a low-but-present building", () => {
    expect(facilityTierForQuality(undefined)).toBe("UNDEVELOPED");
    expect(facilityTierForQuality(0)).toBe("UNDEVELOPED");
  });

  it("maps the real 0-20 quality scale across the five built bands", () => {
    expect(facilityTierForQuality(3)).toBe("BASIC");
    expect(facilityTierForQuality(6)).toBe("MODEST");
    expect(facilityTierForQuality(10)).toBe("PROFESSIONAL");
    expect(facilityTierForQuality(14)).toBe("ADVANCED");
    expect(facilityTierForQuality(18)).toBe("ELITE");
  });
});

describe("stadium visual tiers", () => {
  it("derives the band from real recorded capacity", () => {
    expect(stadiumTierForVenue(undefined)).toBe("LOCAL_GROUND");
    expect(stadiumTierForVenue({ venueId: eid("v"), name: "V", capacity: 800, confirmedHomeGround: true })).toBe("LOCAL_GROUND");
    expect(stadiumTierForVenue({ venueId: eid("v"), name: "V", capacity: 5000, confirmedHomeGround: true })).toBe("BASIC_VENUE");
    expect(stadiumTierForVenue({ venueId: eid("v"), name: "V", capacity: 12000, confirmedHomeGround: true })).toBe("ESTABLISHED");
  });

  it("will not present a big but unlit, uncovered ground as a modern elite venue", () => {
    const bare = stadiumTierForVenue({
      venueId: eid("v"),
      name: "Big Bare Ground",
      capacity: 45000,
      floodlights: false,
      coveredStands: false,
      confirmedHomeGround: true,
    });
    expect(bare).toBe("ESTABLISHED");

    const equipped = stadiumTierForVenue({
      venueId: eid("v"),
      name: "Big Modern Ground",
      capacity: 45000,
      floodlights: true,
      coveredStands: true,
      confirmedHomeGround: true,
    });
    expect(equipped).toBe("ELITE");
  });
});

describe("club scene profile — state driven", () => {
  it("gives a club with no facilities and no ground an undeveloped, open-land campus", () => {
    const scene = buildClubSceneProfile(clubProfile());
    expect(scene.stadium.tier).toBe("LOCAL_GROUND");
    expect(scene.stadium.standCount).toBe(1);
    expect(scene.stadium.floodlights).toBe(false);
    expect(scene.site).toBe("OPEN_LAND");
    expect(scene.buildings.every((building) => building.tier === "UNDEVELOPED")).toBe(true);
    expect(scene.prestige).toBe(0);
  });

  it("scales a well-resourced club's campus and stands up from its real numbers", () => {
    const scene = buildClubSceneProfile(
      clubProfile({
        stadium: {
          venueId: eid("venue-1"),
          name: "Main Stadium",
          capacity: 24000,
          floodlights: true,
          coveredStands: true,
          confirmedHomeGround: true,
        },
        reputation: { footballReputation: 72, commercialReputation: 60 },
        facilitySnapshot: {
          trainingFacilityQuality: 17,
          youthFacilityQuality: 14,
          medicalFacilityQuality: 10,
          analyticsFacilityQuality: 6,
          academyCapacity: 40,
        },
      }),
    );
    expect(scene.stadium.tier).toBe("MODERN_LARGE");
    expect(scene.stadium.standCount).toBe(3);
    expect(scene.stadium.floodlights).toBe(true);
    expect(scene.stadium.roofed).toBe(true);
    expect(scene.site).toBe("URBAN");
    expect(scene.prestige).toBeCloseTo(0.72);
    const byKind = Object.fromEntries(scene.buildings.map((building) => [building.kind, building.tier]));
    expect(byKind.TRAINING).toBe("ELITE");
    expect(byKind.ACADEMY).toBe("ADVANCED");
    expect(byKind.MEDICAL).toBe("PROFESSIONAL");
    expect(byKind.OFFICES).toBe("MODEST");
  });

  it("shows a real in-progress project as construction on the block it actually belongs to", () => {
    const scene = buildClubSceneProfile(
      clubProfile({
        facilitySnapshot: {
          trainingFacilityQuality: 8,
          youthFacilityQuality: 8,
          medicalFacilityQuality: 8,
          analyticsFacilityQuality: 8,
          academyCapacity: 20,
        },
        campusProjects: [
          {
            id: eid("project-1"),
            projectType: "TRAINING_GROUND",
            status: "CONSTRUCTION",
            reference: { ...reference("project-1", "New training ground"), entityType: "INFRASTRUCTURE_PROJECT" },
          } as ClubProfile["campusProjects"][number],
          {
            id: eid("project-2"),
            projectType: "ACADEMY",
            status: "PLANNING",
            reference: { ...reference("project-2", "Academy plan"), entityType: "INFRASTRUCTURE_PROJECT" },
          } as ClubProfile["campusProjects"][number],
        ],
      }),
    );
    const training = scene.buildings.find((building) => building.kind === "TRAINING")!;
    expect(training.underConstruction).toBe(true);
    expect(training.planned).toBe(false);
    expect(training.statusLabel).toContain("under construction");

    const academy = scene.buildings.find((building) => building.kind === "ACADEMY")!;
    expect(academy.underConstruction).toBe(false);
    expect(academy.planned).toBe(true);

    // A block with no project at all stays a plain facility, not a building site.
    const offices = scene.buildings.find((building) => building.kind === "OFFICES")!;
    expect(offices.underConstruction).toBe(false);
    expect(offices.planned).toBe(false);
  });

  it("is deterministic: the same club always produces the identical layout seed and accent", () => {
    const first = buildClubSceneProfile(clubProfile());
    const second = buildClubSceneProfile(clubProfile());
    expect(second.seed).toBe(first.seed);
    expect(second.accentHue).toBe(first.accentHue);
  });

  it("gives different clubs different stable accents, so two grounds never look identical by accident", () => {
    const a = buildClubSceneProfile(clubProfile({ entityReference: reference("club-a", "Club A") }));
    const b = buildClubSceneProfile(clubProfile({ entityReference: reference("club-b", "Club B") }));
    expect(a.seed).not.toBe(b.seed);
  });

  it("states every fact the scene shows in text, including an unconfirmed home ground", () => {
    const scene = buildClubSceneProfile(
      clubProfile({
        stadium: {
          venueId: eid("venue-2"),
          name: "Nearest Ground",
          capacity: 4000,
          confirmedHomeGround: false,
        },
      }),
    );
    expect(scene.stadium.provisionalVenue).toBe(true);
    expect(scene.summary.join(" ")).toContain("not a confirmed home ground");
    // One line per building plus the stadium and the reputation line.
    expect(scene.summary.length).toBeGreaterThanOrEqual(6);
  });

  it("never claims a real kit colour — the accent is a stable simulation-only hue in range", () => {
    const scene = buildClubSceneProfile(clubProfile());
    expect(scene.accentHue).toBeGreaterThanOrEqual(0);
    expect(scene.accentHue).toBeLessThan(360);
  });
});

describe("geographic identity", () => {
  it("classifies a real Kathmandu valley district", () => {
    expect(siteGeographyForLocation("Kathmandu")).toBe("KATHMANDU_VALLEY");
    expect(siteGeographyForLocation("Lalitpur (estimated)")).toBe("KATHMANDU_VALLEY");
    expect(siteGeographyForLocation("Bhaktapur")).toBe("KATHMANDU_VALLEY");
  });

  it("classifies a real Terai plains district", () => {
    expect(siteGeographyForLocation("Morang")).toBe("TERAI");
    expect(siteGeographyForLocation("Chitwan (estimated)")).toBe("TERAI");
  });

  it("falls back to hill terrain for any other real, recorded district — geographically correct for most of Nepal", () => {
    expect(siteGeographyForLocation("Kaski (estimated)")).toBe("HILL");
    expect(siteGeographyForLocation("Gulmi")).toBe("HILL");
  });

  it("never guesses a terrain when there is no location on record", () => {
    expect(siteGeographyForLocation(undefined)).toBe("UNKNOWN");
  });

  it("carries the classification into the scene profile and states it in the text summary", () => {
    const scene = buildClubSceneProfile(clubProfile({ locationLabel: "Kathmandu" }));
    expect(scene.geography).toBe("KATHMANDU_VALLEY");
    expect(scene.summary.join(" ").toLowerCase()).toContain("kathmandu valley");
  });
});
