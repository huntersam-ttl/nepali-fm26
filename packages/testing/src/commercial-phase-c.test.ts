import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, createSeasonMembership, initializeClubEconomyForSave, postMatchdayEconomy, postMerchandiseRevenue, runPreseasonCommercialCamp, setClubTicketPrice } from "@nepal-football-sim/simulation";
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
});
