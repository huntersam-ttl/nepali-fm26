import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ClubEconomyRepository, OwnershipInvestorRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, createInvestorProfile, initializeClubEconomyForSave, reviewInvestorConfidence, runChairmanDemo } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

describe("ownership phase B", () => {
  it("persists deterministic investor confidence while keeping personal and club cash separate", () => {
    const dir = mkdtempSync(join(tmpdir(), "ownership-phase-b-"));
    const path = join(dir, "save.sqlite");
    createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8")), saveName: "ownership", gameVersion: "test", randomSeed: "ownership" });
    const db = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2027-07-01", seed: "ownership" });
    const club = db.prepare("SELECT id FROM clubs WHERE name='New Road Team'").get() as { id: EntityId };
    const demo = runChairmanDemo({ db, seed: "ownership", worldDate: "2027-07-01", clubId: club.id });
    const before = new ClubEconomyRepository(db).personalFinancialProfile(demo.chairmanPersonId)!.cash;
    createInvestorProfile(db, { clubId: club.id, personId: demo.chairmanPersonId, date: "2027-07-01", expectations: { FINANCIAL_RETURN: 0.2 } });
    const first = reviewInvestorConfidence(db, { clubId: club.id, date: "2028-07-01" });
    const second = reviewInvestorConfidence(db, { clubId: club.id, date: "2028-07-01" });
    expect(second[0]?.expectations).toEqual(first[0]?.expectations);
    expect(new ClubEconomyRepository(db).personalFinancialProfile(demo.chairmanPersonId)!.cash).toBe(before);
    expect(new OwnershipInvestorRepository(db).profile(club.id, demo.chairmanPersonId)?.status).toBe("ACTIVE");
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
