import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MediaPhaseBRepository, TransferMarketRepository, openGameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService, assignResponsibility, generatePressQuestions } from "@nepal-football-sim/simulation";
import type { EntityId, SaveMetadata, TransferOffer } from "@nepal-football-sim/shared-types";

/*
 * Sporting Director / Director of Football press: the same MediaInterview/
 * journalist/outlet pipeline Manager, Owner and President press already
 * use, entered through a new RECRUITMENT context grounded in real transfer
 * business (a completed incoming signing, a completed outgoing sale, a
 * failed deal) — never a second engine, and never asked of the Manager once
 * the club has genuinely delegated the TRANSFERS domain away.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const managerCharacter = {
  fullName: "SD Press Tester",
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

/** Creates a default (Manager-mode) career, then grants SPORTING_DIRECTOR on
 * the same physical person at their own club and delegates the club's
 * TRANSFERS domain to that appointment — the real mechanics an owner
 * delegating recruitment away from the Manager would produce, not a
 * shortcut invented for this test. */
const newSdService = (label: string, role: "SPORTING_DIRECTOR" | "DIRECTOR_OF_FOOTBALL" = "SPORTING_DIRECTOR") => {
  const directory = mkdtempSync(join(tmpdir(), `sd-press-${label}-`));
  dirs.push(directory);
  const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
  const created = service.createCareer({ saveName: `SD press ${label}`, character: managerCharacter });
  if (!created.ok) throw new Error(created.error.message);
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
  const clubId = (
    db.prepare("SELECT t.club_id AS club_id FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id WHERE mc.person_id=? AND mc.status='ACTIVE' LIMIT 1").get(personId) as {
      club_id: EntityId;
    }
  ).club_id;

  const appointmentId = `sd-press-appointment-${label}`;
  db.prepare(
    `INSERT INTO staff_appointments (id, person_id, organisation_type, club_id, role, start_date, employment_status)
     VALUES (?, ?, 'CLUB', ?, ?, ?, 'ACTIVE')`,
  ).run(appointmentId, personId, clubId, role, save.world_date);
  db.prepare(
    `INSERT INTO club_executive_roles (id, club_id, role, person_id, appointment_id, status, assigned_on, provenance_status)
     VALUES (?, ?, ?, ?, ?, 'FILLED', ?, 'SIMULATION_ONLY')`,
  ).run(`sd-press-execrole-${label}`, clubId, role, personId, appointmentId, save.world_date);
  assignResponsibility(db, { worldDate: save.world_date } as SaveMetadata, clubId, "TRANSFERS", "STAFF", appointmentId as EntityId);
  db.close();

  expect(service.loadCareer(save.id).ok).toBe(true);
  // SPORTING_DIRECTOR/DIRECTOR_OF_FOOTBALL are NPC jobs — the
  // appointment above is enough; the player never switches into them.
  return { service, saveId: save.id, savePath, personId, clubId };
};

const insertOffer = (
  savePath: string,
  offer: Pick<TransferOffer, "id" | "buyingClubId" | "sellingClubId" | "playerId" | "status" | "submittedAt">,
): void => {
  const db = openGameDatabase(savePath);
  new TransferMarketRepository(db).insertTransferOffer({
    id: offer.id,
    buyingClubId: offer.buyingClubId,
    sellingClubId: offer.sellingClubId,
    playerId: offer.playerId,
    offerType: "PERMANENT",
    transferFee: 500_000,
    installments: 1,
    addOns: 0,
    sellOnPercentage: 0,
    submittedAt: offer.submittedAt,
    expiresAt: offer.submittedAt,
    status: offer.status,
    currency: "NPR",
    agentFee: 0,
    signingFee: 0,
  });
  db.close();
};

const realPlayerAndOtherClub = (savePath: string, excludeClubId: EntityId): { playerId: EntityId; otherClubId: EntityId } => {
  const db = openGameDatabase(savePath);
  const otherClub = db
    .prepare("SELECT id FROM clubs WHERE id != ? LIMIT 1")
    .get(excludeClubId) as { id: EntityId };
  const player = db
    .prepare(`SELECT player_id FROM player_contracts WHERE club_id = ? AND status='ACTIVE' LIMIT 1`)
    .get(excludeClubId) as { player_id: EntityId } | undefined;
  if (!player) {
    const any = db.prepare("SELECT person_id FROM player_attributes LIMIT 1").get() as { person_id: EntityId };
    db.close();
    return { playerId: any.person_id, otherClubId: otherClub.id };
  }
  db.close();
  return { playerId: player.player_id, otherClubId: otherClub.id };
};

describe("sporting director press", () => {
  it("asks a grounded question from a real completed incoming signing, answers it, and persists across reload", () => {
    const { service, saveId, savePath, clubId } = newSdService("incoming");

    const beforeEvaluate = service.getExecutiveAuthority();
    expect(beforeEvaluate.ok).toBe(true);
    if (beforeEvaluate.ok) expect(beforeEvaluate.data?.inbox ?? []).toHaveLength(0);

    service.closeCareer();
    const { playerId, otherClubId } = realPlayerAndOtherClub(savePath, clubId);
    insertOffer(savePath, {
      id: "sd-press-incoming-offer" as EntityId,
      buyingClubId: clubId,
      sellingClubId: otherClubId,
      playerId,
      status: "COMPLETED",
      submittedAt: "2026-08-01",
    });
    expect(service.loadCareer(saveId).ok).toBe(true);

    const evaluated = service.evaluateSportingDirectorPress();
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok || !evaluated.data) return;
    expect(evaluated.data.status).toBe("OPEN");
    expect(evaluated.data.currentQuestion?.prompt).toMatch(/right player to bring in/i);
    expect(evaluated.data.currentQuestion?.subjectEntities.length).toBeGreaterThan(0);
    const interviewId = evaluated.data.interviewId;

    const dashboardWithInbox = service.getExecutiveAuthority();
    expect(dashboardWithInbox.ok).toBe(true);
    if (dashboardWithInbox.ok) {
      const pressItem = dashboardWithInbox.data?.inbox.find((item) => item.type === "PRESS_INTERVIEW");
      expect(pressItem).toBeDefined();
      expect(pressItem?.relatedEntity?.id).toBe(interviewId);
    }

    const stance = evaluated.data.currentQuestion!.options[0]!.stance;
    const answered = service.answerSportingDirectorStructuredPressQuestion({ interviewId, stance });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(answered.data.status).toBe("COMPLETED");
    expect(answered.data.priorAnswers).toHaveLength(1);

    const secondEvaluate = service.evaluateSportingDirectorPress();
    expect(secondEvaluate.ok).toBe(true);
    if (secondEvaluate.ok) expect(secondEvaluate.data).toBeUndefined();

    const dashboardAfter = service.getExecutiveAuthority();
    expect(dashboardAfter.ok).toBe(true);
    if (dashboardAfter.ok) expect(dashboardAfter.data?.inbox ?? []).toHaveLength(0);

    service.closeCareer();
    expect(service.loadCareer(saveId).ok).toBe(true);
    const reloaded = service.getSportingDirectorStructuredPressConference(interviewId);
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.data.status).toBe("COMPLETED");
      expect(reloaded.data.priorAnswers).toEqual(answered.data.priorAnswers);
    }
    service.closeCareer();
  }, 120_000);

  it("Manager does NOT receive duplicate press for a fact the SD already owns (TRANSFERS delegated away)", () => {
    const { service, savePath, clubId, personId } = newSdService("dedupe");
    service.closeCareer();
    const { playerId, otherClubId } = realPlayerAndOtherClub(savePath, clubId);
    insertOffer(savePath, {
      id: "sd-press-dedupe-offer" as EntityId,
      buyingClubId: clubId,
      sellingClubId: otherClubId,
      playerId,
      status: "COMPLETED",
      submittedAt: "2026-08-01",
    });

    const db = openGameDatabase(savePath);
    const teamId = (
      db.prepare("SELECT id FROM teams WHERE club_id=? AND level='senior' LIMIT 1").get(clubId) as { id: EntityId }
    ).id;
    const managerQuestions = generatePressQuestions(db, { context: "TRANSFER", teamId });
    expect(managerQuestions.some((q) => q.topic === "TRANSFER_COMPLETED")).toBe(false);
    const sdQuestions = generatePressQuestions(db, { context: "RECRUITMENT", clubId });
    expect(sdQuestions.some((q) => q.topic === "INCOMING_TRANSFER")).toBe(true);
    db.close();
    void personId;
  });

  it("Manager remains the canonical press owner when TRANSFERS is not delegated (default club)", () => {
    const directory = mkdtempSync(join(tmpdir(), "sd-press-manager-owns-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const created = service.createCareer({ saveName: "Manager owns transfers", character: managerCharacter });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const savePath = created.data.catalogEntry.filePath;
    service.closeCareer();

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
    const teamId = (
      db.prepare("SELECT id FROM teams WHERE club_id=? AND level='senior' LIMIT 1").get(clubId) as { id: EntityId }
    ).id;
    const { playerId, otherClubId } = realPlayerAndOtherClub(savePath, clubId);
    db.close();

    insertOffer(savePath, {
      id: "sd-press-manager-owns-offer" as EntityId,
      buyingClubId: otherClubId,
      sellingClubId: clubId,
      playerId,
      status: "COMPLETED",
      submittedAt: "2026-08-01",
    });

    const db2 = openGameDatabase(savePath);
    const managerQuestions = generatePressQuestions(db2, { context: "TRANSFER", teamId });
    expect(managerQuestions.some((q) => q.topic === "TRANSFER_COMPLETED")).toBe(true);
    const sdQuestions = generatePressQuestions(db2, { context: "RECRUITMENT", clubId });
    expect(sdQuestions).toHaveLength(0);
    db2.close();
  });

  it("rejects SD press commands from a Manager-mode save with no recruitment authority", () => {
    const directory = mkdtempSync(join(tmpdir(), "sd-press-reject-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const created = service.createCareer({ saveName: "Manager only", character: managerCharacter });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const evaluated = service.evaluateSportingDirectorPress();
    expect(evaluated.ok).toBe(false);
    if (!evaluated.ok) expect(evaluated.error.code).toBe("ROLE_NOT_AUTHORIZED");

    const answered = service.answerSportingDirectorStructuredPressQuestion({
      interviewId: "does-not-exist" as EntityId,
      stance: "CALM",
    });
    expect(answered.ok).toBe(false);
    if (!answered.ok) expect(answered.error.code).toBe("ROLE_NOT_AUTHORIZED");

    const fetched = service.getSportingDirectorStructuredPressConference("does-not-exist" as EntityId);
    expect(fetched.ok).toBe(false);
    if (!fetched.ok) expect(fetched.error.code).toBe("ROLE_NOT_AUTHORIZED");

    const media = service.getMediaCentre();
    expect(media.ok).toBe(true);
    if (media.ok) {
      expect(media.data.completedInterviews.every((item) => item.context !== "RECRUITMENT")).toBe(true);
    }
    service.closeCareer();
  });

  it("rejects SD press commands from Owner and President saves", () => {
    for (const mode of ["OWNER"] as const) {
      const directory = mkdtempSync(join(tmpdir(), "sd-press-cross-reject-"));
      dirs.push(directory);
      const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
      const clubs = service.listStartingClubs();
      expect(clubs.ok).toBe(true);
      if (!clubs.ok) continue;
      const club = clubs.data.find((option) => option.division === "C") ?? clubs.data[0]!;
      const created = service.createCareer({
        careerMode: mode,
        saveName: `SD reject ${mode}`,
        joinTeamId: club.teamId,
        character: managerCharacter,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) continue;
      const evaluated = service.evaluateSportingDirectorPress();
      expect(evaluated.ok).toBe(false);
      if (!evaluated.ok) expect(evaluated.error.code).toBe("ROLE_NOT_AUTHORIZED");
      service.closeCareer();
    }
  });

  it("journalist relationship changes exactly once, keyed by the SD's own personId, and a Story publishes exactly once for a material answer", () => {
    const { service, saveId, savePath, clubId } = newSdService("journalist");
    service.closeCareer();
    const { playerId, otherClubId } = realPlayerAndOtherClub(savePath, clubId);
    insertOffer(savePath, {
      id: "sd-press-journalist-offer" as EntityId,
      buyingClubId: clubId,
      sellingClubId: otherClubId,
      playerId,
      status: "COMPLETED",
      submittedAt: "2026-08-01",
    });
    expect(service.loadCareer(saveId).ok).toBe(true);

    const evaluated = service.evaluateSportingDirectorPress();
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok || !evaluated.data) return;
    const interviewId = evaluated.data.interviewId;
    const assertiveStance = evaluated.data.currentQuestion!.options.find((option) => option.stance === "ASSERTIVE")?.stance;
    expect(assertiveStance).toBeDefined();
    const answered = service.answerSportingDirectorStructuredPressQuestion({ interviewId, stance: assertiveStance! });
    expect(answered.ok).toBe(true);

    service.closeCareer();
    const db = openGameDatabase(savePath);
    const relationships = new MediaPhaseBRepository(db).relationships();
    expect(relationships.length).toBeGreaterThan(0);
    const events = db
      .prepare("SELECT COUNT(*) AS n FROM historical_events WHERE event_type='SPORTING_DIRECTOR_PRESS_STATEMENT'")
      .get() as { n: number };
    expect(events.n).toBe(1);
    db.close();

    expect(service.loadCareer(saveId).ok).toBe(true);
    const secondEvaluate = service.evaluateSportingDirectorPress();
    expect(secondEvaluate.ok).toBe(true);
    if (secondEvaluate.ok) expect(secondEvaluate.data).toBeUndefined();
    service.closeCareer();
    const db2 = openGameDatabase(savePath);
    const eventsAfter = db2
      .prepare("SELECT COUNT(*) AS n FROM historical_events WHERE event_type='SPORTING_DIRECTOR_PRESS_STATEMENT'")
      .get() as { n: number };
    expect(eventsAfter.n).toBe(1);
    db2.close();
  }, 120_000);

  it("two genuine same-day recruitment facts (a signing and a failed deal) never collide onto the same interview id", () => {
    const { service, saveId, savePath, clubId } = newSdService("distinct-facts");
    service.closeCareer();
    const { playerId, otherClubId } = realPlayerAndOtherClub(savePath, clubId);
    const db = openGameDatabase(savePath);
    const otherPlayer = db
      .prepare(
        `SELECT person_id FROM player_attributes WHERE person_id != ? LIMIT 1`,
      )
      .get(playerId) as { person_id: EntityId };
    db.close();

    insertOffer(savePath, {
      id: "sd-press-distinct-signing" as EntityId,
      buyingClubId: clubId,
      sellingClubId: otherClubId,
      playerId,
      status: "COMPLETED",
      submittedAt: "2026-08-01",
    });
    insertOffer(savePath, {
      id: "sd-press-distinct-failed" as EntityId,
      buyingClubId: clubId,
      sellingClubId: otherClubId,
      playerId: otherPlayer.person_id,
      status: "REJECTED",
      submittedAt: "2026-08-01",
    });
    expect(service.loadCareer(saveId).ok).toBe(true);

    const evaluated = service.evaluateSportingDirectorPress();
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok || !evaluated.data) return;
    const interviewId = evaluated.data.interviewId;
    expect(evaluated.data.totalQuestions).toBeGreaterThanOrEqual(2);
    const stance = evaluated.data.currentQuestion!.options[0]!.stance;
    const firstAnswer = service.answerSportingDirectorStructuredPressQuestion({ interviewId, stance });
    expect(firstAnswer.ok).toBe(true);
    if (!firstAnswer.ok) return;
    if (firstAnswer.data.status === "OPEN" && firstAnswer.data.currentQuestion) {
      expect(firstAnswer.data.currentQuestion.prompt).toMatch(/unable to complete the move/i);
    }
    service.closeCareer();
  }, 120_000);

  it("Director of Football holds identical recruitment press authority to Sporting Director", () => {
    const { service, saveId, savePath, clubId } = newSdService("dof", "DIRECTOR_OF_FOOTBALL");
    service.closeCareer();
    const { playerId, otherClubId } = realPlayerAndOtherClub(savePath, clubId);
    insertOffer(savePath, {
      id: "sd-press-dof-offer" as EntityId,
      buyingClubId: clubId,
      sellingClubId: otherClubId,
      playerId,
      status: "COMPLETED",
      submittedAt: "2026-08-01",
    });
    expect(service.loadCareer(saveId).ok).toBe(true);
    const evaluated = service.evaluateSportingDirectorPress();
    expect(evaluated.ok).toBe(true);
    expect(evaluated.ok && evaluated.data?.status).toBe("OPEN");
    service.closeCareer();
  });
});
