import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase, migrateDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService, assignExecutiveRole } from "@nepal-football-sim/simulation";
import type { CareerRole, EntityId } from "@nepal-football-sim/shared-types";

/**
 * The consolidated 6-role authority matrix for every player-relationship
 * surface — built against the REAL DesktopApplicationService (the same
 * command layer the desktop app itself calls), not just the read-model
 * builders story-actions.test.ts and player-profile-cross-role.test.ts
 * already cover. Those two files already prove the read-model/story-action
 * layer is correctly scoped; this file proves the underlying COMMAND
 * layer itself rejects/allows the same way, closing the "nav visibility is
 * not authority" gap explicitly called out for this pass.
 *
 * One save, one person, all six roles genuinely held on the same career
 * (manager + majority owner + federation president + all three club
 * executive roles), switching the active role between assertions — the
 * same real mechanism a save file legitimately reaches.
 */

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const buildSixRoleFixture = () => {
  const savesDirectory = mkdtempSync(join(tmpdir(), "role-authority-matrix-"));
  tempDirs.push(savesDirectory);
  const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
  const created = service.createCareer({
    saveName: "Role Authority Matrix",
    character: {
      fullName: "Authority Matrix Test",
      preferredDisplayName: "Matrix",
      dateOfBirth: "1985-01-01",
      startingAge: 41,
      languages: ["en"],
      footballBackground: "COMMUNITY_COACHING",
      education: "SPORTS_RELATED_DEGREE",
      playingExperience: "AMATEUR_PLAYER",
      coachingExperience: "SENIOR_COACH",
      businessBackground: "ENTREPRENEURSHIP",
      startingReputationProfile: "LOCAL_RESPECTED",
    },
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("career creation failed");
  const savePath = created.data.catalogEntry.filePath;
  const worldDate = created.data.save.worldDate;
  service.closeCareer();

  const db = openGameDatabase(savePath);
  migrateDatabase(db);
  const personId = (
    db
      .prepare("SELECT person_id FROM career_characters WHERE id = ?")
      .get(created.data.save.playerCharacterId!) as { person_id: EntityId }
  ).person_id;
  const managerClub = db
    .prepare("SELECT club_id FROM manager_contracts WHERE person_id = ? AND status = 'ACTIVE'")
    .get(personId) as { club_id: EntityId };
  const clubId = managerClub.club_id;
  const federation = db
    .prepare("SELECT f.id FROM federations f JOIN clubs c ON c.country_id = f.country_id WHERE c.id = ? LIMIT 1")
    .get(clubId) as { id: EntityId };

  // OWNER — majority stake.
  db.prepare(
    `INSERT INTO club_ownership_stakes
      (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "ram-owner-stake",
    clubId,
    "PERSON",
    personId,
    "Authority Matrix Test",
    "MAJORITY_OWNER",
    75,
    75,
    worldDate,
    "ACTIVE",
    "BUYABLE",
    "SIMULATION_ONLY",
  );

  // FEDERATION PRESIDENT — leadership tenure.
  db.prepare(
    `INSERT INTO federation_leadership_tenures
      (id,person_id,federation_id,role,term_start,term_end,status,provenance_status)
      VALUES (?,?,?,?,?,?,?,?)`,
  ).run("ram-president", personId, federation.id, "FEDERATION_PRESIDENT", worldDate, "2030-01-01", "ACTIVE", "SIMULATION_ONLY");

  // CEO / GENERAL_SECRETARY / SPORTING_DIRECTOR — real executive
  // appointments via assignExecutiveRole, the same primitive the live game
  // itself uses (see executive-role-playable.test.ts).
  // hireStaff enforces one active employment slot per person (the real,
  // deliberate staff-market rule) — this fixture needs the SAME person
  // genuinely holding three concurrent executive appointments (plus their
  // manager job), which no real save could reach through the staff market
  // alone. Insert the staff_appointments rows directly (the table itself
  // has no such uniqueness constraint) and pass a real, matching
  // StaffAppointment object straight to assignExecutiveRole — the exact
  // shape hireStaff itself would have produced, just without going through
  // its single-employment business rule.
  for (const role of ["CEO", "GENERAL_SECRETARY", "SPORTING_DIRECTOR"] as const) {
    const appointmentId = `ram-appointment:${role}` as EntityId;
    db.prepare(
      `INSERT INTO staff_appointments
        (id, person_id, organisation_type, club_id, role, start_date, employment_status)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(appointmentId, personId, "CLUB", clubId, role, worldDate, "ACTIVE");
    assignExecutiveRole(db, {
      clubId,
      ownerPersonId: personId,
      role,
      appointment: {
        id: appointmentId,
        personId,
        organisationType: "CLUB",
        clubId,
        role,
        startDate: worldDate,
        employmentStatus: "ACTIVE",
      },
      date: worldDate,
    });
  }

  db.close();
  expect(service.loadCareer(created.data.save.id).ok).toBe(true);
  return { service, clubId, personId, savePath };
};

const switchTo = (service: DesktopApplicationService, role: CareerRole): void => {
  const result = service.switchActiveCareerRole(role);
  expect(result.ok).toBe(true);
};

describe("relationship role authority matrix — MANAGER", () => {
  it("MANAGER can read AND mutate every relationship command", () => {
    const { service } = buildSixRoleFixture();
    switchTo(service, "MANAGER");
    expect(service.getSquad().ok).toBe(true);
    expect(service.getDressingRoom().ok).toBe(true);
    expect(service.getSquadConcerns().ok).toBe(true);
    expect(service.getTransferCentre().ok).toBe(true);
    // No real concern/demand exists yet on a freshly created career — these
    // commands are expected to reach real domain validation (not role
    // rejection) rather than succeed outright; asserting the error code is
    // NOT ROLE_NOT_AUTHORIZED proves the role gate passed.
    const concernResponse = service.respondToConcern({
      concernId: "no-such-concern" as EntityId,
      action: "REASSURE",
    });
    expect(concernResponse.ok).toBe(false);
    if (!concernResponse.ok) expect(concernResponse.error.code).not.toBe("ROLE_NOT_AUTHORIZED");
    const captaincy = service.appointCaptaincy({ captainPersonId: undefined });
    expect(captaincy.ok).toBe(true);
    service.closeCareer();
  });
});

describe("relationship role authority matrix — OWNER (CHAIRMAN_OWNER)", () => {
  it("OWNER can read Player Profile relationship data but is blocked from every Manager relationship command", () => {
    const { service } = buildSixRoleFixture();
    switchTo(service, "CHAIRMAN_OWNER");
    expect(service.getSquad()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.getDressingRoom()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.getSquadConcerns()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.getTransferCentre()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(
      service.respondToConcern({ concernId: "no-such-concern" as EntityId, action: "REASSURE" }),
    ).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.appointCaptaincy({ captainPersonId: undefined })).toMatchObject({
      ok: false,
      error: { code: "ROLE_NOT_AUTHORIZED" },
    });
    service.closeCareer();
  });
});

describe("relationship role authority matrix — FEDERATION PRESIDENT", () => {
  it("PRESIDENT is blocked from every club-manager relationship command", () => {
    const { service } = buildSixRoleFixture();
    switchTo(service, "FEDERATION_PRESIDENT");
    expect(service.getSquad()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.getDressingRoom()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.getTransferCentre()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.appointCaptaincy({ captainPersonId: undefined })).toMatchObject({
      ok: false,
      error: { code: "ROLE_NOT_AUTHORIZED" },
    });
    service.closeCareer();
  });
});

describe("relationship role authority matrix — SPORTING_DIRECTOR", () => {
  it("SPORTING_DIRECTOR gets real delegated recruitment/transfer VIEW authority, but no player-relationship control and no transfer-mutation command", () => {
    const { service, clubId } = buildSixRoleFixture();
    switchTo(service, "SPORTING_DIRECTOR");
    // Real, working delegated authority: the executive recruitment desk.
    const authority = service.getExecutiveAuthority();
    expect(authority.ok).toBe(true);
    if (authority.ok) {
      expect(authority.data?.assignment.status).toBe("FILLED");
      expect(authority.data?.permittedActions).toContain("TRANSFER_NEGOTIATION");
    }
    const desk = service.getExecutiveRecruitmentDesk(clubId);
    expect(desk.ok).toBe(true);

    // No Manager-only player-relationship authority.
    expect(service.getSquad()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.getDressingRoom()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.appointCaptaincy({ captainPersonId: undefined })).toMatchObject({
      ok: false,
      error: { code: "ROLE_NOT_AUTHORIZED" },
    });
    expect(
      service.respondToConcern({ concernId: "no-such-concern" as EntityId, action: "REASSURE" }),
    ).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });

    // KNOWN GAP (documented, not fixed this pass — see final report): the
    // real, working delegated authority above is VIEW-ONLY. The desktop
    // command that actually mutates a transfer offer (getTransferCentre /
    // respondTransferOffer, which TransferNegotiationLauncher — the same
    // overlay story-actions.ts's "Open negotiation"/"Open transfer context"
    // action opens — depends on) is Manager-only with no delegated-executive
    // path, so this genuinely FILLED, authorized executive still cannot
    // reach the transfer-negotiation mutation surface at all.
    expect(service.getTransferCentre()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    service.closeCareer();
  });
});

describe("relationship role authority matrix — CEO", () => {
  it("CEO has no player-relationship authority", () => {
    const { service } = buildSixRoleFixture();
    switchTo(service, "CEO");
    expect(service.getSquad()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.getDressingRoom()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.getTransferCentre()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.appointCaptaincy({ captainPersonId: undefined })).toMatchObject({
      ok: false,
      error: { code: "ROLE_NOT_AUTHORIZED" },
    });
    const authority = service.getExecutiveAuthority();
    expect(authority.ok).toBe(true);
    if (authority.ok) expect(authority.data?.permittedActions).not.toContain("TRANSFER_NEGOTIATION");
    service.closeCareer();
  });
});

describe("relationship role authority matrix — GENERAL_SECRETARY", () => {
  it("GENERAL_SECRETARY has no player-relationship authority", () => {
    const { service } = buildSixRoleFixture();
    switchTo(service, "GENERAL_SECRETARY");
    expect(service.getSquad()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.getDressingRoom()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.getTransferCentre()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.appointCaptaincy({ captainPersonId: undefined })).toMatchObject({
      ok: false,
      error: { code: "ROLE_NOT_AUTHORIZED" },
    });
    service.closeCareer();
  });
});

describe("relationship role authority matrix — Player Profile read visibility", () => {
  it("every role can open a Player Profile as a shared world entity, but only MANAGER gets player-management controls", () => {
    const { service, clubId } = buildSixRoleFixture();
    const squad = (() => {
      switchTo(service, "MANAGER");
      const result = service.getSquad();
      expect(result.ok).toBe(true);
      return result.ok ? result.data : undefined;
    })();
    const playerId = squad!.players[0]!.personId;

    for (const role of [
      "MANAGER",
      "CHAIRMAN_OWNER",
      "FEDERATION_PRESIDENT",
      "SPORTING_DIRECTOR",
      "CEO",
      "GENERAL_SECRETARY",
    ] as const) {
      switchTo(service, role);
      const profile = service.getPlayerProfile(playerId);
      expect(profile.ok).toBe(true);
      if (!profile.ok) continue;
      expect(profile.data.viewer.role).toBe(role);
      expect(profile.data.viewer.canManagePlayer).toBe(role === "MANAGER");
      // A club-affiliated role (Owner/CEO/GeneralSecretary/SportingDirector,
      // all appointed at the SAME club as the manager here) still sees the
      // real relationship section read-only; the federation-level
      // President — no club of their own — sees none.
      if (role === "FEDERATION_PRESIDENT") {
        expect(profile.data.relationship).toBeUndefined();
      } else {
        expect(profile.data.relationship).toBeDefined();
      }
    }
    void clubId;
    service.closeCareer();
  });
});
