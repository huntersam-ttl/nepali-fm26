import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CareerWorldRepository, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService, heldCareerRoles } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 8D: career transitions are enforced in the domain, not hidden in the UI.
 * Job-market commands belong to the active Manager career only; accepting an
 * offer while employed ends the current appointment as RESIGNED and opens the
 * new one in a single unit; resignation returns the person to unemployment.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const character = {
  fullName: "Career Transition Tester",
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
  const directory = mkdtempSync(join(tmpdir(), `transition-${label}-`));
  dirs.push(directory);
  const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
  return { service, directory };
};

const newManager = (label: string) => {
  const { service } = newService(label);
  const created = service.createCareer({ saveName: `Transition ${label}`, character });
  if (!created.ok) throw new Error(created.error.message);
  return { service, savePath: created.data.catalogEntry.filePath };
};

const newOwner = (label: string) => {
  const { service } = newService(label);
  const clubs = service.listStartingClubs();
  if (!clubs.ok) throw new Error(clubs.error.message);
  const club = clubs.data.find((option) => option.division === "C") ?? clubs.data[0]!;
  const created = service.createCareer({
    careerMode: "OWNER",
    saveName: `Transition ${label}`,
    joinTeamId: club.teamId,
    character,
  });
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

type Ids = { personId: EntityId; profileId: EntityId; worldDate: string; playerId: EntityId };

const ids = (db: GameDatabase): Ids => {
  const save = db.prepare("SELECT player_character_id, world_date FROM saves LIMIT 1").get() as {
    player_character_id: EntityId;
    world_date: string;
  };
  const personId = (
    db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as {
      person_id: EntityId;
    }
  ).person_id;
  const profileId = (db.prepare("SELECT id FROM manager_profiles WHERE person_id=?").get(personId) as { id: EntityId }).id;
  return { personId, profileId, worldDate: save.world_date, playerId: save.player_character_id };
};

const activeContractCount = (db: GameDatabase, personId: EntityId): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM manager_contracts WHERE person_id=? AND status='ACTIVE'").get(personId) as { n: number }).n;

/** Opens a real vacancy at another Nepali club by sacking its AI manager, and seeds an OFFERED application. */
const seedOfferedVacancy = (savePath: string): { applicationId: EntityId; vacancyId: EntityId; clubName: string } =>
  withDb(savePath, (db) => {
    const { personId, profileId, worldDate } = ids(db);
    const team = db
      .prepare(
        `SELECT t.id AS id, t.club_id AS club_id FROM teams t
         JOIN clubs c ON c.id=t.club_id JOIN countries co ON co.id=c.country_id
         WHERE co.iso_code IN ('NP','NPL')
           AND NOT EXISTS (SELECT 1 FROM manager_contracts mc WHERE mc.team_id=t.id AND mc.status='ACTIVE')
         ORDER BY t.id LIMIT 1`,
      )
      .get() as { id: EntityId; club_id: EntityId };
    const careerWorld = new CareerWorldRepository(db);
    careerWorld.insertVacancy({
      id: "transition-vacancy" as EntityId,
      clubId: team.club_id,
      teamId: team.id,
      openedOn: worldDate,
      reason: "SACKED",
      boardExpectation: "SURVIVE",
      status: "OPEN",
    } as never);
    const vacancy = careerWorld.vacancy("transition-vacancy" as EntityId)!;
    const applicationId = "transition-offer" as EntityId;
    careerWorld.insertApplication({
      id: applicationId,
      vacancyId: vacancy.id,
      managerProfileId: profileId,
      personId,
      status: "OFFERED",
      createdOn: worldDate,
      decidedOn: worldDate,
      offeredSalaryMinor: 3_000_000,
      offeredContractEnd: "2028-08-01",
    } as never);
    const clubName = (db.prepare("SELECT name FROM clubs WHERE id=?").get(vacancy.clubId) as { name: string }).name;
    return { applicationId, vacancyId: vacancy.id as EntityId, clubName };
  });

const grantPresidency = (savePath: string): void =>
  withDb(savePath, (db) => {
    const { personId, worldDate } = ids(db);
    const federationId = (
      db.prepare("SELECT id FROM federations WHERE name='All Nepal Football Association'").get() as { id: EntityId }
    ).id;
    db.prepare(
      `INSERT INTO federation_leadership_tenures
        (id, person_id, federation_id, role, term_start, term_end, status, provenance_status)
        VALUES (?, ?, ?, 'FEDERATION_PRESIDENT', ?, '2030-01-01', 'ACTIVE', 'SIMULATION_ONLY')`,
    ).run("transition-president-tenure", personId, federationId, worldDate);
  });

describe("job-market role guards", () => {
  it("an Owner cannot apply, accept, decline or resign", () => {
    const { service } = newOwner("owner-guard");
    const dummy = "nothing" as EntityId;
    for (const result of [
      service.applyForJob(dummy),
      service.acceptJobOffer(dummy),
      service.declineJobOffer(dummy),
      service.resignFromClub(),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ROLE_NOT_AUTHORIZED");
    }
    service.closeCareer();
  });

  it("a President in temporary office cannot use the job market, and the base career is preserved", () => {
    const { service, savePath } = newManager("president-guard");
    service.closeCareer();
    grantPresidency(savePath);
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT").ok).toBe(true);

    const dummy = "nothing" as EntityId;
    for (const result of [
      service.applyForJob(dummy),
      service.acceptJobOffer(dummy),
      service.declineJobOffer(dummy),
      service.resignFromClub(),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ROLE_NOT_AUTHORIZED");
    }

    const overview = service.getCareerOverview();
    expect(overview.ok).toBe(true);
    if (overview.ok) {
      expect(overview.data.activeRole).toBe("FEDERATION_PRESIDENT");
      expect(overview.data.baseRole).toBe("MANAGER");
      expect(overview.data.isTemporaryPresidentOffice).toBe(true);
    }
    // Still employed: the overlay never flattened the base career.
    service.closeCareer();
    withDb(savePath, (db) => expect(activeContractCount(db, ids(db).personId)).toBe(1));
  });

  it("returning to the Manager career restores job-market access without changing the person", () => {
    const { service, savePath } = newManager("return-to-manager");
    const before = withDb(savePath, (db) => ids(db).personId);
    service.closeCareer();
    grantPresidency(savePath);
    service.loadCareerByPath(savePath);
    service.switchActiveCareerRole("FEDERATION_PRESIDENT");
    expect(service.applyForJob("nothing" as EntityId).ok).toBe(false);
    expect(service.switchActiveCareerRole("MANAGER").ok).toBe(true);

    const centre = service.getJobCentre();
    expect(centre.ok).toBe(true);
    const overview = service.getCareerOverview();
    expect(overview.ok && overview.data.personId).toBe(before);
    service.closeCareer();
  });
});

describe("accepting an offer while employed", () => {
  it("ends the current appointment as RESIGNED and opens exactly one new active contract", () => {
    const { service, savePath } = newManager("accept-employed");
    const oldClub = (() => {
      const dashboard = service.getManagerDashboard();
      if (!dashboard.ok) throw new Error("dashboard failed");
      return dashboard.data.clubName;
    })();
    service.closeCareer();
    const offer = seedOfferedVacancy(savePath);
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    const personBefore = withDb(savePath, (db) => ids(db).personId);

    const accepted = service.acceptJobOffer(offer.applicationId);
    expect(accepted.ok).toBe(true);

    const dashboard = service.getManagerDashboard();
    expect(dashboard.ok && dashboard.data.employmentStatus).toBe("EMPLOYED");
    expect(dashboard.ok && dashboard.data.clubName).toBe(offer.clubName);

    const history = service.getCareerHistory();
    expect(history.ok).toBe(true);
    if (history.ok) {
      const outcomes = history.data.history.map((entry) => entry.outcome);
      expect(outcomes.filter((outcome) => outcome === "ACTIVE")).toHaveLength(1);
      expect(outcomes).toContain("RESIGNED");
      expect(history.data.history.some((entry) => entry.clubName === oldClub && entry.outcome === "RESIGNED")).toBe(true);
      expect(history.data.history.some((entry) => entry.clubName === offer.clubName && entry.outcome === "ACTIVE")).toBe(true);
    }
    service.closeCareer();

    withDb(savePath, (db) => {
      const { personId } = ids(db);
      expect(personId).toBe(personBefore);
      expect(activeContractCount(db, personId)).toBe(1);
      expect(heldCareerRoles(db, personId).filter((entry) => entry.role === "MANAGER")).toHaveLength(1);
      const application = new CareerWorldRepository(db).application(offer.applicationId);
      expect(application?.status).toBe("ACCEPTED");
      const vacancy = new CareerWorldRepository(db).vacancy(offer.vacancyId);
      expect(vacancy?.status).toBe("FILLED");
      // The club the manager left now has an open vacancy.
      const oldVacancy = db
        .prepare(
          "SELECT COUNT(*) AS n FROM manager_job_vacancies v JOIN clubs c ON c.id=v.club_id WHERE c.name=? AND v.status='OPEN' AND v.reason='RESIGNED'",
        )
        .get(oldClub as string) as { n: number };
      expect(oldVacancy.n).toBe(1);
    });
  });

  it("is atomic: a failure part-way leaves the original appointment untouched", () => {
    const { service, savePath } = newManager("accept-atomic");
    service.closeCareer();
    const offer = seedOfferedVacancy(savePath);
    withDb(savePath, (db) => {
      db.exec(
        `CREATE TRIGGER fail_welcome BEFORE INSERT ON inbox_items
         WHEN NEW.title LIKE 'Welcome to%'
         BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`,
      );
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);

    const accepted = service.acceptJobOffer(offer.applicationId);
    expect(accepted.ok).toBe(false);
    service.closeCareer();

    withDb(savePath, (db) => {
      const { personId } = ids(db);
      expect(activeContractCount(db, personId)).toBe(1);
      const resigned = db
        .prepare("SELECT COUNT(*) AS n FROM manager_contracts WHERE person_id=? AND status='RESIGNED'")
        .get(personId) as { n: number };
      expect(resigned.n).toBe(0);
      const careerWorld = new CareerWorldRepository(db);
      expect(careerWorld.application(offer.applicationId)?.status).toBe("OFFERED");
      expect(careerWorld.vacancy(offer.vacancyId)?.status).toBe("OPEN");
    });
  });

  it("refuses to decline someone else's offer", () => {
    const { service, savePath } = newManager("decline-owner");
    service.closeCareer();
    const applicationId = withDb(savePath, (db) => {
      const { personId, worldDate } = ids(db);
      const other = db.prepare("SELECT id, person_id FROM manager_profiles WHERE person_id<>? LIMIT 1").get(personId) as {
        id: EntityId;
        person_id: EntityId;
      };
      const vacancyRow = db.prepare("SELECT id FROM manager_job_vacancies LIMIT 1").get() as { id: EntityId } | undefined;
      let vacancyId = vacancyRow?.id;
      if (!vacancyId) {
        const team = db.prepare("SELECT id, club_id FROM teams LIMIT 1").get() as { id: EntityId; club_id: EntityId };
        vacancyId = "transition-vacancy" as EntityId;
        new CareerWorldRepository(db).insertVacancy({
          id: vacancyId,
          clubId: team.club_id,
          teamId: team.id,
          openedOn: worldDate,
          reason: "SACKED",
          boardExpectation: "SURVIVE",
          status: "OPEN",
        } as never);
      }
      const id = "someone-elses-offer" as EntityId;
      new CareerWorldRepository(db).insertApplication({
        id,
        vacancyId,
        managerProfileId: other.id,
        personId: other.person_id,
        status: "OFFERED",
        createdOn: worldDate,
        decidedOn: worldDate,
      } as never);
      return id;
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    const declined = service.declineJobOffer(applicationId);
    expect(declined.ok).toBe(false);
    service.closeCareer();
    withDb(savePath, (db) => expect(new CareerWorldRepository(db).application(applicationId)?.status).toBe("OFFERED"));
  });
});

describe("resignation", () => {
  it("ends the appointment, returns to unemployment, opens the Jobs market and cannot repeat", () => {
    const { service, savePath } = newManager("resign");
    const before = service.getManagerDashboard();
    if (!before.ok) throw new Error("dashboard failed");
    const oldClub = before.data.clubName;

    expect(service.resignFromClub().ok).toBe(true);

    const dashboard = service.getManagerDashboard();
    expect(dashboard.ok && dashboard.data.employmentStatus).toBe("UNEMPLOYED");
    const centre = service.getJobCentre();
    expect(centre.ok).toBe(true);
    if (centre.ok) expect(centre.data.vacancies.some((entry) => entry.clubName === oldClub && entry.reason === "RESIGNED")).toBe(true);

    const history = service.getCareerHistory();
    if (history.ok) {
      expect(history.data.history.some((entry) => entry.outcome === "RESIGNED")).toBe(true);
      expect(history.data.history.some((entry) => entry.outcome === "ACTIVE")).toBe(false);
    } else throw new Error("history failed");

    const again = service.resignFromClub();
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("INVALID_SELECTION");
    service.closeCareer();

    withDb(savePath, (db) => {
      const { personId } = ids(db);
      expect(activeContractCount(db, personId)).toBe(0);
      expect(heldCareerRoles(db, personId).some((entry) => entry.role === "MANAGER")).toBe(false);
    });
  });
});
