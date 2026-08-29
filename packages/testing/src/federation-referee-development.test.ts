import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FederationGovernanceRepository,
  WorkforceSupplyRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  createNepalSave,
  generateOfficial,
  initializeFederationGovernanceForSave,
  initializeWorkforceSupplyForSave,
  processFederationMonth,
} from "@nepal-football-sim/simulation";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("federation referee-development cadence", () => {
  it("develops eligible officials once, persists the result, and excludes other federations", () => {
    const directory = mkdtempSync(join(tmpdir(), "nepal-referee-development-"));
    tempDirs.push(directory);
    const databasePath = join(directory, "career.sqlite");
    createNepalSave({
      databasePath,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "Referee development cadence",
      gameVersion: "test",
      randomSeed: "referee-development-cadence",
    });
    const db = openGameDatabase(databasePath);
    try {
      initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "cadence" });
      initializeWorkforceSupplyForSave({ db, worldDate: "2026-09-01", seed: "cadence" });
      const federation = db
        .prepare("SELECT id, country_id FROM federations WHERE name = 'All Nepal Football Association'")
        .get() as { id: EntityId; country_id: EntityId };
      for (let index = 0; index < 5; index += 1) {
        generateOfficial({
          db,
          countryId: federation.country_id,
          role: "REFEREE",
          date: "2026-09-01",
          seasonLabel: "2026",
          index,
        });
      }
      const workforce = new WorkforceSupplyRepository(db);
      const before = workforce
        .activeOfficials("REFEREE")
        .filter((official) => official.countryId === federation.country_id)
        .sort((a, b) => a.quality - b.quality || a.personId.localeCompare(b.personId))
        .slice(0, 4);
      processFederationMonth(db, { date: "2026-09-28", seed: "cadence" });

      const governance = new FederationGovernanceRepository(db);
      const programmes = governance.refereeDevelopmentProgrammes(federation.id);
      expect(programmes).toHaveLength(1);
      expect(programmes[0]!.refereesAdvanced).toBeGreaterThan(0);
      expect(programmes[0]!.refereesAdvanced).toBeLessThanOrEqual(4);

      expect(before.length).toBeGreaterThan(0);
      const firstQuality = before[0]!.quality;
      const after = workforce.official(before[0]!.personId)!;
      expect(after.quality).toBeGreaterThan(firstQuality);
      const historyCount = (
        db
          .prepare("SELECT COUNT(*) AS count FROM staff_history_events WHERE event_type = 'REFEREE_DEVELOPMENT_COMPLETED' AND federation_id = ?")
          .get(federation.id) as { count: number }
      ).count;
      expect(historyCount).toBe(programmes[0]!.refereesAdvanced);

      processFederationMonth(db, { date: "2026-09-28", seed: "cadence" });
      expect(governance.refereeDevelopmentProgrammes(federation.id)).toHaveLength(1);
      expect(
        (
          db
            .prepare("SELECT COUNT(*) AS count FROM staff_history_events WHERE event_type = 'REFEREE_DEVELOPMENT_COMPLETED' AND federation_id = ?")
            .get(federation.id) as { count: number }
        ).count,
      ).toBe(historyCount);
      expect(workforce.official(before[0]!.personId)!.quality).toBe(after.quality);
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM staff_history_events h
             JOIN persons p ON p.id = h.person_id
             WHERE h.event_type = 'REFEREE_DEVELOPMENT_COMPLETED'
               AND h.federation_id = ? AND p.nationality_country_id != ?`,
          )
          .get(federation.id, federation.country_id),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  }, 120000);
});
