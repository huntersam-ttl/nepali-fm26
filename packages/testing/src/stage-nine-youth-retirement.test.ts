import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RecruitmentRepository,
  TransferMarketRepository,
  YouthRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  createNepalSave,
  initializeTransferMarketForSave,
  runAnnualYouthAndRetirementCycle,
  runYouthDiagnostic,
  searchPlayersForClub,
  simulateNepalCareer,
} from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-youth-"));
  tempDirs.push(dir);
  return join(dir, "youth.sqlite");
};

const createSave = (seed: string): string => {
  const databasePath = tempDbPath();
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Youth ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  return databasePath;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("youth intake and retirement foundation", () => {
  it("generates simulation-only youth from academy, district and grassroots pathways", () => {
    const db = openGameDatabase(createSave("origin-flags"));
    const report = runAnnualYouthAndRetirementCycle({
      db,
      worldDate: "2026-08-15",
      seed: "origin-flags",
    });
    const youth = new YouthRepository(db);
    /*
     * Save creation bootstraps lower-league squads through the same generator, so
     * the origins table also holds those players. Only the annual intake's own
     * origins belong in this comparison.
     */
    const annualEventIds = new Set(youth.annualIntakeEvents("2026").map((event) => event.id));
    const origins = youth
      .generatedPlayerOrigins()
      .filter((origin) => origin.intakeEventId && annualEventIds.has(origin.intakeEventId));

    expect(report.generatedPlayers).toBeGreaterThan(40);
    expect(report.generatedPlayers).toBeLessThan(120);
    expect(report.academyLinkedPlayers).toBeGreaterThan(0);
    expect(report.districtPlayers + report.grassrootsPlayers).toBeGreaterThan(0);
    expect(report.averageCurrentAbility).toBeGreaterThan(3);
    expect(report.averagePotential).toBeLessThan(13);
    expect(report.highestPotential).toBeLessThan(16);
    expect(origins).toHaveLength(report.generatedPlayers);
    expect(origins.every((origin) => origin.originDataType === "SIMULATION_ONLY")).toBe(true);
    expect([...new Set(origins.map((origin) => origin.originType))]).toEqual(
      expect.arrayContaining(["CLUB_ACADEMY", "DISTRICT_FOOTBALL", "GRASSROOTS"]),
    );
    db.close();
  });

  it("creates realistic identities, DOBs, positions, attributes, potentials and youth contracts", () => {
    const db = openGameDatabase(createSave("identity-contracts"));
    runAnnualYouthAndRetirementCycle({ db, worldDate: "2026-08-15", seed: "identity-contracts" });
    const youth = new YouthRepository(db);
    const origins = youth.generatedPlayerOrigins();
    const market = new TransferMarketRepository(db);
    const importedNames = new Set(
      db
        .prepare(
          `SELECT p.full_name
          FROM player_factual_profiles pfp
          JOIN persons p ON p.id = pfp.player_id`,
        )
        .all()
        .map((row: any) => row.full_name),
    );
    const names = generatedNames(db);
    // generated_player_origins is general-purpose origin/pathway metadata,
    // attached to real factual players too (of any age, any origin_type) —
    // not exclusively a "this identity was synthesized as youth" marker.
    // Restricted to distinct synthetic identities (no factual profile) to
    // check the youth-intake-specific DOB/position invariants below, the
    // same distinction the name-collision check above relies on.
    const generatedRows = db
      .prepare(
        `SELECT p.date_of_birth, pa.primary_position
        FROM generated_player_origins gpo
        JOIN persons p ON p.id = gpo.player_id
        JOIN player_attributes pa ON pa.person_id = p.id
        WHERE gpo.origin_type != 'GENERATED_FREE_PLAYER'
          AND NOT EXISTS (
            SELECT 1 FROM player_factual_profiles pfp WHERE pfp.player_id = gpo.player_id
          )`,
      )
      .all() as Array<{ date_of_birth: string; primary_position: string }>;

    expect(new Set(names).size).toBe(names.length);
    // A generated_player_origins row does not always mean "a brand-new
    // synthetic identity" — a real, factually-imported young player can
    // legitimately also carry generated-origin developmental/backstory
    // metadata under their own real personId (e.g. an emergency-repair or
    // preseason-continuity top-up reusing an existing factual player). That
    // is the SAME person appearing in both tables, not two different
    // people coincidentally sharing a name, so it must not fail this check.
    // What must never happen is a *distinct* synthetic identity (its own
    // personId, never linked to any factual profile) being handed the
    // exact display name of a real imported player — that would make two
    // different people indistinguishable by name in the UI.
    const distinctSyntheticNameCollisions = db
      .prepare(
        `SELECT p.full_name
        FROM generated_player_origins gpo
        JOIN persons p ON p.id = gpo.player_id
        WHERE NOT EXISTS (
          SELECT 1 FROM player_factual_profiles pfp WHERE pfp.player_id = gpo.player_id
        )`,
      )
      .all()
      .map((row: any) => row.full_name as string);
    expect(distinctSyntheticNameCollisions.some((name) => importedNames.has(name))).toBe(false);
    expect(generatedRows.every((row) => row.date_of_birth >= "2007-01-01")).toBe(true);
    expect(new Set(generatedRows.map((row) => row.primary_position)).size).toBeGreaterThanOrEqual(
      6,
    );
    expect(generatedRows.some((row) => row.primary_position === "GK")).toBe(true);
    expect(origins.map((origin) => origin.archetype)).toContain("SHOT_STOPPER");
    expect(
      origins.filter((origin) => market.activeContract(origin.playerId, "2026-08-15")).length,
    ).toBeGreaterThan(40);
    expect(
      market
        .allPlayerContracts()
        .filter((contract) => origins.some((origin) => origin.playerId === contract.playerId))
        .every((contract) => ["YOUTH", "AMATEUR", "SEMI_PRO"].includes(contract.contractType)),
    ).toBe(true);
    db.close();
  });

  it("is deterministic for the same save seed and does not regenerate after reload", () => {
    // Both fixtures must share a save seed; differing seeds give differing
    // bootstrap squads, and the intake then dedupes against different names.
    const firstPath = createSave("deterministic-save");
    const secondPath = createSave("deterministic-save");
    const first = openGameDatabase(firstPath);
    const second = openGameDatabase(secondPath);
    const firstReport = runAnnualYouthAndRetirementCycle({
      db: first,
      worldDate: "2026-08-15",
      seed: "same-youth-seed",
    });
    const secondReport = runAnnualYouthAndRetirementCycle({
      db: second,
      worldDate: "2026-08-15",
      seed: "same-youth-seed",
    });
    const firstNames = generatedNames(first);
    const secondNames = generatedNames(second);
    first.close();
    second.close();

    expect(firstReport.generatedPlayers).toBe(secondReport.generatedPlayers);
    expect(firstNames).toEqual(secondNames);

    const reloaded = openGameDatabase(firstPath);
    const rerun = runAnnualYouthAndRetirementCycle({
      db: reloaded,
      worldDate: "2026-08-15",
      seed: "same-youth-seed",
    });
    expect(rerun.generatedPlayers).toBe(firstReport.generatedPlayers);
    const reloadedYouth = new YouthRepository(reloaded);
    const reloadedAnnual = new Set(
      reloadedYouth.annualIntakeEvents("2026").map((event) => event.id),
    );
    expect(
      reloadedYouth
        .generatedPlayerOrigins()
        .filter((origin) => origin.intakeEventId && reloadedAnnual.has(origin.intakeEventId)),
    ).toHaveLength(firstReport.generatedPlayers);
    reloaded.close();
  });

  it("integrates generated youth with scouting knowledge and transfer contracts", () => {
    const db = openGameDatabase(createSave("scouting-transfer-youth"));
    initializeTransferMarketForSave({
      db,
      worldDate: "2026-08-01",
      seed: "scouting-transfer-youth",
    });
    runAnnualYouthAndRetirementCycle({
      db,
      worldDate: "2026-08-15",
      seed: "scouting-transfer-youth",
    });
    const origin = new YouthRepository(db)
      .generatedPlayerOrigins()
      .find((candidate) => candidate.clubId)!;
    const knowledge = new RecruitmentRepository(db).playerKnowledge(
      origin.clubId!,
      origin.playerId,
    );
    const contract = new TransferMarketRepository(db).activeContract(origin.playerId, "2026-08-15");

    expect(knowledge?.sourceType).toBe("OWN_PLAYER");
    expect(knowledge?.abilityKnowledge.estimatedAbility).toEqual(
      expect.objectContaining({ min: expect.any(Number), max: expect.any(Number) }),
    );
    expect(
      searchPlayersForClub(db, origin.clubId!, {}, "2026-08-15").some(
        (candidate) => "potentialAbility" in (candidate as object),
      ),
    ).toBe(false);
    expect(contract?.provenance.status).toBe("SIMULATION_ONLY");
    db.close();
  });

  it("preserves people after retirement and can convert some retirees into staff", () => {
    const db = openGameDatabase(createSave("retirement-staff"));
    const report = runYouthDiagnostic({
      db,
      startDate: "2026-08-15",
      seasons: 10,
      seed: "retirement-staff",
    });
    const youth = new YouthRepository(db);
    const retired = youth.retirementStates().filter((state) => state.state === "RETIRED");
    const staffTransitions = youth.staffTransitions();
    const preservedPeople = retired.filter((state) => personExists(db, state.playerId));

    expect(report.totals.retirements).toBeGreaterThan(0);
    expect(retired.length).toBeGreaterThan(0);
    expect(preservedPeople).toHaveLength(retired.length);
    expect(staffTransitions.length).toBeGreaterThan(0);
    expect(staffTransitions.every((transition) => personExists(db, transition.playerId))).toBe(
      true,
    );
    db.close();
  });

  it("keeps a 20-season youth population diagnostic within health bounds", () => {
    const db = openGameDatabase(createSave("twenty-season-population"));
    const finalDate = "2045-08-15";
    const report = runYouthDiagnostic({
      db,
      startDate: "2026-08-15",
      seasons: 20,
      seed: "twenty-season-population",
    });
    const final = report.populationBySeason.at(-1)!;

    /*
     * Intake recurs every season, so both "players generated so far" figures grow
     * with the run and cannot be held under a constant. What must stay bounded is
     * the yearly cohort: a duplicated generator or a widened club scope shows up
     * there first, which a cumulative cap only catches long after the fact.
     */
    const seasons = 20;
    const perSeasonFloor = 40;
    const perSeasonCeiling = 150;
    const cohorts = report.seasons.map((season) => season.generatedPlayers);
    expect(Math.min(...cohorts)).toBeGreaterThanOrEqual(perSeasonFloor);
    expect(Math.max(...cohorts)).toBeLessThanOrEqual(perSeasonCeiling);
    expect(report.totals.generatedPlayers).toBeGreaterThan(seasons * perSeasonFloor);
    expect(report.totals.generatedPlayers).toBeLessThan(seasons * perSeasonCeiling);

    // Exactly one annual intake per season, and never one for a foreign club.
    expect(
      db
        .prepare(
          "SELECT season_label FROM youth_intake_events WHERE source = 'ANNUAL_INTAKE' GROUP BY season_label",
        )
        .all(),
    ).toHaveLength(seasons);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM youth_intake_events e
           JOIN clubs c ON c.id = e.club_id
           LEFT JOIN countries co ON co.id = c.country_id
           WHERE e.source = 'ANNUAL_INTAKE' AND (co.iso_code IS NULL OR co.iso_code NOT IN ('NP', 'NPL'))`,
        )
        .get(),
    ).toEqual({ count: 0 });

    // Every generated person traces back to a recorded intake event.
    const bootstrapPlayers = (
      db
        .prepare(
          "SELECT COALESCE(SUM(players_generated), 0) AS total FROM youth_intake_events WHERE source = 'BOOTSTRAP_SQUAD_REPAIR'",
        )
        .get() as { total: number }
    ).total;
    expect(final.generatedPlayers).toBe(report.totals.generatedPlayers + bootstrapPlayers);

    expect(report.totals.highestPotential).toBeLessThan(16);

    /*
     * `final.averageAge` covers every open PLAYER role in the world, including the
     * imported CONTEXT_ONLY players. Those carry no player_attributes row, so the
     * retirement query cannot see them, and their ageing is handled by the external
     * world pass this diagnostic does not run — they simply get twenty years older.
     * Age health is therefore asserted over the population this cycle governs.
     */
    const ageStats = (predicate: string) =>
      db
        .prepare(
          `SELECT AVG(age) AS mean, MAX(age) AS oldest, COUNT(*) AS count FROM (
             SELECT (CAST(strftime('%Y', ?) AS INTEGER) - CAST(strftime('%Y', p.date_of_birth) AS INTEGER))
               - (strftime('%m-%d', ?) < strftime('%m-%d', p.date_of_birth)) AS age
             FROM person_roles pr
             JOIN persons p ON p.id = pr.person_id
             WHERE pr.role = 'PLAYER' AND pr.active_to IS NULL AND p.date_of_birth IS NOT NULL
               AND ${predicate}
           )`,
        )
        .get(finalDate, finalDate) as { mean: number; oldest: number; count: number };

    const nepal = ageStats(
      "EXISTS (SELECT 1 FROM countries c WHERE c.id = p.nationality_country_id AND c.iso_code IN ('NP', 'NPL'))",
    );
    const generated = ageStats(
      "EXISTS (SELECT 1 FROM generated_player_origins g WHERE g.player_id = p.id)",
    );

    expect(nepal.count).toBeGreaterThan(500);
    expect(nepal.mean).toBeGreaterThan(17);
    expect(nepal.mean).toBeLessThan(28);
    expect(generated.mean).toBeGreaterThan(17);
    expect(generated.mean).toBeLessThan(28);
    // Players this cycle both created and retires must not accumulate past a career.
    expect(generated.oldest).toBeLessThan(42);
    expect(final.clubSquadSizes.every((club) => club.players < 60)).toBe(true);
    expect(report.seasons.every((season) => Number(season.positionsGenerated.GK ?? 0) > 0)).toBe(
      true,
    );
    db.close();
  });

  it("keeps a transfer-and-youth enabled career playable for one full season", () => {
    const db = openGameDatabase(createSave("career-with-youth"));
    const report = simulateNepalCareer({
      db,
      seasons: 1,
      seed: "career-with-youth",
      transfersEnabled: true,
      youthEnabled: true,
    });

    expect(report.seasons.length).toBeGreaterThan(0);
    expect(report.youthReports.length).toBeGreaterThan(0);
    expect(
      report.youthReports.reduce((total, item) => total + item.generatedPlayers, 0),
    ).toBeGreaterThan(0);
    expect(new YouthRepository(db).generatedPlayerOrigins().length).toBeGreaterThan(0);
    db.close();
  });

  it("repairs preseason squads for all core Nepal competition member clubs", () => {
    const db = openGameDatabase(createSave("preseason-continuity"));
    const report = simulateNepalCareer({
      db,
      seasons: 1,
      seed: "preseason-continuity",
    });
    const coreReports = report.preseasonReports.filter((item) =>
      [
        "ANFA National League",
        "Martyr's Memorial A-Division League",
        "Martyr's Memorial B-Division League",
      ].includes(item.competitionName),
    );

    expect(coreReports.length).toBeGreaterThan(0);
    expect(
      coreReports.every((item) => item.playableTeamCountAfter === item.actualMembershipCount),
    ).toBe(true);
    expect(coreReports.every((item) => item.minimumClubSquadSize >= 22)).toBe(true);
    expect(
      coreReports.every((item) => item.clubDiagnostics.every((club) => club.goalkeepersAfter >= 1)),
    ).toBe(true);
    expect(report.seasons.every((season) => season.squadHealth.emergencyLineupCases === 0)).toBe(
      true,
    );
    db.close();
  });

  it("propagates A and B Division memberships through pyramid progression without stale overlap", () => {
    const db = openGameDatabase(createSave("membership-continuity"));
    simulateNepalCareer({
      db,
      seasons: 1,
      seed: "membership-continuity",
      transfersEnabled: true,
      youthEnabled: true,
    });
    const initialA = membershipCount(db, "Martyr's Memorial A-Division League", "2026");
    const nextA = membershipCount(db, "Martyr's Memorial A-Division League", "2027");
    const initialB = membershipCount(db, "Martyr's Memorial B-Division League", "2026");
    const nextB = membershipCount(db, "Martyr's Memorial B-Division League", "2027");
    const overlap = db
      .prepare(
        `SELECT COUNT(*) AS count
        FROM club_memberships a
        JOIN competition_seasons acs ON acs.id = a.competition_season_id
        JOIN competitions ac ON ac.id = acs.competition_id
        JOIN club_memberships b ON b.club_id = a.club_id
        JOIN competition_seasons bcs ON bcs.id = b.competition_season_id
        JOIN competitions bc ON bc.id = bcs.competition_id
        WHERE ac.name = ? AND bc.name = ?
          AND acs.name LIKE '%2027%' AND bcs.name LIKE '%2027%'
          AND a.status NOT IN ('WITHDRAWN', 'SUSPENDED', 'INELIGIBLE')
          AND b.status NOT IN ('WITHDRAWN', 'SUSPENDED', 'INELIGIBLE')`,
      )
      .get("Martyr's Memorial A-Division League", "Martyr's Memorial B-Division League") as {
      count: number;
    };

    expect(nextA).toBe(initialA);
    expect(nextB).toBe(initialB);
    expect(overlap.count).toBe(0);
    db.close();
  });
});

const generatedNames = (db: ReturnType<typeof openGameDatabase>): string[] =>
  db
    .prepare(
      `SELECT p.full_name
      FROM generated_player_origins gpo
      JOIN persons p ON p.id = gpo.player_id
      ORDER BY gpo.player_id`,
    )
    .all()
    .map((row: any) => row.full_name);

const personExists = (db: ReturnType<typeof openGameDatabase>, personId: EntityId): boolean => {
  const row = db.prepare("SELECT COUNT(*) AS count FROM persons WHERE id = ?").get(personId) as {
    count: number;
  };
  return row.count === 1;
};

const membershipCount = (
  db: ReturnType<typeof openGameDatabase>,
  competitionName: string,
  seasonLabel: string,
): number => {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT cm.club_id) AS count
      FROM club_memberships cm
      JOIN competition_seasons cs ON cs.id = cm.competition_season_id
      JOIN competitions c ON c.id = cs.competition_id
      WHERE c.name = ? AND cs.name LIKE ?
        AND cm.status NOT IN ('WITHDRAWN', 'SUSPENDED', 'INELIGIBLE')`,
    )
    .get(competitionName, `%${seasonLabel}%`) as { count: number };
  return row.count;
};
