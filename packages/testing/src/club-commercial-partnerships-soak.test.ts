import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, simulateNepalCareer, SPONSORSHIP_SLOT_ORDER } from "@nepal-football-sim/simulation";
import type { ClubLedgerEntry, EntityId, SponsorshipContract } from "@nepal-football-sim/shared-types";

/**
 * Club Commercial Phase 2 — multi-season soak for the partnership economy.
 *
 * Runs the canonical whole-world career simulation with the economy enabled
 * and then audits every club's commercial contracts, AI included. Nothing
 * here signs, pays or expires a deal directly: the point is to observe what
 * the real systems do when left alone for several seasons, and to catch
 * runaway contract inflation, duplicated exclusive slots, deals that keep
 * paying after they expire, and bonuses that post more than once.
 *
 * One simulation is shared across every assertion — a season of the full
 * world costs minutes, so a world per test would multiply the cost to
 * re-observe identical state.
 */

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const SEASONS = Number(process.env.PARTNERSHIP_SOAK_SEASONS ?? "5");
const SOAK_TIMEOUT = 2_700_000;

let db: GameDatabase;
let directory: string;
let economy: ClubEconomyRepository;
let contracts: SponsorshipContract[];
let sponsorshipEntries: ClubLedgerEntry[];

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "partnership-soak-"));
  const path = join(directory, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: "partnership-soak",
    gameVersion: "test",
    randomSeed: "partnership-soak",
  });
  db = openGameDatabase(path);
  simulateNepalCareer({ db, seasons: SEASONS, seed: "partnership-soak", economyEnabled: true });

  economy = new ClubEconomyRepository(db);
  contracts = economy.sponsorships();
  const clubIds = [...new Set(contracts.map((contract) => contract.clubId))];
  sponsorshipEntries = clubIds.flatMap((clubId) =>
    economy.ledgerEntries(clubId).filter((entry) => entry.category === "SPONSORSHIP"),
  );
}, SOAK_TIMEOUT);

afterAll(() => {
  db?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe(`club commercial partnerships soak — ${SEASONS} simulated seasons`, () => {
  it("keeps every contract value finite, positive and free of runaway inflation", () => {
    expect(contracts.length, "the commercial system should have traded during the soak").toBeGreaterThan(0);

    for (const contract of contracts) {
      expect(Number.isFinite(contract.annualValue), "contract value must be finite").toBe(true);
      expect(Number.isNaN(contract.annualValue)).toBe(false);
      expect(contract.annualValue, "a contract is never worth nothing or less").toBeGreaterThan(0);
    }

    // Deals are worth more as clubs grow, but sponsor budget tiers and the
    // macro economy both bound that — a league should not multiply its
    // commercial values by orders of magnitude over a handful of seasons.
    const bySeason = new Map<string, number[]>();
    for (const contract of contracts) {
      const season = contract.startDate.slice(0, 4);
      bySeason.set(season, [...(bySeason.get(season) ?? []), contract.annualValue]);
    }
    const seasons = [...bySeason.keys()].sort();
    if (seasons.length >= 2) {
      const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
      const first = mean(bySeason.get(seasons[0]!)!);
      const last = mean(bySeason.get(seasons[seasons.length - 1]!)!);
      if (first > 0) {
        expect(last / first, "sponsorship values must not inflate exponentially").toBeLessThan(25);
      }
    }
  }, SOAK_TIMEOUT);

  it("never lets a club hold two conflicting exclusive deals, or more than the available slots", () => {
    const clubIds = [...new Set(contracts.map((contract) => contract.clubId))];
    for (const clubId of clubIds) {
      const active = contracts.filter(
        (contract) => contract.clubId === clubId && contract.status === "ACTIVE",
      );
      expect(
        active.length,
        `club ${clubId} must never exceed the canonical slot count`,
      ).toBeLessThanOrEqual(SPONSORSHIP_SLOT_ORDER.length);

      const groups = active
        .map((contract) => contract.exclusivityGroup)
        .filter((group): group is string => Boolean(group));
      expect(new Set(groups).size, `club ${clubId} must not duplicate an exclusivity slot`).toBe(
        groups.length,
      );

      // At most one kit supplier, ever — the slot this phase added.
      expect(
        active.filter((contract) => contract.type === "KIT_SUPPLIER").length,
        `club ${clubId} must hold at most one kit supplier`,
      ).toBeLessThanOrEqual(1);
    }
  }, SOAK_TIMEOUT);

  it("stops paying a deal once it has expired", () => {
    const expired = contracts.filter((contract) => contract.status === "EXPIRED");
    if (expired.length === 0) return; // nothing expired within the soak window

    for (const contract of expired) {
      const paymentsAfterExpiry = sponsorshipEntries.filter(
        (entry) =>
          entry.relatedEntityId === contract.id &&
          entry.description === "Monthly sponsorship payment" &&
          entry.date > contract.endDate,
      );
      expect(
        paymentsAfterExpiry,
        `expired contract ${contract.id} must stop paying after ${contract.endDate}`,
      ).toHaveLength(0);
    }
  }, SOAK_TIMEOUT);

  it("never posts a performance bonus or a royalty twice for the same period", () => {
    // Bonuses are settled once per contract per season; royalties once per
    // contract per month. Both are keyed by idempotency, so a duplicate here
    // would mean the key no longer distinguishes the period.
    const seen = new Map<string, number>();
    for (const entry of sponsorshipEntries) {
      if (!entry.description.startsWith("Sponsorship ") && entry.description !== "Kit supplier merchandise royalty") {
        continue;
      }
      const period = entry.description === "Kit supplier merchandise royalty" ? entry.date : entry.date.slice(0, 4);
      const key = `${entry.relatedEntityId}:${entry.description}:${period}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const duplicated = [...seen.entries()].filter(([, count]) => count > 1);
    expect(duplicated, "no bonus or royalty may post twice for one period").toEqual([]);
  }, SOAK_TIMEOUT);

  it("keeps sponsorship proportionate to the rest of a club's income", () => {
    const clubIds = [...new Set(contracts.map((contract) => contract.clubId))];
    let clubsWithIncome = 0;
    const ratios: Array<{ clubId: EntityId; ratio: number; breakdown: string; total: number }> = [];

    for (const clubId of clubIds) {
      const credits = economy.ledgerEntries(clubId).filter((entry) => entry.direction === "CREDIT");
      if (credits.length === 0) continue;
      const total = credits.reduce((sum, entry) => sum + entry.amount, 0);
      const byCategory = new Map<string, number>();
      for (const entry of credits) {
        byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + entry.amount);
      }
      const sponsorship = byCategory.get("SPONSORSHIP") ?? 0;
      if (total <= 0 || sponsorship <= 0) continue;
      clubsWithIncome += 1;
      ratios.push({
        clubId,
        ratio: sponsorship / total,
        total,
        breakdown: [...byCategory.entries()]
          .sort((left, right) => right[1] - left[1])
          .map(([category, amount]) => `${category}=${Math.round((amount / total) * 100)}%`)
          .join(" "),
      });
    }

    expect(clubsWithIncome, "some clubs should have commercial income").toBeGreaterThan(0);

    /*
     * Measure the right population.
     *
     * processClubEconomyMonth pays sponsorship and merchandise to EVERY club
     * holding a financial account — including foreign and context clubs that
     * never play a Nepal fixture and therefore can never earn matchday or
     * prize money. Their sponsorship share is ~100% by construction, so
     * averaging them in measures the harness's club population rather than
     * the economy's balance, and any bound drawn from it would be fitted to
     * that artefact instead of guarding anything.
     *
     * The meaningful question is about clubs that actually play: for them,
     * matchday and merchandise are real income lines, so sponsorship should
     * not be substantially their whole economy. Both populations are logged
     * on every run so the figures can be judged directly rather than
     * inferred from whether the suite happened to pass.
     */
    const report = (label: string, rows: typeof ratios): void => {
      if (rows.length === 0) {
        console.log(`[soak] ${label}: none`);
        return;
      }
      const sorted = [...rows].sort((left, right) => left.ratio - right.ratio);
      const worstRow = sorted[sorted.length - 1]!;
      const medianRow = sorted[Math.floor(sorted.length / 2)]!;
      console.log(
        `[soak] ${label}: ${rows.length} clubs · median ${(medianRow.ratio * 100).toFixed(1)}% · ` +
          `worst ${(worstRow.ratio * 100).toFixed(1)}% of NPR ` +
          `${Math.round(worstRow.total).toLocaleString("en-US")} — ${worstRow.breakdown}`,
      );
    };

    const competing = ratios.filter((row) => row.breakdown.includes("MATCHDAY_REVENUE"));
    const nonCompeting = ratios.filter((row) => !row.breakdown.includes("MATCHDAY_REVENUE"));
    report("clubs that actually played", competing);
    report("clubs with no fixtures (account-only)", nonCompeting);

    expect(
      competing.length,
      "the soak must contain clubs that actually played, or this measures nothing",
    ).toBeGreaterThan(0);

    const worst = [...competing].sort((left, right) => right.ratio - left.ratio)[0]!;
    expect(
      worst.ratio,
      `a club that plays league football should have a real matchday/merchandise economy ` +
        `alongside its deals — worst competing club ${worst.clubId} at ` +
        `${(worst.ratio * 100).toFixed(1)}% of NPR ${Math.round(worst.total).toLocaleString("en-US")}; ` +
        `breakdown: ${worst.breakdown}`,
    ).toBeLessThan(0.9);
  }, SOAK_TIMEOUT);
});
