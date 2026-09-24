import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FederationGovernanceRepository,
  FederationPoliticsRepository,
  GovernmentRepository,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  ensureFederationLeadershipContinuity,
  initializeFederationGovernanceForSave,
  issueComplianceSanction,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 9D: the Federation President life cycle. A term that ends closes the
 * tenure (kept as history), removes every President authority and returns the
 * same person to the base career. Tenure and election reads are public-state
 * only. Government requests are validated in the domain.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const character = {
  fullName: "Federation Closure Tester",
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
  const directory = mkdtempSync(join(tmpdir(), `fedclose-${label}-`));
  dirs.push(directory);
  return new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
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

const personOf = (db: GameDatabase): EntityId => {
  const save = db.prepare("SELECT player_character_id FROM saves LIMIT 1").get() as { player_character_id: EntityId };
  return (db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as { person_id: EntityId })
    .person_id;
};

type Base = "MANAGER" | "CHAIRMAN_OWNER";

/** A career whose base role is Manager or Owner, holding a President tenure. */
const newPresident = (label: string, base: Base, status: "ACTIVE" | "INTERIM" = "ACTIVE", termEnd = "2030-01-01") => {
  const service = newService(label);
  let savePath: string;
  if (base === "CHAIRMAN_OWNER") {
    const clubs = service.listStartingClubs();
    if (!clubs.ok) throw new Error(clubs.error.message);
    const club = clubs.data.find((option) => option.division === "C") ?? clubs.data[0]!;
    const created = service.createCareer({ careerMode: "OWNER", saveName: `Close ${label}`, joinTeamId: club.teamId, character });
    if (!created.ok) throw new Error(created.error.message);
    savePath = created.data.catalogEntry.filePath;
  } else {
    const created = service.createCareer({ saveName: `Close ${label}`, character });
    if (!created.ok) throw new Error(created.error.message);
    savePath = created.data.catalogEntry.filePath;
  }
  service.closeCareer();
  withDb(savePath, (db) => {
    const save = db.prepare("SELECT world_date, random_seed FROM saves LIMIT 1").get() as { world_date: string; random_seed: string };
    initializeFederationGovernanceForSave({ db, worldDate: save.world_date, seed: save.random_seed });
    db.prepare(
      `INSERT INTO federation_leadership_tenures
        (id, person_id, federation_id, role, term_start, term_end, status, provenance_status)
        VALUES ('closure-tenure', ?, ?, 'FEDERATION_PRESIDENT', ?, ?, ?, 'SIMULATION_ONLY')`,
    ).run(personOf(db), federationId(db), save.world_date, termEnd, status);
  });
  expect(service.loadCareerByPath(savePath).ok).toBe(true);
  expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT").ok).toBe(true);
  return { service, savePath };
};

/** Runs the real season-end leadership routine for a date, with the save closed. */
const runContinuity = (service: DesktopApplicationService, savePath: string, dates: string[]): void => {
  service.closeCareer();
  withDb(savePath, (db) => {
    for (const date of dates) ensureFederationLeadershipContinuity(db, { date, seed: "closure" });
  });
  expect(service.loadCareerByPath(savePath).ok).toBe(true);
};

const roles = (service: DesktopApplicationService) => {
  const result = service.getCareerRoles();
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};

const presidentReads = (service: DesktopApplicationService) => [
  service.getFederationPresidentDashboard(),
  service.getFederationTenure(),
  service.getFederationExternalContext(),
  service.getFederationCompetitionGovernance(),
  service.getFederationDevelopmentProgrammes(),
  service.getFederationGrants(),
  service.getCompetitionPyramid(),
  service.getNationalDevelopment(),
  service.getGovernmentOverview(),
  service.setFederationBudget("ADMINISTRATION", 1),
];

const expectAllRejected = (results: Array<{ ok: boolean; error?: { code: string } }>): void => {
  for (const result of results) {
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ROLE_NOT_AUTHORIZED");
  }
};

describe("term end returns the same person to the base career", () => {
  for (const base of ["MANAGER", "CHAIRMAN_OWNER"] as const) {
    it(`a ${base} president whose term ends is restored to ${base} with the tenure kept as history`, () => {
      const { service, savePath } = newPresident(`end-${base}`, base, "ACTIVE", "2026-07-01");
      expect(roles(service).activeRole).toBe("FEDERATION_PRESIDENT");
      const before = withDb(savePath, (db) => ({
        person: personOf(db),
        contracts: db.prepare("SELECT COUNT(*) AS n FROM manager_contracts WHERE person_id=? AND status='ACTIVE'").get(personOf(db)),
        stakes: db.prepare("SELECT COUNT(*) AS n FROM club_ownership_stakes WHERE holder_id=? AND status='ACTIVE'").get(personOf(db)),
      }));

      runContinuity(service, savePath, ["2026-07-28"]);

      const state = roles(service);
      expect(state.activeRole).toBe(base);
      expect(state.heldRoles.map((entry) => entry.role)).not.toContain("FEDERATION_PRESIDENT");
      expectAllRejected(presidentReads(service));
      service.closeCareer();

      withDb(savePath, (db) => {
        const federation = federationId(db);
        const tenures = new FederationGovernanceRepository(db).leadershipTenures(federation);
        const mine = tenures.find((tenure) => tenure.id === "closure-tenure");
        expect(mine).toMatchObject({ status: "FORMER", termEnd: "2026-07-01" });
        const seatHolders = tenures.filter(
          (tenure) => tenure.role === "FEDERATION_PRESIDENT" && (tenure.status === "ACTIVE" || tenure.status === "INTERIM"),
        );
        expect(seatHolders).toHaveLength(1);
        expect(seatHolders[0]?.personId).not.toBe(before.person);
        expect(personOf(db)).toBe(before.person);
        expect(db.prepare("SELECT COUNT(*) AS n FROM persons WHERE id=?").get(before.person)).toEqual({ n: 1 });
        expect(db.prepare("SELECT COUNT(*) AS n FROM manager_contracts WHERE person_id=? AND status='ACTIVE'").get(before.person)).toEqual(before.contracts);
        expect(db.prepare("SELECT COUNT(*) AS n FROM club_ownership_stakes WHERE holder_id=? AND status='ACTIVE'").get(before.person)).toEqual(before.stakes);
      });
    }, 240_000);
  }

  it("a president whose term has not ended keeps the presidency", () => {
    const { service, savePath } = newPresident("running", "MANAGER");
    runContinuity(service, savePath, ["2026-08-28"]);
    expect(roles(service).activeRole).toBe("FEDERATION_PRESIDENT");
    expect(service.getFederationTenure().ok).toBe(true);
    service.closeCareer();
  }, 240_000);
});

describe("interim presidency", () => {
  it("is reported as interim, and closes when the pending election is held", () => {
    const { service, savePath } = newPresident("interim", "MANAGER", "INTERIM", "2026-07-01");
    const tenure = service.getFederationTenure();
    if (!tenure.ok) throw new Error(tenure.error.message);
    expect(tenure.data.current).toMatchObject({ status: "INTERIM", termEnd: "2026-07-01" });

    runContinuity(service, savePath, ["2026-07-28"]);
    expect(roles(service).activeRole).toBe("FEDERATION_PRESIDENT");

    runContinuity(service, savePath, ["2026-10-28"]);
    expect(roles(service).activeRole).toBe("MANAGER");
    expectAllRejected(presidentReads(service));
    service.closeCareer();
    withDb(savePath, (db) => {
      const mine = new FederationGovernanceRepository(db).leadershipTenures(federationId(db)).find((item) => item.id === "closure-tenure");
      expect(mine?.status).toBe("FORMER");
    });
  }, 240_000);

  it("an interim president cannot set a federation budget", () => {
    const { service } = newPresident("interim-budget", "MANAGER", "INTERIM");
    const result = service.setFederationBudget("ADMINISTRATION", 1);
    expect(result.ok).toBe(false);
    service.closeCareer();
  }, 240_000);
});

describe("tenure read", () => {
  it("maps the active term and history and exposes no election internals", () => {
    const { service, savePath } = newPresident("tenure", "MANAGER");
    service.closeCareer();
    withDb(savePath, (db) => {
      const federation = federationId(db);
      const person = personOf(db);
      const politics = new FederationPoliticsRepository(db);
      const other = db
        .prepare("SELECT id FROM persons WHERE id<>? ORDER BY id LIMIT 1")
        .get(person) as { id: EntityId };
      politics.upsertCycle({
        id: "closure-cycle-done" as EntityId,
        federationId: federation,
        nominationStart: "2022-05-01",
        electionDate: "2022-08-01",
        termYears: 4,
        status: "COMPLETED",
        provenanceStatus: "SIMULATION_ONLY",
      });
      politics.upsertCandidate({
        id: "closure-candidate" as EntityId,
        cycleId: "closure-cycle-done" as EntityId,
        federationId: federation,
        personId: other.id,
        reputation: 7,
        supportBase: 6.5,
        committeeInfluence: 0.55,
        votingBlocs: { clubs: 0.9 },
        manifesto: {},
        incumbent: false,
        status: "ELECTED",
        provenanceStatus: "SIMULATION_ONLY",
      });
      politics.upsertResult({
        id: "closure-result" as EntityId,
        cycleId: "closure-cycle-done" as EntityId,
        federationId: federation,
        winnerCandidateId: "closure-candidate" as EntityId,
        electedPersonId: other.id,
        votes: { "closure-candidate": 0.777777 },
        decidedAt: "2022-08-01",
        status: "COMPLETED",
        provenanceStatus: "SIMULATION_ONLY",
      });
      politics.upsertCycle({
        id: "closure-cycle-next" as EntityId,
        federationId: federation,
        nominationStart: "2029-10-01",
        electionDate: "2030-01-01",
        termYears: 4,
        status: "SCHEDULED",
        provenanceStatus: "SIMULATION_ONLY",
      });
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    const result = service.getFederationTenure();
    if (!result.ok) throw new Error(result.error.message);
    const view = result.data;
    expect(view.current).toMatchObject({ id: "closure-tenure", status: "ACTIVE", termEnd: "2030-01-01" });
    expect(view.history.map((entry) => entry.id)).toEqual(["closure-tenure"]);
    expect(view.election.upcoming).toMatchObject({ electionDate: "2030-01-01", nominationStart: "2029-10-01" });
    expect(view.election.latest).toMatchObject({ decidedAt: "2022-08-01", youWon: false, termYears: 4 });
    expect(view.election.latest?.winnerName).toBeTruthy();
    expect(JSON.stringify(view)).not.toMatch(/0\.777777|votes|supportBase|committeeInfluence|votingBlocs|coalition|confidence|probab/i);
    service.closeCareer();
  }, 240_000);

  it("has honest missing-history state when nothing has been recorded", () => {
    const { service } = newPresident("tenure-empty", "MANAGER");
    const result = service.getFederationTenure();
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.election.latest).toBeUndefined();
    expect(result.data.history).toHaveLength(1);
    service.closeCareer();
  }, 240_000);

  it("is rejected for a Manager and an Owner", () => {
    for (const base of ["MANAGER", "CHAIRMAN_OWNER"] as const) {
      const service = newService(`guard-${base}`);
      if (base === "MANAGER") {
        expect(service.createCareer({ saveName: "Guard manager", character }).ok).toBe(true);
      } else {
        const clubs = service.listStartingClubs();
        if (!clubs.ok) throw new Error(clubs.error.message);
        expect(
          service.createCareer({ careerMode: "OWNER", saveName: "Guard owner", joinTeamId: clubs.data[0]!.teamId, character }).ok,
        ).toBe(true);
      }
      expectAllRejected(presidentReads(service));
      service.closeCareer();
    }
  }, 240_000);
});

describe("external context read", () => {
  it("shows sanctions as recorded and never the compliance scores", () => {
    const { service, savePath } = newPresident("external", "MANAGER");
    service.closeCareer();
    withDb(savePath, (db) => {
      issueComplianceSanction(db, {
        federationId: federationId(db),
        date: "2026-08-10",
        authority: "AFC",
        category: "FINANCIAL_REPORTING",
        reason: "Late audited accounts",
        requirementsForResolution: ["Submit audited accounts"],
        affectedProgrammes: ["Development grants"],
        consequences: ["NEW_GRANTS_BLOCKED"],
      });
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    const result = service.getFederationExternalContext();
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.sanctions).toHaveLength(1);
    expect(result.data.sanctions[0]).toMatchObject({
      authority: "AFC",
      reason: "Late audited accounts",
      consequences: ["NEW_GRANTS_BLOCKED"],
      requirementsForResolution: ["Submit audited accounts"],
    });
    expect(JSON.stringify(result.data)).not.toMatch(/autonomy|statutoryCompliance|electionLegitimacy|financialControls|auditQuality|dimensions|history/);
    service.closeCareer();
  }, 240_000);
});

describe("government funding request validation", () => {
  it("accepts a valid request, then rejects invalid, oversized and duplicate open requests", () => {
    const { service, savePath } = newPresident("government", "MANAGER");
    service.closeCareer();
    const institutionId = withDb(savePath, (db) => {
      const id = "closure-institution" as EntityId;
      new GovernmentRepository(db).upsertInstitution({
        id,
        name: "National Sports Council",
        institutionType: "NATIONAL_SPORTS_COUNCIL",
        profile: {
          budgetCapacity: 100_000_000,
          committedBudget: 10_000_000,
          footballPriority: 60,
          credibilityTowardFederation: 55,
          infrastructurePriority: 60,
          youthWomenPriority: 60,
        },
        provenanceStatus: "SIMULATION_ONLY",
      });
      return id;
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);

    const ok = service.requestGovernmentFunding(institutionId, "REGIONAL_GROUND", 2_000_000);
    expect(ok.ok).toBe(true);

    const cases: Array<[string, () => { ok: boolean; error?: { code: string } }]> = [
      ["unknown purpose", () => service.requestGovernmentFunding(institutionId, "NOT_A_TYPE" as never, 1_000)],
      ["zero", () => service.requestGovernmentFunding(institutionId, "INFRASTRUCTURE", 0)],
      ["negative", () => service.requestGovernmentFunding(institutionId, "INFRASTRUCTURE", -5)],
      ["not a number", () => service.requestGovernmentFunding(institutionId, "INFRASTRUCTURE", Number.NaN)],
      ["too large", () => service.requestGovernmentFunding(institutionId, "INFRASTRUCTURE", 5e15)],
      ["duplicate open", () => service.requestGovernmentFunding(institutionId, "REGIONAL_GROUND", 3_000_000)],
    ];
    for (const [label, run] of cases) {
      const result = run();
      expect(result.ok, label).toBe(false);
      expect(result.error?.code, label).toBe("INVALID_SELECTION");
    }
    const overview = service.getGovernmentOverview();
    if (!overview.ok) throw new Error(overview.error.message);
    expect(overview.data.applications).toHaveLength(1);
    expect(overview.data.applications[0]?.requestedAmount).toBe(2_000_000);
    expect(JSON.stringify(overview.data)).not.toMatch(/credibilityTowardFederation|trust\b|footballPriority/);
    service.closeCareer();
  }, 240_000);

  it("rejects a Manager and an Owner requesting government funding", () => {
    const service = newService("gov-guard");
    expect(service.createCareer({ saveName: "Gov guard", character }).ok).toBe(true);
    const result = service.requestGovernmentFunding("x" as EntityId, "INFRASTRUCTURE", 1_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ROLE_NOT_AUTHORIZED");
    service.closeCareer();
  }, 240_000);
});
