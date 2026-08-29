import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, ClubNetworkRepository, GlobalFootballContextRepository, openGameDatabase } from "@nepal-football-sim/database";
import { activateClubPartnership, commercialPartnershipIncome, createClubPartnership, createNepalSave, createSeasonMembership, initializeClubEconomyForSave, initializeForeignFootballWorldForSave, postMatchdayEconomy, postMerchandiseRevenue, processClubEconomyMonth, runPreseasonCommercialCamp, setClubTicketPrice } from "@nepal-football-sim/simulation";
import type { EntityId, FixtureRecord } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "commercial-phase-c-")); dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: seed, gameVersion: "test", randomSeed: seed });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("commercial football world phase C", () => {
  it("makes higher prices reduce deterministic match demand", () => {
    const cheap = openGameDatabase(makeSave("ticket-cheap"));
    const expensive = openGameDatabase(makeSave("ticket-expensive"));
    initializeClubEconomyForSave({ db: cheap, worldDate: "2026-08-01", seed: "ticket" });
    initializeClubEconomyForSave({ db: expensive, worldDate: "2026-08-01", seed: "ticket" });
    const teams = cheap.prepare("SELECT id FROM teams WHERE level = 'senior' ORDER BY id LIMIT 2").all() as Array<{ id: EntityId }>;
    const fixture: FixtureRecord = { id: "fixture:commercial-price" as EntityId, homeTeamId: teams[0]!.id, awayTeamId: teams[1]!.id, scheduledDate: "2026-08-02", status: "scheduled", round: 1 };
    const club = cheap.prepare("SELECT club_id FROM teams WHERE id = ?").get(fixture.homeTeamId) as { club_id: EntityId };
    setClubTicketPrice(cheap, club.club_id, 150); setClubTicketPrice(expensive, club.club_id, 600);
    const cheapMatch = postMatchdayEconomy(cheap, fixture, "2026-08-02", "ticket")!;
    const expensiveMatch = postMatchdayEconomy(expensive, fixture, "2026-08-02", "ticket")!;
    expect(cheapMatch.attendance).toBeGreaterThan(expensiveMatch.attendance);
    cheap.close(); expensive.close();
  });

  it("persists memberships, merchandise, supporter growth and preseason trade-offs", () => {
    const path = makeSave("commercial-growth"); const db = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "commercial-growth" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    const membership = createSeasonMembership(db, { clubId: club.id, seasonLabel: "2026", price: 3000 });
    const merchandise = postMerchandiseRevenue(db, { clubId: club.id, date: "2026-08-03", seed: "commercial-growth" });
    const camp = runPreseasonCommercialCamp(db, { clubId: club.id, destination: "Pokhara", startDate: "2026-07-01", endDate: "2026-07-10", seed: "commercial-growth" });
    const economy = new ClubEconomyRepository(db);
    expect(membership.revenue).toBeGreaterThan(0); expect(merchandise).toBeGreaterThan(0); expect(camp.cost).toBeGreaterThan(0);
    expect(economy.commercialHistory(club.id).length).toBe(3); expect(economy.commercialCamps(club.id)[0]?.destination).toBe("Pokhara");
    db.close(); const reloaded = openGameDatabase(path);
    expect(new ClubEconomyRepository(reloaded).seasonMemberships(club.id)[0]?.id).toBe(membership.id); reloaded.close();
  });

  it("settles active commercial partnerships once, directionally, and within a bounded cap", () => {
    const path = makeSave("commercial-partnership"); const db = openGameDatabase(path);
    initializeForeignFootballWorldForSave({ db, worldDate: "2026-08-01", seed: "commercial-partnership" });
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "commercial-partnership" });
    const home = db.prepare("SELECT c.id FROM clubs c JOIN countries country ON country.id = c.country_id WHERE country.iso_code = 'NP' ORDER BY c.id LIMIT 1").get() as { id: EntityId };
    const external = new GlobalFootballContextRepository(db).clubs()[0]!;
    const network = new ClubNetworkRepository(db);
    expect(network.activeCommercialPartnerships(home.id, "2026-08-01")).toEqual([]);
    expect(commercialPartnershipIncome(db, home.id, "2026-08-01").amount).toBe(0);
    const proposal = createClubPartnership(db, { fromClubId: home.id, toClubId: external.clubId, partnershipType: "COMMERCIAL", relationshipStrength: 0, startDate: "2026-08-01" });
    activateClubPartnership(db, proposal.id, { date: "2026-08-01", eligibility: { eligible: true, score: 80 } });
    expect(network.activeCommercialPartnerships(home.id, "2026-08-01")).toHaveLength(1);
    expect(network.activeCommercialPartnerships(external.clubId, "2026-08-01")).toEqual([]);
    expect(external.simulationDepth).toBe("CONTEXT_ONLY");
    const settlement = commercialPartnershipIncome(db, home.id, "2026-08-01");
    expect(settlement.amount).toBeGreaterThan(0);
    expect(settlement.amount).toBeLessThanOrEqual(Math.round(settlement.baseCommercialValue * 0.08));
    processClubEconomyMonth(db, { date: "2026-08-01", seed: "commercial-partnership" });
    processClubEconomyMonth(db, { date: "2026-08-01", seed: "commercial-partnership" });
    const economy = new ClubEconomyRepository(db);
    const entries = economy.ledgerEntries(home.id).filter((entry) => entry.category === "COMMERCIAL_PARTNERSHIP_INCOME");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.amount).toBe(settlement.amount);
    expect(economy.ledgerEntries(external.clubId).filter((entry) => entry.category === "COMMERCIAL_PARTNERSHIP_INCOME")).toEqual([]);
    db.prepare("UPDATE international_club_partnerships SET status='SUSPENDED' WHERE id=?").run(proposal.id);
    expect(network.activeCommercialPartnerships(home.id, "2026-08-02")).toEqual([]);
    expect(commercialPartnershipIncome(db, home.id, "2026-08-02").amount).toBe(0);
    db.close(); const reloaded = openGameDatabase(path);
    expect(new ClubEconomyRepository(reloaded).ledgerEntries(home.id).filter((entry) => entry.category === "COMMERCIAL_PARTNERSHIP_INCOME")).toHaveLength(1);
    reloaded.close();
  });
});
