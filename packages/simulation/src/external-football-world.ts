import { createStableEntityId, type ExternalFootballRegion, type ExternalFootballRegionProfile } from "@nepal-football-sim/shared-types";
import { ClubEconomyRepository, ExternalFootballRepository, FederationGovernanceRepository, type GameDatabase } from "@nepal-football-sim/database";
import { SeededRandom } from "./rng.js";
import { findHomeFootballContext } from "./home-context.js";
import { homeMarketRegion } from "./market-regions.js";

const regions: Array<{ region: ExternalFootballRegion; economic: number; football: number; clubs: number; national: number }> = [
  { region: "SOUTH_ASIA", economic: 3.4, football: 4.2, clubs: 4.3, national: 4.5 },
  { region: "WIDER_ASIA", economic: 5.3, football: 5.6, clubs: 5.8, national: 5.7 },
  { region: "MIDDLE_EAST", economic: 6.4, football: 6.5, clubs: 6.7, national: 6.2 },
  { region: "AUSTRALIA", economic: 7.2, football: 6.8, clubs: 6.9, national: 6.8 },
  { region: "EUROPE", economic: 9.2, football: 9.5, clubs: 9.4, national: 9.2 },
];
const clamp = (value: number): number => Math.max(0, Math.min(10, Number(value.toFixed(3))));

export const processExternalFootballWorldSeason = (db: GameDatabase, input: { seasonLabel: string; seed: string }): ExternalFootballRegionProfile[] => {
  const external = new ExternalFootballRepository(db);
  if (external.profiles(input.seasonLabel).length === regions.length) return external.profiles(input.seasonLabel);
  const federationId = findHomeFootballContext(db)?.federationId;
  const homeRegion = homeMarketRegion(db);
  const federation = federationId ? new FederationGovernanceRepository(db).profile(federationId) : undefined;
  const clubs = new ClubEconomyRepository(db).financialAccounts();
  const averageCommercial = clubs.length === 0 ? 0 : clubs.reduce((total, account) => total + (new ClubEconomyRepository(db).commercialProfile(account.clubId)?.brandStrength ?? 0), 0) / clubs.length;
  const results: ExternalFootballRegionProfile[] = [];
  for (const base of regions) {
    const previous = external.profiles().filter((profile) => profile.region === base.region).at(-1);
    const rng = new SeededRandom(`${input.seed}:external:${base.region}:${input.seasonLabel}`);
    const homeLift = base.region === homeRegion ? ((federation?.reputation ?? 4) + (federation?.infrastructureLevel ?? 3)) * 0.018 : 0;
    const economicStrength = clamp((previous?.economicStrength ?? base.economic) + (rng.next() - 0.45) * 0.22);
    const footballReputation = clamp((previous?.footballReputation ?? base.football) + (economicStrength - base.economic) * 0.08 + homeLift * 0.35 + (rng.next() - 0.5) * 0.16);
    const clubStrength = clamp((previous?.clubStrength ?? base.clubs) + (economicStrength - base.economic) * 0.1 + (rng.next() - 0.5) * 0.14);
    const nationalTeamStrength = clamp((previous?.nationalTeamStrength ?? base.national) + (footballReputation - base.football) * 0.08 + (rng.next() - 0.5) * 0.12);
    const profile: ExternalFootballRegionProfile = {
      id: createStableEntityId("external-football-region", `${base.region}:${input.seasonLabel}`),
      region: base.region,
      seasonLabel: input.seasonLabel,
      economicStrength,
      footballReputation,
      clubStrength,
      transferDemand: clamp(footballReputation * 0.62 + (base.region === homeRegion ? homeLift * 2 : 0)),
      foreignRecruitmentAppeal: clamp(economicStrength * 0.58 + footballReputation * 0.32),
      nationalTeamStrength,
      commercialGrowth: clamp((previous?.commercialGrowth ?? base.economic * 0.45) + averageCommercial * 0.012 + (rng.next() - 0.48) * 0.16),
      status: "SIMULATION_ONLY",
    };
    external.upsertProfile(profile);
    results.push(profile);
  }
  return results;
};

export const preferredForeignMarkets = (db: GameDatabase, seasonLabel: string): { source: ExternalFootballRegion; destination: ExternalFootballRegion } => {
  const profiles = new ExternalFootballRepository(db).profiles(seasonLabel);
  const source = [...profiles].sort((a, b) => b.foreignRecruitmentAppeal - a.foreignRecruitmentAppeal || a.region.localeCompare(b.region))[0]?.region ?? "SOUTH_ASIA";
  const destination = [...profiles].sort((a, b) => b.transferDemand - a.transferDemand || a.region.localeCompare(b.region))[0]?.region ?? "SOUTH_ASIA";
  return { source, destination };
};
