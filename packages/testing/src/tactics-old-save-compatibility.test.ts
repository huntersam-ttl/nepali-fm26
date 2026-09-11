import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import { openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");

const onlySaveFile = (savesDirectory: string): string => {
  const file = readdirSync(savesDirectory).find((name) => name.endsWith(".sqlite"));
  if (!file) throw new Error("no save file found");
  return join(savesDirectory, file);
};

/**
 * Simulates a save written before this sprint: a tactical_setups row whose
 * assignments carry no `instructions` key at all (not even `instructions: []`
 * — genuinely absent, as an old JSON blob would be), and a matches row with
 * no tactical_snapshot_json (NULL, exactly what the additive migration
 * leaves on every pre-existing row). Neither should need a migration
 * rewrite — the code must already tolerate the missing fields.
 */
describe("old-save compatibility — player instructions and tactical history", () => {
  let service: DesktopApplicationService;
  let savesDirectory: string;
  let saveId: EntityId;

  const command = (saveName: string) => ({
    saveName,
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

  beforeAll(() => {
    savesDirectory = mkdtempSync(join(tmpdir(), "nepal-old-save-compat-"));
    service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const created = service.createCareer(command("Old Save Compat"));
    if (!created.ok) throw new Error(`career creation failed: ${created.error.message}`);
    saveId = created.data.save.id;
  }, 240_000);

  afterAll(() => {
    service.closeCareer();
    rmSync(savesDirectory, { recursive: true, force: true });
  });

  it("a tactical_setups row with no `instructions` key on any assignment loads, validates, and saves/reloads cleanly", () => {
    const before = service.getTactics();
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    // Rewrite the persisted row's assignments_json to the pre-Sprint-4 shape
    // — no `instructions` property on any assignment — bypassing the normal
    // (already-compatible) write path to prove the READ path tolerates it.
    service.closeCareer();
    const dbPath = onlySaveFile(savesDirectory);
    const db = openGameDatabase(dbPath);
    const row = db
      .prepare("SELECT id, assignments_json FROM tactical_setups WHERE team_id = (SELECT team_id FROM tactical_setups LIMIT 1)")
      .get() as { id: string; assignments_json: string } | undefined;
    expect(row).toBeTruthy();
    if (!row) return;
    const strippedAssignments = (JSON.parse(row.assignments_json) as Array<Record<string, unknown>>).map(
      (assignment) => {
        const { instructions: _drop, ...rest } = assignment;
        return rest;
      },
    );
    expect(strippedAssignments.every((a) => !("instructions" in a))).toBe(true);
    db.prepare("UPDATE tactical_setups SET assignments_json = ? WHERE id = ?").run(
      JSON.stringify(strippedAssignments),
      row.id,
    );
    db.close();

    const reloaded = service.loadCareer(saveId);
    expect(reloaded.ok).toBe(true);

    const after = service.getTactics();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    // No crash reading it back; every assignment has a valid role/duty and
    // no instructions (undefined, not a fabricated empty array on disk —
    // but never throws when the UI or engine reads `assignment.instructions`).
    expect(after.data.setup.assignments.length).toBeGreaterThan(0);
    for (const assignment of after.data.setup.assignments) {
      expect(assignment.instructions ?? []).toEqual([]);
      expect(assignment.roleId).toBeTruthy();
    }
    expect(after.data.validation.isValid).toBe(true);
    expect(after.data.instructionOptions.length).toBeGreaterThan(0);

    // A save/reload cycle from this old-shaped state remains valid, and
    // adding a fresh instruction now works exactly as it would on a new save.
    const slot = after.data.setup.assignments.find((a) => a.playerId)!;
    const updated = service.updateTactics({
      assignments: after.data.setup.assignments.map((a) =>
        a.slotId === slot.slotId ? { ...a, instructions: ["GET_FURTHER_FORWARD"] } : a,
      ),
    });
    expect(updated.ok).toBe(true);
  });

  it("a matches row with no tactical_snapshot_json reports tactical history as unavailable, never the club's current tactic", () => {
    const fixtures = service.getFixtures();
    expect(fixtures.ok).toBe(true);
    if (!fixtures.ok) return;
    service.continueCareer();
    const upcoming = service.getFixtures();
    if (!upcoming.ok) return;
    const target = upcoming.data.upcoming[0]!;
    const played = service.quickSimMatch(target.id);
    expect(played.ok).toBe(true);

    // Simulate a match played before this column existed: null it out directly.
    service.closeCareer();
    const dbPath = onlySaveFile(savesDirectory);
    const db = openGameDatabase(dbPath);
    db.prepare("UPDATE matches SET tactical_snapshot_json = NULL WHERE fixture_id = ?").run(target.id);
    db.close();
    const reloaded = service.loadCareer(saveId);
    expect(reloaded.ok).toBe(true);

    const report = service.getPostMatchReport(target.id);
    expect(report.ok).toBe(true);
    if (!report.ok || !report.data) return;
    expect(report.data.startingTactics).toBe("UNAVAILABLE");
  }, 60_000);
});
