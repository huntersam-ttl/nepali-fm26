import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  assignExecutiveRole,
  hireStaff,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * The general secretary's operations desk. All four secretary authorities
 * (contract administration, licensing, competition registration, staff
 * recruitment) already have canonical commands; what was missing was a surface
 * showing what needs administering. These tests hold the desk to the same
 * rules as the recruitment desk: authority from the persisted assignment, only
 * canonical records, honest empty sections.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
const character = {
  fullName: "Secretary Desk Test",
  dateOfBirth: "1985-01-01",
  startingAge: 41,
  languages: ["en"],
  footballBackground: "COMMUNITY_COACHING",
  education: "SPORTS_RELATED_DEGREE",
  playingExperience: "AMATEUR_PLAYER",
  coachingExperience: "SENIOR_COACH",
  businessBackground: "ENTREPRENEURSHIP",
  startingReputationProfile: "LOCAL_RESPECTED",
};

const prepare = (): {
  service: DesktopApplicationService;
  clubId: EntityId;
  filePath: string;
} => {
  const dir = mkdtempSync(join(tmpdir(), "exec-secretary-desk-"));
  dirs.push(dir);
  const service = new DesktopApplicationService({
    savesDirectory: dir,
    worldDatasetPath: registryPath,
  });
  const listed = service.listStartingClubs();
  if (!listed.ok) throw new Error(listed.error.message);
  const club = listed.data.find((item) => item.division === "A");
  if (!club?.clubId || !club.teamId) throw new Error("No A-Division club in the starting-club list");
  const created = service.createCareer({
    careerMode: "MANAGER",
    saveName: "Secretary Desk",
    joinTeamId: club.teamId,
    character,
  });
  if (!created.ok) throw new Error(created.error.message);
  return { service, clubId: club.clubId, filePath: created.data.catalogEntry.filePath };
};

/**
 * Grants the career person a controlling stake plus a real, FILLED executive
 * assignment in the given role — the same ownership and executive-role
 * primitives a chairman UI action would use, applied to the save file.
 */
const makeManagerAlsoExecutive = (
  filePath: string,
  clubId: EntityId,
  worldDate: string,
  role: "GENERAL_SECRETARY" | "SPORTING_DIRECTOR",
): EntityId => {
  const db = openGameDatabase(filePath);
  const person = db
    .prepare(
      `SELECT mc.person_id AS personId FROM manager_contracts mc
       JOIN teams t ON t.id=mc.team_id WHERE t.club_id=? AND mc.status='ACTIVE' LIMIT 1`,
    )
    .get(clubId) as { personId: EntityId };
  const personId = person.personId;
  db.prepare(
    "INSERT INTO club_ownership_stakes (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    `${clubId}:secretary-owner-stake`,
    clubId,
    "PERSON",
    personId,
    "Manager Owner",
    "MAJORITY_OWNER",
    75,
    75,
    worldDate,
    "ACTIVE",
    "BUYABLE",
    "SIMULATION_ONLY",
  );
  // The staff market requires a recorded specialisation matching the role.
  db.prepare(
    `INSERT INTO staff_profiles (id, person_id, preferred_role, reputation, availability, work_eligibility_status)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET preferred_role = excluded.preferred_role`,
  ).run(`${personId}:staff-profile`, personId, role, "60", "AVAILABLE", "ELIGIBLE");
  const appointment = hireStaff(
    db,
    {
      id: "exec-secretary-save" as EntityId,
      name: "Secretary Operations Desk",
      worldDate,
      databaseVersion: 38,
      gameVersion: "test",
      randomSeed: "exec-secretary",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSavedAt: "2026-01-01T00:00:00.000Z",
    },
    clubId,
    undefined,
    personId,
    role,
    500_000,
    24,
  );
  assignExecutiveRole(db, { clubId, ownerPersonId: personId, role, appointment, date: worldDate });
  db.close();
  return personId;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("general secretary operations desk", () => {
  it("gives a general secretary a real administrative surface backed by their delegated authority", () => {
    const { service, clubId, filePath } = prepare();
    const header = service.getCareerHeader();
    if (!header.ok) throw new Error(header.error.message);
    makeManagerAlsoExecutive(filePath, clubId, header.data.worldDate, "GENERAL_SECRETARY");

    const switched = service.switchActiveCareerRole("GENERAL_SECRETARY");
    expect(switched.ok).toBe(true);

    const desk = service.getSecretaryOperationsDesk(clubId);
    expect(desk.ok).toBe(true);
    if (!desk.ok) return;
    expect(desk.data.blockedReason).toBeUndefined();
    expect(desk.data.clubId).toBe(clubId);
    expect(desk.data.clubName.length).toBeGreaterThan(0);
    expect(desk.data.authorities).toEqual(
      expect.arrayContaining([
        "CONTRACT_ADMINISTRATION",
        "LICENSING",
        "COMPETITION_REGISTRATION",
        "STAFF_RECRUITMENT",
      ]),
    );
    // A real club fields at least one registered team.
    expect(desk.data.registrations.length).toBeGreaterThan(0);
  });

  it("never invents rows: every desk entry names a real person or team", () => {
    const { service, clubId, filePath } = prepare();
    const header = service.getCareerHeader();
    if (!header.ok) throw new Error(header.error.message);
    makeManagerAlsoExecutive(filePath, clubId, header.data.worldDate, "GENERAL_SECRETARY");
    const desk = service.getSecretaryOperationsDesk(clubId);
    if (!desk.ok) throw new Error(desk.error.message);
    for (const row of desk.data.contracts) expect(row.playerName).not.toBe("Unnamed person");
    for (const row of desk.data.staff) expect(row.personName).not.toBe("Unnamed person");
    for (const row of desk.data.registrations) {
      expect(row.teamName.length).toBeGreaterThan(0);
      // Registration counts must be consistent with the squad they describe.
      expect(row.registeredPlayers).toBeLessThanOrEqual(row.squadSize);
      expect(row.registeredPlayers).toBeGreaterThanOrEqual(0);
    }
    // A licence case is only offered for closing while it is genuinely open.
    for (const item of desk.data.licensing) {
      if (item.status === "RESOLVED" || item.status === "PASSED") expect(item.canClose).toBe(false);
      for (const task of item.outstanding) expect(task.requirement.length).toBeGreaterThan(0);
    }
  });

  it("a sporting director gets only the one administrative section they genuinely hold", () => {
    const { service, clubId, filePath } = prepare();
    const header = service.getCareerHeader();
    if (!header.ok) throw new Error(header.error.message);
    makeManagerAlsoExecutive(filePath, clubId, header.data.worldDate, "SPORTING_DIRECTOR");

    const desk = service.getSecretaryOperationsDesk(clubId);
    expect(desk.ok).toBe(true);
    if (!desk.ok) return;
    // STAFF_RECRUITMENT is genuinely shared by the sporting director and the
    // secretary, so the staff section is theirs — but nothing else is.
    expect(desk.data.authorities).toEqual(["STAFF_RECRUITMENT"]);
    expect(desk.data.blockedReason).toBeUndefined();
    expect(desk.data.contracts).toEqual([]);
    expect(desk.data.licensing).toEqual([]);
    expect(desk.data.registrations).toEqual([]);
    expect(desk.data.staff.length).toBeGreaterThan(0);
  });

  it("authority comes from the assignment, not the role name — an unassigned person gets nothing", () => {
    const { service, clubId } = prepare();
    const desk = service.getSecretaryOperationsDesk(clubId);
    expect(desk.ok).toBe(true);
    if (!desk.ok) return;
    expect(desk.data.authorities).toEqual([]);
    expect(desk.data.blockedReason).toBeDefined();
  });

  it("the desk survives a full reload with identical content", () => {
    const { service, clubId, filePath } = prepare();
    const header = service.getCareerHeader();
    if (!header.ok) throw new Error(header.error.message);
    makeManagerAlsoExecutive(filePath, clubId, header.data.worldDate, "GENERAL_SECRETARY");
    const first = service.getSecretaryOperationsDesk(clubId);
    if (!first.ok) throw new Error(first.error.message);

    const reopened = new DesktopApplicationService({
      savesDirectory: filePath.slice(0, filePath.lastIndexOf("/")),
      worldDatasetPath: registryPath,
    });
    const listed = reopened.listSaves();
    if (!listed.ok) throw new Error(listed.error.message);
    const loaded = reopened.loadCareer(listed.data[0].saveId);
    expect(loaded.ok).toBe(true);
    const again = reopened.getSecretaryOperationsDesk(clubId);
    if (!again.ok) throw new Error(again.error.message);
    expect(again.data).toEqual(first.data);
  });
});
