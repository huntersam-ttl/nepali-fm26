import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("career pyramid and new-save balancing", () => {
  it("lists active A, B, and C pyramid clubs independent of imported squad count", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-pyramid-list-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({
      savesDirectory: dir,
      worldDatasetPath: registryPath,
    });
    const result = service.listStartingClubs();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new Set(result.data.map((club) => club.division))).toEqual(new Set(["A", "B", "C"]));
      expect(result.data.some((club) => club.clubName === "Planning Boyz United")).toBe(true);
      expect(result.data.some((club) => club.clubName === "Bagmati Youth Club")).toBe(true);
    }
    service.closeCareer();
  });

  it("creates lower-division gameplay squads and keeps ordinary new-save wages bounded", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-pyramid-create-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({
      savesDirectory: dir,
      worldDatasetPath: registryPath,
    });
    const options = service.listStartingClubs();
    if (!options.ok) throw new Error(options.error.message);
    const bClub = options.data.find((club) => club.division === "B");
    if (!bClub) throw new Error("No B Division club");
    const created = service.createCareer({
      saveName: "B Division test",
      joinTeamId: bClub.teamId,
      character: {
        fullName: "Test Manager",
        dateOfBirth: "1990-01-01",
        startingAge: 36,
        languages: ["en"],
        footballBackground: "COMMUNITY_COACHING",
        education: "SECONDARY",
        playingExperience: "AMATEUR_PLAYER",
        coachingExperience: "YOUTH_COACH",
        businessBackground: "SMALL_BUSINESS",
        startingReputationProfile: "LOCAL_RESPECTED",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.header.competitionName).toContain("B-Division");
    const db = openGameDatabase(created.data.catalogEntry.filePath);
    try {
      const squad = Number(
        (
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM team_person_assignments WHERE team_id=? AND role='PLAYER' AND ended_on IS NULL",
            )
            .get(bClub.teamId) as { n: number }
        ).n,
      );
      expect(squad).toBeGreaterThanOrEqual(11);
      expect(squad).toBeLessThanOrEqual(22);
      const unattached = Number(
        (
          db
            .prepare("SELECT COUNT(*) AS n FROM player_transfer_statuses WHERE status='FREE_AGENT'")
            .get() as { n: number }
        ).n,
      );
      expect(unattached).toBeGreaterThan(0);
      const highWage = Number(
        (
          db
            .prepare(
              "SELECT MAX(salary) AS n FROM player_contracts WHERE status='ACTIVE' AND salary>0",
            )
            .get() as { n: number }
        ).n,
      );
      expect(highWage).toBeLessThan(250_000);
    } finally {
      db.close();
      service.closeCareer();
    }
  });

  it("starts Khumaltar, Three Star, and a healthy A-Division club with viable squads", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-a-division-start-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({
      savesDirectory: dir,
      worldDatasetPath: registryPath,
    });
    const options = service.listStartingClubs();
    if (!options.ok) throw new Error(options.error.message);
    const selected = [
      options.data.find((club) => club.clubName === "Khumaltar Youth Club"),
      options.data.find((club) => club.clubName === "Three Star Club"),
      options.data.find((club) => club.division === "A" && club.squadSize > 0),
    ];
    if (selected.some((club) => !club))
      throw new Error("Required A Division clubs are unavailable");
    for (const [index, club] of selected.entries()) {
      const result = service.createCareer({
        saveName: `A Division start ${index}`,
        joinTeamId: club!.teamId,
        character: {
          fullName: "A Division Test Manager",
          dateOfBirth: "1990-01-01",
          startingAge: 36,
          languages: ["en"],
          footballBackground: "COMMUNITY_COACHING",
          education: "SECONDARY",
          playingExperience: "AMATEUR_PLAYER",
          coachingExperience: "YOUTH_COACH",
          businessBackground: "SMALL_BUSINESS",
          startingReputationProfile: "LOCAL_RESPECTED",
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const db = openGameDatabase(result.data.catalogEntry.filePath);
      try {
        const squad = Number(
          (
            db
              .prepare(
                "SELECT COUNT(*) AS n FROM team_person_assignments WHERE team_id=? AND role='PLAYER' AND ended_on IS NULL",
              )
              .get(club!.teamId) as { n: number }
          ).n,
        );
        const realPlayers = Number(
          (
            db
              .prepare(
                "SELECT COUNT(*) AS n FROM team_person_assignments tpa LEFT JOIN generated_player_origins gpo ON gpo.player_id=tpa.person_id WHERE tpa.team_id=? AND tpa.role='PLAYER' AND tpa.ended_on IS NULL AND gpo.player_id IS NULL",
              )
              .get(club!.teamId) as { n: number }
          ).n,
        );
        // squadSize counts the Nepal registry only; a real career's global seed
        // may also place genuine foreign players (PLY-* imports) at the club.
        const registryPlayers = Number(
          (
            db
              .prepare(
                `SELECT COUNT(*) AS n FROM team_person_assignments tpa
                 LEFT JOIN generated_player_origins gpo ON gpo.player_id=tpa.person_id
                 WHERE tpa.team_id=? AND tpa.role='PLAYER' AND tpa.ended_on IS NULL AND gpo.player_id IS NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM player_factual_profiles f
                     WHERE f.player_id=tpa.person_id AND f.canonical_external_id LIKE 'PLY-%'
                   )`,
              )
              .get(club!.teamId) as { n: number }
          ).n,
        );
        expect(squad).toBeGreaterThanOrEqual(11);
        if (club!.clubName === "Khumaltar Youth Club" || club!.clubName === "Three Star Club") {
          expect(realPlayers).toBe(0);
        } else {
          expect(realPlayers).toBeGreaterThan(0);
          expect(registryPlayers).toBeLessThanOrEqual(club!.squadSize);
        }
      } finally {
        db.close();
      }
    }
    service.closeCareer();
  }, 120_000);

  it("starts an owner career with canonical majority control", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-owner-start-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({
      savesDirectory: dir,
      worldDatasetPath: registryPath,
    });
    const options = service.listStartingClubs();
    if (!options.ok) throw new Error(options.error.message);
    const club = options.data.find((item) => item.division === "B");
    if (!club) throw new Error("No B Division club");
    const result = service.createCareer({
      careerMode: "OWNER",
      saveName: "Owner start",
      joinTeamId: club.teamId,
      character: {
        fullName: "Owner Test",
        dateOfBirth: "1990-01-01",
        startingAge: 36,
        languages: ["en"],
        footballBackground: "COMMUNITY_COACHING",
        education: "SECONDARY",
        playingExperience: "AMATEUR_PLAYER",
        coachingExperience: "YOUTH_COACH",
        businessBackground: "SMALL_BUSINESS",
        startingReputationProfile: "LOCAL_RESPECTED",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.header.activeRole).toBe("CHAIRMAN_OWNER");
    const roles = service.getCareerRoles();
    expect(roles.ok && roles.data.heldRoles).toContain("CHAIRMAN_OWNER");
    const dashboard = service.getChairmanDashboard();
    expect(dashboard.ok).toBe(true);
    const candidacy = service.getFederationCandidacy();
    expect(candidacy.ok).toBe(true);
    if (candidacy.ok) expect(candidacy.data.reasons.join(" ")).toContain("3 seasons");
    service.closeCareer();
  }, 120_000);
});
