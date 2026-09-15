import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * A save written before executive roles were removed from the human-playable
 * model could have persisted `career_control_context.active_role` as CEO,
 * SPORTING_DIRECTOR, DIRECTOR_OF_FOOTBALL or GENERAL_SECRETARY, or predate
 * the `base_role` column entirely. Loading such a save must never crash,
 * never resurface an NPC role as the player's active career, and must never
 * touch the underlying appointment records.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
const character = {
  fullName: "Legacy Save Tester",
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

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const newManagerSave = (): { service: DesktopApplicationService; filePath: string; saveId: EntityId; personId: EntityId; clubId: EntityId } => {
  const dir = mkdtempSync(join(tmpdir(), "legacy-role-save-"));
  dirs.push(dir);
  const service = new DesktopApplicationService({ savesDirectory: dir, worldDatasetPath: registryPath });
  const listed = service.listStartingClubs();
  if (!listed.ok) throw new Error(listed.error.message);
  const club = listed.data[0]!;
  const created = service.createCareer({
    careerMode: "MANAGER",
    saveName: "Legacy Save",
    joinTeamId: club.teamId,
    character,
  });
  if (!created.ok) throw new Error(created.error.message);
  const filePath = created.data.catalogEntry.filePath;
  const saveId = created.data.save.id;
  service.closeCareer();
  const db = openGameDatabase(filePath);
  const personId = (
    db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(created.data.save.playerCharacterId!) as {
      person_id: EntityId;
    }
  ).person_id;
  db.close();
  return { service, filePath, saveId, personId, clubId: club.clubId! };
};

/** Grants the manager's own person an ACTIVE CEO appointment at their club —
 * the same executive-role primitives production code uses — so the read
 * model has a genuine appointment to check for survival. */
const grantCeoAppointment = (filePath: string, personId: EntityId, clubId: EntityId, worldDate: string): void => {
  const db = openGameDatabase(filePath);
  const appointmentId = "legacy-ceo-appointment";
  db.prepare(
    `INSERT INTO staff_appointments (id, person_id, organisation_type, club_id, role, start_date, employment_status)
     VALUES (?, ?, 'CLUB', ?, 'CEO', ?, 'ACTIVE')`,
  ).run(appointmentId, personId, clubId, worldDate);
  db.prepare(
    `INSERT INTO club_executive_roles (id, club_id, role, person_id, appointment_id, status, assigned_on, provenance_status)
     VALUES (?, ?, 'CEO', ?, ?, 'FILLED', ?, 'SIMULATION_ONLY')`,
  ).run("legacy-ceo-execrole", clubId, personId, appointmentId, worldDate);
  db.close();
};

const grantOwnership = (filePath: string, personId: EntityId, clubId: EntityId, worldDate: string): void => {
  const db = openGameDatabase(filePath);
  db.prepare(
    `INSERT INTO club_ownership_stakes
      (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "legacy-owner-stake",
    clubId,
    "PERSON",
    personId,
    character.fullName,
    "MAJORITY_OWNER",
    75,
    75,
    worldDate,
    "ACTIVE",
    "PARTIALLY_BUYABLE",
    "SIMULATION_ONLY",
  );
  db.close();
};

const writeControlContext = (
  filePath: string,
  personId: EntityId,
  activeRole: string,
  baseRole?: string,
): void => {
  const db = openGameDatabase(filePath);
  db.prepare(
    `CREATE TABLE IF NOT EXISTS career_control_context (
      person_id TEXT PRIMARY KEY,
      active_role TEXT NOT NULL,
      base_role TEXT
    )`,
  ).run();
  db.prepare(
    "INSERT OR REPLACE INTO career_control_context (person_id, active_role, base_role) VALUES (?, ?, ?)",
  ).run(personId, activeRole, baseRole ?? null);
  db.close();
};

describe("old-save reconciliation: a stored active_role that predates the executive-role cleanup", () => {
  it("Case A: active_role=CEO, base_role=MANAGER reconciles to MANAGER, CEO appointment stays intact as an NPC job", () => {
    const { service, filePath, saveId, personId, clubId } = newManagerSave();
    expect(service.loadCareer(saveId).ok).toBe(true);
    const header = service.getCareerHeader();
    if (!header.ok) throw new Error(header.error.message);
    service.closeCareer();
    grantCeoAppointment(filePath, personId, clubId, header.data.worldDate);
    writeControlContext(filePath, personId, "CEO", "MANAGER");

    expect(service.loadCareer(saveId).ok).toBe(true);
    const roles = service.getCareerRoles();
    expect(roles.ok).toBe(true);
    if (roles.ok) {
      expect(roles.data.activeRole).toBe("MANAGER");
      expect(roles.data.heldRoles).not.toContain("CEO");
    }
    service.closeCareer();

    const db = openGameDatabase(filePath);
    const appointment = db
      .prepare("SELECT status FROM club_executive_roles WHERE id='legacy-ceo-execrole'")
      .get() as { status: string } | undefined;
    expect(appointment?.status).toBe("FILLED");
    db.close();
  });

  it("Case B: active_role=SPORTING_DIRECTOR, base_role=CHAIRMAN_OWNER reconciles to CHAIRMAN_OWNER, SD appointment stays intact", () => {
    const { service, filePath, saveId, personId, clubId } = newManagerSave();
    expect(service.loadCareer(saveId).ok).toBe(true);
    const header = service.getCareerHeader();
    if (!header.ok) throw new Error(header.error.message);
    service.closeCareer();
    grantOwnership(filePath, personId, clubId, header.data.worldDate);
    const db = openGameDatabase(filePath);
    db.prepare(
      `INSERT INTO staff_appointments (id, person_id, organisation_type, club_id, role, start_date, employment_status)
       VALUES (?, ?, 'CLUB', ?, 'SPORTING_DIRECTOR', ?, 'ACTIVE')`,
    ).run("legacy-sd-appointment", personId, clubId, header.data.worldDate);
    db.prepare(
      `INSERT INTO club_executive_roles (id, club_id, role, person_id, appointment_id, status, assigned_on, provenance_status)
       VALUES (?, ?, 'SPORTING_DIRECTOR', ?, ?, 'FILLED', ?, 'SIMULATION_ONLY')`,
    ).run("legacy-sd-execrole", clubId, personId, "legacy-sd-appointment", header.data.worldDate);
    db.close();
    writeControlContext(filePath, personId, "SPORTING_DIRECTOR", "CHAIRMAN_OWNER");

    expect(service.loadCareer(saveId).ok).toBe(true);
    const roles = service.getCareerRoles();
    expect(roles.ok).toBe(true);
    if (roles.ok) {
      expect(roles.data.activeRole).toBe("CHAIRMAN_OWNER");
      expect(roles.data.heldRoles).not.toContain("SPORTING_DIRECTOR");
    }
    service.closeCareer();

    const check = openGameDatabase(filePath);
    const appointment = check
      .prepare("SELECT status FROM club_executive_roles WHERE id='legacy-sd-execrole'")
      .get() as { status: string } | undefined;
    expect(appointment?.status).toBe("FILLED");
    check.close();
  });

  it("Case C: active_role=FEDERATION_PRESIDENT with base_role=CHAIRMAN_OWNER but no valid presidency reconciles to CHAIRMAN_OWNER", () => {
    const { service, filePath, saveId, personId, clubId } = newManagerSave();
    expect(service.loadCareer(saveId).ok).toBe(true);
    const header = service.getCareerHeader();
    if (!header.ok) throw new Error(header.error.message);
    service.closeCareer();
    grantOwnership(filePath, personId, clubId, header.data.worldDate);
    // Deliberately no federation_leadership_tenures row: the presidency is
    // not (or no longer) genuinely held.
    writeControlContext(filePath, personId, "FEDERATION_PRESIDENT", "CHAIRMAN_OWNER");

    expect(service.loadCareer(saveId).ok).toBe(true);
    const roles = service.getCareerRoles();
    expect(roles.ok).toBe(true);
    if (roles.ok) expect(roles.data.activeRole).toBe("CHAIRMAN_OWNER");
    service.closeCareer();
  });

  it("Case E: no base_role value at all derives a safe playable base role and persists it", () => {
    const { service, filePath, saveId, personId } = newManagerSave();
    writeControlContext(filePath, personId, "MANAGER", undefined);

    expect(service.loadCareer(saveId).ok).toBe(true);
    const roles = service.getCareerRoles();
    expect(roles.ok).toBe(true);
    if (roles.ok) expect(roles.data.activeRole).toBe("MANAGER");
    service.closeCareer();

    const db = openGameDatabase(filePath);
    const row = db
      .prepare("SELECT base_role FROM career_control_context WHERE person_id=?")
      .get(personId) as { base_role: string | null } | undefined;
    expect(row?.base_role).toBe("MANAGER");
    db.close();
  });
});
