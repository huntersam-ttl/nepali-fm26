import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, simulateNepalCareer } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * A bounded, practical long-save check (3 seasons, not the full 20-season
 * benchmark) that the facility/commercial AI variety introduced this pass
 * behaves sensibly once genuinely exercised over time by the real season
 * loop — not just in single-club unit tests: real project-type diversity,
 * real sponsor-slot diversity, no runaway costs, no world-finance collapse.
 */

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("AI facility/commercial variety over a multi-season run", () => {
  it("keeps a 3-season Nepal world's facility and commercial development varied and bounded", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-long-save-variety-"));
    dirs.push(dir);
    const path = join(dir, "career.sqlite");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "ai-long-save-variety",
      gameVersion: "test",
      randomSeed: "ai-long-save-variety",
    });
    const db = openGameDatabase(path);
    simulateNepalCareer({
      db,
      seasons: 3,
      seed: "ai-long-save-variety",
      economyEnabled: true,
      transfersEnabled: true,
      youthEnabled: true,
    });
    const economy = new ClubEconomyRepository(db);
    const clubs = (
      db
        .prepare(
          `SELECT c.id FROM clubs c
           WHERE NOT EXISTS (
             SELECT 1 FROM external_club_context ecc
             WHERE ecc.club_id = c.id AND ecc.simulation_depth = 'CONTEXT_ONLY'
           )`,
        )
        .all() as Array<{ id: EntityId }>
    ).map((row) => row.id);
    expect(clubs.length).toBeGreaterThan(10);

    // FACILITIES: real project-type variety across the league, not every
    // club mechanically building the same one project type.
    const allProjects = clubs.flatMap((clubId) => economy.infrastructureProjects(clubId));
    const projectTypes = new Set(allProjects.map((project) => project.projectType));
    if (allProjects.length > 3) {
      expect(projectTypes.size).toBeGreaterThan(1);
    }
    for (const project of allProjects) {
      // Nepal-scale, generously bounded — no European-sized figure crept in.
      expect(project.capitalCost).toBeLessThan(35_000_000);
      expect(project.provenanceStatus).toBe("SIMULATION_ONLY");
    }
    // No duplicate spam: at most one non-terminal project per club at a time.
    for (const clubId of clubs) {
      const active = economy
        .infrastructureProjects(clubId)
        .filter((project) => !["COMPLETED", "CANCELLED"].includes(project.status));
      expect(active.length).toBeLessThanOrEqual(1);
    }

    // COMMERCIAL: real sponsor diversity, no single sponsor/category
    // pathologically dominating every club, no runaway value inflation.
    const allSponsorships = clubs.flatMap((clubId) =>
      economy.sponsorships(clubId).filter((item) => item.status === "ACTIVE"),
    );
    expect(allSponsorships.length).toBeGreaterThan(0);
    const sponsorIds = new Set(allSponsorships.map((item) => item.sponsorId));
    if (allSponsorships.length > 5) {
      expect(sponsorIds.size).toBeGreaterThan(1);
    }
    for (const clubId of clubs) {
      const active = economy.sponsorships(clubId).filter((item) => item.status === "ACTIVE");
      const groups = active.map((item) => item.exclusivityGroup).filter(Boolean);
      expect(new Set(groups).size).toBe(groups.length);
      for (const deal of active) {
        expect(deal.annualValue).toBeLessThan(60_000_000);
      }
    }

    // WORLD HEALTH: no wholesale financial collapse across the league.
    const accounts = clubs
      .map((clubId) => economy.financialAccount(clubId))
      .filter((account): account is NonNullable<typeof account> => Boolean(account));
    const insolvent = accounts.filter((account) => account.financialHealth === "INSOLVENT");
    expect(insolvent.length / accounts.length).toBeLessThan(0.5);
    db.close();
  }, 180_000);
});
