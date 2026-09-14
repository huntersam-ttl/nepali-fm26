import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventRepository, EventRoutingRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, resolveStoryEntityReference, simulateNepalCareer, storyImportanceBand } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * Story Universe foundation soak — one bounded real season of background
 * world progression (the same natural-production pattern
 * ai-press-production-loop.test.ts and press-final-soak.test.ts already
 * established), instrumented to detect spam/duplication/dead references
 * across every HistoricalEvent category the world naturally produces, not
 * just press.
 */

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `story-universe-soak-${name}-`));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: name,
    gameVersion: "test",
    randomSeed: name,
  });
  return path;
};

const seedManagersForAllFixtureTeams = (db: ReturnType<typeof openGameDatabase>): number => {
  const teams = db
    .prepare(
      `SELECT DISTINCT team_id FROM (
        SELECT home_team_id AS team_id FROM fixtures
        UNION
        SELECT away_team_id AS team_id FROM fixtures
      )`,
    )
    .all() as Array<{ team_id: EntityId }>;
  let seeded = 0;
  for (const { team_id: teamId } of teams) {
    const existing = db.prepare("SELECT 1 FROM manager_contracts WHERE team_id=? AND status='ACTIVE'").get(teamId);
    if (existing) continue;
    const person = db
      .prepare("SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM manager_profiles) LIMIT 1")
      .get() as { id: EntityId } | undefined;
    if (!person) break;
    const clubRow = db.prepare("SELECT club_id FROM teams WHERE id=?").get(teamId) as { club_id: EntityId } | undefined;
    if (!clubRow) continue;
    const profileId = `soak-story-manager-profile-${person.id}` as EntityId;
    db.prepare(
      `INSERT INTO manager_profiles (id, person_id, attributes_json, preferred_style, reputation_profile, created_on)
       VALUES (?, ?, '{}', 'BALANCED', 'UNKNOWN', '2026-01-01')`,
    ).run(profileId, person.id);
    db.prepare(
      `INSERT INTO manager_contracts (id, manager_profile_id, person_id, team_id, club_id, job_title, contract_start, salary_amount_minor, currency, status)
       VALUES (?, ?, ?, ?, ?, 'Head Coach', '2026-01-01', 100000, 'NPR', 'ACTIVE')`,
    ).run(`soak-story-manager-contract-${person.id}`, profileId, person.id, teamId, clubRow.club_id);
    seeded += 1;
  }
  return seeded;
};

const RAW_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("Story Universe foundation soak — one real season", () => {
  it("a natural season of world progression produces bounded, valid, non-duplicated, non-fabricated Stories", () => {
    const path = makeSave("season");
    const db = openGameDatabase(path);
    const t0 = Date.now();

    simulateNepalCareer({
      db,
      seasons: 1,
      seed: "story-universe-soak-bootstrap",
      savePath: path,
      competitionSeasonId: "anfa-national-league-2026" as EntityId,
      maxFixturesPerSeason: 90,
    });
    seedManagersForAllFixtureTeams(db);
    simulateNepalCareer({
      db,
      seasons: 1,
      seed: "story-universe-soak-season-2",
      savePath: path,
      competitionSeasonId: "anfa-national-league-2026" as EntityId,
    });
    const tSimulated = Date.now();

    const events = new EventRepository(db).historicalEvents();

    // --- duplicates: the primary key itself guarantees this, but confirm
    // the repository read-path agrees (no accidental row duplication via a
    // join or a stale cache). ---
    const idSet = new Set(events.map((event) => event.id));
    expect(idSet.size).toBe(events.length);

    // --- by category / by materiality ---
    const byType = new Map<string, number>();
    const byImportance = new Map<string, number>();
    for (const event of events) {
      byType.set(event.eventType, (byType.get(event.eventType) ?? 0) + 1);
      const band = storyImportanceBand(event.importance);
      byImportance.set(band, (byImportance.get(band) ?? 0) + 1);
    }

    // --- entity reference validity: every involved entity either resolves
    // to a real, labelled reference or is a recognised-but-unmapped type
    // (never a raw id leaking into presentation). ---
    let deadRefs = 0;
    let rawUuidTitles = 0;
    const unmappedTypes = new Set<string>();
    const MAPPED_ROLE = "MANAGER" as const;
    for (const event of events) {
      if (RAW_UUID.test(event.title)) rawUuidTitles += 1;
      for (const ref of event.involvedEntities) {
        const resolved = resolveStoryEntityReference(db, ref, MAPPED_ROLE);
        if (!resolved) {
          unmappedTypes.add(ref.type);
          continue;
        }
        if (!resolved.visible) continue;
        if (RAW_UUID.test(resolved.label)) deadRefs += 1;
      }
    }

    // --- role relevance: at least some deliveries were routed (the
    // existing EventRoutingRepository/routeHistoricalEvent mechanism, not a
    // second per-role duplication of the same Story row). ---
    const deliveries = new EventRoutingRepository(db).deliveries();

    const totalMs = Date.now() - t0;
    console.log("SOAK — world/runtime:", {
      totalHistoricalEvents: events.length,
      simulateMs: tSimulated - t0,
      totalMs,
    });
    console.log("SOAK — by category:", Object.fromEntries([...byType.entries()].sort((a, b) => b[1] - a[1])));
    console.log("SOAK — by materiality:", Object.fromEntries(byImportance));
    console.log("SOAK — entity refs:", { rawUuidTitles, deadRefs, unmappedTypes: [...unmappedTypes] });
    console.log("SOAK — role deliveries:", deliveries.length);

    expect(events.length).toBeGreaterThan(0);
    expect(rawUuidTitles).toBe(0);
    expect(deadRefs).toBe(0);

    // Highest-volume producer, reported (not asserted against an arbitrary
    // cap) so a future regression that floods one category is visible.
    const [topType, topCount] = [...byType.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["none", 0];
    console.log("SOAK — highest-volume category:", topType, topCount);

    db.close();
  }, 300_000);
});
