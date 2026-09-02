import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  CommercialRightsRepository,
  CompetitionCommercialRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  buildOrganizationProfile,
  createNepalSave,
  ensureADivisionTitleSponsorPackage,
} from "@nepal-football-sim/simulation";
import type { EntityId, SponsorshipContract } from "@nepal-football-sim/shared-types";

const dataset = JSON.parse(
  readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8"),
);

describe("organization profiles", () => {
  it("aggregates real sponsor history and resolves lender/investor identities", () => {
    const directory = mkdtempSync(join(tmpdir(), "organization-profile-"));
    const path = join(directory, "career.sqlite");
    createNepalSave({
      databasePath: path,
      dataset,
      saveName: "organization-profile",
      gameVersion: "test",
      randomSeed: "organization-profile",
    });
    const db = openGameDatabase(path);
    try {
      const club = db.prepare("SELECT id FROM clubs ORDER BY id LIMIT 1").get() as { id: EntityId };
      const season = db
        .prepare(
          "SELECT cs.id FROM competition_seasons cs JOIN competitions c ON c.id=cs.competition_id WHERE lower(c.name) LIKE '%a-division%' ORDER BY cs.id LIMIT 1",
        )
        .get() as { id: EntityId };
      const federation = db
        .prepare(
          "SELECT federation_id AS id FROM competitions WHERE lower(name) LIKE '%a-division%' ORDER BY id LIMIT 1",
        )
        .get() as { id: EntityId };
      const sponsorId = "organization-profile-sponsor" as EntityId;
      db.prepare(
        "INSERT INTO sponsor_organisations (id,name,industry,country_id,reputation,budget_tier,status) VALUES (?,?,?,?,?,?,?)",
      ).run(
        sponsorId,
        "Himalayan Community Bank",
        "Banking",
        null,
        60,
        "REGIONAL",
        "SIMULATION_ONLY",
      );
      const clubContract: SponsorshipContract = {
        id: "organization-profile-club-deal" as EntityId,
        clubId: club.id,
        sponsorId,
        type: "LOCAL_PARTNER",
        startDate: "2026-08-01",
        endDate: "2027-07-31",
        annualValue: 250_000,
        bonuses: {},
        currency: "NPR",
        status: "EXPIRED",
        provenanceStatus: "SIMULATION_ONLY",
      };
      new ClubEconomyRepository(db).upsertSponsorship(clubContract);
      const rightsPackage = ensureADivisionTitleSponsorPackage(db, federation.id, "2026-08-01");
      const rightsRepo = new CommercialRightsRepository(db);
      const offer = {
        id: "organization-profile-rights-offer" as EntityId,
        packageId: rightsPackage.id,
        federationId: federation.id,
        sponsorId,
        termYears: 1,
        annualValue: 500_000,
        bonuses: {},
        reachScore: 50,
        strategicFit: 55,
        relationshipValue: 60,
        exclusivity: true,
        scope: "COMPETITION" as const,
        status: "ACTIVE" as const,
        offeredOn: "2026-08-01",
        startDate: "2026-08-01",
        endDate: "2027-07-31",
        federationLedgerEntryId: "organization-profile-ledger" as EntityId,
        provenanceStatus: "SIMULATION_ONLY" as const,
      };
      rightsRepo.upsertOffer(offer);
      new CompetitionCommercialRepository(db).upsert({
        id: "organization-profile-competition-deal" as EntityId,
        competitionSeasonId: season.id,
        rightsOfferId: offer.id,
        sponsorId,
        displayTitle: "A Division presented by Himalayan Community Bank",
        startDate: "2026-08-01",
        endDate: "2027-07-31",
        status: "ACTIVE",
        revenueDestination: "FEDERATION_LEDGER",
        provenanceStatus: "SIMULATION_ONLY",
      });
      const sponsor = buildOrganizationProfile(db, "SPONSOR", sponsorId, "FEDERATION_PRESIDENT");
      expect(sponsor.entityReference).toMatchObject({
        entityType: "SPONSOR",
        id: sponsorId,
        label: "Himalayan Community Bank",
        destination: "organization",
        visible: true,
        provenanceStatus: "SIMULATION_ONLY",
      });
      expect(sponsor.activeDeals.length).toBeGreaterThan(0);
      expect(sponsor.dealHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: clubContract.id, status: "EXPIRED" }),
        ]),
      );
      expect(sponsor.activeDeals).toEqual(
        expect.arrayContaining([expect.objectContaining({ sourceEntityId: offer.id })]),
      );
      expect(sponsor.relationshipClues).toEqual(
        expect.arrayContaining(["Established partner", "Repeated partner"]),
      );
      const lenderId = (new ClubEconomyRepository(db).lenders()[0]?.id ?? "missing") as EntityId;
      expect(
        buildOrganizationProfile(db, "LENDER", lenderId, "CHAIRMAN_OWNER").entityReference,
      ).toMatchObject({
        entityType: "LENDER",
        id: lenderId,
        visible: true,
      });
      const investorId = db.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get() as {
        id: EntityId;
      };
      expect(
        buildOrganizationProfile(db, "INVESTOR", investorId.id, "CHAIRMAN_OWNER").entityReference,
      ).toMatchObject({
        entityType: "INVESTOR",
        id: investorId.id,
        visible: true,
      });
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 180_000);
});
