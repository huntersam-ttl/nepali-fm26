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
 * The sporting director / director of football half of the executive model.
 * Both roles hold RECRUITMENT_STRATEGY, TRANSFER_NEGOTIATION, LOAN_STRATEGY,
 * PLAYER_CONTRACTS and SQUAD_PLANNING, but the executive landing screen only
 * ever rendered CEO-shaped surfaces (budget/bank/sponsor/facilities), so those
 * authorities were listed and never usable. These tests hold the recruitment
 * desk to the same rules the rest of the executive model follows: authority
 * comes from the persisted assignment, never from the role name, and the desk
 * only ever reports canonical transfer/loan/contract records.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
const character = {
  fullName: "Recruitment Desk Test",
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
  const dir = mkdtempSync(join(tmpdir(), "exec-recruitment-desk-"));
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
    saveName: "Recruitment Desk",
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
  role: "SPORTING_DIRECTOR" | "GENERAL_SECRETARY",
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
    `${clubId}:recruitment-owner-stake`,
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
      id: "exec-recruitment-save" as EntityId,
      name: "Executive Recruitment Desk",
      worldDate,
      databaseVersion: 38,
      gameVersion: "test",
      randomSeed: "exec-recruitment",
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

describe("executive recruitment desk", () => {
  it("gives a sporting director a real recruitment surface backed by their delegated authority", () => {
    const { service, clubId, filePath } = prepare();
    const header = service.getCareerHeader();
    if (!header.ok) throw new Error(header.error.message);
    makeManagerAlsoExecutive(filePath, clubId, header.data.worldDate, "SPORTING_DIRECTOR");

    // SPORTING_DIRECTOR is an NPC job — the desk is reachable through the
    // held appointment without ever switching the player's career into it.
    const desk = service.getExecutiveRecruitmentDesk(clubId);
    expect(desk.ok).toBe(true);
    if (!desk.ok) return;
    expect(desk.data.blockedReason).toBeUndefined();
    expect(desk.data.clubId).toBe(clubId);
    expect(desk.data.clubName.length).toBeGreaterThan(0);
    // The five recruitment-side authorities the role actually holds.
    expect(desk.data.authorities).toEqual(
      expect.arrayContaining([
        "RECRUITMENT_STRATEGY",
        "TRANSFER_NEGOTIATION",
        "LOAN_STRATEGY",
        "PLAYER_CONTRACTS",
        "SQUAD_PLANNING",
      ]),
    );
    // A real club has a squad under contract — the desk reads canonical rows.
    expect(desk.data.squadSize).toBeGreaterThan(0);
    for (const row of desk.data.negotiations) expect(row.canNegotiate).toBe(true);
  });

  it("never invents rows: every desk entry names a real player and a real counterparty", () => {
    const { service, clubId, filePath } = prepare();
    const header = service.getCareerHeader();
    if (!header.ok) throw new Error(header.error.message);
    makeManagerAlsoExecutive(filePath, clubId, header.data.worldDate, "SPORTING_DIRECTOR");
    const desk = service.getExecutiveRecruitmentDesk(clubId);
    if (!desk.ok) throw new Error(desk.error.message);
    for (const row of [...desk.data.negotiations, ...desk.data.loans]) {
      expect(row.playerName).not.toBe("Unnamed player");
      expect(row.otherClubName).not.toBe("Unlisted club");
      expect(row.playerId.length).toBeGreaterThan(0);
    }
    for (const row of desk.data.expiringContracts) {
      expect(row.playerName).not.toBe("Unnamed player");
      expect(row.monthlyWage).toBeGreaterThanOrEqual(0);
    }
  });

  it("a general secretary holds no recruitment authority and gets an honest empty desk", () => {
    const { service, clubId, filePath } = prepare();
    const header = service.getCareerHeader();
    if (!header.ok) throw new Error(header.error.message);
    makeManagerAlsoExecutive(filePath, clubId, header.data.worldDate, "GENERAL_SECRETARY");

    const desk = service.getExecutiveRecruitmentDesk(clubId);
    expect(desk.ok).toBe(true);
    if (!desk.ok) return;
    expect(desk.data.authorities).toEqual([]);
    expect(desk.data.blockedReason).toBeDefined();
    expect(desk.data.negotiations).toEqual([]);
    expect(desk.data.loans).toEqual([]);
    expect(desk.data.expiringContracts).toEqual([]);
  });

  it("authority comes from the assignment, not the role name — an unassigned person gets nothing", () => {
    const { service, clubId } = prepare();
    // No executive assignment was ever created for this career person.
    const desk = service.getExecutiveRecruitmentDesk(clubId);
    expect(desk.ok).toBe(true);
    if (!desk.ok) return;
    expect(desk.data.authorities).toEqual([]);
    expect(desk.data.blockedReason).toBeDefined();
  });
});
