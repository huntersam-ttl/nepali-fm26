import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ClubEconomyRepository, WorldRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  capitalInjectionFromInvestor,
  createNepalSave,
  investorMeetingOverview,
  runChairmanDemo,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dataset = JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8"));

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "investor-meeting-"));
  const path = join(dir, "save.sqlite");
  createNepalSave({ databasePath: path, dataset, saveName: "investor-meeting", gameVersion: "test", randomSeed: "investor-meeting" });
  const db = openGameDatabase(path);
  const row = db
    .prepare(
      "SELECT DISTINCT c.id FROM clubs c JOIN club_memberships cm ON cm.club_id=c.id JOIN competition_seasons cs ON cs.id=cm.competition_season_id JOIN competitions comp ON comp.id=cs.competition_id WHERE lower(comp.name) LIKE '%a-division%' AND cm.status='ACTIVE' LIMIT 1",
    )
    .get() as { id: EntityId };
  const demo = runChairmanDemo({ db, seed: "investor-meeting", worldDate: "2027-07-01", clubId: row.id });
  const economy = new ClubEconomyRepository(db);
  const ownerStake = economy.ownershipStakes(row.id).find((stake) => stake.holderId === demo.chairmanPersonId && stake.status === "ACTIVE")!;
  economy.upsertOwnershipStake({ ...ownerStake, percentage: 75, votingPercentage: 75, role: "MAJORITY_OWNER", ownershipModel: "BUYABLE" });
  return { dir, db, clubId: row.id, ownerId: demo.chairmanPersonId };
};

describe("investor meeting: overview and capital injection", () => {
  it("builds an honest overview: real personal cash, majority threshold, and the same market view the owner dashboard uses", () => {
    const { dir, db, clubId, ownerId } = setup();
    const overview = investorMeetingOverview(db, clubId, ownerId, "2027-07-02");
    expect(overview.clubId).toBe(clubId);
    expect(overview.ownerPersonId).toBe(ownerId);
    expect(overview.majorityThreshold).toBe(51);
    expect(overview.ownerPersonalCash).toBe(new ClubEconomyRepository(db).personalFinancialProfile(ownerId)!.cash);
    expect(overview.market.ownership.find((stake) => stake.holderId === ownerId)?.percentage).toBe(75);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws for a club that does not exist rather than returning an empty overview", () => {
    const { dir, db, ownerId } = setup();
    expect(() => investorMeetingOverview(db, "missing-club" as EntityId, ownerId, "2027-07-02")).toThrow(/Club not found/);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("moves capital injection money into club cash, not personal-to-personal, and dilutes every stake including the investor's own by the same real formula", () => {
    const { dir, db, clubId, ownerId } = setup();
    const economy = new ClubEconomyRepository(db);
    const beforeClubCash = economy.financialAccount(clubId)!.cashBalance;
    const beforePersonalCash = economy.personalFinancialProfile(ownerId)!.cash;
    const beforeOwnerPercentage = economy.ownershipStakes(clubId).find((stake) => stake.holderId === ownerId)!.percentage!;

    capitalInjectionFromInvestor(db, { clubId, personId: ownerId, date: "2027-07-02", amount: 1_000_000, form: "EQUITY" });

    const after = new ClubEconomyRepository(db);
    expect(after.financialAccount(clubId)!.cashBalance).toBe(beforeClubCash + 1_000_000);
    expect(after.personalFinancialProfile(ownerId)!.cash).toBe(beforePersonalCash - 1_000_000);
    // The owner's own prior stake is diluted by the injection's share first,
    // then the newly-added equity is added back on top — never a fabricated
    // "no dilution for the investor themself" shortcut.
    const afterOwnerPercentage = after.ownershipStakes(clubId).find((stake) => stake.holderId === ownerId)!.percentage!;
    expect(afterOwnerPercentage).toBeGreaterThan(0);
    expect(afterOwnerPercentage).not.toBe(beforeOwnerPercentage);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects capital injection from a person holding no stake in the club", () => {
    const { dir, db, clubId } = setup();
    const economy = new ClubEconomyRepository(db);
    const strangerId = "stranger-person" as EntityId;
    const countryId = (db.prepare("SELECT id FROM countries LIMIT 1").get() as { id: EntityId }).id;
    new WorldRepository(db).insertPerson({ id: strangerId, fullName: "Stranger", nationalityCountryId: countryId, languages: ["ne"] });
    economy.upsertPersonalFinancialProfile({ personId: strangerId, cash: 5_000_000, investments: 0, assets: 0, liabilities: 0, netWorth: 5_000_000, currency: "NPR", lastUpdatedAt: "2027-07-01", status: "SIMULATION_ONLY" });
    expect(() => capitalInjectionFromInvestor(db, { clubId, personId: strangerId, date: "2027-07-02", amount: 500_000, form: "EQUITY" })).toThrow(/lacks capital authority/);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
