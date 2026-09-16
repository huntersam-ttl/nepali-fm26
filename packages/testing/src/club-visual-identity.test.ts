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

  it("lets the owner save a full identity (colours + badge), which persists and resolves exactly", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "club-identity-full-"));
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const locations = service.listFounderLocations();
    expect(locations.ok).toBe(true);
    if (!locations.ok) return;
    const location = locations.data[0]!;
    const created = service.createCareer({
      saveName: "Identity Full Save",
      careerMode: "OWNER",
      founder: {
        clubName: "Full Identity FC",
        locationId: location.id,
        locationName: location.district,
        groundName: "Full Identity Ground",
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

    const saved = service.setClubVisualIdentity(clubId, {
      primaryColour: "#101010",
      secondaryColour: "#202020",
      accentColour: "#303030",
      badgeShape: "DIAMOND",
      badgeSymbol: "STAR",
      badgeInitials: "fifc",
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.data.badgeShape).toBe("DIAMOND");
      expect(saved.data.badgeSymbol).toBe("STAR");
      // Initials are normalised (trimmed + upper-cased) rather than stored verbatim.
      expect(saved.data.badgeInitials).toBe("FIFC");
    }

    expect(service.saveCareer().ok).toBe(true);
    expect(service.loadCareer(created.data.catalogEntry.saveId).ok).toBe(true);

    const resolved = service.getClubVisualIdentity(clubId);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.data.isCustom).toBe(true);
      expect(resolved.data.badgeShape).toBe("DIAMOND");
      expect(resolved.data.badgeSymbol).toBe("STAR");
      expect(resolved.data.badgeInitials).toBe("FIFC");
      expect(resolved.data.primaryColour).toBe("#101010");
    }

    service.closeCareer();
    rmSync(savesDirectory, { recursive: true, force: true });
  });

  it("rejects an invalid badge shape/symbol rather than saving it", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "club-identity-invalid-badge-"));
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const locations = service.listFounderLocations();
    expect(locations.ok).toBe(true);
    if (!locations.ok) return;
    const location = locations.data[0]!;
    const created = service.createCareer({
      saveName: "Identity Invalid Badge",
      careerMode: "OWNER",
      founder: {
        clubName: "Invalid Badge FC",
        locationId: location.id,
        locationName: location.district,
        groundName: "Invalid Badge Ground",
        philosophy: "COMMUNITY",
      },
      character,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const dashboard = service.getChairmanDashboard();
    expect(dashboard.ok).toBe(true);
    if (!dashboard.ok) return;

    const result = service.setClubVisualIdentity(dashboard.data.club.id, {
      primaryColour: "#101010",
      secondaryColour: "#202020",
      accentColour: "#303030",
      // @ts-expect-error deliberately invalid for this test
      badgeShape: "HEXAGON",
      badgeSymbol: "STAR",
      badgeInitials: "IBF",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_SELECTION");

    service.closeCareer();
    rmSync(savesDirectory, { recursive: true, force: true });
  });

  it("keeps resolving a legacy Phase 1C colour-only override correctly (no badge fields, no crash)", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "club-identity-legacy-colours-"));
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const locations = service.listFounderLocations();
    expect(locations.ok).toBe(true);
    if (!locations.ok) return;
    const location = locations.data[0]!;
    const created = service.createCareer({
      saveName: "Identity Legacy Colours",
      careerMode: "OWNER",
      founder: {
        clubName: "Legacy Colours FC",
        locationId: location.id,
        locationName: location.district,
        groundName: "Legacy Colours Ground",
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

    // Simulates a save that only ever went through Phase 1C's colour-only
    // write path — never a full identity write.
    expect(
      service.setClubColours(clubId, { primaryColour: "#654321", secondaryColour: "#123abc", accentColour: "#abc123" })
        .ok,
    ).toBe(true);

    const resolved = service.getClubVisualIdentity(clubId);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.data.isCustom).toBe(true);
      expect(resolved.data.primaryColour).toBe("#654321");
      // No badge override was ever saved for this club — the resolver must
      // not fabricate one.
      expect(resolved.data.badgeShape).toBeUndefined();
      expect(resolved.data.badgeSymbol).toBeUndefined();
      expect(resolved.data.badgeInitials).toBeUndefined();
    }

    service.closeCareer();
    rmSync(savesDirectory, { recursive: true, force: true });
  });

  it("persists each kit slot independently — saving Home never touches Away/Third, across a real reload", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "club-identity-kits-"));
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const locations = service.listFounderLocations();
    expect(locations.ok).toBe(true);
    if (!locations.ok) return;
    const location = locations.data[0]!;
    const created = service.createCareer({
      saveName: "Identity Kits",
      careerMode: "OWNER",
      founder: {
        clubName: "Kits FC",
        locationId: location.id,
        locationName: location.district,
        groundName: "Kits Ground",
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

    const homeKit = {
      baseColour: "#111111",
      secondaryColour: "#222222",
      trimColour: "#333333",
      pattern: "VERTICAL_STRIPES" as const,
      shortsColour: "#444444",
      socksColour: "#555555",
    };
    const firstSave = service.setClubVisualIdentity(clubId, {
      primaryColour: "#101010",
      secondaryColour: "#202020",
      accentColour: "#303030",
      badgeShape: "ROUND",
      badgeSymbol: "MOUNTAIN",
      badgeInitials: "KFC",
      homeKit,
    });
    expect(firstSave.ok).toBe(true);
    if (firstSave.ok) {
      expect(firstSave.data.homeKit).toEqual(homeKit);
      expect(firstSave.data.awayKit).toBeUndefined();
      expect(firstSave.data.thirdKit).toBeUndefined();
    }

    // Now save Away only — Home must remain exactly as saved, Third must
    // still be undefined (deterministic), never silently reset.
    const awayKit = {
      baseColour: "#666666",
      secondaryColour: "#777777",
      trimColour: "#888888",
      pattern: "SASH" as const,
      shortsColour: "#999999",
      socksColour: "#aaaaaa",
    };
    const secondSave = service.setClubVisualIdentity(clubId, {
      primaryColour: "#101010",
      secondaryColour: "#202020",
      accentColour: "#303030",
      badgeShape: "ROUND",
      badgeSymbol: "MOUNTAIN",
      badgeInitials: "KFC",
      awayKit,
    });
    expect(secondSave.ok).toBe(true);
    if (secondSave.ok) {
      expect(secondSave.data.homeKit).toEqual(homeKit);
      expect(secondSave.data.awayKit).toEqual(awayKit);
      expect(secondSave.data.thirdKit).toBeUndefined();
    }

    expect(service.saveCareer().ok).toBe(true);
    expect(service.loadCareer(created.data.catalogEntry.saveId).ok).toBe(true);

    const resolved = service.getClubVisualIdentity(clubId);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.data.homeKit).toEqual(homeKit);
      expect(resolved.data.awayKit).toEqual(awayKit);
      expect(resolved.data.thirdKit).toBeUndefined();
    }

    service.closeCareer();
    rmSync(savesDirectory, { recursive: true, force: true });
  });

  it("rejects an invalid kit pattern rather than saving it", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "club-identity-invalid-kit-"));
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const locations = service.listFounderLocations();
    expect(locations.ok).toBe(true);
    if (!locations.ok) return;
    const location = locations.data[0]!;
    const created = service.createCareer({
      saveName: "Identity Invalid Kit",
      careerMode: "OWNER",
      founder: {
        clubName: "Invalid Kit FC",
        locationId: location.id,
        locationName: location.district,
        groundName: "Invalid Kit Ground",
        philosophy: "COMMUNITY",
      },
      character,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const dashboard = service.getChairmanDashboard();
    expect(dashboard.ok).toBe(true);
    if (!dashboard.ok) return;

    const result = service.setClubVisualIdentity(dashboard.data.club.id, {
      primaryColour: "#101010",
      secondaryColour: "#202020",
      accentColour: "#303030",
      badgeShape: "ROUND",
      badgeSymbol: "MOUNTAIN",
      badgeInitials: "IKF",
      homeKit: {
        baseColour: "#111111",
        secondaryColour: "#222222",
        trimColour: "#333333",
        // @ts-expect-error deliberately invalid for this test
        pattern: "TARTAN",
        shortsColour: "#444444",
        socksColour: "#555555",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_SELECTION");

    service.closeCareer();
    rmSync(savesDirectory, { recursive: true, force: true });
  });

  it("snapshots the current season's real kit designs on identity read, once, and never mutates that snapshot afterward", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "club-kit-history-"));
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const locations = service.listFounderLocations();
    expect(locations.ok).toBe(true);
    if (!locations.ok) return;
    const location = locations.data[0]!;
    const created = service.createCareer({
      saveName: "Kit History",
      careerMode: "OWNER",
      founder: {
        clubName: "Kit History FC",
        locationId: location.id,
        locationName: location.district,
        groundName: "Kit History Ground",
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

    // A brand-new club has no history until its identity is actually read
    // once — this is the "first identity read of a season" activation
    // trigger (there is no live, per-save season-rollover event to hook
    // this to instead; see desktop-application.ts's getClubVisualIdentity
    // for why).
    const beforeAnyRead = service.getClubKitHistory(clubId);
    expect(beforeAnyRead.ok).toBe(true);
    if (beforeAnyRead.ok) expect(beforeAnyRead.data).toEqual([]);

    const firstRead = service.getClubVisualIdentity(clubId);
    expect(firstRead.ok).toBe(true);
    if (!firstRead.ok) return;

    const historyAfterFirstRead = service.getClubKitHistory(clubId);
    expect(historyAfterFirstRead.ok).toBe(true);
    if (!historyAfterFirstRead.ok) return;
    expect(historyAfterFirstRead.data).toHaveLength(1);
    const [seasonOne] = historyAfterFirstRead.data;
    expect(seasonOne!.seasonKey).toBe("2026");
    // The club has no custom kit yet, so history recorded the real
    // deterministic fallback design — structured fields, not a placeholder.
    expect(firstRead.data.isCustom).toBe(false);
    expect(seasonOne!.homeKit.baseColour).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(typeof seasonOne!.awayKit.pattern).toBe("string");

    // Reading identity again within the same season must not duplicate the
    // snapshot (snapshotSeasonIfAbsent is INSERT OR IGNORE, unique on
    // club_id+season_key).
    service.getClubVisualIdentity(clubId);
    service.getClubVisualIdentity(clubId);
    const historyAfterRepeatedReads = service.getClubKitHistory(clubId);
    expect(historyAfterRepeatedReads.ok).toBe(true);
    if (historyAfterRepeatedReads.ok) expect(historyAfterRepeatedReads.data).toHaveLength(1);

    // Now the owner customises the club's Home kit to something completely
    // different from what was snapshotted above.
    const saved = service.setClubVisualIdentity(clubId, {
      primaryColour: "#0a0a0a",
      secondaryColour: "#f0f0f0",
      accentColour: "#c0ffee",
      badgeShape: "CREST",
      badgeSymbol: "STAR",
      badgeInitials: "KHF",
      homeKit: {
        baseColour: "#ff0000",
        secondaryColour: "#00ff00",
        trimColour: "#0000ff",
        pattern: "HALVES",
        shortsColour: "#ffffff",
        socksColour: "#000000",
      },
    });
    expect(saved.ok).toBe(true);

    // Reading identity again (still the same season) must still not
    // duplicate the snapshot, AND the season-one snapshot recorded above
    // must remain exactly what it was — history is immutable, not a live
    // reference to the club's current kit.
    service.getClubVisualIdentity(clubId);
    const historyAfterEdit = service.getClubKitHistory(clubId);
    expect(historyAfterEdit.ok).toBe(true);
    if (!historyAfterEdit.ok) return;
    expect(historyAfterEdit.data).toHaveLength(1);
    expect(historyAfterEdit.data[0]).toEqual(seasonOne);
    expect(historyAfterEdit.data[0]!.homeKit.baseColour).not.toBe("#ff0000");

    // Persists across a real save/reload, not just in-memory.
    expect(service.saveCareer().ok).toBe(true);
    expect(service.loadCareer(created.data.catalogEntry.saveId).ok).toBe(true);
    const historyAfterReload = service.getClubKitHistory(clubId);
    expect(historyAfterReload.ok).toBe(true);
    if (historyAfterReload.ok) expect(historyAfterReload.data).toEqual(historyAfterEdit.data);

    service.closeCareer();
    rmSync(savesDirectory, { recursive: true, force: true });
  });
});
