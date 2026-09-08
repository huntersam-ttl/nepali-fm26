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

  it("keeps sponsor counters in negotiation until the sponsor accepts", () => {
    const db = openGameDatabase(savePath("bounded-sponsor-counter"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "bounded-sponsor-counter" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    const offer = generateSponsorOffers(db, { clubId: club.id, date: "2026-08-01", seed: "bounded-sponsor-counter", count: 1 })[0]!;
    const ledgerBefore = new ClubEconomyRepository(db).ledgerEntries().filter((entry) => entry.relatedEntityId === offer.id).length;
    const countered = counterSponsorOffer(db, { sponsorshipId: offer.id, annualValue: Math.round(offer.annualValue * 1.06), date: "2026-08-02", seed: "bounded-sponsor-counter" });
    expect(countered.status).toBe("COUNTERED");
    expect(countered.counterpartyResponse).toBe("COUNTERED");
    expect(countered.negotiationRound).toBe(1);
    expect(new ClubEconomyRepository(db).ledgerEntries().filter((entry) => entry.relatedEntityId === offer.id)).toHaveLength(ledgerBefore);
    const accepted = counterSponsorOffer(db, { sponsorshipId: offer.id, annualValue: Math.round(countered.annualValue * 1.01), date: "2026-08-03", seed: "bounded-sponsor-counter" });
    expect(accepted.status).toBe("ACTIVE");
    expect(accepted.counterpartyResponse).toBe("ACCEPTED");
    expect(new ClubEconomyRepository(db).ledgerEntries().filter((entry) => entry.relatedEntityId === offer.id)).toHaveLength(ledgerBefore + 1);
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

  /**
   * A club can hold up to four concurrent sponsors, one per exclusivity slot
   * (shirt main, official partner, sleeve, local partner). `generateSponsorOffers`
   * used to always fill index 0 as SHIRT_MAIN regardless of what the club
   * already held, so once a club's real shirt sponsor was active, every
   * subsequent generated offer collided with it (rejected by
   * `acceptSponsorOffer`'s exclusivity check) and every OTHER slot stayed
   * permanently empty — the commercial pipeline could never diversify past
   * the club's first sponsor. Offers must now target only genuinely open
   * slots, and never re-propose a slot that's already active.
   */
  it("only proposes sponsorship slots the club doesn't already hold", () => {
    const db = openGameDatabase(savePath("sponsor-open-slots"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "sponsor-open-slots" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as {
      id: EntityId;
    };
    const economy = new ClubEconomyRepository(db);
    // The world seeds every club with one baseline sponsor at creation — the
    // fresh test club may already hold a slot before this test does anything.
    const heldFromStart = new Set(
      economy.sponsorships(club.id).filter((item) => item.status === "ACTIVE").map((item) => item.type),
    );
    const first = generateSponsorOffers(db, {
      clubId: club.id,
      date: "2026-08-01",
      seed: "sponsor-open-slots",
      count: 1,
    })[0]!;
    expect(heldFromStart.has(first.type)).toBe(false);
    acceptSponsorOffer(db, first.id, "2026-08-01");

    // With that slot now held too, a further offer must target yet another one.
    const second = generateSponsorOffers(db, {
      clubId: club.id,
      date: "2026-08-02",
      seed: "sponsor-open-slots",
      count: 1,
    })[0]!;
    expect(second.type).not.toBe(first.type);
    expect(heldFromStart.has(second.type)).toBe(false);

    // Once every slot is genuinely filled, no further offer is proposed.
    acceptSponsorOffer(db, second.id, "2026-08-02");
    const filled = new Set([...heldFromStart, first.type, second.type]);
    const remaining = (["SHIRT_MAIN", "OFFICIAL_PARTNER", "SLEEVE", "LOCAL_PARTNER"] as const).filter(
      (type) => !filled.has(type),
    );
    for (const _ of remaining) {
      const next = generateSponsorOffers(db, {
        clubId: club.id,
        date: "2026-08-03",
        seed: "sponsor-open-slots",
        count: 1,
      })[0];
      if (next) acceptSponsorOffer(db, next.id, "2026-08-03");
    }
    const fullyStocked = generateSponsorOffers(db, {
      clubId: club.id,
      date: "2026-08-04",
      seed: "sponsor-open-slots",
      count: 1,
    });
    expect(fullyStocked).toHaveLength(0);
    expect(new Set(economy.sponsorships(club.id).filter((item) => item.status === "ACTIVE").map((item) => item.type)).size).toBe(4);
    db.close();
  });
});
