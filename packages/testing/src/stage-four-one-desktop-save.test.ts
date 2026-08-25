import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CURRENT_DATABASE_VERSION,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");

const tempDirs: string[] = [];

const service = (): DesktopApplicationService => {
  const savesDirectory = mkdtempSync(join(tmpdir(), "nepal-football-desktop-"));
  tempDirs.push(savesDirectory);
  return new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const command = (saveName: string, joinTeamId?: EntityId, startingAge = 33) => ({
  saveName,
  joinTeamId,
  character: {
    fullName: "Maya Adhikari",
    preferredDisplayName: "Maya",
    dateOfBirth: "1993-05-12",
    startingAge,
    languages: ["ne", "en"],
    footballBackground: "COMMUNITY_COACHING",
    education: "SPORTS_RELATED_DEGREE",
    playingExperience: "AMATEUR_PLAYER",
    coachingExperience: "YOUTH_COACH",
    businessBackground: "SMALL_BUSINESS",
    startingReputationProfile: "LOCAL_RESPECTED",
  },
});

describe("desktop runtime real SQLite careers", () => {
  it("offers only real Nepal clubs with a usable squad as starting options", () => {
    const clubs = service().listStartingClubs();
    expect(clubs.ok).toBe(true);
    if (!clubs.ok) return;

    expect(clubs.data.length).toBeGreaterThan(0);
    for (const club of clubs.data) {
      expect(club.squadSize).toBeGreaterThanOrEqual(14);
      expect(club.clubName).not.toMatch(/Testing|Test XI|Sample|Demo/);
    }
    expect(clubs.data.some((club) => club.competitionName.includes("ANFA National League"))).toBe(
      true,
    );
  });

  it("creates a career backed by the canonical Nepal world, not a testing world", () => {
    const runtime = service();
    const created = runtime.createCareer(command("Real World Save"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.data.header.characterName).toBe("Maya");
    expect(created.data.header.activeRole).toBe("MANAGER");
    expect(created.data.catalogEntry.filePath.endsWith(".sqlite")).toBe(true);
    expect(created.data.squad.length).toBeGreaterThanOrEqual(14);
    expect(created.data.fixtures.length).toBeGreaterThan(0);
    expect(created.data.activeTactic?.assignments).toHaveLength(11);

    // Real imported world, not the retired synthetic one.
    const teamNames = created.data.competition.table.map((row) => row.teamName);
    expect(teamNames.length).toBeGreaterThan(4);
    for (const name of [...teamNames, created.data.header.clubName ?? ""]) {
      expect(name).not.toMatch(/Kathmandu Testing Club|Lalitpur Test XI|Pokhara Sample|Demo/);
    }
    for (const player of created.data.squad) {
      expect(player.name).not.toMatch(/^(Kiran|Suman|Anil|Bikash) (Kathmandu|Lalitpur|Pokhara)/);
    }
  });

  it("writes catalog metadata that lists without reopening the world", () => {
    const runtime = service();
    const created = runtime.createCareer(command("Catalog Save"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const listed = runtime.listSaves();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]).toMatchObject({
      saveName: "Catalog Save",
      characterName: "Maya",
      activeRole: "MANAGER",
      schemaVersion: CURRENT_DATABASE_VERSION,
    });
    expect(listed.data[0]?.organisation).toBeTruthy();
    expect(listed.data[0]?.gameVersion).toBeTruthy();
    expect(
      readdirSync(listed.data[0]!.filePath.replace(/\/[^/]+$/, "")).some((file) =>
        file.endsWith(".meta.json"),
      ),
    ).toBe(true);
  });

  it("restores identical career state after close and reopen", () => {
    const runtime = service();
    const created = runtime.createCareer(command("Reload Save"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const advanced = runtime.continueCareer();
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(advanced.data.save.worldDate).not.toBe(created.data.save.worldDate);

    const expected = {
      saveId: advanced.data.save.id,
      worldDate: advanced.data.save.worldDate,
      characterName: advanced.data.header.characterName,
      clubName: advanced.data.header.clubName,
      competitionName: advanced.data.header.competitionName,
    };

    expect(runtime.saveCareer().ok).toBe(true);
    expect(runtime.closeCareer()).toEqual({ ok: true, data: { closed: true } });
    // Session is closed: commands must refuse rather than silently reopen.
    expect(runtime.getCareerHeader()).toMatchObject({
      ok: false,
      error: { code: "SESSION_NOT_OPEN" },
    });

    const reopened = runtime.loadCareer(expected.saveId);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect({
      saveId: reopened.data.save.id,
      worldDate: reopened.data.save.worldDate,
      characterName: reopened.data.header.characterName,
      clubName: reopened.data.header.clubName,
      competitionName: reopened.data.header.competitionName,
    }).toEqual(expected);
  });

  it("keeps two careers in separate files with no state leakage", () => {
    const runtime = service();
    const clubs = runtime.listStartingClubs();
    expect(clubs.ok).toBe(true);
    if (!clubs.ok) return;

    const careerA = runtime.createCareer(command("Career A", clubs.data[0]!.teamId));
    expect(careerA.ok).toBe(true);
    if (!careerA.ok) return;
    const advancedA = runtime.continueCareer();
    expect(advancedA.ok).toBe(true);
    if (!advancedA.ok) return;

    const careerB = runtime.createCareer(command("Career B", clubs.data[1]!.teamId));
    expect(careerB.ok).toBe(true);
    if (!careerB.ok) return;

    expect(careerB.data.save.id).not.toBe(careerA.data.save.id);
    expect(careerB.data.catalogEntry.filePath).not.toBe(careerA.data.catalogEntry.filePath);
    expect(careerB.data.header.clubName).not.toBe(careerA.data.header.clubName);
    // B is freshly created, so it must not inherit A's advanced world date.
    expect(careerB.data.save.worldDate).toBe(careerA.data.save.worldDate);
    expect(careerB.data.save.worldDate).not.toBe(advancedA.data.save.worldDate);

    const reloadedA = runtime.loadCareer(careerA.data.save.id);
    expect(reloadedA.ok).toBe(true);
    if (!reloadedA.ok) return;
    expect(reloadedA.data.save.worldDate).toBe(advancedA.data.save.worldDate);
    expect(reloadedA.data.header.clubName).toBe(careerA.data.header.clubName);

    const listed = runtime.listSaves();
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.data).toHaveLength(2);
  });

  it("deletes one save without touching the others", () => {
    const runtime = service();
    const clubs = runtime.listStartingClubs();
    if (!clubs.ok) return;
    const keep = runtime.createCareer(command("Keep Me", clubs.data[0]!.teamId));
    const drop = runtime.createCareer(command("Drop Me", clubs.data[1]!.teamId));
    expect(keep.ok && drop.ok).toBe(true);
    if (!keep.ok || !drop.ok) return;

    const deleted = runtime.deleteSave(drop.data.save.id);
    expect(deleted).toEqual({ ok: true, data: { deleted: true } });
    expect(existsSync(drop.data.catalogEntry.filePath)).toBe(false);
    expect(existsSync(keep.data.catalogEntry.filePath)).toBe(true);

    const listed = runtime.listSaves();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]?.saveId).toBe(keep.data.save.id);
    expect(runtime.loadCareer(drop.data.save.id)).toMatchObject({
      ok: false,
      error: { code: "SAVE_NOT_FOUND" },
    });
  });

  it("cycles database handles without leaking or locking save files", () => {
    const runtime = service();
    const clubs = runtime.listStartingClubs();
    if (!clubs.ok) return;
    const a = runtime.createCareer(command("Handle A", clubs.data[0]!.teamId));
    const b = runtime.createCareer(command("Handle B", clubs.data[1]!.teamId));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    runtime.closeCareer();
    expect(runtime.loadCareer(a.data.save.id).ok).toBe(true);
    runtime.closeCareer();
    expect(runtime.loadCareer(b.data.save.id).ok).toBe(true);
    runtime.closeCareer();

    // A third open of the first save proves nothing held an exclusive lock.
    const reopened = runtime.loadCareer(a.data.save.id);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.data.save.id).toBe(a.data.save.id);

    // An independent connection can still open the file while a session is live.
    const direct = openGameDatabase(reopened.data.catalogEntry.filePath);
    expect(migrateDatabase(direct)).toBe(CURRENT_DATABASE_VERSION);
    direct.close();
    runtime.closeCareer();
  });

  it("persists a quick sim result across reload", () => {
    const runtime = service();
    const created = runtime.createCareer(command("Quick Sim Save"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const simulated = runtime.quickSimMatch(created.data.home.nextFixture?.id);
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;
    expect(simulated.data.home.previousResult?.score).toMatch(/\d-\d/);
    expect(simulated.data.competition.table.some((row) => row.played === 1)).toBe(true);

    runtime.closeCareer();
    const reloaded = runtime.loadCareer(created.data.save.id);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.data.fixtures.some((fixture) => fixture.status === "played")).toBe(true);
    expect(reloaded.data.home.previousResult?.score).toBe(
      simulated.data.home.previousResult?.score,
    );
  });

  it("persists edited tactics across reload", () => {
    const runtime = service();
    const created = runtime.createCareer(command("Tactic Save"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const tactic = created.data.activeTactic!;

    const saved = runtime.saveTactic({
      ...tactic,
      name: "High press saved tactic",
      style: "HIGH_PRESS",
      bench: [...tactic.bench].reverse(),
      setPieces: { ...tactic.setPieces, penaltyTaker: tactic.assignments[10]?.playerId },
    });
    expect(saved.ok).toBe(true);

    runtime.closeCareer();
    const reloaded = runtime.loadCareer(created.data.save.id);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.data.activeTactic?.name).toBe("High press saved tactic");
    expect(reloaded.data.activeTactic?.style).toBe("HIGH_PRESS");
    expect(reloaded.data.activeTactic?.bench[0]).toBe(tactic.bench.at(-1));
  });

  it("returns structured errors and leaves no half-created save behind", () => {
    const runtime = service();
    const invalid = runtime.createCareer(command("Bad Age", undefined, 22));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("CAREER_CREATION_FAILED");

    const listed = runtime.listSaves();
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.data).toHaveLength(0);

    expect(
      runtime.createCareer(command("Bad Club", "team-does-not-exist" as EntityId)),
    ).toMatchObject({ ok: false, error: { code: "INVALID_SELECTION" } });
    expect(runtime.loadCareer("missing" as EntityId)).toMatchObject({
      ok: false,
      error: { code: "SAVE_NOT_FOUND" },
    });
  });

  it("ignores unreadable files when listing the catalog", () => {
    const runtime = service();
    const created = runtime.createCareer(command("Good Save"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    writeFileSync(
      join(created.data.catalogEntry.filePath.replace(/\/[^/]+$/, ""), "broken.sqlite"),
      "not a sqlite database",
    );

    const listed = runtime.listSaves();
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.data).toHaveLength(1);
  });

  it("migrates an older Stage 4-compatible schema when opening a save", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-football-migrate-"));
    tempDirs.push(dir);
    const path = join(dir, "old.sqlite");
    const db = openGameDatabase(path);
    db.exec(
      "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
    );
    db.close();

    const migrated = openGameDatabase(path);
    expect(migrateDatabase(migrated)).toBe(CURRENT_DATABASE_VERSION);
    migrated.close();
  });
});
