import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  acceptSponsorOffer,
  closeClubFinancialSeason,
  createNepalSave,
  generateSponsorOffers,
  initializeClubEconomyForSave,
  KIT_SUPPLIER_ROYALTY_SHARE,
  postMerchandiseRevenue,
  processClubEconomyMonth,
  runClubAiSeasonPlanning,
  settleSponsorshipPerformanceBonuses,
  SPONSORSHIP_SLOT_ORDER,
} from "@nepal-football-sim/simulation";
import type { EntityId, SponsorshipContract } from "@nepal-football-sim/shared-types";

/**
 * Club Commercial Phase 2 — kit supplier contracts, merchandise royalties
 * and sponsorship performance bonuses.
 *
 * Everything here runs through the EXISTING sponsorship machinery: the same
 * SponsorshipContract, the same offer/accept lifecycle, the same
 * exclusivity check, and the same canonical ledger posting. These tests
 * exist to prove that extending that system did not quietly create a second
 * one, and that the new money is bounded and paid exactly once.
 */

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "club-commercial-partnerships-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: seed,
    gameVersion: "test",
    randomSeed: seed,
  });
  return path;
};

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const worldWithEconomy = (seed: string): { db: GameDatabase; clubId: EntityId } => {
  const db = openGameDatabase(makeSave(seed));
  initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed });
  const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as {
    id: EntityId;
  };
  return { db, clubId: club.id };
};

const merchandiseLedger = (db: GameDatabase, clubId: EntityId) =>
  new ClubEconomyRepository(db)
    .ledgerEntries(clubId)
    .filter((entry) => entry.category === "MERCHANDISE" && entry.direction === "CREDIT");

const sponsorshipLedger = (db: GameDatabase, clubId: EntityId, description: string) =>
  new ClubEconomyRepository(db)
    .ledgerEntries(clubId)
    .filter((entry) => entry.category === "SPONSORSHIP" && entry.description === description);

/** Signs a real KIT_SUPPLIER deal through the canonical offer lifecycle. */
const signKitSupplier = (db: GameDatabase, clubId: EntityId, date: string): SponsorshipContract => {
  const economy = new ClubEconomyRepository(db);
  // Fill every other slot first so the supplier slot is the open one the
  // generator proposes — the same path a club follows in a real world.
  for (let attempt = 0; attempt < SPONSORSHIP_SLOT_ORDER.length * 2; attempt += 1) {
    const held = economy
      .sponsorships(clubId)
      .filter((item) => item.status === "ACTIVE")
      .map((item) => item.type);
    if (held.includes("KIT_SUPPLIER")) break;
    const offers = generateSponsorOffers(db, { clubId, date, seed: `supplier:${attempt}`, count: 1 });
    const offer = offers[0];
    if (!offer) break;
    acceptSponsorOffer(db, offer.id, date);
  }
  const supplier = economy
    .sponsorships(clubId)
    .find((item) => item.type === "KIT_SUPPLIER" && item.status === "ACTIVE");
  if (!supplier) throw new Error("failed to sign a kit supplier through the canonical lifecycle");
  return supplier;
};

describe("club commercial partnerships — kit supply as a canonical sponsorship slot", () => {
  it("offers KIT_SUPPLIER as a real slot that flows through the existing contract lifecycle", () => {
    const { db, clubId } = worldWithEconomy("kit-supplier-lifecycle");
    const supplier = signKitSupplier(db, clubId, "2026-08-01");

    expect(supplier.type).toBe("KIT_SUPPLIER");
    expect(supplier.status).toBe("ACTIVE");
    expect(supplier.annualValue).toBeGreaterThan(0);
    // Supply deals run longer than the minor slots.
    expect(Number(supplier.endDate.slice(0, 4)) - Number(supplier.startDate.slice(0, 4))).toBe(2);
    // It is a sponsorship row like any other — not a parallel contract store.
    expect(supplier.provenanceStatus).toBe("SIMULATION_ONLY");
    expect(supplier.exclusivityGroup).toBe("KIT_SUPPLIER");
    db.close();
  });

  it("never hands a club a free kit supplier at world creation", () => {
    const { db, clubId } = worldWithEconomy("kit-supplier-baseline");
    const economy = new ClubEconomyRepository(db);
    const active = economy.sponsorships(clubId).filter((item) => item.status === "ACTIVE");

    expect(active.length, "world creation seeds exactly one baseline deal").toBe(1);
    expect(active[0]!.type, "the baseline deal is the shirt front, not kit supply").toBe("SHIRT_MAIN");
    expect(
      active.some((item) => item.type === "KIT_SUPPLIER"),
      "a club must go to market for a supplier like any other deal",
    ).toBe(false);
    db.close();
  });

  it("refuses a second active kit supplier for the same club", () => {
    const { db, clubId } = worldWithEconomy("kit-supplier-exclusive");
    signKitSupplier(db, clubId, "2026-08-01");

    // Forge a second supplier offer directly and try to activate it: the
    // canonical exclusivity check must reject it.
    const economy = new ClubEconomyRepository(db);
    const existing = economy
      .sponsorships(clubId)
      .find((item) => item.type === "KIT_SUPPLIER" && item.status === "ACTIVE")!;
    const rival: SponsorshipContract = {
      ...existing,
      id: "rival-kit-supplier" as EntityId,
      status: "OFFERED",
    };
    economy.upsertSponsorship(rival);

    expect(() => acceptSponsorOffer(db, rival.id, "2026-09-01")).toThrow(/already exists/i);
    expect(
      economy
        .sponsorships(clubId)
        .filter((item) => item.type === "KIT_SUPPLIER" && item.status === "ACTIVE"),
      "exactly one supplier stays active",
    ).toHaveLength(1);
    db.close();
  });
});

describe("club commercial partnerships — merchandise royalty", () => {
  it("pays a bounded royalty on the merchandise the club really sold, once per month", () => {
    const { db, clubId } = worldWithEconomy("kit-royalty");
    signKitSupplier(db, clubId, "2026-08-01");

    processClubEconomyMonth(db, { date: "2026-09-28", seed: "kit-royalty" });
    const royalties = sponsorshipLedger(db, clubId, "Kit supplier merchandise royalty");
    expect(royalties.length, "a supplier pays a royalty for the month").toBe(1);

    const merchandise = merchandiseLedger(db, clubId).filter((entry) => entry.date === "2026-09-28");
    expect(merchandise.length).toBe(1);
    const expected = Math.round(merchandise[0]!.amount * KIT_SUPPLIER_ROYALTY_SHARE);
    expect(royalties[0]!.amount).toBe(expected);
    // Bounded: a royalty can never rival the trade it is a share of.
    expect(royalties[0]!.amount).toBeLessThan(merchandise[0]!.amount);
    expect(KIT_SUPPLIER_ROYALTY_SHARE).toBeGreaterThan(0);
    expect(KIT_SUPPLIER_ROYALTY_SHARE).toBeLessThan(0.25);

    // Replaying the same month must not pay twice — the ledger row id is
    // derived from the idempotency key.
    processClubEconomyMonth(db, { date: "2026-09-28", seed: "kit-royalty" });
    expect(
      sponsorshipLedger(db, clubId, "Kit supplier merchandise royalty"),
      "a replayed tick must not pay the royalty again",
    ).toHaveLength(1);
    db.close();
  });

  it("pays no royalty to a club with no kit supplier", () => {
    const { db, clubId } = worldWithEconomy("kit-royalty-absent");
    processClubEconomyMonth(db, { date: "2026-09-28", seed: "kit-royalty-absent" });

    expect(merchandiseLedger(db, clubId).length, "the club still trades merchandise").toBeGreaterThan(0);
    expect(
      sponsorshipLedger(db, clubId, "Kit supplier merchandise royalty"),
      "no supplier, no royalty",
    ).toHaveLength(0);
    db.close();
  });
});

describe("club commercial partnerships — performance bonuses", () => {
  /** Records a real league title for the club, the way season finalisation does. */
  const crownChampion = (db: GameDatabase, clubId: EntityId, decidedOn: string): void => {
    const team = db.prepare("SELECT id FROM teams WHERE club_id = ? LIMIT 1").get(clubId) as {
      id: EntityId;
    };
    const season = db.prepare("SELECT id FROM competition_seasons LIMIT 1").get() as { id: EntityId };
    db.prepare(
      "INSERT OR IGNORE INTO competition_winners (id, competition_season_id, team_id, decided_on) VALUES (?, ?, ?, ?)",
    ).run(`winner-${clubId}-${decidedOn}`, season.id, team.id, decidedOn);
  };

  it("pays a champion bonus exactly once, even when the season is closed again", () => {
    const { db, clubId } = worldWithEconomy("bonus-champion");
    const economy = new ClubEconomyRepository(db);
    const contract = economy.sponsorships(clubId).find((item) => item.status === "ACTIVE")!;
    expect(contract.bonuses.champion, "offers advertise a champion bonus").toBeGreaterThan(0);

    crownChampion(db, clubId, "2027-05-30");
    const paid = settleSponsorshipPerformanceBonuses(db, {
      clubId,
      seasonLabel: "2027",
      date: "2027-06-30",
    });
    expect(paid, "a title pays the advertised bonus").toBeGreaterThan(0);

    const bonuses = sponsorshipLedger(db, clubId, "Sponsorship champion bonus");
    expect(bonuses).toHaveLength(1);
    expect(bonuses[0]!.amount).toBe(Math.round(contract.bonuses.champion!));

    // Re-closing the same season must not pay it again.
    settleSponsorshipPerformanceBonuses(db, { clubId, seasonLabel: "2027", date: "2027-06-30" });
    closeClubFinancialSeason(db, { seasonLabel: "2027", date: "2027-06-30" });
    expect(
      sponsorshipLedger(db, clubId, "Sponsorship champion bonus"),
      "a bonus is earned once per season, however often the books are closed",
    ).toHaveLength(1);
    db.close();
  });

  it("pays a promotion bonus off a real competition movement", () => {
    const { db, clubId } = worldWithEconomy("bonus-promotion");
    const economy = new ClubEconomyRepository(db);
    const contract = economy.sponsorships(clubId).find((item) => item.status === "ACTIVE")!;
    expect(contract.bonuses.promotion, "offers advertise a promotion bonus").toBeGreaterThan(0);

    const season = db.prepare("SELECT id, end_date FROM competition_seasons LIMIT 1").get() as {
      id: EntityId;
      end_date: string;
    };
    const competition = db.prepare("SELECT competition_id FROM competition_seasons WHERE id = ?").get(
      season.id,
    ) as { competition_id: EntityId };
    const seasonLabel = String(season.end_date).slice(0, 4);
    db.prepare(
      `INSERT OR IGNORE INTO competition_movements
        (id, club_id, team_id, from_competition_id, to_competition_id,
         from_competition_season_id, to_competition_season_id, movement_type, status, reason)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 'PROMOTED', 'CONFIRMED', NULL)`,
    ).run(
      `movement-${clubId}`,
      clubId,
      competition.competition_id,
      competition.competition_id,
      season.id,
      season.id,
    );

    settleSponsorshipPerformanceBonuses(db, { clubId, seasonLabel, date: `${seasonLabel}-06-30` });
    const bonuses = sponsorshipLedger(db, clubId, "Sponsorship promotion bonus");
    expect(
      bonuses,
      "a stored PROMOTED movement must actually pay the advertised promotion bonus",
    ).toHaveLength(1);
    expect(bonuses[0]!.amount).toBe(Math.round(contract.bonuses.promotion!));
    db.close();
  });

  it("pays nothing to a club that neither won nor went up", () => {
    const { db, clubId } = worldWithEconomy("bonus-none");
    const paid = settleSponsorshipPerformanceBonuses(db, {
      clubId,
      seasonLabel: "2027",
      date: "2027-06-30",
    });
    expect(paid).toBe(0);
    expect(sponsorshipLedger(db, clubId, "Sponsorship champion bonus")).toHaveLength(0);
    expect(sponsorshipLedger(db, clubId, "Sponsorship promotion bonus")).toHaveLength(0);
    db.close();
  });
});

describe("club commercial partnerships — AI participation", () => {
  it("lets AI clubs reach the kit supply slot through the same canonical planner", () => {
    const { db } = worldWithEconomy("ai-kit-supplier");
    /*
     * The AI season planner only runs on the world's August planning date and
     * fills one open slot per run, so repeated runs let clubs work through
     * their open slots exactly as they do across real seasons. Nothing here
     * signs a deal directly — if AI clubs can hold a supplier, it is because
     * the canonical generate/rank/accept path reached the new slot on its own.
     */
    for (let run = 0; run < 7; run += 1) {
      runClubAiSeasonPlanning(db, { date: "2026-08-28", seed: "ai-kit-supplier" });
    }

    const suppliers = new ClubEconomyRepository(db)
      .sponsorships()
      .filter((item) => item.type === "KIT_SUPPLIER" && item.status === "ACTIVE");
    expect(
      suppliers.length,
      "AI clubs must be able to sign a kit supplier, not just the human player",
    ).toBeGreaterThan(0);

    // Exclusivity still holds for AI clubs: never two suppliers for one club.
    const byClub = new Map<EntityId, number>();
    for (const supplier of suppliers) {
      byClub.set(supplier.clubId, (byClub.get(supplier.clubId) ?? 0) + 1);
    }
    for (const [clubId, count] of byClub) {
      expect(count, `club ${clubId} must hold at most one kit supplier`).toBe(1);
    }
    db.close();
  }, 300_000);
});
