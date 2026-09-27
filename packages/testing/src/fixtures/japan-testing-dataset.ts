import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/*
 * TESTING-ONLY dataset for the second-country smoke test. Every place, club, and person is
 * fictional and marked SIMULATION_ONLY; nothing here is real Japanese football data. It is the
 * smallest world the generic save path can run a season on: one federation, two "prefectures" of
 * cities (no districts), one eight-club league and eighteen players per club.
 */

const provenance = {
  sourceId: "testing-japan-fixture",
  sourceName: "Testing-only Japan fixture (fictional)",
  retrievedAt: "2027-01-01T00:00:00.000Z",
  confidence: 1,
  confidenceLevel: "HIGH",
  status: "SIMULATION_ONLY",
  notes: "Fictional data for a portability test; not a real-world record.",
} as const;
const fact = <T>(value: T) => ({ value, status: "SIMULATION_ONLY" as const, provenance });
const unknown = { status: "UNKNOWN" as const };

const PREFECTURES = [
  {
    key: "testing-prefecture-east",
    name: "Testing Prefecture East",
    cities: ["Testing City East One", "Testing City East Two"],
  },
  {
    key: "testing-prefecture-west",
    name: "Testing Prefecture West",
    cities: ["Testing City West One", "Testing City West Two"],
  },
] as const;

const CLUB_NAMES = [
  "Test Aoba FC",
  "Test Benten FC",
  "Test Chidori FC",
  "Test Daiwa FC",
  "Test Enishi FC",
  "Test Fuji-Test FC",
  "Test Gion FC",
  "Test Hikari FC",
  "Test Ibuki FC",
  "Test Jinbo FC",
  "Test Kasumi FC",
  "Test Lumen FC",
  "Test Mizuho FC",
  "Test Nagisa FC",
  "Test Ouka FC",
  "Test Pine-Test FC",
];
const CLUBS_PER_TIER = 8;
const TIERS = [
  { key: "testing-japan-division", name: "Testing Japan Division" },
  { key: "testing-japan-second-division", name: "Testing Japan Second Division" },
] as const;

export type JapanTestingDatasetOptions = {
  /** How many domestic tiers of eight clubs the world has: 1 (the default) or 2. */
  tiers?: 1 | 2;
};

const POSITIONS = [
  "GK",
  "GK",
  "RB",
  "CB",
  "CB",
  "CB",
  "LB",
  "DM",
  "DM",
  "CM",
  "CM",
  "CM",
  "AM",
  "RW",
  "LW",
  "ST",
  "ST",
  "ST",
] as const;
const GROUP = {
  GK: "GOALKEEPER",
  RB: "DEFENDER",
  CB: "DEFENDER",
  LB: "DEFENDER",
  DM: "MIDFIELDER",
  CM: "MIDFIELDER",
  AM: "MIDFIELDER",
  RW: "FORWARD",
  LW: "FORWARD",
  ST: "FORWARD",
} as const;

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** A small deterministic pseudo-random stream, so the fixture is identical on every build. */
const stream = (seed: string) => {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return (): number => {
    state = Math.imul(state ^ (state >>> 15), 2246822507) >>> 0;
    state = Math.imul(state ^ (state >>> 13), 3266489909) >>> 0;
    return ((state ^ (state >>> 16)) >>> 0) / 4294967296;
  };
};

const GIVEN = [
  "Haruto",
  "Ren",
  "Sora",
  "Kaito",
  "Yuma",
  "Daichi",
  "Riku",
  "Takumi",
  "Hinata",
  "Yuto",
  "Sota",
  "Kenta",
  "Naoki",
  "Shota",
];
const FAMILY = [
  "Akimori",
  "Tsukishiro",
  "Nagamine",
  "Fujimaru",
  "Hoshizaki",
  "Mizukawa",
  "Amagawa",
  "Kuramori",
  "Shiraishi",
  "Minakata",
  "Uryuzaki",
  "Tachibara",
  "Kusanagi",
  "Yamanaka",
  "Kirishima",
  "Tanikawa",
];

export const buildJapanTestingDataset = (
  options: JapanTestingDatasetOptions = {},
): Record<string, unknown> => {
  const tierCount = options.tiers ?? 1;
  const tierDefs = TIERS.slice(0, tierCount);
  const federationKey = tierCount > 1 ? fact("tjfa") : unknown;
  const locations: unknown[] = [];
  const cityKeys: string[] = [];
  for (const prefecture of PREFECTURES) {
    locations.push({
      key: prefecture.key,
      countryKey: "jp",
      name: prefecture.name,
      kind: "province",
      provenance,
      canonicalExternalId: `JP-TEST-${slug(prefecture.name).toUpperCase()}`,
    });
    for (const city of prefecture.cities) {
      const key = slug(city);
      cityKeys.push(key);
      locations.push({
        key,
        countryKey: "jp",
        name: city,
        kind: "city",
        parentLocationKey: fact(prefecture.key),
        provenance,
        canonicalExternalId: `JP-TEST-${key.toUpperCase()}`,
      });
    }
  }

  const clubs: unknown[] = [];
  const teams: unknown[] = [];
  const memberships: unknown[] = [];
  const persons: unknown[] = [];
  const personRoles: unknown[] = [];
  const assignments: unknown[] = [];
  const attributes: unknown[] = [];
  const profiles: unknown[] = [];

  CLUB_NAMES.slice(0, tierCount * CLUBS_PER_TIER).forEach((name, clubIndex) => {
    const tier = tierDefs[Math.floor(clubIndex / CLUBS_PER_TIER)]!;
    const clubKey = `JPT-CLB-${String(clubIndex + 1).padStart(2, "0")}`;
    const teamKey = `${clubKey}-MEN`;
    clubs.push({
      key: clubKey,
      canonicalExternalId: clubKey,
      countryKey: "jp",
      name,
      officialName: fact(name),
      shortName: fact(name.replace(" FC", "")),
      locationKey: fact(cityKeys[clubIndex % cityKeys.length]!),
      ownershipType: fact("PRIVATE"),
      organisationType: fact("CLUB"),
      foundedYear: unknown,
      provenance,
    });
    teams.push({
      key: teamKey,
      canonicalExternalId: teamKey,
      name: `${name} Men's First Team`,
      clubKey: fact(clubKey),
      level: "senior",
      gender: "men",
      provenance,
    });
    memberships.push({
      key: `membership-${clubKey}`,
      clubKey,
      teamKey: fact(teamKey),
      competitionKey: tier.key,
      competitionSeasonKey: fact(`${tier.key}-2027`),
      membershipType: "LEAGUE_MEMBER",
      status: "ACTIVE",
      provenance,
    });

    POSITIONS.forEach((position, index) => {
      const next = stream(`${clubKey}:${index}`);
      const personKey = `jpt-player-${clubIndex + 1}-${index + 1}`;
      const fullName = `${GIVEN[Math.floor(next() * GIVEN.length)]} ${FAMILY[Math.floor(next() * FAMILY.length)]}`;
      const rating = (base: number): number =>
        Math.max(3, Math.min(17, Math.round(base + (next() - 0.5) * 6)));
      const level = 7 + Math.floor(next() * 5);
      const birthYear = 1994 + Math.floor(next() * 9);
      const dob = `${birthYear}-${String(1 + Math.floor(next() * 12)).padStart(2, "0")}-${String(1 + Math.floor(next() * 27)).padStart(2, "0")}`;
      persons.push({
        key: personKey,
        fullName,
        displayName: fact(fullName),
        dateOfBirth: unknown,
        nationalityCountryKey: "jp",
        genderPresentation: unknown,
        placeOfBirthLocationKey: unknown,
        hometownLocationKey: unknown,
        languages: unknown,
        provenance,
      });
      personRoles.push({
        key: `role-${personKey}`,
        personKey,
        role: "PLAYER",
        activeFrom: fact("2027-01-01"),
        provenance,
      });
      assignments.push({
        key: `assignment-${personKey}`,
        personKey,
        teamKey,
        role: "PLAYER",
        startedOn: fact("2027-01-01"),
        provenance,
      });
      const isKeeper = position === "GK";
      attributes.push({
        key: `attr-${personKey}`,
        personKey,
        primaryPosition: position,
        secondaryPositions: [],
        technical: {
          firstTouch: rating(level),
          passing: rating(level),
          crossing: rating(level),
          dribbling: rating(level),
          finishing: rating(level),
          heading: rating(level),
          tackling: rating(level),
          technique: rating(level),
          longShots: rating(level),
          setPieces: rating(level),
        },
        mental: {
          decisions: rating(level),
          vision: rating(level),
          composure: rating(level),
          positioning: rating(level),
          anticipation: rating(level),
          workRate: rating(level),
          teamwork: rating(level),
          leadership: rating(level),
          aggression: rating(level),
          determination: rating(level),
          professionalism: rating(level),
        },
        physical: {
          pace: rating(level),
          acceleration: rating(level),
          strength: rating(level),
          stamina: rating(level),
          agility: rating(level),
          balance: rating(level),
          jumping: rating(level),
          naturalFitness: rating(level),
        },
        goalkeeping: {
          handling: rating(isKeeper ? level : 3),
          reflexes: rating(isKeeper ? level : 3),
          oneOnOnes: rating(isKeeper ? level : 3),
          aerialReach: rating(isKeeper ? level : 3),
          kicking: rating(isKeeper ? level : 3),
          distribution: rating(isKeeper ? level : 3),
          commandOfArea: rating(isKeeper ? level : 3),
        },
        provenance,
      });
      profiles.push({
        key: `factual-${personKey}`,
        playerKey: personKey,
        canonicalExternalId: `JPT-PLY-${clubIndex + 1}-${index + 1}`,
        currentClubKey: fact(clubKey),
        nameVariants: [],
        factualSecondaryPositions: [],
        factualPositionGroup: GROUP[position],
        positionPrecision: "GENERAL",
        squadStatus: "UNKNOWN",
        dateOfBirth: unknown,
        nationality: fact("Japan"),
        previousClubs: [],
        factualContractStatus: "UNKNOWN",
        recordStatus: "UNKNOWN",
        confidenceLevel: "HIGH",
        lastVerified: "2027-01-01",
        simulationPrimaryPosition: position,
        simulationPrimaryPositionStatus: "SIMULATION_ONLY",
        simulationAgeProfile: "PRIME",
        simulationDateOfBirth: dob,
        simulationDateOfBirthStatus: "SIMULATION_ONLY",
        simulationHeightCm: 165 + Math.floor(next() * 30),
        simulationHeightStatus: "SIMULATION_ONLY",
        simulationPreferredFoot: next() < 0.75 ? "RIGHT" : "LEFT",
        simulationPreferredFootStatus: "SIMULATION_ONLY",
        currentAbility: level + next(),
        potentialAbility: level + 1 + next() * 2,
        reputation: 30 + next() * 30,
        hiddenTraits: {
          professionalism: 10,
          consistency: 12,
          ambition: 12,
          adaptability: 10,
          pressureHandling: 10,
          injuryProneness: 6,
          developmentRate: 1,
          status: "SIMULATION_ONLY",
        },
        evidence: [],
        provenance,
      });
    });
  });

  return {
    meta: {
      datasetId: "testing-japan-2027",
      targetDatabaseDate: "2027-01",
      description: "Testing-only fictional Japan portability fixture",
      provenance,
    },
    countries: [{ key: "jp", name: "Japan", isoCode: "JP", provenance }],
    locations,
    venues: [],
    federations: [
      {
        key: "tjfa",
        countryKey: "jp",
        name: "Testing Japan Football Association",
        foundedYear: unknown,
        provenance,
      },
    ],
    competitions: tierDefs.map((tier) => ({
      key: tier.key,
      federationKey,
      name: tier.name,
      scope: "domestic",
      category: "PYRAMID_LEAGUE",
      provenance,
    })),
    competitionSeasons: tierDefs.map((tier) => ({
      key: `${tier.key}-2027`,
      competitionKey: tier.key,
      name: `${tier.name} 2027`,
      startDate: "2027-02-01",
      endDate: "2027-12-15",
      provenance,
    })),
    competitionRules: tierDefs.map((tier, index) => ({
      key: `rules-${tier.key}-2027`,
      competitionSeasonKey: `${tier.key}-2027`,
      competitionType: "ROUND_ROBIN",
      pointsForWin: 3,
      pointsForDraw: 1,
      pointsForLoss: 0,
      tiebreakers: ["points", "goalDifference", "goalsScored", "wins"],
      numberOfRounds: 2,
      homeAwayStructure: "double",
      seasonStartDate: "2027-02-01",
      seasonEndDate: "2027-12-15",
      roundSpacingDays: 14,
      promotionSlots: tierCount > 1 && index === 1 ? 2 : 0,
      relegationSlots: tierCount > 1 && index === 0 ? 2 : 0,
      continentalQualificationSlots: 0,
      ...(tierCount > 1 ? {} : { promotionEnabled: false, relegationEnabled: false }),
      provenance,
    })),
    competitionRelationships:
      tierCount > 1
        ? [
            {
              key: "rel-first-relegation-second",
              fromCompetitionKey: TIERS[0].key,
              toCompetitionKey: TIERS[1].key,
              movementType: "RELEGATION",
              numberOfTeams: 2,
              selectionMethod: "BOTTOM_TABLE",
              provenance,
            },
            {
              key: "rel-second-promotion-first",
              fromCompetitionKey: TIERS[1].key,
              toCompetitionKey: TIERS[0].key,
              movementType: "PROMOTION",
              numberOfTeams: 2,
              selectionMethod: "TOP_TABLE",
              provenance,
            },
          ]
        : [],
    clubs,
    clubAliases: [],
    teams,
    clubRelationships: [],
    clubMemberships: memberships,
    academies: [],
    venueRelationships: [],
    locationTravelContexts: [],
    staffProfiles: [],
    staffAppointments: [],
    persons,
    personRoles,
    teamPersonAssignments: assignments,
    playerAttributes: attributes,
    playerFactualProfiles: profiles,
  };
};

export const writeJapanTestingDataset = (
  path: string,
  options: JapanTestingDatasetOptions = {},
): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(buildJapanTestingDataset(options)));
};
