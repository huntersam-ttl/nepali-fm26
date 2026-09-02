import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ClubEconomyRepository, FederationGovernanceRepository, MediaRightsRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, federationCommercialOverview } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dataset = JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8"));

/**
 * federationCommercialOverview is read-only by design: both the underlying
 * federation sponsorship and any competition media-rights deal are created
 * and settled in a single atomic step elsewhere (ensureFederationSponsorship,
 * settleFederationMediaRightsForCompetition) — there is no OFFERED state for
 * a president to negotiate, so this only ever surfaces what already exists.
 */
describe("federation commercial overview", () => {
  const setup = () => {
    const directory = mkdtempSync(join(tmpdir(), "federation-commercial-"));
    const path = join(directory, "career.sqlite");
    createNepalSave({ databasePath: path, dataset, saveName: "federation-commercial", gameVersion: "test", randomSeed: "federation-commercial" });
    const db = openGameDatabase(path);
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: string }).id as EntityId;
    return { directory, db, federationId };
  };

  it("returns an honest empty overview when nothing has ever been settled", () => {
    const { directory, db, federationId } = setup();
    const overview = federationCommercialOverview(db, federationId);
    expect(overview.sponsorship).toBeUndefined();
    expect(overview.mediaRights).toEqual([]);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("attaches the real sponsor name to an existing federation sponsorship and lists settled media-rights deals", () => {
    const { directory, db, federationId } = setup();
    const economy = new ClubEconomyRepository(db);
    const sponsorId = "fc-test-sponsor" as EntityId;
    economy.upsertSponsor({ id: sponsorId, name: "Federation Partner Ltd", industry: "Banking", reputation: 6, budgetTier: "NATIONAL", status: "SIMULATION_ONLY" });
    new FederationGovernanceRepository(db).upsertFederationSponsorship({
      id: "fc-test-sponsorship" as EntityId,
      federationId,
      sponsorId,
      type: "OFFICIAL_PARTNER",
      startDate: "2026-08-01",
      endDate: "2027-08-01",
      annualValue: 2_500_000,
      currency: "NPR",
      status: "ACTIVE",
      provenanceStatus: "SIMULATION_ONLY",
    });
    const mediaRepo = new MediaRightsRepository(db);
    mediaRepo.upsertBroadcaster({ id: "fc-test-broadcaster" as EntityId, name: "Himal Broadcast Network", marketReach: 40, reliability: 70, financialStrength: 50, productionCapability: 45, domesticReach: 55, internationalReach: 10, provenanceStatus: "SIMULATION_ONLY" });
    mediaRepo.upsertPackage({ id: "fc-test-package" as EntityId, federationId, name: "A-Division broadcast rights", category: "DOMESTIC_TV", availableFrom: "2026-08-01", availableTo: "2027-08-01", status: "ACTIVE", retainedByFederation: false, provenanceStatus: "SIMULATION_ONLY" });
    mediaRepo.upsertOffer({ id: "fc-test-offer" as EntityId, packageId: "fc-test-package" as EntityId, federationId, broadcasterId: "fc-test-broadcaster" as EntityId, value: 1_200_000, reachScore: 40, strategicControl: 30, productionQuality: 35, status: "ACTIVE", offeredOn: "2026-08-01", startDate: "2026-08-01", endDate: "2027-08-01", provenanceStatus: "SIMULATION_ONLY" });

    const overview = federationCommercialOverview(db, federationId);
    expect(overview.sponsorship?.sponsorName).toBe("Federation Partner Ltd");
    expect(overview.sponsorship?.annualValue).toBe(2_500_000);
    expect(overview.mediaRights).toHaveLength(1);
    expect(overview.mediaRights[0]).toMatchObject({ packageName: "A-Division broadcast rights", broadcasterName: "Himal Broadcast Network", value: 1_200_000, status: "ACTIVE" });
    expect(overview.properties.find((property) => property.scope === "FEDERATION")).toMatchObject({
      canonicalName: "Federation main partner",
      status: "ACTIVE",
    });
    expect(overview.history.some((entry) => entry.id === "fc-test-sponsorship")).toBe(true);

    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
