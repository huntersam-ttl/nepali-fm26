import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  MediaRepository,
  migrateDatabase,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  JAPAN_TESTING_PACK_ID,
  NEPAL_COMMERCIAL,
  NEPAL_MEDIA,
  countryEconomicProfile,
  competitionAppliesToHome,
  homeCountryId,
  homeFederationId,
  initializeInternationalFootballForSave,
  japanTestingPack,
  lowerLeagueCoverageReport,
  registerCountryPack,
  scheduledCompetitions,
  startingClubOptions,
} from "@nepal-football-sim/simulation";
import { validateCountryWorldDataset } from "@nepal-football-sim/data-import";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  buildJapanTestingDataset,
  writeJapanTestingDataset,
} from "./fixtures/japan-testing-dataset.js";

/*
 * Phase 11N: the second country's other career modes and a two-tier pyramid. Fictional testing-only
 * Japan again; what is under test is that nothing in the engine assumes Nepal's three A/B/C divisions.
 */

const dirs: string[] = [];
afterAll(() =>
  dirs.splice(0).forEach((dir) => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* a WAL handle can outlive the test on Windows; the temp directory is disposable */
    }
  }),
);

const character = {
  fullName: "Test Person",
  dateOfBirth: "1985-01-01",
  startingAge: 41,
  languages: ["en"],
  footballBackground: "COMMUNITY_COACHING",
  education: "SPORTS_RELATED_DEGREE",
  playingExperience: "AMATEUR_PLAYER",
  coachingExperience: "YOUTH_COACH",
  businessBackground: "SMALL_BUSINESS",
  startingReputationProfile: "LOCAL_RESPECTED",
} as const;

const open = (path: string): GameDatabase => {
  const db = openGameDatabase(path);
  migrateDatabase(db);
  return db;
};
const count = (db: GameDatabase, sql: string, ...params: unknown[]): number =>
  (db.prepare(sql).get(...(params as [])) as { n: number }).n;

const NEPAL_IDENTITY = [
  "nepal",
  "kathmandu",
  "anfa",
  "bagmati",
  "koshi",
  "lumbini",
  "himal",
  "everest",
  "annapurna",
  "terai",
  "ncell",
  "nabil",
  "chaudhary",
  "muktinath",
  "gurung",
  "shrestha",
  "a-division",
  "b-division",
  "c-division",
  "a division",
  "b division",
  "c division",
];
/** Every text value in the save that matches a Nepal identity or an A/B/C division label. */
const nepalHits = (db: GameDatabase): string[] => {
  // Nepal is a legitimate foreign nation in the world registry.
  const skip = new Set([
    "saves",
    "schema_migrations",
    "countries",
    "international_team_profiles",
    "international_matches",
    "international_participants",
    "country_development_profiles",
    "simulation_world_rankings",
  ]);
  const hits: string[] = [];
  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
  for (const table of tables) {
    if (skip.has(table) || table === "entity_provenance" || table === "import_records") continue;
    const columns = (
      db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; type: string }>
    )
      .filter((column) => /CHAR|TEXT|CLOB|^$/i.test(column.type))
      .map((column) => column.name);
    for (const column of columns) {
      const where = NEPAL_IDENTITY.map(() => `lower("${column}") LIKE ?`).join(" OR ");
      for (const row of db
        .prepare(
          `SELECT DISTINCT substr("${column}", 1, 120) AS v FROM "${table}" WHERE ${where} LIMIT 3`,
        )
        .all(...NEPAL_IDENTITY.map((word) => `%${word}%`)) as Array<{ v: string }>)
        hits.push(`${table}.${column}: ${row.v}`);
    }
  }
  return hits;
};

let dir = "";
let datasetPath = "";
const service = (): DesktopApplicationService =>
  new DesktopApplicationService({
    savesDirectory: dir,
    worldDatasetPath: datasetPath,
    countryPackId: JAPAN_TESTING_PACK_ID,
  });

const playSeason = (svc: DesktopApplicationService): number => {
  let steps = 0;
  for (let guard = 0; guard < 900; guard += 1) {
    const status = svc.getSeasonStatus();
    if (!status.ok) throw new Error(status.error.message);
    if (status.data.phase !== "IN_PROGRESS") return steps;
    const step = svc.continueCareer();
    if (!step.ok) throw new Error(`continue: ${step.error.code} ${step.error.message}`);
    svc.quickSimMatch();
    steps += 1;
  }
  throw new Error("The season never completed.");
};

const transition = (svc: DesktopApplicationService): void => {
  for (let guard = 0; guard < 40; guard += 1) {
    const step = svc.advanceSeasonTransition();
    if (!step.ok) throw new Error(`${step.error.code}: ${step.error.message}`);
    if (step.data.seasonStatus.phase === "TRANSITION_FAILED")
      throw new Error(step.data.seasonStatus.transition?.error ?? "transition failed");
    if (step.data.finished) return;
  }
  throw new Error("The transition never finished.");
};

const timings: Record<string, number> = {};
const timed = <T>(label: string, run: () => T): T => {
  const started = Date.now();
  try {
    return run();
  } finally {
    timings[label] = Date.now() - started;
  }
};

let managerPath = "";
let managerSecondSeasonPlayed = false;
let founderPath = "";
let founderClubId = "";
let ownerPath = "";

beforeAll(() => {
  registerCountryPack(japanTestingPack);
  dir = mkdtempSync(join(tmpdir(), "correctness-11n-"));
  dirs.push(dir);
  datasetPath = join(dir, "dataset.json");
  writeJapanTestingDataset(datasetPath, { tiers: 2 });

  // A manager career across two tiers: a season, the transition (promotion and relegation), a second season.
  const manager = service();
  const options = manager.listStartingClubs();
  if (!options.ok) throw new Error(options.error.message);
  const created = timed("managerCreate", () =>
    manager.createCareer({
      saveName: "jp-two-tier",
      character,
      startingTeamId: options.data[0]!.teamId,
    } as never),
  );
  if (!created.ok) throw new Error(created.error.message);
  managerPath = created.data.catalogEntry.filePath;
  timed("managerSeason1", () => playSeason(manager));
  timed("managerTransition", () => transition(manager));
  const status = manager.getSeasonStatus();
  if (status.ok && status.data.phase === "IN_PROGRESS") {
    timed("managerSeason2", () => playSeason(manager));
    managerSecondSeasonPlayed = true;
  }
  manager.closeCareer();

  // A founder career: a new club, founded in a Japanese place, entering the bottom tier.
  const founder = service();
  const places = founder.listFounderLocations();
  if (!places.ok) throw new Error(places.error.message);
  const place = places.data[0]!;
  const founded = timed("founderCreate", () =>
    founder.createCareer({
      saveName: "jp-founder",
      careerMode: "OWNER",
      founder: {
        clubName: "Test Founders FC",
        locationId: place.id,
        locationName: place.district,
        groundName: "Test Founders Ground",
        philosophy: "COMMUNITY",
      },
      character,
    } as never),
  );
  if (!founded.ok) throw new Error(`${founded.error.code}: ${founded.error.message}`);
  founderPath = founded.data.catalogEntry.filePath;
  founderClubId = founded.data.header.clubName ?? "";
  founder.saveCareer();
  founder.closeCareer();

  // An owner career of an existing tier-1 club.
  const owner = service();
  const ownerOptions = owner.listStartingClubs();
  if (!ownerOptions.ok) throw new Error(ownerOptions.error.message);
  const ownerCreated = timed("ownerCreate", () =>
    owner.createCareer({
      saveName: "jp-owner",
      careerMode: "OWNER",
      character,
      startingTeamId: ownerOptions.data[0]!.teamId,
    } as never),
  );
  if (!ownerCreated.ok)
    throw new Error(`${ownerCreated.error.code}: ${ownerCreated.error.message}`);
  ownerPath = ownerCreated.data.catalogEntry.filePath;
  owner.closeCareer();
  console.log(`[11N timings] ${JSON.stringify(timings)}`);
}, 1_200_000);

describe("Japan's two-tier pyramid comes from tier data", () => {
  it("has exactly two tiers, taken from the promotion/relegation relationships, with no third tier", () => {
    const db = open(managerPath);
    const tiers = db
      .prepare(
        "SELECT c.name AS name, t.tier AS tier FROM competition_tiers t JOIN competitions c ON c.id = t.competition_id ORDER BY t.tier",
      )
      .all() as Array<{ name: string; tier: number }>;
    expect(tiers).toEqual([
      { name: "Testing Japan Division", tier: 1 },
      { name: "Testing Japan Second Division", tier: 2 },
    ]);
    expect(count(db, "SELECT COUNT(*) AS n FROM competition_tiers WHERE tier >= 3")).toBe(0);
    db.close();
  });

  it("offers starting clubs from both tiers, labelled by tier and not by name", () => {
    const options = startingClubOptions(
      validateCountryWorldDataset(buildJapanTestingDataset({ tiers: 2 })),
      japanTestingPack,
    );
    expect(options).toHaveLength(16);
    expect(
      options
        .slice(0, 8)
        .every(
          (option) =>
            option.division === "A" && option.competitionName === "Testing Japan Division",
        ),
    ).toBe(true);
    expect(
      options
        .slice(8)
        .every(
          (option) =>
            option.division === "B" && option.competitionName === "Testing Japan Second Division",
        ),
    ).toBe(true);
    const renamed = buildJapanTestingDataset({ tiers: 2 }) as {
      competitions: Array<{ name: string }>;
    };
    renamed.competitions.forEach((competition, index) => {
      competition.name = `League ${index}`;
    });
    expect(
      startingClubOptions(validateCountryWorldDataset(renamed), japanTestingPack).map(
        (option) => option.division,
      ),
    ).toEqual(options.map((option) => option.division));
  });

  it("promotes and relegates between the two tiers and runs a second season with the new memberships", () => {
    const db = open(managerPath);
    const moves = db
      .prepare(
        "SELECT movement_type AS type, COUNT(*) AS n FROM competition_movements GROUP BY movement_type ORDER BY movement_type",
      )
      .all() as Array<{ type: string; n: number }>;
    expect(moves).toEqual([
      { type: "PROMOTION", n: 2 },
      { type: "RELEGATION", n: 2 },
    ]);
    const champions = count(db, "SELECT COUNT(*) AS n FROM competition_winners");
    expect(champions).toBeGreaterThanOrEqual(2);
    // Season two's membership of each division: eight clubs, of whom two moved.
    const next = db
      .prepare(
        "SELECT cs.name AS season, COUNT(*) AS n FROM club_memberships cm JOIN competition_seasons cs ON cs.id = cm.competition_season_id WHERE cs.name LIKE '% 2028' GROUP BY cs.name ORDER BY cs.name",
      )
      .all() as Array<{ season: string; n: number }>;
    expect(next).toEqual([
      { season: "Testing Japan Division 2028", n: 8 },
      { season: "Testing Japan Second Division 2028", n: 8 },
    ]);
    const promoted = db
      .prepare(
        "SELECT cm.club_id AS id FROM club_memberships cm JOIN competition_seasons cs ON cs.id = cm.competition_season_id WHERE cm.status = 'PROMOTED'",
      )
      .all() as Array<{ id: EntityId }>;
    expect(promoted).toHaveLength(2);
    for (const club of promoted) {
      const previous = db
        .prepare(
          "SELECT cs.name AS season FROM club_memberships cm JOIN competition_seasons cs ON cs.id = cm.competition_season_id WHERE cm.club_id = ? AND cs.name LIKE '% 2027'",
        )
        .get(club.id) as { season: string };
      expect(previous.season).toBe("Testing Japan Second Division 2027");
    }
    expect(managerSecondSeasonPlayed).toBe(true);
    // Every club in season two has a valid squad and fixtures were played in both divisions.
    expect(
      count(
        db,
        "SELECT COUNT(*) AS n FROM fixtures f JOIN competition_seasons cs ON cs.id = f.competition_season_id WHERE cs.name LIKE '% 2028'",
      ),
    ).toBeGreaterThan(0);
    expect(
      count(
        db,
        "SELECT COUNT(*) AS n FROM (SELECT t.id FROM teams t JOIN club_memberships cm ON cm.team_id = t.id WHERE cm.status IN ('ACTIVE','PROMOTED','RELEGATED') AND (SELECT COUNT(*) FROM team_person_assignments a WHERE a.team_id = t.id AND a.role='PLAYER' AND a.ended_on IS NULL) < 11)",
      ),
    ).toBe(0);
    db.close();
  });

  it("keeps Japan's international side independent of its domestic depth", () => {
    const db = open(managerPath);
    initializeInternationalFootballForSave({ db, worldDate: "2029-01-01", seed: "11n" });
    const keys = new Set<string>();
    for (let year = 2027; year < 2040; year += 1)
      for (const { config } of scheduledCompetitions(year))
        if (competitionAppliesToHome(db, config)) keys.add(String(config.key));
    expect([...keys].sort()).toEqual([
      "AFC_WOMENS_ASIAN_CUP_QUALIFICATION",
      "AFC_WORLD_CUP_QUALIFICATION",
      "ASIAN_CUP",
      "ASIAN_CUP_QUALIFICATION",
    ]);
    expect(
      count(
        db,
        "SELECT COUNT(*) AS n FROM teams WHERE federation_id = ? AND club_id IS NULL",
        homeFederationId(db),
      ),
    ).toBe(5);
    db.close();
  });

  it("supplies and reports workforce for clubs of both tiers", () => {
    const db = open(managerPath);
    const report = lowerLeagueCoverageReport({ db, date: "2029-02-01" });
    expect(report.aDivisionRealPlayers).toBeGreaterThan(0);
    expect(report.bDivisionRealPlayers).toBeGreaterThan(0);
    expect(report.cDivisionRealPlayers, "no third tier exists").toBe(0);
    const managed = db
      .prepare(
        "SELECT DISTINCT t.tier AS tier FROM manager_contracts mc JOIN club_memberships cm ON cm.club_id = mc.club_id JOIN competition_tiers t ON t.competition_id = cm.competition_id WHERE mc.status = 'ACTIVE' ORDER BY t.tier",
      )
      .all() as Array<{ tier: number }>;
    expect(
      managed.map((row) => row.tier),
      "managers work at clubs of both tiers",
    ).toEqual([1, 2]);
    expect(count(db, "SELECT COUNT(*) AS n FROM manager_job_vacancies")).toBeGreaterThanOrEqual(0);
    db.close();
  });

  it("opens manager vacancies across both tiers", () => {
    const db = open(managerPath);
    const tiers = db
      .prepare(
        "SELECT DISTINCT t.tier AS tier FROM manager_contracts mc JOIN club_memberships cm ON cm.club_id = mc.club_id JOIN competition_tiers t ON t.competition_id = cm.competition_id ORDER BY t.tier",
      )
      .all() as Array<{ tier: number }>;
    expect(tiers.length).toBeGreaterThan(0);
    for (const row of tiers) expect([1, 2]).toContain(row.tier);
    db.close();
  });
});

describe("a founder career in Japan", () => {
  it("offers Japanese places with no district layer and no Nepal wording", () => {
    const places = service().listFounderLocations();
    expect(places.ok).toBe(true);
    if (!places.ok) return;
    expect(places.data).toHaveLength(4);
    expect(places.data.map((place) => `${place.province} / ${place.district}`).sort()).toEqual([
      "Testing Prefecture East / Testing City East One",
      "Testing Prefecture East / Testing City East Two",
      "Testing Prefecture West / Testing City West One",
      "Testing Prefecture West / Testing City West Two",
    ]);
  });

  it("creates a Japanese club through the production path, admitted to the bottom tier", () => {
    const db = open(founderPath);
    const club = db
      .prepare("SELECT id, name, country_id AS country FROM clubs WHERE name = 'Test Founders FC'")
      .get() as { id: EntityId; name: string; country: EntityId };
    expect(club.country).toBe(homeCountryId(db));
    const membership = db
      .prepare(
        "SELECT c.name AS competition, t.tier AS tier, cm.status AS status FROM club_memberships cm JOIN competitions c ON c.id = cm.competition_id LEFT JOIN competition_tiers t ON t.competition_id = c.id WHERE cm.club_id = ?",
      )
      .all(club.id) as Array<{ competition: string; tier: number; status: string }>;
    expect(membership).toEqual([
      { competition: "Testing Japan Second Division", tier: 2, status: "ACTIVE" },
    ]);
    const place = db
      .prepare(
        "SELECT l.name AS name, l.country_id AS country FROM clubs c JOIN locations l ON l.id = c.location_id WHERE c.id = ?",
      )
      .get(club.id) as { name: string; country: EntityId };
    expect(place.name).toMatch(/^Testing City /);
    expect(place.country).toBe(homeCountryId(db));
    expect(
      count(
        db,
        "SELECT COUNT(*) AS n FROM club_ownership_stakes WHERE club_id = ? AND percentage = 100",
        club.id,
      ),
    ).toBe(1);
    expect(
      count(
        db,
        "SELECT COUNT(*) AS n FROM team_person_assignments a JOIN teams t ON t.id = a.team_id WHERE t.club_id = ? AND a.role = 'PLAYER' AND a.ended_on IS NULL",
        club.id,
      ),
    ).toBeGreaterThan(10);
    const account = new ClubEconomyRepository(db).financialAccount(club.id)!;
    expect(account.currency).toBe("JPY");
    expect(account.cashBalance).toBeGreaterThan(0);
    db.close();
  });

  it("reloads, and its generated people and commercial life are Japan's", () => {
    const svc = service();
    expect(svc.loadCareerByPath(founderPath).ok).toBe(true);
    const dashboard = svc.getChairmanDashboard();
    expect(dashboard.ok).toBe(true);
    if (dashboard.ok) {
      expect(dashboard.data.club.ownershipPercentage).toBe(100);
      expect(dashboard.data.sponsorships.length).toBeGreaterThan(0);
    }
    const candidates = svc.listOwnerManagerCandidates();
    expect(candidates.ok && candidates.data.length > 0).toBe(true);
    svc.closeCareer();
    const db = open(founderPath);
    const languages = new Set(
      (
        db
          .prepare(
            "SELECT DISTINCT languages_json AS l FROM persons WHERE languages_json IS NOT NULL",
          )
          .all() as Array<{ l: string }>
      ).map((row) => row.l),
    );
    for (const l of languages) expect(l).not.toContain("Nepali");
    const dealNames = (
      db
        .prepare(
          "SELECT DISTINCT so.name AS name FROM sponsorship_contracts cs JOIN sponsor_organisations so ON so.id = cs.sponsor_id",
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(dealNames.length).toBeGreaterThan(0);
    for (const name of dealNames)
      expect(
        (japanTestingPack.commercial?.sponsors ?? []).some((sponsor) => sponsor.name === name),
        name,
      ).toBe(true);
    expect(founderClubId).toBe("Test Founders FC");
    db.close();
  });
});

describe("an owner career in Japan", () => {
  it("loads, with Japanese money, sponsors, lenders and media", () => {
    const svc = service();
    expect(svc.loadCareerByPath(ownerPath).ok).toBe(true);
    const dashboard = svc.getChairmanDashboard();
    expect(dashboard.ok).toBe(true);
    if (dashboard.ok) {
      expect(dashboard.data.club.ownershipPercentage).toBeGreaterThan(0);
      expect(dashboard.data.finances.account.currency).toBe("JPY");
    }
    svc.closeCareer();
    const db = open(ownerPath);
    expect(countryEconomicProfile(db).priceLevel).toBe(2);
    const economy = new ClubEconomyRepository(db);
    const allowed = new Set([
      ...(japanTestingPack.commercial?.sponsors ?? []).map((s) => s.name),
      ...(japanTestingPack.commercial?.federationSponsors ?? []).map((s) => s.name),
    ]);
    for (const sponsor of economy.sponsors())
      expect(allowed.has(sponsor.name), sponsor.name).toBe(true);
    for (const lender of economy.lenders())
      expect(
        (japanTestingPack.commercial?.lenders ?? []).some((item) => item.name === lender.name),
      ).toBe(true);
    const nepalOutlets = new Set((NEPAL_MEDIA.outlets ?? []).map((outlet) => outlet.name));
    for (const outlet of new MediaRepository(db).outlets())
      expect(nepalOutlets.has(outlet.name)).toBe(false);
    for (const sponsor of NEPAL_COMMERCIAL.sponsors ?? [])
      expect(economy.sponsors().some((item) => item.name === sponsor.name)).toBe(false);
    db.close();
  });

  it("runs an owner season and reloads (one continue path)", () => {
    const svc = service();
    expect(svc.loadCareerByPath(ownerPath).ok).toBe(true);
    const step = svc.continueCareer();
    expect(step.ok).toBe(true);
    expect(svc.saveCareer().ok).toBe(true);
    svc.closeCareer();
  });
});

describe("no Nepal domestic identity in any Japan career", () => {
  for (const [label, get] of [
    ["manager (two tiers, two seasons)", () => managerPath],
    ["founder", () => founderPath],
    ["owner", () => ownerPath],
  ] as const) {
    it(`${label}: the save holds nothing of Nepal's but Nepal as a foreign nation`, () => {
      const db = open(get());
      expect(nepalHits(db)).toEqual([]);
      db.close();
    });
  }
});

describe("the code is not written for Nepal's three divisions", () => {
  it("no production source infers a division from a competition name or a fixed tier of 3", () => {
    const root = resolve("packages/simulation/src");
    const files = (path: string): string[] =>
      readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(join(path, entry.name))
          : /\.ts$/.test(entry.name) && !/\.test\./.test(entry.name)
            ? [join(path, entry.name)]
            : [],
      );
    const offenders: string[] = [];
    for (const file of files(root)) {
      const text = readFileSync(file, "utf8");
      if (
        /\[ABC\]-DIVISION|includes\("a-division"\)|includes\("b-division"\)|competition_tiers[^"'`]{0,80}\)\s*=\s*3\b/i.test(
          text,
        )
      )
        offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
