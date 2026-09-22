import { describe, expect, it } from "vitest";
import {
  CLUB_UNKNOWN,
  clubDisplayName,
  confirmedHomeGround,
  groundCapacity,
  groundLabel,
  identityAccent,
  isNavigable,
  provenanceLabel,
  referenceLabel,
} from "./club.js";
import type { ClubProfile, EntityId, EntityReference } from "@nepal-football-sim/shared-types";

const eid = (v: string) => v as unknown as EntityId;

const profile = (over: Partial<ClubProfile> = {}): ClubProfile =>
  ({
    entityReference: { entityType: "CLUB", id: eid("c1"), label: "Thunder FC", destination: "/club/c1", visible: true, provenanceStatus: "SIMULATION_ONLY" },
    squad: [],
    recentFixtures: [],
    activeSponsors: [],
    infrastructureProjects: [],
    campusProjects: [],
    infrastructureHistory: [],
    ...over,
  }) as ClubProfile;

describe("club identity mapping", () => {
  it("1/2. maps name and badge/colour fallbacks canonically", () => {
    expect(clubDisplayName(profile())).toBe("Thunder FC");
    expect(clubDisplayName(undefined)).toBe(CLUB_UNKNOWN);
    expect(identityAccent(undefined)).toBe("var(--sys-accent)");
    expect(identityAccent({ primaryColour: "#123456" } as never)).toBe("#123456");
  });
  it("3/4. unknown factual fields stay unknown; nothing fabricated", () => {
    expect(groundLabel(profile())).toBe(CLUB_UNKNOWN);
    expect(groundCapacity(profile())).toBe(CLUB_UNKNOWN);
    expect(referenceLabel(undefined)).toBe(CLUB_UNKNOWN);
  });
  it("ground reports real values when canonical, and honours confirmed status", () => {
    const withGround = profile({
      stadium: { venueId: eid("v1"), name: "National Ground", capacity: 12000, confirmedHomeGround: true },
    });
    expect(groundLabel(withGround)).toBe("National Ground");
    expect(groundCapacity(withGround)).toBe("12000");
    expect(confirmedHomeGround(withGround)).toBe(true);
    expect(confirmedHomeGround(profile())).toBe(false);
  });
  it("5/6. leadership refs map; unknown leader is unknown", () => {
    const leader: EntityReference = { entityType: "STAFF", id: eid("s1"), label: "Coach A", destination: "/staff", visible: true, allowedActions: [], provenanceStatus: "SIMULATION_ONLY" };
    expect(referenceLabel(profile({ manager: leader }).manager)).toBe("Coach A");
  });
  it("clickability requires a visible + destination ref", () => {
    expect(isNavigable({ entityType: "CLUB", id: eid("c1"), label: "C", destination: "/c", visible: true } as never)).toBe(true);
    expect(isNavigable({ entityType: "CLUB", id: eid("c1"), label: "C", visible: false } as never)).toBe(false);
  });
  it("7. provenance is preserved, not invented", () => {
    expect(provenanceLabel("SIMULATION_ONLY")).toBe("SIMULATION_ONLY");
    expect(provenanceLabel(undefined)).toBe(CLUB_UNKNOWN);
  });
  it("no hidden reputation/ability values leak through the mapping", () => {
    const text = JSON.stringify([
      clubDisplayName(profile()),
      groundLabel(profile()),
      identityAccent(undefined),
      provenanceLabel("SIMULATION_ONLY"),
    ]);
    expect(text).not.toMatch(/reputation|hiddenAbility|internalWeight|currentAbility/i);
  });
});