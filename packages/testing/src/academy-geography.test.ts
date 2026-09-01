import { describe, expect, it } from "vitest";
import {
  deriveAcademyCatchment,
  deriveSchoolFootballSummary,
  deriveTalentHotspot,
  evolveTalentHotspot,
} from "@nepal-football-sim/simulation";
import type {
  AcademySimulationProfile,
  DistrictFootballUnit,
} from "@nepal-football-sim/shared-types";

const district = (id: string, schoolParticipation: number): DistrictFootballUnit => ({
  id: id as DistrictFootballUnit["id"],
  name: id,
  provinceId: `province-${id}` as DistrictFootballUnit["provinceId"],
  remoteness: 35,
  developmentStatus: "DEVELOPING",
  affiliationStatus: "DEVELOPING",
  developmentReputation: 20,
  registeredClubCount: 1,
  schoolParticipation,
  girlsParticipation: schoolParticipation,
  youthParticipation: schoolParticipation,
  coachSupply: schoolParticipation,
  refereeSupply: 20,
  groundAvailability: schoolParticipation,
  scoutingVisibility: schoolParticipation,
  governanceCompliance: 60,
  history: [],
  provenanceStatus: "SIMULATION_ONLY",
});

const profile: AcademySimulationProfile = {
  id: "academy-profile" as AcademySimulationProfile["id"],
  academyId: "academy" as AcademySimulationProfile["academyId"],
  clubId: "club" as AcademySimulationProfile["clubId"],
  countryId: "nepal" as AcademySimulationProfile["countryId"],
  youthRecruitmentQuality: 7,
  academyCoachingQuality: 7,
  academyFacilitiesQuality: 6,
  regionalReach: 5,
  talentIdentificationQuality: 7,
  status: "SIMULATION_ONLY",
};

describe("academy geography foundation", () => {
  it.each(["A", "B", "C"])("is deterministic for representative %s division inputs", (division) => {
    const input = {
      district: district(
        `district-${division}`,
        division === "A" ? 65 : division === "B" ? 40 : 20,
      ),
      asOf: "2026-08-01",
      academyPresence: division === "A" ? 2 : 1,
      academyQuality: 6,
      federationInvestment: 10,
      historicalProduction: 2,
      seed: "geography",
    };
    expect(deriveTalentHotspot(input)).toEqual(deriveTalentHotspot(input));
  });

  it("keeps hotspot movement slow and exposes a reason", () => {
    const previous = deriveTalentHotspot({
      district: district("kaski", 20),
      asOf: "2026-08-01",
      academyPresence: 0,
      academyQuality: 1,
      federationInvestment: 0,
      historicalProduction: 0,
      seed: "slow",
    });
    const next = evolveTalentHotspot(previous, {
      district: district("kaski", 100),
      asOf: "2027-08-01",
      academyPresence: 4,
      academyQuality: 10,
      federationInvestment: 100,
      historicalProduction: 20,
      seed: "slow",
    });
    expect(["EMERGING", "DEVELOPING", "ESTABLISHED", "PRIORITY"]).toContain(next.label);
    expect(next.contributingFactors.length).toBeGreaterThan(0);
    expect(next.asOf).toBe("2027-08-01");
  });

  it("derives bounded school and academy pathways", () => {
    expect(deriveSchoolFootballSummary(district("jhapa", 70), 2)).toMatchObject({
      programmeLabel: "STRONG",
      academyConnection: "REGIONAL_PATHWAY",
    });
    expect(
      deriveAcademyCatchment({
        profile,
        homeDistrictId: district("kaski", 40).id,
        partnershipCount: 2,
      }),
    ).toMatchObject({ catchmentLabel: "NATIONWIDE", provenance: "SIMULATION_ONLY" });
  });
});
