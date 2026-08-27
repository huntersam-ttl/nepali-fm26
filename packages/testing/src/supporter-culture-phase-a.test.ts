import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SupporterCultureRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId, SupporterCultureProfile } from "@nepal-football-sim/shared-types";
import {
  applyPlayerSaleEffect,
  applyPromotionEffect,
  applyRelegationEffect,
  applyStarSigningEffect,
  applyTrophyEffect,
  computeAttendanceDemand,
  computeMatchAtmosphere,
  createNepalSave,
  createRivalry,
  evolveSupporterBaseSeason,
  evolveSupporterCultureSeason,
  expectationsForContext,
  initialNationalTeamSupporterState,
  initialSupporterCultureProfile,
  initializeClubEconomyForSave,
  initializeSupporterCultureForSave,
  nextManagerApproval,
  nextNationalTeamSupporterState,
  nextRivalryIntensity,
  nextSupporterMood,
  normalizeSupporterSentiment,
  postMatchdayEconomy,
  supporterBoardPressureModifier,
  supporterCommercialEngagementIndex,
  supporterReadModel,
  supporterUnrestState,
} from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-supporters-"));
  tempDirs.push(dir);
  return join(dir, "supporters.sqlite");
};

const createSave = (seed: string): string => {
  const databasePath = tempDbPath();
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Supporters ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  return databasePath;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const profileFor = (overrides: Partial<SupporterCultureProfile> = {}): SupporterCultureProfile => ({
  ...initialSupporterCultureProfile({
    clubId: "club:test" as EntityId,
    tier: 1,
    seed: "unit",
    date: "2026-08-01",
    reputation: 6,
    populationContext: 60,
  }),
  ...overrides,
});

const bounded = (profile: SupporterCultureProfile): void => {
  for (const key of [
    "localIdentity",
    "nationalReach",
    "loyalty",
    "passion",
    "patience",
    "volatility",
    "matchgoingCulture",
    "awaySupport",
    "youthInterest",
    "familyAttendance",
    "commercialEngagement",
    "socialReach",
    "expectations",
    "optimism",
    "currentMood",
    "baselineMood",
    "trustInOwnership",
    "trustInManager",
  ] as const) {
    expect(Number.isFinite(profile[key])).toBe(true);
    expect(profile[key]).toBeGreaterThanOrEqual(0);
    expect(profile[key]).toBeLessThanOrEqual(100);
  }
  for (const key of [
    "potentialReach",
    "activeFanbase",
    "matchgoingBase",
    "seasonTicketBase",
    "casualAudience",
  ] as const) {
    expect(Number.isFinite(profile[key])).toBe(true);
    expect(profile[key]).toBeGreaterThanOrEqual(0);
  }
};

describe("supporter culture phase A: initialisation", () => {
  it("initialises bounded, simulation-only profiles for Nepal clubs", () => {
    const db = openGameDatabase(createSave("init"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "init" });
    const created = initializeSupporterCultureForSave({
      db,
      worldDate: "2026-08-01",
      seed: "init",
    });
    expect(new SupporterCultureRepository(db).profiles().length).toBeGreaterThan(0);
    for (const profile of created) {
      bounded(profile);
      expect(profile.provenanceStatus).toBe("SIMULATION_ONLY");
    }
    // Re-running never resets live supporter state.
    expect(
      initializeSupporterCultureForSave({ db, worldDate: "2026-09-01", seed: "init" }),
    ).toHaveLength(0);
    db.close();
  });

  it("starts lower-tier and women's support at a smaller scale than a top-tier men's club", () => {
    const shared = {
      clubId: "club:x" as EntityId,
      seed: "scale",
      date: "2026-08-01",
      reputation: 7,
      populationContext: 60,
    };
    const top = initialSupporterCultureProfile({ ...shared, tier: 1 });
    const lower = initialSupporterCultureProfile({ ...shared, tier: 3 });
    const womens = initialSupporterCultureProfile({ ...shared, tier: 1, gender: "women" });
    expect(lower.activeFanbase).toBeLessThan(top.activeFanbase);
    expect(womens.activeFanbase).toBeLessThan(top.activeFanbase);
    expect(womens.activeFanbase).toBeGreaterThan(0);
    // A promoted club is not expected to win the division it just reached.
    expect(
      expectationsForContext({
        tier: 2,
        reputation: 4,
        historicStature: 20,
        previousFinishShare: 0.1,
        boardAmbition: 50,
        squadStrength: 40,
        financialHealth: 50,
        justPromoted: true,
      }),
    ).toBeLessThan(
      expectationsForContext({
        tier: 1,
        reputation: 9,
        historicStature: 90,
        previousFinishShare: 0.1,
        boardAmbition: 80,
        squadStrength: 85,
        financialHealth: 70,
      }),
    );
  });
});

describe("supporter culture phase A: attendance", () => {
  const base = {
    matchgoingBase: 4000,
    seasonTicketBase: 500,
    passion: 60,
    loyalty: 60,
    matchgoingCulture: 60,
    familyAttendance: 40,
    homeMood: 55,
    awayMatchgoingBase: 2000,
    awaySupport: 40,
    ticketPrice: 250,
    capacity: 6000,
  };

  it("never exceeds capacity and is deterministic for the same state and seed", () => {
    const small = computeAttendanceDemand({ ...base, capacity: 800, seed: "fixture-1" });
    expect(small.attendance).toBeLessThanOrEqual(800);
    expect(small.cappedByCapacity).toBe(true);
    expect(computeAttendanceDemand({ ...base, seed: "fixture-1" })).toEqual(
      computeAttendanceDemand({ ...base, seed: "fixture-1" }),
    );
  });

  it("raises demand for stronger support, rivalry and stakes, and suppresses it for poor affordability", () => {
    const neutral = computeAttendanceDemand({ ...base, capacity: 40000 });
    expect(
      computeAttendanceDemand({ ...base, capacity: 40000, matchgoingBase: 8000 }).attendance,
    ).toBeGreaterThan(neutral.attendance);
    expect(
      computeAttendanceDemand({ ...base, capacity: 40000, rivalryIntensity: 85 }).attendance,
    ).toBeGreaterThan(neutral.attendance);
    expect(
      computeAttendanceDemand({ ...base, capacity: 40000, stakes: 95 }).attendance,
    ).toBeGreaterThan(neutral.attendance);
    expect(
      computeAttendanceDemand({
        ...base,
        capacity: 40000,
        ticketPrice: 1400,
        affordabilityIndex: 1.8,
      }).attendance,
    ).toBeLessThan(neutral.attendance);
    // Rivalry lift is meaningful but never a multiple of normal demand.
    expect(
      computeAttendanceDemand({ ...base, capacity: 40000, rivalryIntensity: 100 }).attendance,
    ).toBeLessThan(neutral.attendance * 1.6);
  });

  it("keeps away support small over long journeys and inside its allocation", () => {
    const near = computeAttendanceDemand({ ...base, capacity: 40000, travelDistanceKm: 5 });
    const far = computeAttendanceDemand({ ...base, capacity: 40000, travelDistanceKm: 700 });
    expect(far.awayAttendance).toBeLessThan(near.awayAttendance);
    expect(near.awayAttendance).toBeLessThanOrEqual(near.awayAllocation);
  });

  it("produces a bounded atmosphere with only small pressure context", () => {
    const atmosphere = computeMatchAtmosphere({
      attendance: 6000,
      capacity: 6000,
      passion: 95,
      rivalryIntensity: 100,
      stakes: 100,
    });
    expect(atmosphere.atmosphere).toBeLessThanOrEqual(100);
    expect(atmosphere.homePressure).toBeLessThanOrEqual(6);
    expect(atmosphere.refereePressure).toBeLessThanOrEqual(5);
  });

  it("drives real matchday attendance through the existing economy engine", () => {
    const db = openGameDatabase(createSave("matchday"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "matchday" });
    initializeSupporterCultureForSave({ db, worldDate: "2026-08-01", seed: "matchday" });
    const teams = db
      .prepare(
        "SELECT id, club_id FROM teams WHERE club_id IS NOT NULL AND level = 'senior' AND gender = 'men' ORDER BY id LIMIT 2",
      )
      .all() as Array<{ id: EntityId }>;
    const venue = db.prepare("SELECT id FROM venues ORDER BY id LIMIT 1").get() as
      { id: EntityId } | undefined;
    const result = postMatchdayEconomy(
      db,
      {
        id: "fixture:supporter-test" as EntityId,
        homeTeamId: teams[0]!.id,
        awayTeamId: teams[1]!.id,
        scheduledDate: "2026-08-02",
        status: "scheduled",
        round: 5,
        venueId: venue?.id,
      },
      "2026-08-02",
      "matchday",
    )!;
    expect(result.attendance).toBeLessThanOrEqual(result.capacity);
    expect(result.attendanceBreakdown).toBeDefined();
    expect(result.attendanceBreakdown!.baselineLocalDemand).toBeGreaterThan(0);
    db.close();
  });
});

describe("supporter culture phase A: mood, expectations and pressure", () => {
  it("moves mood within bounds and lets no single result redefine sentiment", () => {
    const profile = profileFor();
    const win = nextSupporterMood(profile, { performanceVsExpectation: 30 });
    expect(win.currentMood).toBeGreaterThan(profile.currentMood);
    expect(Math.abs(win.currentMood - profile.currentMood)).toBeLessThanOrEqual(9);
    const disaster = nextSupporterMood(profile, {
      performanceVsExpectation: -40,
      relegation: true,
      financialInstability: true,
      brokenPromise: true,
      objectiveFailed: true,
    });
    expect(disaster.currentMood).toBeGreaterThanOrEqual(0);
    expect(profile.currentMood - disaster.currentMood).toBeLessThanOrEqual(9);
  });

  it("degrades under repeated poor results and trends back toward baseline afterwards", () => {
    let profile = profileFor();
    for (let match = 0; match < 12; match += 1) {
      const mood = nextSupporterMood(profile, { performanceVsExpectation: -30 });
      profile = { ...profile, ...mood };
    }
    const trough = profile.currentMood;
    expect(trough).toBeLessThan(45);
    for (let month = 0; month < 8; month += 1)
      profile = normalizeSupporterSentiment(profile, "2027-01-01");
    expect(profile.currentMood).toBeGreaterThan(trough);
    expect(Math.abs(profile.currentMood - profile.baselineMood)).toBeLessThan(4);
  });

  it("derives unrest from sustained conditions and feeds it to the board as pressure only", () => {
    const angry = profileFor({
      currentMood: 10,
      baselineMood: 60,
      trustInOwnership: 12,
      trustInManager: 8,
    });
    expect(supporterUnrestState(angry)).toBe("PROTESTING");
    expect(supporterUnrestState(profileFor({ currentMood: 70, trustInOwnership: 70 }))).toBe(
      "CONTENT",
    );
    const pressure = supporterBoardPressureModifier({ ...angry, unrest: "PROTESTING" });
    expect(pressure).toBeGreaterThanOrEqual(-6);
    expect(pressure).toBeLessThan(0);
    expect(
      supporterBoardPressureModifier(profileFor({ trustInManager: 95, unrest: "CONTENT" })),
    ).toBeLessThanOrEqual(4);
  });

  it("moves supporter approval of the manager on performance versus expectation", () => {
    const profile = profileFor();
    const good = nextManagerApproval(profile, { performanceVsExpectation: 35, trophy: true });
    const bad = nextManagerApproval(profile, {
      performanceVsExpectation: -35,
      soldFanFavourite: true,
    });
    expect(good).toBeGreaterThan(profile.trustInManager);
    expect(bad).toBeLessThan(profile.trustInManager);
    expect(good).toBeLessThanOrEqual(100);
    expect(bad).toBeGreaterThanOrEqual(0);
  });
});

describe("supporter culture phase A: promotion, relegation and long-term growth", () => {
  it("grows interest on promotion and sheds casual support faster than the core on relegation", () => {
    const profile = profileFor({ loyalty: 80 });
    const promoted = applyPromotionEffect(profile, { newTier: 1, date: "2027-06-01" });
    expect(promoted.casualAudience).toBeGreaterThan(profile.casualAudience);
    expect(promoted.optimism).toBeGreaterThan(profile.optimism);
    const relegated = applyRelegationEffect(profile, { newTier: 2, date: "2027-06-01" });
    const casualLoss = 1 - relegated.casualAudience / profile.casualAudience;
    const coreLoss = 1 - relegated.activeFanbase / profile.activeFanbase;
    expect(casualLoss).toBeGreaterThan(coreLoss);
    expect(relegated.activeFanbase).toBeGreaterThan(profile.activeFanbase * 0.85);
  });

  it("lets a small club grow over sustained success without runaway or negative values", () => {
    let profile = initialSupporterCultureProfile({
      clubId: "club:small" as EntityId,
      tier: 3,
      seed: "growth",
      date: "2026-08-01",
      reputation: 2,
      populationContext: 30,
    });
    const start = profile.activeFanbase;
    for (let season = 0; season < 12; season += 1) {
      profile = evolveSupporterBaseSeason(profile, {
        date: `${2027 + season}-06-01`,
        tier: season < 3 ? 3 : season < 6 ? 2 : 1,
        finishShare: 0.05,
        trophies: season > 5 ? 1 : 0,
        promoted: season === 3 || season === 6,
        reputation: Math.min(9, 2 + season * 0.6),
      });
      bounded(profile);
    }
    expect(profile.activeFanbase).toBeGreaterThan(start);
    // Twelve dominant seasons grow a club substantially, never exponentially.
    expect(profile.activeFanbase).toBeLessThan(start * 6);

    let decline = profile;
    for (let season = 0; season < 12; season += 1) {
      decline = evolveSupporterBaseSeason(decline, {
        date: `${2039 + season}-06-01`,
        tier: 3,
        finishShare: 0.95,
        relegated: season === 0,
        reputation: 2,
      });
      bounded(decline);
    }
    expect(decline.activeFanbase).toBeLessThan(profile.activeFanbase);
    expect(decline.activeFanbase).toBeGreaterThan(0);
  });

  it("scales trophy, star signing and player sale reactions to context", () => {
    const profile = profileFor();
    expect(
      applyTrophyEffect(profile, { competitionImportance: 90, expectedShare: 0.9, date: "d" })
        .optimism,
    ).toBeGreaterThan(profile.optimism);
    const signing = applyStarSigningEffect(profile, { playerReputation: 90, date: "d" });
    expect(signing.casualAudience).toBeLessThan(profile.casualAudience * 1.05);
    const cheapSale = applyPlayerSaleEffect(profile, {
      playerAffinity: 95,
      feeQuality: 5,
      date: "d",
    });
    const goodSale = applyPlayerSaleEffect(profile, {
      playerAffinity: 95,
      feeQuality: 95,
      financialDistress: 90,
      replacementQuality: 70,
      date: "d",
    });
    expect(cheapSale.currentMood).toBeLessThan(goodSale.currentMood);
  });
});

describe("supporter culture phase A: rivalries", () => {
  it("builds intensity from repeated meaningful meetings but keeps it bounded", () => {
    let rivalry = createRivalry({
      clubId: "a" as EntityId,
      rivalClubId: "b" as EntityId,
      origin: "GEOGRAPHIC",
      historicBaseline: 30,
      date: "2026-08-01",
    });
    const single = nextRivalryIntensity(rivalry, { date: "2026-08-10" });
    expect(single.intensity - rivalry.intensity).toBeLessThanOrEqual(4);
    for (let meeting = 0; meeting < 60; meeting += 1) {
      rivalry = nextRivalryIntensity(rivalry, {
        date: "2027-01-01",
        titleBattle: true,
        cupFinal: true,
        controversialMatch: true,
      });
    }
    expect(rivalry.intensity).toBeLessThanOrEqual(100);
    expect(rivalry.intensity).toBeGreaterThan(60);
    expect(rivalry.meetings).toBe(60);
  });

  it("decays slowly when clubs stop meeting but never below the historic baseline", () => {
    let rivalry = createRivalry({
      clubId: "a" as EntityId,
      rivalClubId: "b" as EntityId,
      origin: "HISTORIC",
      historicBaseline: 55,
      date: "2026-08-01",
    });
    for (let meeting = 0; meeting < 10; meeting += 1)
      rivalry = nextRivalryIntensity(rivalry, { date: "2027-01-01", titleBattle: true });
    const peak = rivalry.intensity;
    for (let month = 0; month < 60; month += 1)
      rivalry = nextRivalryIntensity(rivalry, {
        date: "2032-01-01",
        met: false,
        monthsSinceLastMeeting: 1,
      });
    expect(rivalry.intensity).toBeLessThan(peak);
    expect(rivalry.intensity).toBeGreaterThanOrEqual(55);
  });
});

describe("supporter culture phase A: commercial, national teams and persistence", () => {
  it("supplies a bounded commercial engagement input without minting money", () => {
    const weak = supporterCommercialEngagementIndex(
      profileFor({
        activeFanbase: 300,
        commercialEngagement: 10,
        nationalReach: 5,
        socialReach: 5,
      }),
    );
    const strong = supporterCommercialEngagementIndex(
      profileFor({
        activeFanbase: 40000,
        commercialEngagement: 95,
        nationalReach: 95,
        socialReach: 95,
      }),
    );
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeLessThanOrEqual(1.9);
    expect(weak).toBeGreaterThanOrEqual(0.5);
  });

  it("moves national team support on results and qualification within bounds", () => {
    let state = initialNationalTeamSupporterState({
      nationalTeamId: "nt:nepal" as EntityId,
      date: "2026-08-01",
    });
    const womens = initialNationalTeamSupporterState({
      nationalTeamId: "nt:nepal-w" as EntityId,
      gender: "women",
      date: "2026-08-01",
    });
    expect(womens.support).toBeLessThan(state.support);
    for (let match = 0; match < 30; match += 1) {
      state = nextNationalTeamSupporterState(state, {
        date: "2027-01-01",
        recentResultScore: 8,
        qualified: match === 10,
        competitionImportance: 80,
      });
      expect(state.support).toBeLessThanOrEqual(100);
      expect(state.support).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(state.mood)).toBe(true);
    }
    expect(state.support).toBeGreaterThan(60);
  });

  it("persists supporter state, rivalries and events across save reload", () => {
    const path = createSave("persist");
    const first = openGameDatabase(path);
    initializeClubEconomyForSave({ db: first, worldDate: "2026-08-01", seed: "persist" });
    const [profile] = initializeSupporterCultureForSave({
      db: first,
      worldDate: "2026-08-01",
      seed: "persist",
    });
    const repository = new SupporterCultureRepository(first);
    repository.upsertRivalry(
      createRivalry({
        clubId: profile!.clubId,
        rivalClubId: "club:rival" as EntityId,
        origin: "GEOGRAPHIC",
        historicBaseline: 62,
        date: "2026-08-01",
      }),
    );
    const evolved = evolveSupporterCultureSeason(first, profile!.clubId, {
      date: "2027-06-01",
      tier: 1,
      finishShare: 0.1,
      promoted: true,
      trophies: 1,
    })!;
    first.close();

    const second = openGameDatabase(path);
    const reloaded = new SupporterCultureRepository(second);
    expect(reloaded.profile(profile!.clubId)).toEqual(evolved);
    expect(reloaded.rivalry(profile!.clubId, "club:rival" as EntityId)?.historicBaseline).toBe(62);
    expect(reloaded.events(profile!.clubId).some((event) => event.type === "PROMOTION")).toBe(true);

    // The same state continues deterministically after reload.
    const continuedAfterReload = evolveSupporterCultureSeason(second, profile!.clubId, {
      date: "2028-06-01",
      tier: 1,
      finishShare: 0.2,
    });
    const control = evolveSupporterBaseSeason(evolved, {
      date: "2028-06-01",
      tier: 1,
      finishShare: 0.2,
    });
    expect(continuedAfterReload).toEqual(control);

    const readModel = supporterReadModel(second, profile!.clubId)!;
    expect(readModel.supporterBase.activeFanbase).toBeGreaterThan(0);
    expect(readModel.topRivalries.length).toBeGreaterThan(0);
    expect(readModel.commercialEngagementIndex).toBeGreaterThan(0);
    second.close();
  });
});
