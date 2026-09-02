import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CommercialRightsRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  aDivisionCommercialReadModel,
  activateADivisionTitleSponsorship,
  awardCommercialRightsForPresident,
  calculateCommercialRightsOffer,
  createNepalSave,
  ensureADivisionTitleSponsorPackage,
  ensureFederationMainPartnerPackage,
  expireADivisionTitleSponsorships,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dataset = JSON.parse(
  readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8"),
);

describe("commercial rights federation pilot", () => {
  const setup = () => {
    const directory = mkdtempSync(join(tmpdir(), "commercial-rights-pilot-"));
    const path = join(directory, "career.sqlite");
    createNepalSave({
      databasePath: path,
      dataset,
      saveName: "commercial-rights-pilot",
      gameVersion: "test",
      randomSeed: "commercial-rights-pilot",
    });
    const db = openGameDatabase(path);
    const federationId = (
      db
        .prepare(
          "SELECT federation_id AS id FROM competitions WHERE lower(name) LIKE '%a-division%' ORDER BY id LIMIT 1",
        )
        .get() as { id: EntityId }
    ).id;
    const personId = (
      db.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get() as { id: EntityId }
    ).id;
    return { directory, db, federationId, personId };
  };

  it("migration owns the rights schema and preserves a fresh save", () => {
    const { directory, db } = setup();
    expect(
      (
        db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {
          version: number;
        }
      ).version,
    ).toBe(89);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='federation_commercial_rights_offers'",
        )
        .get(),
    ).toBeTruthy();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("runs the federation main-partner pilot through President authority and the federation ledger exactly once", () => {
    const { directory, db, federationId, personId } = setup();
    const rightsPackage = ensureFederationMainPartnerPackage(db, federationId, "2026-08-01");
    const repo = new CommercialRightsRepository(db);
    const sponsorId = "pilot-sponsor" as EntityId;
    repo.upsertSponsor({
      id: sponsorId,
      name: "Pilot Nepal Partner",
      sector: "Banking",
      financialStrength: 70,
      strategicValue: 65,
      reputation: 60,
      domesticReach: 70,
      internationalReach: 20,
      reliability: 75,
      provenanceStatus: "SIMULATION_ONLY",
    });
    const offer = calculateCommercialRightsOffer({
      rightsPackage,
      sponsor: repo.sponsor(sponsorId)!,
      evidence: {
        federationReputation: 50,
        competitionReputation: 40,
        nationalTeamPerformance: 40,
        audienceScale: 50_000,
        mediaExposure: 45,
        womenYouthGrowth: 35,
      },
      offeredOn: "2026-08-01",
    });
    repo.upsertOffer(offer);
    db.prepare(
      "INSERT INTO federation_leadership_tenures (id,person_id,federation_id,role,term_start,status,provenance_status) VALUES (?,?,?,?,?,?,?)",
    ).run(
      "pilot-tenure",
      personId,
      federationId,
      "FEDERATION_PRESIDENT",
      "2026-08-01",
      "ACTIVE",
      "SIMULATION_ONLY",
    );
    const active = awardCommercialRightsForPresident(db, {
      offerId: offer.id,
      federationId,
      presidentPersonId: personId,
      date: "2026-08-01",
      startDate: "2026-08-01",
    });
    expect(active.status).toBe("ACTIVE");
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM federation_ledger_entries WHERE related_entity_id=?",
          )
          .get(offer.id) as { count: number }
      ).count,
    ).toBe(1);
    expect(() =>
      awardCommercialRightsForPresident(db, {
        offerId: offer.id,
        federationId,
        presidentPersonId: personId,
        date: "2026-08-01",
        startDate: "2026-08-01",
      }),
    ).toThrow();
    expect(() =>
      awardCommercialRightsForPresident(db, {
        offerId: offer.id,
        federationId,
        presidentPersonId: "not-president" as EntityId,
        date: "2026-08-01",
        startDate: "2026-08-01",
      }),
    ).toThrow(/active federation president/);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("links an A Division sponsor to a season without rewriting canonical competition identity", () => {
    const { directory, db, federationId, personId } = setup();
    const season = db
      .prepare(
        "SELECT cs.id, c.name FROM competition_seasons cs JOIN competitions c ON c.id=cs.competition_id WHERE c.federation_id=? AND lower(c.name) LIKE '%a-division%' ORDER BY cs.start_date LIMIT 1",
      )
      .get(federationId) as { id: EntityId; name: string };
    const rightsPackage = ensureADivisionTitleSponsorPackage(db, federationId, "2026-08-01");
    const repo = new CommercialRightsRepository(db);
    const sponsorId = "a-division-pilot-sponsor" as EntityId;
    repo.upsertSponsor({
      id: sponsorId,
      name: "A Division Pilot Bank",
      sector: "Banking",
      financialStrength: 72,
      strategicValue: 70,
      reputation: 65,
      domesticReach: 75,
      internationalReach: 20,
      reliability: 78,
      provenanceStatus: "SIMULATION_ONLY",
    });
    const offer = calculateCommercialRightsOffer({
      rightsPackage,
      sponsor: repo.sponsor(sponsorId)!,
      evidence: {
        federationReputation: 55,
        competitionReputation: 60,
        nationalTeamPerformance: 40,
        audienceScale: 70_000,
        mediaExposure: 60,
        womenYouthGrowth: 30,
      },
      offeredOn: "2026-08-01",
    });
    repo.upsertOffer(offer);
    db.prepare(
      "INSERT INTO federation_leadership_tenures (id,person_id,federation_id,role,term_start,status,provenance_status) VALUES (?,?,?,?,?,?,?)",
    ).run(
      "a-division-pilot-tenure",
      personId,
      federationId,
      "FEDERATION_PRESIDENT",
      "2026-08-01",
      "ACTIVE",
      "SIMULATION_ONLY",
    );
    const linked = activateADivisionTitleSponsorship(db, {
      competitionSeasonId: season.id,
      offerId: offer.id,
      presidentPersonId: personId,
      federationId,
      date: "2026-08-01",
      startDate: "2026-08-01",
    });
    expect(linked.displayTitle).toContain("A Division Pilot Bank");
    expect(
      (
        db
          .prepare(
            "SELECT name FROM competitions WHERE id=(SELECT competition_id FROM competition_seasons WHERE id=?)",
          )
          .get(season.id) as { name: string }
      ).name,
    ).toBe(season.name);
    expect(aDivisionCommercialReadModel(db, season.id)).toMatchObject({
      sponsorName: "A Division Pilot Bank",
      negotiationStatus: "ACTIVE",
      settlementState: "SETTLED",
      revenueDestination: "FEDERATION_LEDGER",
    });
    expect(
      activateADivisionTitleSponsorship(db, {
        competitionSeasonId: season.id,
        offerId: offer.id,
        presidentPersonId: personId,
        federationId,
        date: "2026-08-01",
        startDate: "2026-08-01",
      }),
    ).toEqual(linked);
    expect(expireADivisionTitleSponsorships(db, "2028-08-01")).toHaveLength(0);
    expect(expireADivisionTitleSponsorships(db, "2028-08-02")).toHaveLength(1);
    expect(expireADivisionTitleSponsorships(db, "2028-08-02")).toHaveLength(0);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
