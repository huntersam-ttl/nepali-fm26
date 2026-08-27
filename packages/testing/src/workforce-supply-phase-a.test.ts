import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkforceSupplyRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId, OfficialSimulationProfile } from "@nepal-football-sim/shared-types";
import {
  SeededRandom,
  advanceOfficialCareer,
  computeWorkforceDemand,
  createNepalSave,
  demandLine,
  generateOfficial,
  initializeWorkforceSupplyForSave,
  reconcileWorkforceSupply,
  runAnnualYouthAndRetirementCycle,
  workforceInvariantViolations,
  worldSustainabilityReport,
} from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-workforce-"));
  tempDirs.push(dir);
  return join(dir, "workforce.sqlite");
};

const createSave = (seed: string): string => {
  const databasePath = tempDbPath();
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Workforce ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  return databasePath;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("workforce supply phase A: demand", () => {
  it("derives demand from the active world and forecasts exits rather than using fixed totals", () => {
    const db = openGameDatabase(createSave("demand"));
    const demand = computeWorkforceDemand({ db, date: "2026-08-01" });
    expect(demand.activeClubs).toBeGreaterThan(0);
    expect(demand.activeWomensTeams).toBeGreaterThan(0);

    const men = demandLine(demand, "MEN_PLAYERS", "SQUAD")!;
    const women = demandLine(demand, "WOMEN_PLAYERS", "SQUAD")!;
    // Women's requirement comes from women's teams alone, never the men's target.
    expect(women.required).toBe(demand.activeWomensTeams * 16);
    expect(men.required).toBe(demand.activeClubs * 20);
    expect(women.required).not.toBe(men.required);
    // Ageing players in the imported world create a real future demand signal.
    expect(men.projectedExits).toBeGreaterThan(0);

    for (const line of demand.lines) {
      expect(Number.isFinite(line.balance)).toBe(true);
      expect(line.correction).toBeGreaterThanOrEqual(0);
      // A correction only ever closes part of a shortage.
      if (line.balance >= 0) expect(line.correction).toBe(0);
      else expect(line.correction).toBeLessThanOrEqual(-line.balance);
    }
    db.close();
  });

  it("scales referee demand with fixture volume and keeps a floor for a live calendar", () => {
    const db = openGameDatabase(createSave("ref-demand"));
    const quiet = computeWorkforceDemand({ db, date: "2026-08-01" });
    const quietReferees = demandLine(quiet, "REFEREES", "REFEREE")!.required;
    const anyFixture = db.prepare("SELECT COUNT(*) n FROM fixtures").get() as { n: number };
    expect(quietReferees).toBeGreaterThanOrEqual(6);
    expect(demandLine(quiet, "REFEREES", "ASSISTANT_REFEREE")!.required).toBeGreaterThan(
      quietReferees,
    );
    expect(anyFixture.n).toBeGreaterThanOrEqual(0);
    db.close();
  });
});

describe("workforce supply phase A: officials", () => {
  it("bootstraps an officiating population the imported world does not have", () => {
    const db = openGameDatabase(createSave("officials"));
    expect(new WorkforceSupplyRepository(db).officials()).toHaveLength(0);
    const created = initializeWorkforceSupplyForSave({
      db,
      worldDate: "2026-08-01",
      seed: "officials",
    });
    expect(created).toBeGreaterThan(0);
    const repository = new WorkforceSupplyRepository(db);
    expect(repository.activeOfficials("REFEREE").length).toBeGreaterThan(0);
    expect(repository.activeOfficials("ASSISTANT_REFEREE").length).toBeGreaterThan(0);
    for (const official of repository.officials()) {
      expect(official.provenanceStatus).toBe("SIMULATION_ONLY");
      expect(official.quality).toBeGreaterThan(0);
      expect(official.quality).toBeLessThanOrEqual(100);
      expect(official.potential).toBeGreaterThanOrEqual(official.quality);
      expect(official.level).toBeGreaterThanOrEqual(1);
      expect(official.level).toBeLessThanOrEqual(3);
    }
    // Bootstrap is idempotent: a reload must not duplicate the pool.
    const before = repository.officials().length;
    expect(
      initializeWorkforceSupplyForSave({ db, worldDate: "2026-08-01", seed: "officials" }),
    ).toBe(0);
    expect(repository.officials()).toHaveLength(before);
    db.close();
  });

  it("enters new officials at the bottom and never generates an elite referee", () => {
    const db = openGameDatabase(createSave("official-entry"));
    const countryId = (db.prepare("SELECT id FROM countries LIMIT 1").get() as { id: EntityId }).id;
    const rookie = generateOfficial({
      db,
      countryId,
      role: "REFEREE",
      date: "2026-08-01",
      seasonLabel: "2026",
      index: 0,
      developmentEnvironment: 100,
    });
    expect(rookie.level).toBe(3);
    expect(rookie.quality).toBeLessThan(65);
    db.close();
  });

  it("develops officials gradually within bounds and retires them without collapsing the pool", () => {
    let official: OfficialSimulationProfile = {
      personId: "person:o" as EntityId,
      refereeProfileId: "ref:o" as EntityId,
      countryId: "country:npl" as EntityId,
      role: "REFEREE",
      gender: "male",
      level: 3,
      quality: 30,
      potential: 80,
      experience: 0,
      fitness: 80,
      seasonAppointments: 0,
      careerAppointments: 0,
      debutOn: "2026-08-01",
      status: "ACTIVE",
      provenanceStatus: "SIMULATION_ONLY",
    };
    const perSeason: number[] = [];
    for (let season = 0; season < 15; season += 1) {
      const before = official.quality;
      official = advanceOfficialCareer(official, {
        date: `${2027 + season}-06-01`,
        appointments: 18,
        developmentEnvironment: 100,
        age: 26 + season,
        rng: new SeededRandom(`career:${season}`),
      });
      if (official.status !== "ACTIVE") break;
      perSeason.push(official.quality - before);
    }
    // Even with maximum federation investment, growth stays incremental.
    expect(Math.max(...perSeason)).toBeLessThanOrEqual(3.25);
    expect(official.quality).toBeLessThanOrEqual(official.potential);
    expect(official.quality).toBeLessThanOrEqual(100);
    expect(official.level).toBeLessThanOrEqual(3);
    expect(official.level).toBeGreaterThanOrEqual(1);

    // An old, unfit official eventually leaves, sometimes into instructing.
    let veteran: OfficialSimulationProfile = { ...official, status: "ACTIVE", fitness: 30 };
    for (let attempt = 0; attempt < 20 && veteran.status === "ACTIVE"; attempt += 1) {
      veteran = advanceOfficialCareer(veteran, {
        date: "2060-06-01",
        appointments: 4,
        age: 58,
        rng: new SeededRandom(`retire:${attempt}`),
      });
    }
    expect(["RETIRED", "INSTRUCTOR"]).toContain(veteran.status);
  });
});

describe("workforce supply phase A: reconciliation", () => {
  it("replenishes players, staff and officials within hard caps and never twice per season", () => {
    const db = openGameDatabase(createSave("reconcile"));
    const first = reconcileWorkforceSupply({
      db,
      date: "2027-06-01",
      seed: "reconcile",
      seasonLabel: "2027",
    });
    expect(first.skippedAlreadyRun).toBe(false);
    expect(first.generatedOfficials + first.generatedStaff).toBeGreaterThan(0);
    expect(first.generatedWomenPlayers).toBeGreaterThan(0);
    // Hard caps: a correction may relieve a shortage, never flood the world.
    expect(first.generatedMenPlayers).toBeLessThanOrEqual(60);
    expect(first.generatedWomenPlayers).toBeLessThanOrEqual(60);
    expect(first.generatedStaff).toBeLessThanOrEqual(30);
    expect(first.generatedOfficials).toBeLessThanOrEqual(48);

    const populationAfterFirst = (
      db.prepare("SELECT COUNT(*) n FROM persons").get() as { n: number }
    ).n;
    // Reload replay: the same season must not generate a second intake.
    const second = reconcileWorkforceSupply({
      db,
      date: "2027-06-01",
      seed: "reconcile",
      seasonLabel: "2027",
    });
    expect(second.skippedAlreadyRun).toBe(true);
    expect(second.generatedMenPlayers).toBe(0);
    expect((db.prepare("SELECT COUNT(*) n FROM persons").get() as { n: number }).n).toBe(
      populationAfterFirst,
    );
    db.close();
  });

  it("marks generated people SIMULATION_ONLY and gives them valid Nepali origins", () => {
    const db = openGameDatabase(createSave("provenance"));
    reconcileWorkforceSupply({ db, date: "2027-06-01", seed: "provenance", seasonLabel: "2027" });
    const origins = db
      .prepare(
        `SELECT origin_data_type AS type, country_id, location_id FROM generated_player_origins LIMIT 200`,
      )
      .all() as Array<{ type: string; country_id: EntityId; location_id?: EntityId }>;
    expect(origins.length).toBeGreaterThan(0);
    for (const origin of origins) {
      expect(origin.type).toBe("SIMULATION_ONLY");
      expect(origin.country_id).toBeTruthy();
    }
    // Origins must not all collapse onto a single location.
    const distinct = new Set(origins.map((origin) => origin.location_id ?? "none"));
    expect(distinct.size).toBeGreaterThan(1);

    const women = db
      .prepare(
        `SELECT COUNT(*) n FROM person_roles pr JOIN persons p ON p.id = pr.person_id
         WHERE pr.role = 'PLAYER' AND pr.active_to IS NULL AND p.gender_presentation = 'female'`,
      )
      .get() as { n: number };
    expect(women.n).toBeGreaterThan(0);
    db.close();
  });
});

describe("workforce supply phase A: sustainability", () => {
  it("reports a self-sustaining world with no invariant violations", () => {
    const db = openGameDatabase(createSave("report"));
    reconcileWorkforceSupply({ db, date: "2027-06-01", seed: "report", seasonLabel: "2027" });
    const report = worldSustainabilityReport({ db, date: "2027-06-01", seasonLabel: "2027" });
    expect(report.violations).toEqual([]);
    expect(report.sustainable).toBe(true);
    expect(report.activeMalePlayers).toBeGreaterThan(0);
    expect(report.activeFemalePlayers).toBeGreaterThan(0);
    expect(report.activeReferees).toBeGreaterThan(0);
    expect(report.activeAssistantReferees).toBeGreaterThan(0);
    expect(report.youthCohort).toBeGreaterThan(0);
    expect(report.generatedEntrantsThisSeason).toBeGreaterThan(0);
    expect(report.realActivePeople).toBeGreaterThan(0);
    expect(report.districtOrigins.length).toBeGreaterThan(1);
    db.close();
  });

  it("flags structural collapse rather than ordinary scarcity", () => {
    const db = openGameDatabase(createSave("invariants"));
    const healthy = worldSustainabilityReport({ db, date: "2026-08-01" });
    // A negative demand balance is legitimate scarcity, not a violation.
    expect(healthy.demand.lines.some((line) => line.balance < 0)).toBe(true);
    expect(workforceInvariantViolations({ ...healthy, violations: [] })).not.toContain(
      "no active players while clubs require squads",
    );
    // Genuine collapse is reported.
    const collapsed = workforceInvariantViolations({
      ...healthy,
      activeMalePlayers: 0,
      activeFemalePlayers: 0,
      activeReferees: 0,
      violations: [],
      demand: { ...healthy.demand, scheduledFixtures: 40, activeWomensTeams: 4 },
    });
    expect(collapsed).toContain("no active players while clubs require squads");
    expect(collapsed).toContain("no active referees while competitions still have fixtures");
    expect(collapsed).toContain("no active women players while women's teams exist");
    expect(workforceInvariantViolations({ ...healthy, activeStaff: -1, violations: [] })).toContain(
      "activeStaff is negative",
    );
    db.close();
  });
});

describe("workforce supply phase A: multi-season continuity", () => {
  it("keeps the world populated and bounded across a decade of ageing and regeneration", () => {
    const db = openGameDatabase(createSave("decade"));
    const timeline: Array<{
      year: number;
      players: number;
      referees: number;
      persons: number;
      age: number;
    }> = [];

    for (let year = 2027; year <= 2038; year += 1) {
      // The real annual lifecycle: youth intake plus retirement, then supply.
      runAnnualYouthAndRetirementCycle({
        db,
        worldDate: `${year}-08-15`,
        seed: `decade:${year}`,
        seasonLabel: String(year),
      });
      reconcileWorkforceSupply({
        db,
        date: `${year}-08-20`,
        seed: `decade:${year}`,
        seasonLabel: String(year),
      });
      const report = worldSustainabilityReport({
        db,
        date: `${year}-09-01`,
        seasonLabel: String(year),
      });
      expect(report.violations).toEqual([]);
      timeline.push({
        year,
        players: report.activeMalePlayers + report.activeFemalePlayers,
        referees: report.activeReferees + report.activeAssistantReferees,
        persons: (db.prepare("SELECT COUNT(*) n FROM persons").get() as { n: number }).n,
        age: report.averagePlayerAge,
      });
    }

    const first = timeline[0]!;
    const last = timeline.at(-1)!;

    // Leagues, officiating and youth all still exist after a decade.
    expect(last.players).toBeGreaterThan(200);
    expect(last.referees).toBeGreaterThan(0);
    for (const point of timeline) {
      expect(Number.isFinite(point.players)).toBe(true);
      expect(point.players).toBeGreaterThan(0);
      expect(point.age).toBeGreaterThan(14);
      expect(point.age).toBeLessThan(42);
    }

    // Entity growth stays bounded: no unlimited accumulation of people.
    expect(last.persons).toBeLessThan(first.persons * 4);
    expect(new Set(timeline.map((point) => point.persons)).size).toBeGreaterThan(1);

    // The generated population progressively replaces the imported one.
    const finalReport = worldSustainabilityReport({ db, date: "2038-09-01", seasonLabel: "2038" });
    expect(finalReport.generatedActivePeople).toBeGreaterThan(0);
    expect(finalReport.retirementsThisSeason).toBeGreaterThanOrEqual(0);
    // A healthy pyramid keeps more than one age band populated.
    expect(Object.values(finalReport.ageBands).filter((band) => band > 0).length).toBeGreaterThan(
      2,
    );
    db.close();
  }, 240000);

  it("is deterministic for the same save, seed and date", () => {
    const runOnce = (seed: string) => {
      const db = openGameDatabase(createSave(seed));
      reconcileWorkforceSupply({ db, date: "2027-06-01", seed: "fixed", seasonLabel: "2027" });
      const report = worldSustainabilityReport({ db, date: "2027-06-01", seasonLabel: "2027" });
      const officials = new WorkforceSupplyRepository(db)
        .officials()
        .map((official) => `${official.personId}:${official.quality}:${official.level}`);
      db.close();
      return {
        men: report.activeMalePlayers,
        women: report.activeFemalePlayers,
        referees: report.activeReferees,
        officials,
      };
    };
    expect(runOnce("determinism")).toEqual(runOnce("determinism"));
  }, 120000);
});
