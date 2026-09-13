import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Backend authority for the four press pipelines that exist so far
 * (Manager, Owner, Federation President, Sporting Director) — proven as
 * real command rejections, never inferred from what the UI happens to
 * show. CEO/General Secretary press does not exist (see the CEO/GS audit:
 * both are delegated views into Owner-owned domains, never a distinct
 * event-producing authority of their own), but this career already grants
 * those as real CareerRoles (career-control.ts), so their commands against
 * every existing press endpoint must still be rejected today.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const character = {
  fullName: "Role Matrix Tester",
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

/** Grants a real club_executive_roles CareerRole (SPORTING_DIRECTOR, CEO, or
 * GENERAL_SECRETARY) on top of a default Manager-mode career, backed by a
 * genuine ACTIVE staff_appointments row — the same join heldCareerRoles
 * requires — then switches the active role to it. */
const grantExecutiveRole = (
  service: DesktopApplicationService,
  savePath: string,
  role: "SPORTING_DIRECTOR" | "CEO" | "GENERAL_SECRETARY",
): void => {
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
  const club = db.prepare("SELECT id FROM clubs LIMIT 1").get() as { id: EntityId };
  const appointmentId = `role-matrix-appointment-${role}`;
  db.prepare(
    `INSERT INTO staff_appointments (id, person_id, organisation_type, club_id, role, start_date, employment_status)
     VALUES (?, ?, 'CLUB', ?, ?, ?, 'ACTIVE')`,
  ).run(appointmentId, personId, club.id, role, save.world_date);
  db.prepare(
    `INSERT INTO club_executive_roles (id, club_id, role, person_id, appointment_id, status, assigned_on, provenance_status)
     VALUES (?, ?, ?, ?, ?, 'FILLED', ?, 'SIMULATION_ONLY')`,
  ).run(`role-matrix-execrole-${role}`, club.id, role, personId, appointmentId, save.world_date);
  db.close();
};

describe("press role authority matrix (Manager, Owner, President)", () => {
  it("MANAGER press: Manager allowed, Owner/President rejected", () => {
    const directory = mkdtempSync(join(tmpdir(), "matrix-manager-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const created = service.createCareer({ saveName: "Matrix manager", character });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Manager is allowed: evaluatePreMatchPress requires a real fixture, but
    // the structured press request path itself must not be role-rejected.
    const managerAttempt = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(managerAttempt.ok).toBe(true);

    // Owner press is rejected outright: no CHAIRMAN_OWNER role held.
    const ownerAttempt = service.evaluateOwnerBusinessPress();
    expect(ownerAttempt.ok).toBe(false);
    if (!ownerAttempt.ok) expect(ownerAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");

    // President press is rejected outright: no FEDERATION_PRESIDENT role held.
    const presidentAttempt = service.evaluatePresidentPress();
    expect(presidentAttempt.ok).toBe(false);
    if (!presidentAttempt.ok) expect(presidentAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");

    // SD press is rejected outright: no recruitment-authority role held.
    const sdAttempt = service.evaluateSportingDirectorPress();
    expect(sdAttempt.ok).toBe(false);
    if (!sdAttempt.ok) expect(sdAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");
    service.closeCareer();
  });

  it("OWNER press: Owner allowed, Manager/President/SD rejected", () => {
    const directory = mkdtempSync(join(tmpdir(), "matrix-owner-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const clubs = service.listStartingClubs();
    expect(clubs.ok).toBe(true);
    if (!clubs.ok) return;
    const club = clubs.data.find((option) => option.division === "C") ?? clubs.data[0]!;
    const created = service.createCareer({
      careerMode: "OWNER",
      saveName: "Matrix owner",
      joinTeamId: club.teamId,
      character,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const ownerAttempt = service.evaluateOwnerBusinessPress();
    expect(ownerAttempt.ok).toBe(true);

    const managerAttempt = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(managerAttempt.ok).toBe(false);
    if (!managerAttempt.ok) expect(managerAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");

    const presidentAttempt = service.evaluatePresidentPress();
    expect(presidentAttempt.ok).toBe(false);
    if (!presidentAttempt.ok) expect(presidentAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");

    const sdAttempt = service.evaluateSportingDirectorPress();
    expect(sdAttempt.ok).toBe(false);
    if (!sdAttempt.ok) expect(sdAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");
    service.closeCareer();
  });

  it("PRESIDENT press: President allowed, Manager/Owner/SD rejected", () => {
    const directory = mkdtempSync(join(tmpdir(), "matrix-president-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const created = service.createCareer({ saveName: "Matrix president", character });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const savePath = created.data.catalogEntry.filePath;
    service.closeCareer();

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
      db.prepare("SELECT id FROM federations WHERE name='All Nepal Football Association'").get() as {
        id: EntityId;
      }
    ).id;
    db.prepare(
      `INSERT INTO federation_leadership_tenures
        (id, person_id, federation_id, role, term_start, term_end, status, provenance_status)
        VALUES (?, ?, ?, 'FEDERATION_PRESIDENT', ?, '2030-01-01', 'ACTIVE', 'SIMULATION_ONLY')`,
    ).run("matrix-president-tenure", personId, federationId, save.world_date);
    db.close();

    expect(service.loadCareer(save.id).ok).toBe(true);
    expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT")).toMatchObject({ ok: true });

    const presidentAttempt = service.evaluatePresidentPress();
    expect(presidentAttempt.ok).toBe(true);

    const managerAttempt = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(managerAttempt.ok).toBe(false);
    if (!managerAttempt.ok) expect(managerAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");

    const ownerAttempt = service.evaluateOwnerBusinessPress();
    expect(ownerAttempt.ok).toBe(false);
    if (!ownerAttempt.ok) expect(ownerAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");

    const sdAttempt = service.evaluateSportingDirectorPress();
    expect(sdAttempt.ok).toBe(false);
    if (!sdAttempt.ok) expect(sdAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");
    service.closeCareer();
  });

  it("SD press: SD allowed, Manager/Owner/President rejected", () => {
    const directory = mkdtempSync(join(tmpdir(), "matrix-sd-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const created = service.createCareer({ saveName: "Matrix SD", character });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const savePath = created.data.catalogEntry.filePath;
    service.closeCareer();

    grantExecutiveRole(service, savePath, "SPORTING_DIRECTOR");

    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    expect(service.switchActiveCareerRole("SPORTING_DIRECTOR")).toMatchObject({
      ok: true,
      data: { activeRole: "SPORTING_DIRECTOR" },
    });

    // SD press itself returns ok:true even with nothing new to ask about
    // (evaluatePresidentPress/evaluateOwnerBusinessPress behave the same
    // way) — the authority check passing is what this test proves.
    const sdAttempt = service.evaluateSportingDirectorPress();
    expect(sdAttempt.ok).toBe(true);

    const managerAttempt = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(managerAttempt.ok).toBe(false);
    if (!managerAttempt.ok) expect(managerAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");

    const ownerAttempt = service.evaluateOwnerBusinessPress();
    expect(ownerAttempt.ok).toBe(false);
    if (!ownerAttempt.ok) expect(ownerAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");

    const presidentAttempt = service.evaluatePresidentPress();
    expect(presidentAttempt.ok).toBe(false);
    if (!presidentAttempt.ok) expect(presidentAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");
    service.closeCareer();
  });

  it("SPORTING_DIRECTOR/CEO/GENERAL_SECRETARY are rejected from Owner and President press even though their own press features do not exist yet", () => {
    for (const role of ["SPORTING_DIRECTOR", "CEO", "GENERAL_SECRETARY"] as const) {
      const directory = mkdtempSync(join(tmpdir(), `matrix-${role.toLowerCase()}-`));
      dirs.push(directory);
      const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
      const created = service.createCareer({ saveName: `Matrix ${role}`, character });
      expect(created.ok).toBe(true);
      if (!created.ok) continue;
      const savePath = created.data.catalogEntry.filePath;
      service.closeCareer();

      grantExecutiveRole(service, savePath, role);
      expect(service.loadCareerByPath(savePath).ok).toBe(true);
      expect(service.switchActiveCareerRole(role)).toMatchObject({ ok: true, data: { activeRole: role } });

      const ownerAttempt = service.evaluateOwnerBusinessPress();
      expect(ownerAttempt.ok).toBe(false);
      if (!ownerAttempt.ok) expect(ownerAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");

      const presidentAttempt = service.evaluatePresidentPress();
      expect(presidentAttempt.ok).toBe(false);
      if (!presidentAttempt.ok) expect(presidentAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");

      // CEO/GENERAL_SECRETARY must also be rejected from SD press; a real
      // SD career role rejecting itself here would be a bug, so this loop
      // only asserts rejection for the two roles that are not SD.
      if (role !== "SPORTING_DIRECTOR") {
        const sdAttempt = service.evaluateSportingDirectorPress();
        expect(sdAttempt.ok).toBe(false);
        if (!sdAttempt.ok) expect(sdAttempt.error.code).toBe("ROLE_NOT_AUTHORIZED");
      }

      service.closeCareer();
    }
  });
});
