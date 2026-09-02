import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CommercialRightsRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  awardCommercialRightsForPresident,
  calculateCommercialRightsOffer,
  createNepalSave,
  ensureFederationMainPartnerPackage,
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
      db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }
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
    ).toBe(88);
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
});
