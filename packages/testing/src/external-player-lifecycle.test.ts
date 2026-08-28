import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GlobalFootballContextRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  advanceExternalPlayerLifecycles,
  createNepalSave,
  initializeForeignFootballWorldForSave,
} from "@nepal-football-sim/simulation";

const directories: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("external player lifecycle", () => {
  it("persists development support and retires an external player exactly once", () => {
    const directory = mkdtempSync(join(tmpdir(), "nepal-football-external-lifecycle-"));
    directories.push(directory);
    const databasePath = join(directory, "world.sqlite");
    createNepalSave({
      databasePath,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "External lifecycle",
      gameVersion: "test",
      randomSeed: "external-lifecycle",
    });
    const db = openGameDatabase(databasePath);
    try {
      initializeForeignFootballWorldForSave({ db, worldDate: "2026-08-01", seed: "external-lifecycle" });
      const context = new GlobalFootballContextRepository(db);
      const first = advanceExternalPlayerLifecycles(db, { date: "2027-07-31", seed: "external-lifecycle" });
      expect(first.developed).toBeGreaterThan(0);
      const player = context.players().find((item) =>
        Boolean(db.prepare("SELECT 1 FROM player_development_states WHERE player_id = ?").get(item.playerId)),
      )!;
      expect(player).toBeTruthy();
      expect(db.prepare("SELECT 1 FROM player_development_states WHERE player_id = ?").get(player.playerId)).toBeTruthy();
      expect(db.prepare("SELECT 1 FROM player_potentials WHERE player_id = ?").get(player.playerId)).toBeTruthy();

      db.prepare("UPDATE person_roles SET active_to = ? WHERE person_id = ? AND role = 'PLAYER' AND active_to IS NULL").run("2027-08-01", player.playerId);
      db.prepare("UPDATE team_person_assignments SET ended_on = ? WHERE person_id = ? AND ended_on IS NULL").run("2027-08-01", player.playerId);
      db.prepare("UPDATE player_contracts SET status = 'TERMINATED' WHERE player_id = ? AND status = 'ACTIVE'").run(player.playerId);
      const retired = advanceExternalPlayerLifecycles(db, { date: "2028-07-31", seed: "external-lifecycle" });
      expect(retired.retired).toBe(1);
      expect(context.players().find((item) => item.playerId === player.playerId)?.careerState).toBe("RETIRED");
      expect(advanceExternalPlayerLifecycles(db, { date: "2028-07-31", seed: "external-lifecycle" }).retired).toBe(0);
    } finally {
      db.close();
    }
  }, 300000);
});
