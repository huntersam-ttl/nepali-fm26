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
 * Verifies the *playable* executive-role path end-to-end through the real
 * DesktopApplicationService — not just the underlying domain functions —
 * for a manager career whose own person is also made the club's CEO. This
 * is the exact reachability path a real save could produce: a chairman
 * appoints their own manager as CEO, or (as constructed here) a manager
 * career person is additionally hired and assigned as their club's CEO.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
const character = {
  fullName: "Executive Role Test",
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

const prepareDivision = (
  division: "A" | "B" | "C",
): { service: DesktopApplicationService; clubId: EntityId; teamId: EntityId; filePath: string } => {
  const dir = mkdtempSync(join(tmpdir(), `exec-role-playable-${division.toLowerCase()}-`));
  dirs.push(dir);
  const service = new DesktopApplicationService({
    savesDirectory: dir,
    worldDatasetPath: registryPath,
  });
  const listed = service.listStartingClubs();
  if (!listed.ok) throw new Error(listed.error.message);
  const club = listed.data.find((item) => item.division === division);
  if (!club?.clubId || !club.teamId)
    throw new Error(`No ${division}-Division club in the starting-club list`);
  const created = service.createCareer({
    careerMode: "MANAGER",
    saveName: `Executive Role ${division}`,
    joinTeamId: club.teamId,
    character,
  });
  if (!created.ok) throw new Error(created.error.message);
  return {
    service,
    clubId: club.clubId,
    teamId: club.teamId,
    filePath: created.data.catalogEntry.filePath,
  };
};

/**
 * Grants the manager's own career person a controlling ownership stake and
 * a CEO staff appointment/executive assignment at their own club — the
 * real, existing ownership and executive-role primitives, applied directly
 * against the save file, exactly as a chairman UI action or founder flow
 * would produce.
 */
const makeManagerAlsoCeo = (filePath: string, clubId: EntityId, worldDate: string): EntityId => {
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
    `${clubId}:manager-owner-stake`,
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
  // Executive roles have no licence tier, so the staff market requires an
  // exactly matching recorded specialisation (see `staffEligibility`).
  db.prepare(
    `INSERT INTO staff_profiles (id, person_id, preferred_role, reputation, availability, work_eligibility_status)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET preferred_role = excluded.preferred_role`,
  ).run(`${personId}:staff-profile`, personId, "CEO", "60", "AVAILABLE", "ELIGIBLE");
  const appointment = hireStaff(
    db,
    {
      id: "exec-role-playable-save" as EntityId,
      name: "Executive Role Playable",
      worldDate,
      databaseVersion: 38,
      gameVersion: "test",
      randomSeed: "exec-role-playable",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSavedAt: "2026-01-01T00:00:00.000Z",
    },
    clubId,
    undefined,
    personId,
    "CEO",
    500_000,
    24,
  );
  assignExecutiveRole(db, {
    clubId,
    ownerPersonId: personId,
    role: "CEO",
    appointment,
    date: worldDate,
  });
  db.close();
  return personId;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("executive role: playable CEO reachability through the real desktop service", () => {
  it.each(["A", "B", "C"] as const)(
    "%s-Division: CEO appears in held roles, role switch works, and the canonical budget command succeeds",
    (division) => {
      const { service, clubId, filePath } = prepareDivision(division);
      const header = service.getCareerHeader();
      if (!header.ok) throw new Error(header.error.message);
      makeManagerAlsoCeo(filePath, clubId, header.data.worldDate);

      const roles = service.getCareerRoles();
      expect(roles.ok).toBe(true);
      if (!roles.ok) return;
      expect(roles.data.heldRoles).toContain("CEO");

      const switched = service.switchActiveCareerRole("CEO");
      expect(switched.ok).toBe(true);
      if (!switched.ok) return;
      expect(switched.data.activeRole).toBe("CEO");

      const authority = service.getExecutiveAuthority();
      expect(authority.ok).toBe(true);
      if (!authority.ok) return;
      expect(authority.data?.assignment.status).toBe("FILLED");
      expect(authority.data?.permittedActions).toContain("BUDGET_ADMINISTRATION");

      const budget = service.setExecutiveClubBudget(clubId, "2026", "WAGE_BUDGET", 1_500_000);
      expect(budget.ok).toBe(true);
      if (budget.ok) expect(budget.data.amount).toBe(1_500_000);
    },
  );

  it("preserves the active CEO role across a full reload", () => {
    const { service, clubId, filePath } = prepareDivision("B");
    const header = service.getCareerHeader();
    if (!header.ok) throw new Error(header.error.message);
    makeManagerAlsoCeo(filePath, clubId, header.data.worldDate);
    service.switchActiveCareerRole("CEO");

    const reopened = new DesktopApplicationService({
      savesDirectory: filePath.slice(0, filePath.lastIndexOf("/")),
      worldDatasetPath: registryPath,
    });
    const listed = reopened.listSaves();
    if (!listed.ok) throw new Error(listed.error.message);
    const saveId = listed.data[0]!.saveId;
    const loaded = reopened.loadCareer(saveId);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.data.header.activeRole).toBe("CEO");
  });

  it("reconciles role loss: unassigning the executive role removes CEO from held roles and blocks further executive commands", () => {
    const { service, clubId, filePath } = prepareDivision("B");
    const header = service.getCareerHeader();
    if (!header.ok) throw new Error(header.error.message);
    const personId = makeManagerAlsoCeo(filePath, clubId, header.data.worldDate);
    service.switchActiveCareerRole("CEO");
    expect(service.setExecutiveClubBudget(clubId, "2026", "WAGE_BUDGET", 1_000_000).ok).toBe(true);

    const db = openGameDatabase(filePath);
    db.prepare(
      "UPDATE club_executive_roles SET status='VACANT', person_id=NULL WHERE club_id=? AND role='CEO'",
    ).run(clubId);
    db.close();

    const roles = service.getCareerRoles();
    expect(roles.ok).toBe(true);
    if (roles.ok) expect(roles.data.heldRoles).not.toContain("CEO");

    // The active role reconciles back to a genuinely held one (Manager) —
    // executive commands against the now-vacant assignment must reject,
    // never silently execute through a stale role.
    const stillActingAsCeo = service.setExecutiveClubBudget(
      clubId,
      "2026",
      "WAGE_BUDGET",
      2_000_000,
    );
    expect(stillActingAsCeo.ok).toBe(false);
    if (!stillActingAsCeo.ok) expect(stillActingAsCeo.error.code).toBe("ROLE_NOT_AUTHORIZED");
    void personId;
  });

  it("rejects a Manager who never switched to CEO from invoking an executive command, even though they hold both roles", () => {
    const { service, clubId, filePath } = prepareDivision("B");
    const header = service.getCareerHeader();
    if (!header.ok) throw new Error(header.error.message);
    makeManagerAlsoCeo(filePath, clubId, header.data.worldDate);
    // Deliberately do not switch — active role remains MANAGER.
    const result = service.setExecutiveClubBudget(clubId, "2026", "WAGE_BUDGET", 1_000_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ROLE_NOT_AUTHORIZED");
  });

  it("Founder-club safety: a vacant CEO seat on a fresh founder-mode club never crashes and blocks executive commands cleanly", () => {
    const dir = mkdtempSync(join(tmpdir(), "exec-role-founder-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({
      savesDirectory: dir,
      worldDatasetPath: registryPath,
    });
    const locations = service.listFounderLocations();
    if (!locations.ok || locations.data.length === 0) return;
    const created = service.createCareer({
      careerMode: "MANAGER",
      saveName: "Founder Executive Safety",
      character,
      founder: { clubName: "Executive Safety FC", locationId: locations.data[0]!.id },
    });
    if (!created.ok) throw new Error(created.error.message);
    // A founder-mode club starts with no executive assignments at all —
    // the read model must resolve to a truthful vacant state, not throw.
    const roles = service.getCareerRoles();
    expect(roles.ok).toBe(true);
    if (roles.ok) expect(roles.data.heldRoles).not.toContain("CEO");
    const switched = service.switchActiveCareerRole("CEO" as never);
    expect(switched.ok).toBe(false);
  });
});
