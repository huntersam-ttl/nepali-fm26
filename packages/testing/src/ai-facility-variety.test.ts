import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, initializeClubEconomyForSave, runClubAiSeasonPlanning } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * AI clubs used to always start a TRAINING_GROUND project — never an
 * academy, medical centre, or stadium — so a long-running world never saw
 * facility variety. `chooseInfrastructureProjectType` (ai-club-strategy.ts)
 * now picks between real project types based on a club's actual facility
 * gaps, reputation, and affordability, still through the same canonical
 * `createInfrastructureProject` engine and its own prerequisite/cost gates.
 */

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const realClub = (db: GameDatabase, offset = 0): EntityId =>
  (
    db
      .prepare(
        `SELECT c.id FROM clubs c
         WHERE NOT EXISTS (
           SELECT 1 FROM external_club_context ecc
           WHERE ecc.club_id = c.id AND ecc.simulation_depth = 'CONTEXT_ONLY'
         )
         ORDER BY c.id LIMIT 1 OFFSET ?`,
      )
      .get(offset) as { id: EntityId }
  ).id;

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const freshDb = (seed: string): GameDatabase => {
  const dir = mkdtempSync(join(tmpdir(), `${seed}-`));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: seed,
    gameVersion: "test",
    randomSeed: seed,
  });
  const db = openGameDatabase(path);
  initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed });
  return db;
};

describe("AI facility project variety", () => {
  it("chooses ACADEMY for a club with a real youth need and no academy yet", () => {
    const db = freshDb("ai-facility-academy");
    const economy = new ClubEconomyRepository(db);
    const club = realClub(db);
    const account = economy.financialAccount(club)!;
    economy.upsertFinancialAccount({ ...account, cashBalance: 15_000_000, financialHealth: "STABLE" });
    const policy = economy.boardPolicy(club);
    if (policy) economy.upsertBoardPolicy({ ...policy, youthPriority: 0.85, infrastructurePriority: 0.6 });
    const facility = economy.facilityProfile(club);
    if (facility) economy.upsertFacilityProfile({ ...facility, youthFacilityQuality: 2 });

    runClubAiSeasonPlanning(db, { date: "2026-08-28", seed: "ai-facility-academy-run" });
    const projects = economy.infrastructureProjects(club);
    expect(projects).toHaveLength(1);
    expect(projects[0]!.projectType).toBe("ACADEMY");
    db.close();
  });

  it("chooses STADIUM only for a well-reputed, very well-capitalised club, never for an ordinary one", () => {
    const db = freshDb("ai-facility-stadium");
    const economy = new ClubEconomyRepository(db);
    const rich = realClub(db, 0);
    const ordinary = realClub(db, 1);

    const richAccount = economy.financialAccount(rich)!;
    economy.upsertFinancialAccount({ ...richAccount, cashBalance: 40_000_000, financialHealth: "STABLE" });
    const richSupporter = economy.supporterProfile(rich);
    if (richSupporter) economy.upsertSupporterProfile({ ...richSupporter, footballReputation: 9 });
    const richPolicy = economy.boardPolicy(rich);
    if (richPolicy) economy.upsertBoardPolicy({ ...richPolicy, infrastructurePriority: 0.7, transferPhilosophy: "BALANCED" });

    const ordinaryAccount = economy.financialAccount(ordinary)!;
    // Affordable enough for a training ground, nowhere near a stadium.
    economy.upsertFinancialAccount({ ...ordinaryAccount, cashBalance: 6_000_000, financialHealth: "STABLE" });
    const ordinaryPolicy = economy.boardPolicy(ordinary);
    if (ordinaryPolicy) economy.upsertBoardPolicy({ ...ordinaryPolicy, infrastructurePriority: 0.7, transferPhilosophy: "BALANCED" });

    runClubAiSeasonPlanning(db, { date: "2026-08-28", seed: "ai-facility-stadium-run" });

    const richProjects = economy.infrastructureProjects(rich);
    expect(richProjects.some((project) => project.projectType === "STADIUM")).toBe(true);

    const ordinaryProjects = economy.infrastructureProjects(ordinary);
    expect(ordinaryProjects.some((project) => project.projectType === "STADIUM")).toBe(false);
    db.close();
  });

  it("never starts a duplicate project while one is already active, across project types", () => {
    const db = freshDb("ai-facility-dedupe");
    const economy = new ClubEconomyRepository(db);
    const club = realClub(db);
    const account = economy.financialAccount(club)!;
    economy.upsertFinancialAccount({ ...account, cashBalance: 40_000_000, financialHealth: "STABLE" });
    const supporter = economy.supporterProfile(club);
    if (supporter) economy.upsertSupporterProfile({ ...supporter, footballReputation: 9 });
    const policy = economy.boardPolicy(club);
    if (policy) economy.upsertBoardPolicy({ ...policy, infrastructurePriority: 0.7, transferPhilosophy: "BALANCED" });

    runClubAiSeasonPlanning(db, { date: "2026-08-28", seed: "ai-facility-dedupe-run" });
    const afterFirst = economy.infrastructureProjects(club);
    expect(afterFirst.length).toBe(1);

    // A second planning pass on the same still-planning project must not add another.
    runClubAiSeasonPlanning(db, { date: "2026-08-28", seed: "ai-facility-dedupe-run" });
    expect(economy.infrastructureProjects(club)).toHaveLength(1);
    db.close();
  });

  it("every AI-chosen project stays Nepal-scale and uses the canonical lifecycle", () => {
    const db = freshDb("ai-facility-scale");
    const economy = new ClubEconomyRepository(db);
    const club = realClub(db);
    const account = economy.financialAccount(club)!;
    economy.upsertFinancialAccount({ ...account, cashBalance: 40_000_000, financialHealth: "STABLE" });
    const supporter = economy.supporterProfile(club);
    if (supporter) economy.upsertSupporterProfile({ ...supporter, footballReputation: 9 });
    const policy = economy.boardPolicy(club);
    if (policy) economy.upsertBoardPolicy({ ...policy, infrastructurePriority: 0.7, transferPhilosophy: "BALANCED" });

    runClubAiSeasonPlanning(db, { date: "2026-08-28", seed: "ai-facility-scale-run" });
    const project = economy.infrastructureProjects(club)[0]!;
    // Even the most expensive canonical project type (stadium) is bounded
    // well under a European-scale build.
    expect(project.capitalCost).toBeGreaterThan(0);
    expect(project.capitalCost).toBeLessThan(30_000_000);
    expect(project.status).toBe("PLANNING");
    expect(project.provenanceStatus).toBe("SIMULATION_ONLY");
    db.close();
  });

  it("persists the chosen project type identically across reload — no re-roll", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-facility-reload-"));
    dirs.push(dir);
    const path = join(dir, "career.sqlite");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "ai-facility-reload",
      gameVersion: "test",
      randomSeed: "ai-facility-reload",
    });
    const db = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "ai-facility-reload" });
    const economy = new ClubEconomyRepository(db);
    const club = realClub(db);
    const account = economy.financialAccount(club)!;
    economy.upsertFinancialAccount({ ...account, cashBalance: 15_000_000, financialHealth: "STABLE" });
    const policy = economy.boardPolicy(club);
    if (policy) economy.upsertBoardPolicy({ ...policy, youthPriority: 0.85, infrastructurePriority: 0.6 });
    const facility = economy.facilityProfile(club);
    if (facility) economy.upsertFacilityProfile({ ...facility, youthFacilityQuality: 2 });

    runClubAiSeasonPlanning(db, { date: "2026-08-28", seed: "ai-facility-reload-run" });
    const before = economy.infrastructureProjects(club);
    db.close();

    const reloaded = openGameDatabase(path);
    const after = new ClubEconomyRepository(reloaded).infrastructureProjects(club);
    expect(after).toEqual(before);
    reloaded.close();
  });

  it("chooses RETAIL_STORE for a club prioritising commercial growth with real headroom to sell more merchandise", () => {
    const db = freshDb("ai-facility-retail");
    const economy = new ClubEconomyRepository(db);
    const club = realClub(db);
    const account = economy.financialAccount(club)!;
    economy.upsertFinancialAccount({ ...account, cashBalance: 10_000_000, financialHealth: "STABLE" });
    const policy = economy.boardPolicy(club);
    if (policy) economy.upsertBoardPolicy({ ...policy, commercialPriority: 0.9, infrastructurePriority: 0.6 });
    const commercial = economy.commercialProfile(club);
    if (commercial) economy.upsertCommercialProfile({ ...commercial, merchandiseAppeal: 15 });

    runClubAiSeasonPlanning(db, { date: "2026-08-28", seed: "ai-facility-retail-run" });
    const projects = economy.infrastructureProjects(club);
    expect(projects).toHaveLength(1);
    expect(projects[0]!.projectType).toBe("RETAIL_STORE");
    db.close();
  });

  it("does not choose RETAIL_STORE for a club whose merchandiseAppeal is already high", () => {
    const db = freshDb("ai-facility-retail-satisfied");
    const economy = new ClubEconomyRepository(db);
    const club = realClub(db);
    const account = economy.financialAccount(club)!;
    economy.upsertFinancialAccount({ ...account, cashBalance: 10_000_000, financialHealth: "STABLE" });
    const policy = economy.boardPolicy(club);
    if (policy) economy.upsertBoardPolicy({ ...policy, commercialPriority: 0.9, infrastructurePriority: 0.6 });
    const commercial = economy.commercialProfile(club);
    if (commercial) economy.upsertCommercialProfile({ ...commercial, merchandiseAppeal: 85 });

    runClubAiSeasonPlanning(db, { date: "2026-08-28", seed: "ai-facility-retail-satisfied-run" });
    const projects = economy.infrastructureProjects(club);
    expect(projects.some((project) => project.projectType === "RETAIL_STORE")).toBe(false);
    db.close();
  });
});
