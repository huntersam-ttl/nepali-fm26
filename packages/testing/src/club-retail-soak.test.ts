import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, shirtSalesFromRevenue, simulateNepalCareer } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * Club Commercial Phase 1C — multi-season soak for the merchandise economy.
 *
 * Runs the canonical whole-world career simulation (the same one
 * long-save-validation uses) with the economy enabled, then audits the
 * merchandise side of every club — human-playable and AI alike — for
 * runaway behaviour. Nothing here posts revenue or drives the AI: the
 * point is to observe what the real systems do when left alone for
 * several seasons.
 *
 * One simulation is shared by every assertion below. Each season of the
 * full world is genuinely expensive (minutes, not seconds), so running a
 * separate world per test would triple the cost to re-observe identical
 * state. Reading is what varies here, not the world being read.
 *
 * All figures are read through ClubEconomyRepository — the same canonical
 * accessor the feature uses — rather than hand-written SQL against table
 * and column names this test would otherwise have to guess at.
 */

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const SEASONS = Number(process.env.CLUB_RETAIL_SOAK_SEASONS ?? "5");
const SOAK_TIMEOUT = 2_700_000;

type ClubSeason = { clubId: EntityId; seasonKey: string; merchandiseRevenue: number };

let db: GameDatabase;
let directory: string;
let economy: ClubEconomyRepository;
let clubIds: EntityId[];
let perSeason: ClubSeason[];

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "club-retail-soak-"));
  const path = join(directory, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: "club-retail-soak",
    gameVersion: "test",
    randomSeed: "club-retail-soak",
  });
  db = openGameDatabase(path);
  simulateNepalCareer({ db, seasons: SEASONS, seed: "club-retail-soak", economyEnabled: true });

  economy = new ClubEconomyRepository(db);
  clubIds = (db.prepare("SELECT id FROM clubs").all() as Array<{ id: EntityId }>).map((row) => row.id);

  const totals = new Map<string, ClubSeason>();
  for (const clubId of clubIds) {
    for (const entry of economy.ledgerEntries(clubId)) {
      if (entry.category !== "MERCHANDISE" || entry.direction !== "CREDIT") continue;
      const seasonKey = entry.date.slice(0, 4);
      const key = `${clubId}:${seasonKey}`;
      const running = totals.get(key) ?? { clubId, seasonKey, merchandiseRevenue: 0 };
      running.merchandiseRevenue += entry.amount;
      totals.set(key, running);
    }
  }
  perSeason = [...totals.values()];
}, SOAK_TIMEOUT);

afterAll(() => {
  db?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe(`club retail soak — ${SEASONS} simulated seasons of the real merchandise economy`, () => {
  it("keeps merchandise revenue, appeal and shirt analytics bounded and finite across seasons", () => {
    expect(perSeason.length, "the merchandise economy should have traded during the soak").toBeGreaterThan(0);

    for (const row of perSeason) {
      expect(Number.isFinite(row.merchandiseRevenue), "merchandise revenue must be finite").toBe(true);
      expect(Number.isNaN(row.merchandiseRevenue)).toBe(false);
      expect(row.merchandiseRevenue, "merchandise CREDIT postings are never negative").toBeGreaterThan(0);
    }

    // Appeal is the one lever a completed RETAIL_STORE moves, and it must
    // stay inside its canonical bounds for every club in the world.
    for (const clubId of new Set(perSeason.map((row) => row.clubId))) {
      const appeal = economy.commercialProfile(clubId)?.merchandiseAppeal;
      expect(appeal, `club ${clubId} should still have a commercial profile`).toBeDefined();
      if (appeal !== undefined) {
        expect(Number.isFinite(appeal)).toBe(true);
        expect(appeal).toBeGreaterThanOrEqual(0);
        expect(appeal, "the RETAIL_STORE lever must stay capped at 100").toBeLessThanOrEqual(100);
      }
    }

    // The analytics layer must stay consistent on real soak data, not just
    // on hand-picked inputs.
    for (const row of perSeason) {
      const appeal = economy.commercialProfile(row.clubId)?.merchandiseAppeal ?? 0;
      const split = shirtSalesFromRevenue({
        merchandiseRevenue: row.merchandiseRevenue,
        merchandiseAppeal: appeal,
      });
      expect(split.homeShirtUnits + split.awayShirtUnits + split.thirdShirtUnits).toBe(split.shirtUnits);
      expect(split.shirtUnits).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(split.shirtUnits)).toBe(true);
      expect(split.shirtRevenue).toBeLessThanOrEqual(row.merchandiseRevenue);
    }
  }, SOAK_TIMEOUT);

  it("does not let league merchandise revenue explode between the first and last season", () => {
    const seasonKeys = [...new Set(perSeason.map((row) => row.seasonKey))].sort();
    expect(seasonKeys.length, "the soak should cover more than one season of trade").toBeGreaterThan(1);

    const totalFor = (key: string) =>
      perSeason.filter((row) => row.seasonKey === key).reduce((sum, row) => sum + row.merchandiseRevenue, 0);
    const first = totalFor(seasonKeys[0]!);
    const last = totalFor(seasonKeys[seasonKeys.length - 1]!);
    // Merchandise grows with supporters and appeal, both of which are
    // bounded, so a healthy league should not multiply its merchandise
    // trade by orders of magnitude over a handful of seasons.
    if (first > 0) {
      expect(last / first, "league merchandise revenue must not explode exponentially").toBeLessThan(25);
    }
  }, SOAK_TIMEOUT);

  it("lets AI clubs build retail stores on real need without spamming them", () => {
    // InfrastructureProject already carries its own clubId, so the rows are
    // used as-is rather than re-attaching one.
    const projects = clubIds.flatMap((clubId) => economy.infrastructureProjects(clubId));
    expect(projects.length, "AI clubs should invest in facilities during the soak").toBeGreaterThan(0);

    const retail = projects.filter((project) => project.projectType === "RETAIL_STORE");
    const byClub = new Map<EntityId, number>();
    for (const project of retail) byClub.set(project.clubId, (byClub.get(project.clubId) ?? 0) + 1);

    // The AI chooses at most one project per season and never duplicates an
    // active one, so no club can queue an unbounded pile of stores.
    for (const [clubId, count] of byClub) {
      expect(count, `club ${clubId} should not spam retail projects`).toBeLessThanOrEqual(SEASONS);
    }

    // Retail must be one option among many, never crowding out the other
    // facility types the AI can invest in.
    const types = new Set(projects.map((project) => project.projectType));
    expect(types.size, "AI facility choice should remain varied, not retail-only").toBeGreaterThan(1);
    expect(
      retail.length / projects.length,
      "retail should be one option among many, not the dominant choice",
    ).toBeLessThan(0.8);

    // Completing stores must never push a club past the appeal cap.
    for (const clubId of new Set(retail.map((project) => project.clubId))) {
      expect(economy.commercialProfile(clubId)?.merchandiseAppeal ?? 0).toBeLessThanOrEqual(100);
    }
  }, SOAK_TIMEOUT);

  it("keeps merchandise proportionate to the rest of a club's income", () => {
    let clubsWithMerchandise = 0;
    for (const clubId of clubIds) {
      const entries = economy.ledgerEntries(clubId).filter((entry) => entry.direction === "CREDIT");
      if (entries.length === 0) continue;
      const income = entries.reduce((sum, entry) => sum + entry.amount, 0);
      const merchandise = entries
        .filter((entry) => entry.category === "MERCHANDISE")
        .reduce((sum, entry) => sum + entry.amount, 0);
      if (merchandise <= 0 || income <= 0) continue;
      clubsWithMerchandise += 1;
      // Sanity, not a tuned ratio: a Nepal club's shirt-and-scarf trade
      // should never become the overwhelming majority of its income while
      // matchday, sponsorship and prize money exist alongside it.
      expect(
        merchandise / income,
        `merchandise should not dominate club ${clubId}'s income`,
      ).toBeLessThan(0.75);
    }
    expect(clubsWithMerchandise, "some clubs should have traded merchandise").toBeGreaterThan(0);
  }, SOAK_TIMEOUT);
});
