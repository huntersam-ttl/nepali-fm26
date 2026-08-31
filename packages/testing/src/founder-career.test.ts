import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import { openGameDatabase } from "@nepal-football-sim/database";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");
const savesDirectory = mkdtempSync(join(tmpdir(), "nepal-founder-career-"));
const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });

afterAll(() => {
  service.closeCareer();
  rmSync(savesDirectory, { recursive: true, force: true });
});

describe("founder owner career", () => {
  it("creates a canonical C-Division founder club with owned ground, squad, finances, and 100% ownership", () => {
    const locations = service.listFounderLocations();
    expect(locations.ok).toBe(true);
    if (!locations.ok) return;
    expect(locations.data).toHaveLength(77);
    expect(new Set(locations.data.map((item) => item.id)).size).toBe(77);
    const location = locations.data.find((item) => item.district === "Kaski") ?? locations.data[0]!;
    const created = service.createCareer({
      saveName: "Founder Career",
      careerMode: "OWNER",
      founder: {
        clubName: "Pokhara City FC",
        locationId: location.id,
        locationName: location.district,
        groundName: "Pokhara City Ground",
        philosophy: "COMMUNITY",
      },
      character: {
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
      },
    });
    if (!created.ok) throw new Error(`${created.error.code}: ${created.error.message} ${created.error.detail ?? ""}`);
    if (!created.ok) return;
    expect(created.data.header.activeRole).toBe("CHAIRMAN_OWNER");
    expect(created.data.header.clubName).toBe("Pokhara City FC");
    expect(created.data.header.teamName).toBe("Pokhara City FC");
    expect(created.data.header.competitionName).toContain("C-Division");
    expect(created.data.catalogEntry.organisation).toBe("Pokhara City FC");
    const dashboard = service.getChairmanDashboard();
    expect(dashboard.ok).toBe(true);
    if (!dashboard.ok) return;
    expect(dashboard.data.club.ownershipPercentage).toBe(100);
    expect(dashboard.data.manager).toBeUndefined();
    expect(dashboard.data.finances.account.cashBalance).toBeGreaterThan(0);
    expect(dashboard.data.sponsorships.some((item) => item.status === "ACTIVE")).toBe(true);
    const candidates = service.listOwnerManagerCandidates();
    expect(candidates.ok).toBe(true);
    if (!candidates.ok) return;
    expect(candidates.data.length).toBeGreaterThan(0);
    const appointment = service.appointManager(candidates.data[0]!.vacancyId, candidates.data[0]!.managerProfileId);
    expect(appointment.ok).toBe(true);
    expect(service.getChairmanDashboard()).toMatchObject({ ok: true, data: { manager: { name: candidates.data[0]!.name } } });
    expect(service.saveCareer().ok).toBe(true);
    expect(service.loadCareer(created.data.catalogEntry.saveId).ok).toBe(true);
    const db = openGameDatabase(created.data.catalogEntry.filePath);
    try {
      const club = db.prepare("SELECT id FROM clubs WHERE name=?").get("Pokhara City FC") as { id?: string } | undefined;
      expect(club?.id).toBeTruthy();
      if (!club?.id) return;
      const team = db.prepare("SELECT id FROM teams WHERE club_id=? AND level='senior'").get(club.id) as { id?: string } | undefined;
      expect(team?.id).toBeTruthy();
      if (!team?.id) return;
      expect((db.prepare("SELECT COUNT(*) AS count FROM team_person_assignments WHERE team_id=? AND role='PLAYER' AND ended_on IS NULL").get(team.id) as { count: number }).count).toBeGreaterThanOrEqual(18);
      expect((db.prepare("SELECT COUNT(*) AS count FROM venue_relationships WHERE club_id=? AND status != 'CLOSED'").get(club.id) as { count: number }).count).toBeGreaterThan(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM club_memberships WHERE club_id=? AND status='ACTIVE'").get(club.id) as { count: number }).count).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS count FROM fixtures WHERE competition_season_id=(SELECT competition_season_id FROM club_memberships WHERE club_id=? LIMIT 1)").get(club.id) as { count: number }).count).toBeGreaterThan(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM sponsorship_contracts WHERE club_id=? AND status='ACTIVE'").get(club.id) as { count: number }).count).toBeGreaterThan(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM club_ledger_entries WHERE club_id=? AND description='Initial sponsorship payment'").get(club.id) as { count: number }).count).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS count FROM manager_contracts WHERE club_id=? AND status='ACTIVE'").get(club.id) as { count: number }).count).toBe(1);
    } finally {
      db.close();
    }
  }, 240_000);
});
