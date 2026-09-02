import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CommercialRightsRepository,
  NationalTeamCommercialRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  activateSeniorNationalTeamMainPartner,
  calculateCommercialRightsOffer,
  createNepalSave,
  ensureSeniorNationalTeamMainPartnerPackage,
  expireNationalTeamCommercialSettlements,
  nationalTeamCommercialReadModel,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dataset = JSON.parse(
  readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8"),
);

describe("national-team commercial finance foundation", () => {
  const setup = () => {
    const directory = mkdtempSync(join(tmpdir(), "national-team-commercial-"));
    const path = join(directory, "career.sqlite");
    createNepalSave({
      databasePath: path,
      dataset,
      saveName: "national-team-commercial",
      gameVersion: "test",
      randomSeed: "national-team-commercial",
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

  it("migrates the programme settlement ledger and keeps youth/women scopes distinct", () => {
    const { directory, db } = setup();
    expect(
      (
        db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {
          version: number;
        }
      ).version,
    ).toBe(90);
    const columns = db
      .prepare("PRAGMA table_info(national_team_commercial_settlements)")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["programme", "rights_offer_id", "restriction_tag"]),
    );
    expect(
      new NationalTeamCommercialRepository(db).byProgramme("missing" as EntityId, "YOUTH"),
    ).toEqual([]);
    expect(
      new NationalTeamCommercialRepository(db).byProgramme("missing" as EntityId, "WOMENS_GIRLS"),
    ).toEqual([]);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("settles the senior main partner once through the earmarked federation ledger", () => {
    const { directory, db, federationId, personId } = setup();
    const rightsPackage = ensureSeniorNationalTeamMainPartnerPackage(
      db,
      federationId,
      "2026-08-01",
    );
    const repo = new CommercialRightsRepository(db);
    const sponsorId = "senior-national-partner" as EntityId;
    repo.upsertSponsor({
      id: sponsorId,
      name: "Senior National Partner",
      sector: "Telecom",
      financialStrength: 78,
      strategicValue: 75,
      reputation: 70,
      domesticReach: 80,
      internationalReach: 60,
      reliability: 82,
      provenanceStatus: "SIMULATION_ONLY",
    });
    const offer = calculateCommercialRightsOffer({
      rightsPackage,
      sponsor: repo.sponsor(sponsorId)!,
      evidence: {
        federationReputation: 55,
        competitionReputation: 50,
        nationalTeamPerformance: 55,
        audienceScale: 150_000,
        mediaExposure: 65,
        womenYouthGrowth: 25,
      },
      offeredOn: "2026-08-01",
    });
    repo.upsertOffer(offer);
    db.prepare(
      "INSERT INTO federation_leadership_tenures (id,person_id,federation_id,role,term_start,status,provenance_status) VALUES (?,?,?,?,?,?,?)",
    ).run(
      "senior-commercial-tenure",
      personId,
      federationId,
      "FEDERATION_PRESIDENT",
      "2026-08-01",
      "ACTIVE",
      "SIMULATION_ONLY",
    );
    const settlement = activateSeniorNationalTeamMainPartner(db, {
      offerId: offer.id,
      federationId,
      presidentPersonId: personId,
      date: "2026-08-01",
      startDate: "2026-08-01",
    });
    expect(settlement.restrictionTag).toBe("NATIONAL_TEAM:SENIOR_MENS:MAIN_PARTNER");
    expect(nationalTeamCommercialReadModel(db, federationId)[0]).toMatchObject({
      sponsorName: "Senior National Partner",
      settlementState: "SETTLED",
    });
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM federation_ledger_entries WHERE id=?")
          .get(settlement.federationLedgerEntryId) as { count: number }
      ).count,
    ).toBe(1);
    expect(
      activateSeniorNationalTeamMainPartner(db, {
        offerId: offer.id,
        federationId,
        presidentPersonId: personId,
        date: "2026-08-01",
        startDate: "2026-08-01",
      }),
    ).toEqual(settlement);
    expect(() =>
      activateSeniorNationalTeamMainPartner(db, {
        offerId: offer.id,
        federationId,
        presidentPersonId: "wrong-role" as EntityId,
        date: "2026-08-01",
        startDate: "2026-08-01",
      }),
    ).toThrow(/active federation president/);
    expect(expireNationalTeamCommercialSettlements(db, "2028-08-02")).toHaveLength(1);
    expect(expireNationalTeamCommercialSettlements(db, "2028-08-02")).toHaveLength(0);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
