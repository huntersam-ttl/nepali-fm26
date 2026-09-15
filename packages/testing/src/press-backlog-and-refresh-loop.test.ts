import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  FederationGovernanceRepository,
  MediaPhaseBRepository,
  TransferMarketRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  assignResponsibility,
  initializeFederationGovernanceForSave,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * The backlog policy this codebase already relies on is structural, not a
 * separate subsystem: startPressConference's own existingOpen check (one
 * open conference per role-group) means a role can never accumulate more
 * than one actionable interview, and evaluate*Press resolving back to that
 * same interview on every call (rather than creating a new one) is exactly
 * the invariant that made the SD live-verification P0 fix correct — a
 * dashboard mount-effect calling evaluate*Press repeatedly is therefore
 * always safe on the backend side; the bug that occurred was purely in
 * *when* the frontend chose to call refresh() off the back of that
 * repeated-but-idempotent result. This suite proves the backend invariant
 * directly, across all three dashboard-driven roles, so a future refactor
 * can't quietly break it again.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const character = {
  fullName: "Backlog Tester",
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

describe("press backlog policy and refresh-loop regression", () => {
  it("Owner dashboard: repeated evaluate calls while OPEN never create a second interview; once completed, repeated calls never resurrect it", () => {
    const directory = mkdtempSync(join(tmpdir(), "backlog-owner-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const clubs = service.listStartingClubs();
    expect(clubs.ok).toBe(true);
    if (!clubs.ok) return;
    const club = clubs.data.find((option) => option.division === "C") ?? clubs.data[0]!;
    const created = service.createCareer({ careerMode: "OWNER", saveName: "Backlog owner", joinTeamId: club.teamId, character });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const savePath = created.data.catalogEntry.filePath;
    const saveId = created.data.save.id;
    service.closeCareer();

    const db = openGameDatabase(savePath);
    const realClubId = (
      db.prepare("SELECT id FROM clubs LIMIT 1").get() as { id: EntityId }
    ).id;
    new ClubEconomyRepository(db).upsertInfrastructureProject({
      id: "backlog-owner-project" as EntityId,
      clubId: realClubId,
      projectType: "STAND",
      planningStart: "2026-01-01",
      expectedCompletion: "2027-01-01",
      capitalCost: 5_000_000,
      ongoingCost: 100_000,
      currency: "NPR",
      status: "APPROVED",
      financingJson: {},
      provenanceStatus: "SIMULATION_ONLY",
    });
    db.close();
    expect(service.loadCareer(saveId).ok).toBe(true);

    // Simulate 10 dashboard mounts while the interview stays OPEN.
    const interviewIds = new Set<EntityId>();
    let firstStance: string | undefined;
    for (let i = 0; i < 10; i += 1) {
      const evaluated = service.evaluateOwnerBusinessPress();
      expect(evaluated.ok).toBe(true);
      if (evaluated.ok && evaluated.data) {
        interviewIds.add(evaluated.data.interviewId);
        firstStance ??= evaluated.data.currentQuestion?.options[0]?.stance;
      }
    }
    // Exactly one distinct interview id across all 10 repeated calls — the
    // backlog can never grow past one while unanswered.
    expect(interviewIds.size).toBe(1);
    const interviewId = [...interviewIds][0]!;
    expect(firstStance).toBeDefined();

    const db2 = openGameDatabase(savePath);
    const totalRows = new MediaPhaseBRepository(db2).interviews().filter((i) => i.context === "OWNER_BUSINESS").length;
    expect(totalRows).toBe(1);
    db2.close();

    const answered = service.answerOwnerStructuredPressQuestion({
      interviewId,
      stance: firstStance as never,
    });
    expect(answered.ok).toBe(true);

    // Simulate 10 more mounts after completion — never resurrected, never
    // duplicated.
    for (let i = 0; i < 10; i += 1) {
      const again = service.evaluateOwnerBusinessPress();
      expect(again.ok).toBe(true);
      if (again.ok) expect(again.data).toBeUndefined();
    }
    const db3 = openGameDatabase(savePath);
    const totalRowsAfter = new MediaPhaseBRepository(db3).interviews().filter((i) => i.context === "OWNER_BUSINESS").length;
    expect(totalRowsAfter).toBe(1);
    db3.close();
    service.closeCareer();
  }, 60_000);

  it("President dashboard: repeated evaluate calls while OPEN never create a second interview; once completed, repeated calls never resurrect it", () => {
    const directory = mkdtempSync(join(tmpdir(), "backlog-president-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const created = service.createCareer({ saveName: "Backlog president", character });
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
      db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as { person_id: EntityId }
    ).person_id;
    const federationId = (
      db.prepare("SELECT id FROM federations WHERE name='All Nepal Football Association'").get() as { id: EntityId }
    ).id;
    initializeFederationGovernanceForSave({ db, worldDate: save.world_date, seed: "backlog-president" });
    db.prepare(
      `INSERT INTO federation_leadership_tenures (id, person_id, federation_id, role, term_start, term_end, status, provenance_status)
       VALUES (?, ?, ?, 'FEDERATION_PRESIDENT', ?, '2030-01-01', 'ACTIVE', 'SIMULATION_ONLY')`,
    ).run("backlog-president-tenure", personId, federationId, save.world_date);
    const project = {
      id: "backlog-president-project" as EntityId,
      federationId,
      projectType: "NATIONAL_TRAINING_CENTRE" as const,
      name: "National Training Centre",
      startDate: save.world_date,
      expectedCompletion: "2027-01-01",
      capitalCost: 5_000_000,
      annualOperatingCost: 100_000,
      currency: "NPR",
      status: "CONSTRUCTION" as const,
      impactJson: {},
      fundingJson: {},
      ownership: "FEDERATION" as const,
      siteRights: "OWNED" as const,
      maintenanceStatus: "FUNDED" as const,
      delayDays: 0,
      fundingStatus: "FUNDED" as const,
      provenanceStatus: "SIMULATION_ONLY" as const,
    };
    new FederationGovernanceRepository(db).upsertProject(project);
    db.close();
    expect(service.loadCareer(save.id).ok).toBe(true);
    expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT")).toMatchObject({ ok: true });

    const interviewIds = new Set<EntityId>();
    for (let i = 0; i < 10; i += 1) {
      const evaluated = service.evaluatePresidentPress();
      expect(evaluated.ok).toBe(true);
      if (evaluated.ok && evaluated.data) interviewIds.add(evaluated.data.interviewId);
    }
    expect(interviewIds.size).toBe(1);
    const interviewId = [...interviewIds][0]!;

    const answered = service.answerPresidentStructuredPressQuestion({ interviewId, stance: "ASSERTIVE" });
    expect(answered.ok).toBe(true);

    for (let i = 0; i < 10; i += 1) {
      const again = service.evaluatePresidentPress();
      expect(again.ok).toBe(true);
      if (again.ok) expect(again.data).toBeUndefined();
    }
    service.closeCareer();
  }, 60_000);

  it("Sporting Director dashboard: repeated evaluate calls while OPEN never create a second interview; once completed, repeated calls never resurrect it", () => {
    const directory = mkdtempSync(join(tmpdir(), "backlog-sd-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const created = service.createCareer({ saveName: "Backlog SD", character });
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
      db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as { person_id: EntityId }
    ).person_id;
    const clubId = (
      db
        .prepare(
          "SELECT t.club_id AS club_id FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id WHERE mc.person_id=? AND mc.status='ACTIVE' LIMIT 1",
        )
        .get(personId) as { club_id: EntityId }
    ).club_id;
    const appointmentId = "backlog-sd-appointment";
    db.prepare(
      `INSERT INTO staff_appointments (id, person_id, organisation_type, club_id, role, start_date, employment_status)
       VALUES (?, ?, 'CLUB', ?, 'SPORTING_DIRECTOR', ?, 'ACTIVE')`,
    ).run(appointmentId, personId, clubId, save.world_date);
    db.prepare(
      `INSERT INTO club_executive_roles (id, club_id, role, person_id, appointment_id, status, assigned_on, provenance_status)
       VALUES (?, ?, 'SPORTING_DIRECTOR', ?, ?, 'FILLED', ?, 'SIMULATION_ONLY')`,
    ).run("backlog-sd-execrole", clubId, personId, appointmentId, save.world_date);

    assignResponsibility(db, { worldDate: save.world_date } as never, clubId, "TRANSFERS", "STAFF", appointmentId as EntityId);

    const otherClub = db.prepare("SELECT id FROM clubs WHERE id != ? LIMIT 1").get(clubId) as { id: EntityId };
    const player = db.prepare("SELECT player_id FROM player_contracts WHERE club_id=? AND status='ACTIVE' LIMIT 1").get(clubId) as
      | { player_id: EntityId }
      | undefined;
    if (player) {
      new TransferMarketRepository(db).insertTransferOffer({
        id: "backlog-sd-offer" as EntityId,
        buyingClubId: clubId,
        sellingClubId: otherClub.id,
        playerId: player.player_id,
        offerType: "PERMANENT",
        transferFee: 500_000,
        installments: 1,
        addOns: 0,
        sellOnPercentage: 0,
        submittedAt: save.world_date,
        expiresAt: save.world_date,
        status: "COMPLETED",
        currency: "NPR",
        agentFee: 0,
        signingFee: 0,
      });
    }
    db.close();
    expect(service.loadCareer(save.id).ok).toBe(true);
    // SPORTING_DIRECTOR is an NPC job: reached through the held appointment,
    // never a career switch.

    const interviewIds = new Set<EntityId>();
    for (let i = 0; i < 10; i += 1) {
      const evaluated = service.evaluateSportingDirectorPress();
      expect(evaluated.ok).toBe(true);
      if (evaluated.ok && evaluated.data) interviewIds.add(evaluated.data.interviewId);
    }
    expect(interviewIds.size).toBe(1);
    const interviewId = [...interviewIds][0]!;

    const answered = service.answerSportingDirectorStructuredPressQuestion({ interviewId, stance: "ASSERTIVE" });
    expect(answered.ok).toBe(true);

    for (let i = 0; i < 10; i += 1) {
      const again = service.evaluateSportingDirectorPress();
      expect(again.ok).toBe(true);
      if (again.ok) expect(again.data).toBeUndefined();
    }
    service.closeCareer();
  }, 60_000);
});
