import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService, findHomeFootballContext, homeFootballContext } from "@nepal-football-sim/simulation";
import type { CareerRole, EntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 11A: the world moves whoever the human is. Each role crosses a season
 * boundary through Continue and the staged transition, keeps its identity, and
 * the federation's own calendar (term expiry) runs without any test-only expiry.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterAll(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })));

const character = {
  fullName: "Role Tester",
  dateOfBirth: "1985-01-01",
  startingAge: 41,
  languages: ["en"],
  footballBackground: "COMMUNITY_COACHING",
  education: "SPORTS_RELATED_DEGREE",
  playingExperience: "AMATEUR_PLAYER",
  coachingExperience: "YOUTH_COACH",
  businessBackground: "SMALL_BUSINESS",
  startingReputationProfile: "LOCAL_RESPECTED",
};

const withDb = <T,>(savePath: string, run: (db: GameDatabase) => T): T => {
  const db = openGameDatabase(savePath);
  try {
    return run(db);
  } finally {
    db.close();
  }
};
const count = (db: GameDatabase, sql: string, ...params: unknown[]): number => (db.prepare(sql).get(...(params as [])) as { n: number }).n;

const newService = (label: string) => {
  const directory = mkdtempSync(join(tmpdir(), `roles-${label}-`));
  dirs.push(directory);
  return new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
};

const firstClub = (service: DesktopApplicationService): EntityId => {
  const clubs = service.listStartingClubs();
  if (!clubs.ok || !clubs.data[0]?.teamId) throw new Error("No starting club available");
  return clubs.data[0].teamId;
};

const continueUntil = (service: DesktopApplicationService, done: () => boolean, limit = 500): number => {
  for (let step = 0; step < limit; step += 1) {
    if (done()) return step;
    const result = service.continueCareer();
    if (!result.ok) throw new Error(`continue: ${result.error.code} ${result.error.message} ${(result.error as { detail?: string }).detail ?? ""}`);
    // A manager plays their own matches; any other role leaves them to the world.
    service.quickSimMatch();
  }
  throw new Error("The condition was never reached.");
};

const seasonComplete = (service: DesktopApplicationService): boolean => {
  const status = service.getSeasonStatus();
  return status.ok && status.data.phase !== "IN_PROGRESS";
};

const runTransition = (service: DesktopApplicationService): void => {
  for (let guard = 0; guard < 40; guard += 1) {
    const step = service.advanceSeasonTransition();
    if (!step.ok) throw new Error(`${step.error.code}: ${step.error.message}`);
    if (step.data.seasonStatus.phase === "TRANSITION_FAILED") throw new Error(step.data.seasonStatus.transition?.error ?? "failed");
    if (step.data.finished) return;
  }
  throw new Error("The transition never finished.");
};

describe("the home football context", () => {
  it("returns the Nepal country, federation, currency and locale from one place", () => {
    const service = newService("home");
    const created = service.createCareer({ saveName: "home", character });
    if (!created.ok) throw new Error(created.error.message);
    const savePath = created.data.catalogEntry.filePath;
    service.closeCareer();
    withDb(savePath, (db) => {
      const context = homeFootballContext(db);
      expect(["NP", "NPL"]).toContain(context.countryIso);
      expect(context).toMatchObject({ federationName: "All Nepal Football Association", currency: "NPR", locale: "en-IN" });
      expect(findHomeFootballContext(db)).toEqual(context);
      expect((db.prepare("SELECT country_id AS id FROM federations WHERE id = ?").get(context.federationId) as { id: EntityId }).id).toBe(context.countryId);
    });
  }, 180_000);
});

describe("crossing a season as each role", () => {
  it("an Owner keeps the club, the stake and the role across the boundary", () => {
    const service = newService("owner");
    const created = service.createCareer({ saveName: "owner", careerMode: "OWNER", joinTeamId: firstClub(service), character });
    if (!created.ok) throw new Error(created.error.message);
    const savePath = created.data.catalogEntry.filePath;
    const stakeBefore = withDb(savePath, (db) => db.prepare("SELECT club_id, percentage FROM club_ownership_stakes WHERE status = 'ACTIVE' AND holder_type = 'PERSON' ORDER BY percentage DESC LIMIT 1").get() as { club_id: EntityId; percentage: number });
    expect(service.getCareerRoles()).toMatchObject({ ok: true, data: { activeRole: "CHAIRMAN_OWNER" } });

    continueUntil(service, () => seasonComplete(service));
    const status = service.getSeasonStatus();
    if (!status.ok) throw new Error(status.error.message);
    expect(status.data.phase).toBe("COMPLETE");
    runTransition(service);

    expect(service.getCareerRoles()).toMatchObject({ ok: true, data: { activeRole: "CHAIRMAN_OWNER" } });
    service.closeCareer();
    withDb(savePath, (db) => {
      const stakeAfter = db.prepare("SELECT club_id, percentage FROM club_ownership_stakes WHERE status = 'ACTIVE' AND holder_type = 'PERSON' AND club_id = ? ORDER BY percentage DESC LIMIT 1").get(stakeBefore.club_id) as { club_id: EntityId; percentage: number };
      expect(stakeAfter.percentage).toBe(stakeBefore.percentage);
      // The club's finances closed for the season and it sits in a new season's competition.
      expect(count(db, "SELECT COUNT(*) AS n FROM club_financial_accounts WHERE club_id = ?", stakeBefore.club_id)).toBe(1);
      expect(
        count(
          db,
          `SELECT COUNT(*) AS n FROM club_memberships m JOIN competition_season_states s ON s.competition_season_id = m.competition_season_id
           WHERE m.club_id = ? AND s.status != 'ROLLED_OVER'`,
          stakeBefore.club_id,
        ),
      ).toBeGreaterThan(0);
      expect(count(db, "SELECT COUNT(*) AS n FROM season_transitions WHERE status = 'COMPLETED'")).toBe(1);
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    expect(service.continueCareer().ok).toBe(true);
    service.closeCareer();
  }, 1_800_000);

  it("an unemployed manager crosses the boundary with the same identity and a living job market", () => {
    const service = newService("unemployed");
    const created = service.createCareer({ saveName: "unemployed", careerMode: "MANAGER", joinTeamId: firstClub(service), character });
    if (!created.ok) throw new Error(created.error.message);
    const savePath = created.data.catalogEntry.filePath;
    const personBefore = created.data.header.personId;
    expect(service.resignFromClub().ok).toBe(true);

    continueUntil(service, () => seasonComplete(service));
    runTransition(service);
    service.closeCareer();
    withDb(savePath, (db) => {
      expect(count(db, "SELECT COUNT(*) AS n FROM career_characters")).toBe(1);
      expect(count(db, "SELECT COUNT(*) AS n FROM career_characters WHERE person_id = ?", personBefore ?? "")).toBe(1);
      expect(count(db, "SELECT COUNT(*) AS n FROM season_transitions WHERE status = 'COMPLETED'")).toBe(1);
      expect(count(db, "SELECT COUNT(*) AS n FROM manager_job_vacancies")).toBeGreaterThan(0);
      expect(count(db, "SELECT COUNT(*) AS n FROM competition_season_states WHERE status = 'ROLLED_OVER'")).toBeGreaterThan(0);
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    const state = service.continueCareer();
    expect(state.ok).toBe(true);
    if (state.ok) expect(state.data.header.personId).toBe(personBefore);
    service.closeCareer();
  }, 1_800_000);

  it("a Federation President's term ends through real world progression, and the season still turns over", () => {
    const service = newService("president");
    const created = service.createCareer({ saveName: "president", careerMode: "MANAGER", joinTeamId: firstClub(service), character });
    if (!created.ok) throw new Error(created.error.message);
    const savePath = created.data.catalogEntry.filePath;
    const saveId = created.data.save.id;
    service.closeCareer();
    // Setup only: the person is President with a term that ends inside the season. The expiry itself is not forced.
    withDb(savePath, (db) => {
      const personId = (db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(created.data.save.playerCharacterId!) as { person_id: EntityId }).person_id;
      const federationId = homeFootballContext(db).federationId;
      db.prepare(
        `INSERT INTO federation_leadership_tenures (id, person_id, federation_id, role, term_start, term_end, status, provenance_status)
         VALUES ('rollover-president-term', ?, ?, 'FEDERATION_PRESIDENT', ?, '2027-02-15', 'ACTIVE', 'SIMULATION_ONLY')`,
      ).run(personId, federationId, created.data.save.worldDate);
    });
    expect(service.loadCareer(saveId).ok).toBe(true);
    expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT")).toMatchObject({ ok: true, data: { activeRole: "FEDERATION_PRESIDENT" } });

    const ledgerBefore = withDb(savePath, (db) => count(db, "SELECT COUNT(*) AS n FROM federation_ledger_entries"));
    // Continue is available to the President, and the calendar runs the federation's own months as they come round.
    continueUntil(service, () => seasonComplete(service));
    const monthsLive = withDb(savePath, (db) => (db.prepare("SELECT value FROM world_progress_cursors WHERE key = 'world_month'").get() as { value: string }).value);
    expect(monthsLive >= "2027-01", "federation months were processed while time passed").toBe(true);
    // The league finishes in early February, before the term's end date: the President still holds office.
    expect(service.getCareerRoles()).toMatchObject({ ok: true, data: { activeRole: "FEDERATION_PRESIDENT" } });
    expect(withDb(savePath, (db) => count(db, "SELECT COUNT(*) AS n FROM federation_leadership_tenures WHERE id = 'rollover-president-term' AND status = 'ACTIVE'"))).toBe(1);

    // The offseason months, including the day the term ends, are processed by the season transition.
    runTransition(service);
    const roles = service.getCareerRoles();
    if (!roles.ok) throw new Error(roles.error.message);
    expect(roles.data.activeRole).not.toBe("FEDERATION_PRESIDENT");
    expect(roles.data.heldRoles).not.toContain("FEDERATION_PRESIDENT" as CareerRole);
    service.closeCareer();
    withDb(savePath, (db) => {
      const term = db.prepare("SELECT status FROM federation_leadership_tenures WHERE id = 'rollover-president-term'").get() as { status: string };
      expect(term.status).toBe("FORMER");
      const successor = count(db, "SELECT COUNT(*) AS n FROM federation_leadership_tenures WHERE role = 'FEDERATION_PRESIDENT' AND status IN ('ACTIVE','INTERIM') AND id != 'rollover-president-term'");
      expect(successor, "an interim or elected president holds the seat").toBeGreaterThan(0);
      expect(count(db, "SELECT COUNT(*) AS n FROM federation_ledger_entries")).toBeGreaterThan(ledgerBefore);
      expect(count(db, "SELECT COUNT(*) AS n FROM season_transitions WHERE status = 'COMPLETED'")).toBe(1);
      expect((db.prepare("SELECT value FROM world_progress_cursors WHERE key = 'world_month'").get() as { value: string }).value).toBe("2027-07");
    });
  }, 2_400_000);
});
