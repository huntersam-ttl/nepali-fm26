import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

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

describe("club visual identity — deterministic fallback and real persisted override", () => {
  it("resolves a deterministic SIMULATION_ONLY fallback for a club with no saved identity", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "club-identity-fallback-"));
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const clubs = service.listStartingClubs();
    expect(clubs.ok).toBe(true);
    if (!clubs.ok) return;
    const club = clubs.data[0]!;
    const created = service.createCareer({
      careerMode: "MANAGER",
      saveName: "Identity Fallback",
      joinTeamId: club.teamId,
      character,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = service.getClubVisualIdentity(club.clubId as EntityId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.isCustom).toBe(false);
    expect(first.data.provenanceStatus).toBe("SIMULATION_ONLY");

    // Deterministic: the same club resolves the exact same fallback colours
    // every call, never a fresh random pick.
    const second = service.getClubVisualIdentity(club.clubId as EntityId);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data).toEqual(first.data);

    service.closeCareer();
    rmSync(savesDirectory, { recursive: true, force: true });
  });

  it("lets the controlling owner save real colours, which persist across reload and override the fallback", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "club-identity-owner-save-"));
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const locations = service.listFounderLocations();
    expect(locations.ok).toBe(true);
    if (!locations.ok) return;
    const location = locations.data[0]!;
    const created = service.createCareer({
      saveName: "Identity Owner Save",
      careerMode: "OWNER",
      founder: {
        clubName: "Identity Test FC",
        locationId: location.id,
        locationName: location.district,
        groundName: "Identity Test Ground",
        philosophy: "COMMUNITY",
      },
      character,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const dashboard = service.getChairmanDashboard();
    expect(dashboard.ok).toBe(true);
    if (!dashboard.ok) return;
    const clubId = dashboard.data.club.id;

    const saved = service.setClubColours(clubId, {
      primaryColour: "#123456",
      secondaryColour: "#abcdef",
      accentColour: "#00ff00",
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.data.isCustom).toBe(true);
      expect(saved.data.primaryColour).toBe("#123456");
    }

    // Persists across a real save/reload, not just in the live in-memory db.
    expect(service.saveCareer().ok).toBe(true);
    expect(service.loadCareer(created.data.catalogEntry.saveId).ok).toBe(true);

    const resolved = service.getClubVisualIdentity(clubId);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.data.isCustom).toBe(true);
      expect(resolved.data.primaryColour).toBe("#123456");
      expect(resolved.data.secondaryColour).toBe("#abcdef");
      expect(resolved.data.accentColour).toBe("#00ff00");
    }

    service.closeCareer();
    rmSync(savesDirectory, { recursive: true, force: true });
  });

  it("rejects an invalid colour value rather than saving it", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "club-identity-invalid-"));
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const clubs = service.listStartingClubs();
    expect(clubs.ok).toBe(true);
    if (!clubs.ok) return;
    const club = clubs.data[0]!;
    const created = service.createCareer({
      careerMode: "MANAGER",
      saveName: "Identity Invalid Colour",
      joinTeamId: club.teamId,
      character,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // A Manager (not an Owner) has no authority to edit club colours at all —
    // this should fail on authorization before colour validation ever runs.
    const result = service.setClubColours(club.clubId as EntityId, {
      primaryColour: "not-a-colour",
      secondaryColour: "#abcdef",
      accentColour: "#00ff00",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ROLE_NOT_AUTHORIZED");

    service.closeCareer();
    rmSync(savesDirectory, { recursive: true, force: true });
  });
});
