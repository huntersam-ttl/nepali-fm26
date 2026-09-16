import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");

const character = {
  fullName: "Maya Adhikari",
  preferredDisplayName: "Maya",
  dateOfBirth: "1993-05-12",
  startingAge: 33,
  languages: ["ne", "en"],
  footballBackground: "COMMUNITY_COACHING",
  education: "SPORTS_RELATED_DEGREE",
  playingExperience: "AMATEUR_PLAYER",
  coachingExperience: "YOUTH_COACH",
  businessBackground: "SMALL_BUSINESS",
  startingReputationProfile: "LOCAL_RESPECTED",
};

describe("career header portrait continuity — same human, same face across role switches", () => {
  it("keeps the same personId (and therefore the same portrait identity) across Manager -> Chairman/Owner -> Federation President -> Manager", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "career-header-continuity-"));
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const clubs = service.listStartingClubs();
    expect(clubs.ok).toBe(true);
    if (!clubs.ok) return;
    const club = clubs.data[0]!;
    const created = service.createCareer({
      careerMode: "MANAGER",
      saveName: "Header Continuity",
      joinTeamId: club.teamId,
      character,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Grants this manager a CHAIRMAN_OWNER stake and a FEDERATION_PRESIDENT
    // role on the same underlying career person, exactly like the browser
    // E2E fixture — the same real command the app's own dev-mode command
    // endpoint calls, just invoked directly rather than through HTTP.
    const fixture = service.seedE2ERoleFixture();
    expect(fixture.ok).toBe(true);

    const asManager = service.getCareerHeader();
    expect(asManager.ok).toBe(true);
    if (!asManager.ok) return;
    expect(asManager.data.activeRole).toBe("MANAGER");
    expect(asManager.data.personId).toBeDefined();
    const personId = asManager.data.personId!;

    const switchedToOwner = service.switchActiveCareerRole("CHAIRMAN_OWNER");
    expect(switchedToOwner.ok).toBe(true);
    const asOwner = service.getCareerHeader();
    expect(asOwner.ok).toBe(true);
    if (!asOwner.ok) return;
    expect(asOwner.data.activeRole).toBe("CHAIRMAN_OWNER");
    expect(asOwner.data.personId).toBe(personId);

    const switchedToPresident = service.switchActiveCareerRole("FEDERATION_PRESIDENT");
    expect(switchedToPresident.ok).toBe(true);
    const asPresident = service.getCareerHeader();
    expect(asPresident.ok).toBe(true);
    if (!asPresident.ok) return;
    expect(asPresident.data.activeRole).toBe("FEDERATION_PRESIDENT");
    expect(asPresident.data.personId).toBe(personId);

    const switchedBackToManager = service.switchActiveCareerRole("MANAGER");
    expect(switchedBackToManager.ok).toBe(true);
    const backToManager = service.getCareerHeader();
    expect(backToManager.ok).toBe(true);
    if (!backToManager.ok) return;
    expect(backToManager.data.activeRole).toBe("MANAGER");
    expect(backToManager.data.personId).toBe(personId);

    // `personAge` should also stay consistent — role switches alone must
    // never shift the age band a portrait would render (only real
    // world-date progression should).
    expect(asOwner.data.personAge).toBe(asManager.data.personAge);
    expect(asPresident.data.personAge).toBe(asManager.data.personAge);
    expect(backToManager.data.personAge).toBe(asManager.data.personAge);

    // apps/desktop/src/presentation/personVisualIdentity.ts's
    // buildPersonVisualIdentity(personId, age) is a pure function of
    // exactly these two fields and never takes role as an input (verified
    // separately by that module's own determinism test) — so the
    // personId/personAge equality just asserted is what actually
    // guarantees the same face renders in every one of these four header
    // states. That client-side module can't be imported from this Node
    // package (apps/desktop is a browser bundle), so this test stops at
    // proving the header's own continuity contract.

    service.closeCareer();
    rmSync(savesDirectory, { recursive: true, force: true });
  });
});
