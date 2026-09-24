import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  assessClubLicence,
  initializeFederationGovernanceForSave,
  proposeCompetitionReform,
  runCoachEducationProgramme,
  runRefereeProgramme,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 9C: read-only competition governance and development programmes for
 * the President. Reforms, licences and programmes are surfaced exactly as
 * recorded; nothing is mutated by reading, and hidden fields never leave the
 * backend.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const character = {
  fullName: "Federation Governance Tester",
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

const newService = (label: string) => {
  const directory = mkdtempSync(join(tmpdir(), `fedgov-${label}-`));
  dirs.push(directory);
  return new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
};

const newManager = (label: string) => {
  const service = newService(label);
  const created = service.createCareer({ saveName: `Gov ${label}`, character });
  if (!created.ok) throw new Error(created.error.message);
  return { service, savePath: created.data.catalogEntry.filePath };
};

const withDb = <T,>(savePath: string, run: (db: GameDatabase) => T): T => {
  const db = openGameDatabase(savePath);
  try {
    return run(db);
  } finally {
    db.close();
  }
};

const federationId = (db: GameDatabase): EntityId =>
  (db.prepare("SELECT id FROM federations WHERE name='All Nepal Football Association'").get() as { id: EntityId }).id;

const newPresident = (label: string) => {
  const { service, savePath } = newManager(label);
  service.closeCareer();
  withDb(savePath, (db) => {
    const save = db.prepare("SELECT player_character_id, world_date, random_seed FROM saves LIMIT 1").get() as {
      player_character_id: EntityId;
      world_date: string;
      random_seed: string;
    };
    const personId = (
      db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as { person_id: EntityId }
    ).person_id;
    initializeFederationGovernanceForSave({ db, worldDate: save.world_date, seed: save.random_seed });
    db.prepare(
      `INSERT INTO federation_leadership_tenures
        (id, person_id, federation_id, role, term_start, term_end, status, provenance_status)
        VALUES (?, ?, ?, 'FEDERATION_PRESIDENT', ?, '2030-01-01', 'ACTIVE', 'SIMULATION_ONLY')`,
    ).run("gov-president-tenure", personId, federationId(db), save.world_date);
  });
  expect(service.loadCareerByPath(savePath).ok).toBe(true);
  expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT").ok).toBe(true);
  return { service, savePath };
};

const governance = (service: DesktopApplicationService) => {
  const result = service.getFederationCompetitionGovernance();
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};

const programmes = (service: DesktopApplicationService) => {
  const result = service.getFederationDevelopmentProgrammes();
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};

const topDivision = (db: GameDatabase) =>
  db
    .prepare(
      "SELECT id, name FROM competitions WHERE federation_id=? AND scope='domestic' AND lower(name) LIKE '%a-division%' LIMIT 1",
    )
    .get(federationId(db)) as { id: EntityId; name: string };

describe("federation governance reads: role boundary", () => {
  it("a Manager cannot read competition governance or programmes", () => {
    const { service } = newManager("manager");
    for (const result of [service.getFederationCompetitionGovernance(), service.getFederationDevelopmentProgrammes()]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ROLE_NOT_AUTHORIZED");
    }
    service.closeCareer();
  });

  it("an Owner cannot read competition governance or programmes", () => {
    const service = newService("owner");
    const clubs = service.listStartingClubs();
    if (!clubs.ok) throw new Error(clubs.error.message);
    const created = service.createCareer({
      careerMode: "OWNER",
      saveName: "Gov owner",
      joinTeamId: (clubs.data.find((option) => option.division === "C") ?? clubs.data[0]!).teamId,
      character,
    });
    expect(created.ok).toBe(true);
    for (const result of [service.getFederationCompetitionGovernance(), service.getFederationDevelopmentProgrammes()]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ROLE_NOT_AUTHORIZED");
    }
    service.closeCareer();
  });
});

describe("competition governance read", () => {
  it("lists the federation's real domestic competitions with season, teams and rules, and nothing invented", () => {
    const { service } = newPresident("competitions");
    const view = governance(service);
    const names = view.competitions.map((row) => row.competition.label.toLowerCase());
    expect(names.some((name) => name.includes("a-division") || name.includes("a division"))).toBe(true);
    for (const row of view.competitions) {
      expect(row.competition.id).toBeTruthy();
      expect(row.teamCount).toBeGreaterThanOrEqual(0);
    }
    const withRules = view.competitions.find((row) => row.format !== undefined);
    expect(withRules?.rounds).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toMatch(/prestige|competitiveness|quality weight|desirab/i);
    expect(view.provenanceStatus).toBe("SIMULATION_ONLY");
    service.closeCareer();
  });

  it("the pyramid uses the competition that has a season and counts registered teams before a match is played", () => {
    const { service } = newPresident("pyramid");
    const result = service.getCompetitionPyramid();
    if (!result.ok) throw new Error(result.error.message);
    const tierOne = result.data.tiers.find((tier) => tier.level === 1);
    expect(tierOne?.currentSeasonName).toBeTruthy();
    expect(tierOne?.teamCount).toBeGreaterThan(0);
    const governanceRow = governance(service).competitions.find(
      (row) => row.competition.id === tierOne?.competition.id,
    );
    expect(governanceRow?.teamCount).toBe(tierOne?.teamCount);
    service.closeCareer();
  });

  it("has honest empty reform and licensing state in a fresh save", () => {
    const { service } = newPresident("empty");
    const view = governance(service);
    expect(view.reforms).toEqual([]);
    expect(view.licensing.cases).toEqual([]);
    expect(view.licensing.seasonLabel).toBeUndefined();
    service.closeCareer();
  });

  it("maps recorded reforms exactly, newest first, without the registration-policy payload, and never mutates", () => {
    const { service, savePath } = newPresident("reforms");
    withDb(savePath, (db) => {
      const competition = topDivision(db);
      proposeCompetitionReform(db, {
        federationId: federationId(db),
        competitionId: competition.id,
        effectiveSeason: "2027",
        changes: { promotionSlots: 3, relegationSlots: 3, registrationPolicy: { secretDesirability: 0.91 } },
        proposedAt: "2026-08-10",
        status: "APPROVED",
        decidedAt: "2026-08-20",
      });
      proposeCompetitionReform(db, {
        federationId: federationId(db),
        competitionId: competition.id,
        effectiveSeason: "2028",
        changes: { teamCount: 14 },
        proposedAt: "2026-09-01",
      });
    });
    const before = withDb(savePath, (db) => db.prepare("SELECT status, decided_at FROM competition_reform_proposals ORDER BY id").all());
    const view = governance(service);
    expect(view.reforms.map((reform) => [reform.status, reform.effectiveSeason])).toEqual([
      ["PROPOSED", "2028"],
      ["APPROVED", "2027"],
    ]);
    expect(view.reforms[1]?.changes).toMatchObject({ promotionSlots: 3, relegationSlots: 3 });
    expect(view.reforms[1]?.decidedAt).toBe("2026-08-20");
    expect(view.reforms[0]?.changes.teamCount).toBe(14);
    expect(JSON.stringify(view)).not.toMatch(/secretDesirability|registrationPolicy/);
    const after = withDb(savePath, (db) => db.prepare("SELECT status, decided_at FROM competition_reform_proposals ORDER BY id").all());
    expect(after).toEqual(before);
    service.closeCareer();
  });

  it("maps the latest season's licence cases, worst first, showing only open requirements and no history", () => {
    const { service, savePath } = newPresident("licensing");
    withDb(savePath, (db) => {
      const competition = topDivision(db);
      const season = db
        .prepare("SELECT id, start_date FROM competition_seasons WHERE competition_id=? ORDER BY end_date DESC LIMIT 1")
        .get(competition.id) as { id: EntityId; start_date: string };
      const clubs = db
        .prepare("SELECT DISTINCT club_id FROM club_memberships WHERE competition_season_id=? ORDER BY club_id LIMIT 3")
        .all(season.id) as Array<{ club_id: EntityId }>;
      expect(clubs.length).toBeGreaterThan(0);
      for (const club of clubs) {
        assessClubLicence(db, {
          federationId: federationId(db),
          clubId: club.club_id,
          competitionSeasonId: season.id,
          seasonLabel: season.start_date.slice(0, 4),
          date: season.start_date,
        });
      }
    });
    const view = governance(service);
    expect(view.licensing.seasonLabel).toBeTruthy();
    expect(view.licensing.cases.length).toBeGreaterThan(0);
    const order = ["FAILED", "CONDITIONAL", "PENDING", "APPEALED", "PASSED", "RESOLVED"];
    const ranks = view.licensing.cases.map((item) => order.indexOf(item.status));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    for (const item of view.licensing.cases) {
      expect(item.club.id).toBeTruthy();
      expect(item).not.toHaveProperty("history");
      for (const requirement of item.openRequirements) expect(requirement.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(JSON.stringify(view)).not.toMatch(/Evidence check|Seasonal licence application/);
    service.closeCareer();
  });
});

describe("development programmes read", () => {
  it("is honestly empty until a programme is recorded, and lists the funding budgets", () => {
    const { service } = newPresident("prog-empty");
    const view = programmes(service);
    expect(view.coachEducation).toEqual([]);
    expect(view.referee).toEqual([]);
    const categories = view.budgets.map((budget) => budget.category);
    for (const category of ["COACH_EDUCATION", "REFEREE_DEVELOPMENT", "YOUTH_DEVELOPMENT", "GRASSROOTS", "WOMENS_FOOTBALL"]) {
      expect(categories).toContain(category);
    }
    expect(categories).not.toContain("ADMINISTRATION");
    service.closeCareer();
  });

  it("maps recorded coach-education and referee programmes exactly and stays distinct from career qualifications", () => {
    const { service, savePath } = newPresident("prog");
    withDb(savePath, (db) => {
      const federation = federationId(db);
      runCoachEducationProgramme(db, { federationId: federation, licenceLevel: "AFC B", startDate: "2026-09-01", seed: "s1", capacity: 20 });
      runRefereeProgramme(db, { federationId: federation, programmeType: "TRAINING", startDate: "2026-09-10", seed: "s2", capacity: 10 });
    });
    const view = programmes(service);
    expect(view.coachEducation).toHaveLength(1);
    expect(view.coachEducation[0]).toMatchObject({
      kind: "COACH_EDUCATION",
      label: "AFC B",
      capacity: 20,
      cost: 20 * 42000,
      outcomeLabel: "Graduates",
      status: "COMPLETED",
    });
    expect(view.coachEducation[0]!.outcome).toBeGreaterThan(0);
    expect(view.referee[0]).toMatchObject({ kind: "REFEREE", label: "TRAINING", capacity: 10, cost: 220000, outcomeLabel: "Officials advanced" });
    expect(JSON.stringify(view)).not.toMatch(/accuracy|bias|disciplinaryTendency|consistency|potential/i);
    service.closeCareer();
  });
});
