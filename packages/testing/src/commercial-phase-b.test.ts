import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  acceptCompetitionMediaRights,
  acceptSponsorOffer,
  counterSponsorOffer,
  createNepalSave,
  expireSponsorships,
  generateCompetitionMediaRightsOffer,
  generateSponsorOffers,
  initializeClubEconomyForSave,
  renewSponsorship,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const savePath = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "commercial-phase-b-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: seed, gameVersion: "test", randomSeed: seed });
  return path;
};

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("commercial football world phase B", () => {
  it("generates differentiated sponsor offers and rejects an implausible counter", () => {
    const db = openGameDatabase(savePath("sponsor-negotiation"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "sponsor-negotiation" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    const offers = generateSponsorOffers(db, { clubId: club.id, date: "2026-08-01", seed: "sponsor-negotiation", count: 3 });
    expect(new Set(offers.map((offer) => offer.type)).size).toBeGreaterThan(1);
    expect(offers.every((offer) => offer.expectations && offer.exclusivityGroup)).toBe(true);
    expect(counterSponsorOffer(db, { sponsorshipId: offers[0]!.id, annualValue: offers[0]!.annualValue * 10, date: "2026-08-01", seed: "sponsor-negotiation" }).status).toBe("REJECTED");
    db.close();
  });

  it("persists sponsor renewal and media-rights distribution across reload", () => {
    const path = savePath("rights-negotiation");
    const db = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "rights-negotiation" });
    const economy = new ClubEconomyRepository(db);
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    const offer = generateSponsorOffers(db, { clubId: club.id, date: "2026-08-01", seed: "rights-negotiation", count: 1 })[0]!;
    const active = acceptSponsorOffer(db, offer.id, "2026-08-01");
    expireSponsorships(db, "2028-01-01");
    const renewal = renewSponsorship(db, { sponsorshipId: active.id, date: "2028-01-01", seed: "rights-negotiation" });
    const season = db.prepare("SELECT competition_season_id AS id FROM club_memberships WHERE status = 'ACTIVE' ORDER BY competition_season_id LIMIT 1").get() as { id: EntityId };
    const rights = generateCompetitionMediaRightsOffer(db, { competitionSeasonId: season.id, date: "2026-08-01", seed: "rights-negotiation" });
    acceptCompetitionMediaRights(db, rights.id, "2026-08-01");
    expect(economy.sponsorships(club.id).some((item) => item.id === renewal.id && item.status === "OFFERED")).toBe(true);
    expect(economy.ledgerEntries().some((entry) => entry.category === "BROADCASTING")).toBe(true);
    db.close();
    const reloaded = openGameDatabase(path);
    expect(new ClubEconomyRepository(reloaded).mediaRights(season.id)[0]?.contractStatus).toBe("ACTIVE");
    reloaded.close();
  });
});
