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
      const clubDeal = sponsor.dealHistory.find((deal) => deal.id === clubContract.id);
      expect(clubDeal?.counterpartReference).toMatchObject({
        entityType: "CLUB",
        id: club.id,
        label: expect.any(String),
        visible: true,
      });
      expect(sponsor.involvedEntities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ entityType: "CLUB", id: club.id, visible: true }),
        ]),
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
      db.prepare(
        "INSERT INTO ownership_acquisition_offers (id,club_id,buyer_person_id,seller_holder_id,percentage,offer_amount,counter_amount,status,created_on,decided_on,rationale,investor_type,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        "organization-profile-rejected-offer",
        club.id,
        investorId.id,
        null,
        12,
        900_000,
        null,
        "REJECTED",
        "2026-08-02",
        "2026-08-03",
        "Test rejection",
        null,
        "SIMULATION_ONLY",
      );
      db.prepare(
        "INSERT INTO ownership_acquisition_offers (id,club_id,buyer_person_id,seller_holder_id,percentage,offer_amount,counter_amount,status,created_on,decided_on,rationale,investor_type,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        "organization-profile-accepted-offer",
        club.id,
        investorId.id,
        null,
        8,
        1_200_000,
        null,
        "ACCEPTED",
        "2026-08-04",
        "2026-08-04",
        "Test acceptance",
        null,
        "SIMULATION_ONLY",
      );
      db.prepare(
        "INSERT INTO ownership_acquisition_transactions (id,offer_id,club_id,buyer_person_id,seller_holder_id,transaction_date,amount,percentage,status,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).run(
        "organization-profile-transaction",
        "organization-profile-accepted-offer",
        club.id,
        investorId.id,
        null,
        "2026-08-04",
        1_200_000,
        8,
        "POSTED",
        "SIMULATION_ONLY",
      );
      db.prepare(
        "INSERT INTO club_ownership_stakes (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,end_date,status,ownership_model,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        "organization-profile-active-stake",
        club.id,
        "PERSON",
        investorId.id,
        "Test Investor",
        "SHAREHOLDER",
        8,
        8,
        "2026-08-04",
        null,
        "ACTIVE",
        "SHAREHOLDING",
        "SIMULATION_ONLY",
      );
      const investor = buildOrganizationProfile(db, "INVESTOR", investorId.id, "CHAIRMAN_OWNER");
      expect(investor.dealHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "organization-profile-rejected-offer", status: "REJECTED" }),
          expect.objectContaining({ id: "organization-profile-transaction", property: "OWNERSHIP_TRANSACTION", status: "ACCEPTED" }),
        ]),
      );
      expect(investor.activeDeals).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "organization-profile-active-stake", status: "ACTIVE" })]),
      );
      expect(investor.involvedEntities).toEqual(
        expect.arrayContaining([expect.objectContaining({ entityType: "CLUB", id: club.id })]),
      );
      expect(["NEPAL", "MULTINATIONAL", "UNKNOWN"]).toContain(investor.organizationContext);
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
