import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * The single canonical statement of the playable-career product model:
 * MANAGER, CHAIRMAN_OWNER and (only while genuinely elected)
 * FEDERATION_PRESIDENT are the only human-playable careers. SPORTING_
 * DIRECTOR, DIRECTOR_OF_FOOTBALL, CEO and GENERAL_SECRETARY are NPC jobs —
 * simulated, appointable, and reachable through their own dedicated
 * authority APIs — but never something a human switches into, even when
 * the human's own person genuinely holds the appointment.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const character = {
  fullName: "Authorization Matrix Tester",
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

const newManagerService = (label: string): { service: DesktopApplicationService; savePath: string } => {
  const directory = mkdtempSync(join(tmpdir(), `authz-${label}-`));
  dirs.push(directory);
  const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
  const created = service.createCareer({ saveName: `Authz ${label}`, character });
  if (!created.ok) throw new Error(created.error.message);
  return { service, savePath: created.data.catalogEntry.filePath };
};

const newOwnerService = (label: string): { service: DesktopApplicationService; savePath: string; clubId: EntityId } => {
  const directory = mkdtempSync(join(tmpdir(), `authz-${label}-`));
  dirs.push(directory);
  const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
  const clubs = service.listStartingClubs();
  if (!clubs.ok) throw new Error(clubs.error.message);
  const club = clubs.data.find((option) => option.division === "C") ?? clubs.data[0]!;
  const created = service.createCareer({
    careerMode: "OWNER",
    saveName: `Authz ${label}`,
    joinTeamId: club.teamId,
    character,
  });
  if (!created.ok) throw new Error(created.error.message);
  return { service, savePath: created.data.catalogEntry.filePath, clubId: club.clubId! };
};

const grantPresidency = (savePath: string): void => {
  const db = openGameDatabase(savePath);
  const save = db.prepare("SELECT id, player_character_id, world_date FROM saves LIMIT 1").get() as {
    id: EntityId;
    player_character_id: EntityId;
    world_date: string;
  };
  const personId = (
    db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as {
      person_id: EntityId;
    }
  ).person_id;
  const federationId = (
    db.prepare("SELECT id FROM federations WHERE name='All Nepal Football Association'").get() as { id: EntityId }
  ).id;
  db.prepare(
    `INSERT INTO federation_leadership_tenures
      (id, person_id, federation_id, role, term_start, term_end, status, provenance_status)
      VALUES (?, ?, ?, 'FEDERATION_PRESIDENT', ?, '2030-01-01', 'ACTIVE', 'SIMULATION_ONLY')`,
  ).run("authz-president-tenure", personId, federationId, save.world_date);
  db.close();
};

/** Grants the manager's own person a genuine ACTIVE executive appointment at
 * their own club, mirroring the real owner-delegation mechanics. */
const grantExecutiveAppointment = (
  savePath: string,
  role: "SPORTING_DIRECTOR" | "CEO",
): { clubId: EntityId } => {
  const db = openGameDatabase(savePath);
  const save = db.prepare("SELECT player_character_id, world_date FROM saves LIMIT 1").get() as {
    player_character_id: EntityId;
    world_date: string;
  };
  const personId = (
    db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as {
      person_id: EntityId;
    }
  ).person_id;
  const clubId = (
    db
      .prepare(
        "SELECT t.club_id AS club_id FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id WHERE mc.person_id=? AND mc.status='ACTIVE' LIMIT 1",
      )
      .get(personId) as { club_id: EntityId }
  ).club_id;
  const appointmentId = `authz-${role}-appointment`;
  db.prepare(
    `INSERT INTO staff_appointments (id, person_id, organisation_type, club_id, role, start_date, employment_status)
     VALUES (?, ?, 'CLUB', ?, ?, ?, 'ACTIVE')`,
  ).run(appointmentId, personId, clubId, role, save.world_date);
  db.prepare(
    `INSERT INTO club_executive_roles (id, club_id, role, person_id, appointment_id, status, assigned_on, provenance_status)
     VALUES (?, ?, ?, ?, ?, 'FILLED', ?, 'SIMULATION_ONLY')`,
  ).run(`authz-${role}-execrole`, clubId, role, personId, appointmentId, save.world_date);
  db.close();
  return { clubId };
};

describe("playable career authorization matrix", () => {
  it("MANAGER: manager actions allowed; Owner/President actions and every NPC executive switch rejected", () => {
    const { service } = newManagerService("manager");

    expect(service.requestStructuredPressConference({ context: "TRANSFER" }).ok).toBe(true);

    const ownerAction = service.setClubBudget("nonexistent-club" as EntityId, "2026", "WAGE_BUDGET", 1);
    expect(ownerAction.ok).toBe(false);
    if (!ownerAction.ok) expect(ownerAction.error.code).toBe("ROLE_NOT_AUTHORIZED");

    const presidentAction = service.getFederationPresidentDashboard();
    expect(presidentAction.ok).toBe(false);
    if (!presidentAction.ok) expect(presidentAction.error.code).toBe("ROLE_NOT_AUTHORIZED");

    for (const role of ["CEO", "SPORTING_DIRECTOR", "GENERAL_SECRETARY", "DIRECTOR_OF_FOOTBALL"] as const) {
      const switched = service.switchActiveCareerRole(role as never);
      expect(switched.ok).toBe(false);
      if (!switched.ok) expect(switched.error.code).toBe("ROLE_NOT_AUTHORIZED");
    }
    service.closeCareer();
  });

  it("CHAIRMAN_OWNER: owner actions allowed; Manager-only action and President actions rejected while Owner is active; every NPC executive switch rejected", () => {
    const { service, clubId } = newOwnerService("owner");

    const ownerAction = service.getChairmanDashboard();
    expect(ownerAction.ok).toBe(true);

    // Manager-only football operations are rejected while active role is Owner.
    const managerAction = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(managerAction.ok).toBe(false);
    if (!managerAction.ok) expect(managerAction.error.code).toBe("ROLE_NOT_AUTHORIZED");

    const presidentAction = service.getFederationPresidentDashboard();
    expect(presidentAction.ok).toBe(false);
    if (!presidentAction.ok) expect(presidentAction.error.code).toBe("ROLE_NOT_AUTHORIZED");

    for (const role of ["CEO", "SPORTING_DIRECTOR", "GENERAL_SECRETARY", "DIRECTOR_OF_FOOTBALL"] as const) {
      const switched = service.switchActiveCareerRole(role as never);
      expect(switched.ok).toBe(false);
      if (!switched.ok) expect(switched.error.code).toBe("ROLE_NOT_AUTHORIZED");
    }

    // Owner supervision surface: executive roles are readable without ever
    // becoming the executive.
    const overview = service.getClubExecutiveOverview(clubId);
    expect(overview.ok).toBe(true);
    if (overview.ok) {
      expect(overview.data.map((entry) => entry.role).sort()).toEqual(
        ["CEO", "DIRECTOR_OF_FOOTBALL", "GENERAL_SECRETARY", "SPORTING_DIRECTOR"].sort(),
      );
    }
    service.closeCareer();
  });

  it("FEDERATION_PRESIDENT: federation governance allowed; Manager action rejected; every NPC executive switch rejected", () => {
    const { service, savePath } = newManagerService("president");
    service.closeCareer();
    grantPresidency(savePath);
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT")).toMatchObject({
      ok: true,
      data: { activeRole: "FEDERATION_PRESIDENT" },
    });

    const presidentAction = service.evaluatePresidentPress();
    expect(presidentAction.ok).toBe(true);

    const managerAction = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(managerAction.ok).toBe(false);
    if (!managerAction.ok) expect(managerAction.error.code).toBe("ROLE_NOT_AUTHORIZED");

    for (const role of ["CEO", "SPORTING_DIRECTOR", "GENERAL_SECRETARY", "DIRECTOR_OF_FOOTBALL"] as const) {
      const switched = service.switchActiveCareerRole(role as never);
      expect(switched.ok).toBe(false);
      if (!switched.ok) expect(switched.error.code).toBe("ROLE_NOT_AUTHORIZED");
    }
    service.closeCareer();
  });

  it("NPC executive appointment (Sporting Director): the role exists and functions in the world, is never exposed to the role picker, and is never switchable", () => {
    const { service, savePath } = newManagerService("sd-appointment");
    service.closeCareer();
    const { clubId } = grantExecutiveAppointment(savePath, "SPORTING_DIRECTOR");
    expect(service.loadCareerByPath(savePath).ok).toBe(true);

    // The role exists in the world and executive authority resolves for it
    // through the held-appointment path — no career switch required.
    const authority = service.getExecutiveAuthority(clubId);
    expect(authority.ok).toBe(true);
    if (authority.ok) {
      expect(authority.data?.assignment.status).toBe("FILLED");
      expect(authority.data?.actorRole).toBe("SPORTING_DIRECTOR");
    }

    // getCareerRoles must never expose the NPC role to the human picker.
    const roles = service.getCareerRoles();
    expect(roles.ok).toBe(true);
    if (roles.ok) {
      expect(roles.data.activeRole).toBe("MANAGER");
      expect(roles.data.heldRoles).not.toContain("SPORTING_DIRECTOR");
    }

    // And switching into it is rejected outright.
    const switched = service.switchActiveCareerRole("SPORTING_DIRECTOR" as never);
    expect(switched.ok).toBe(false);
    if (!switched.ok) expect(switched.error.code).toBe("ROLE_NOT_AUTHORIZED");
    service.closeCareer();
  });

  it("NPC executive appointment (CEO): the role exists and functions in the world, is never exposed to the role picker, and is never switchable", () => {
    const { service, savePath } = newManagerService("ceo-appointment");
    service.closeCareer();
    const { clubId } = grantExecutiveAppointment(savePath, "CEO");
    expect(service.loadCareerByPath(savePath).ok).toBe(true);

    const budget = service.setExecutiveClubBudget(clubId, "2026", "WAGE_BUDGET", 1_500_000);
    expect(budget.ok).toBe(true);

    const roles = service.getCareerRoles();
    expect(roles.ok).toBe(true);
    if (roles.ok) {
      expect(roles.data.activeRole).toBe("MANAGER");
      expect(roles.data.heldRoles).not.toContain("CEO");
    }

    const switched = service.switchActiveCareerRole("CEO" as never);
    expect(switched.ok).toBe(false);
    if (!switched.ok) expect(switched.error.code).toBe("ROLE_NOT_AUTHORIZED");
    service.closeCareer();
  });
});
