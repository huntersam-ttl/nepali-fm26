import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CommercialRightsRepository,
  HIGHEST_KNOWN_SCHEMA_VERSION,
  NationalTeamCommercialRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  activateWomensGirlsDevelopmentPartner,
  activateYouthDevelopmentPartner,
  activateSeniorNationalTeamMainPartner,
  calculateCommercialRightsOffer,
  createNepalSave,
  ensureWomensGirlsDevelopmentPartnerPackage,
  ensureYouthDevelopmentPartnerPackage,
  ensureSeniorNationalTeamMainPartnerPackage,
  expireNationalTeamCommercialSettlements,
  federationCommercialOverview,
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
    ).toBe(HIGHEST_KNOWN_SCHEMA_VERSION);
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

  it("settles distinct youth and women programme partners without cross-programme leakage", () => {
    const { directory, db, federationId, personId } = setup();
    const rightsRepo = new CommercialRightsRepository(db);
    const youthPackage = ensureYouthDevelopmentPartnerPackage(db, federationId, "2026-08-01");
    const womenPackage = ensureWomensGirlsDevelopmentPartnerPackage(db, federationId, "2026-08-01");
    const makeOffer = (rightsPackage: typeof youthPackage, sponsorId: EntityId) => {
      rightsRepo.upsertSponsor({
        id: sponsorId,
        name: sponsorId === "youth-partner" ? "Youth Education Partner" : "Women Health Partner",
        sector: sponsorId === "youth-partner" ? "Education" : "Insurance",
        financialStrength: 60,
        strategicValue: 62,
        reputation: 64,
        domesticReach: 55,
        internationalReach: 35,
        reliability: 78,
        provenanceStatus: "SIMULATION_ONLY",
      });
      const offer = calculateCommercialRightsOffer({
        rightsPackage,
        sponsor: rightsRepo.sponsor(sponsorId)!,
        evidence: {
          federationReputation: 55,
          competitionReputation: 40,
          nationalTeamPerformance: 45,
          audienceScale: 65_000,
          mediaExposure: 50,
          womenYouthGrowth: 35,
        },
        offeredOn: "2026-08-01",
        termYears: 2,
      });
      rightsRepo.upsertOffer(offer);
      return offer;
    };
    const youthOffer = makeOffer(youthPackage, "youth-partner" as EntityId);
    const womenOffer = makeOffer(womenPackage, "women-partner" as EntityId);
    db.prepare(
      "INSERT INTO federation_leadership_tenures (id,person_id,federation_id,role,term_start,status,provenance_status) VALUES (?,?,?,?,?,?,?)",
    ).run(
      "programme-commercial-tenure",
      personId,
      federationId,
      "FEDERATION_PRESIDENT",
      "2026-08-01",
      "ACTIVE",
      "SIMULATION_ONLY",
    );
    const youth = activateYouthDevelopmentPartner(db, {
      offerId: youthOffer.id,
      federationId,
      presidentPersonId: personId,
      date: "2026-08-01",
      startDate: "2026-08-01",
    });
    const women = activateWomensGirlsDevelopmentPartner(db, {
      offerId: womenOffer.id,
      federationId,
      presidentPersonId: personId,
      date: "2026-08-01",
      startDate: "2026-08-01",
    });
    expect(youth.programme).toBe("YOUTH");
    expect(youth.commercialProperty).toBe("YOUTH_DEVELOPMENT_PARTNER");
    expect(women.programme).toBe("WOMENS_GIRLS");
    expect(women.commercialProperty).toBe("WOMENS_GIRLS_DEVELOPMENT_PARTNER");
    expect(youth.restrictionTag).not.toBe(women.restrictionTag);
    expect(
      new NationalTeamCommercialRepository(db).byProgramme(federationId, "YOUTH"),
    ).toHaveLength(1);
    expect(
      new NationalTeamCommercialRepository(db).byProgramme(federationId, "WOMENS_GIRLS"),
    ).toHaveLength(1);
    expect(nationalTeamCommercialReadModel(db, federationId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ programme: "YOUTH", settlementState: "SETTLED" }),
        expect.objectContaining({ programme: "WOMENS_GIRLS", settlementState: "SETTLED" }),
      ]),
    );
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM federation_ledger_entries WHERE related_entity_id IN (?,?)",
          )
          .get(youthOffer.id, womenOffer.id) as { count: number }
      ).count,
    ).toBe(2);
    expect(() =>
      activateYouthDevelopmentPartner(db, {
        offerId: youthOffer.id,
        federationId,
        presidentPersonId: "wrong-role" as EntityId,
        date: "2026-08-01",
        startDate: "2026-08-01",
      }),
    ).toThrow(/active federation president/);
    // Regression: federationCommercialOverview only recognised scope==="NATIONAL_TEAM"
    // as a national-programme package, but youth/women packages carry their own
    // real scope ("YOUTH"/"WOMENS") — so both silently fell back to "FEDERATION"
    // in the President Commercial screen's properties and history lists.
    const overview = federationCommercialOverview(db, federationId);
    expect(overview.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: youthPackage.id, scope: "YOUTH", programme: "YOUTH" }),
        expect.objectContaining({
          id: womenPackage.id,
          scope: "WOMENS_GIRLS",
          programme: "WOMENS_GIRLS",
        }),
      ]),
    );
    expect(overview.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: youthOffer.id, scope: "YOUTH" }),
        expect.objectContaining({ id: womenOffer.id, scope: "WOMENS_GIRLS" }),
      ]),
    );
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
