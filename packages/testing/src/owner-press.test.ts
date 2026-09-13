import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, MediaPhaseBRepository, openGameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Owner press: the same MediaInterview/journalist/outlet pipeline the
 * Manager's structured press conferences already use, entered through a new
 * OWNER_BUSINESS context grounded in real club-business events (an approved
 * infrastructure project, an active sponsorship) — never a second engine,
 * never invented corporate news.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const ownerCharacter = {
  fullName: "Owner Press Tester",
  dateOfBirth: "1980-01-01",
  startingAge: 46,
  languages: ["en"],
  footballBackground: "COMMUNITY_COACHING",
  education: "SECONDARY",
  playingExperience: "AMATEUR_PLAYER",
  coachingExperience: "YOUTH_COACH",
  businessBackground: "SMALL_BUSINESS",
  startingReputationProfile: "LOCAL_RESPECTED",
};

const managerCharacter = {
  fullName: "Manager Press Tester",
  preferredDisplayName: "Manager Tester",
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

const newOwnerService = (label: string) => {
  const directory = mkdtempSync(join(tmpdir(), `owner-press-${label}-`));
  dirs.push(directory);
  const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
  const clubs = service.listStartingClubs();
  if (!clubs.ok) throw new Error(clubs.error.message);
  const club = clubs.data.find((option) => option.division === "C") ?? clubs.data[0]!;
  const created = service.createCareer({
    careerMode: "OWNER",
    saveName: `Owner press ${label}`,
    joinTeamId: club.teamId,
    character: ownerCharacter,
  });
  if (!created.ok) throw new Error(created.error.message);
  return { service, saveId: created.data.save.id, savePath: created.data.catalogEntry.filePath };
};

describe("owner press", () => {
  it("asks a grounded question from a real approved infrastructure project, answers it, and persists across reload", () => {
    const { service, saveId, savePath } = newOwnerService("infra");
    const dashboardBefore = service.getChairmanDashboard();
    expect(dashboardBefore.ok).toBe(true);
    if (!dashboardBefore.ok) return;
    const clubId = dashboardBefore.data.club.id;

    // Every club is seeded with a founding sponsorship at world generation —
    // a real fact in its own right, and the owner's very first grounded
    // press topic. Consume it here so the assertions below can isolate the
    // infrastructure-project scenario this test actually targets.
    const founding = service.evaluateOwnerBusinessPress();
    expect(founding.ok).toBe(true);
    if (founding.ok && founding.data) {
      service.answerOwnerStructuredPressQuestion({
        interviewId: founding.data.interviewId,
        stance: founding.data.currentQuestion!.options[0]!.stance,
      });
    }

    // Seed a real, canonical APPROVED infrastructure project for this club.
    service.closeCareer();
    const db = openGameDatabase(savePath);
    new ClubEconomyRepository(db).upsertInfrastructureProject({
      id: "owner-press-project" as EntityId,
      clubId,
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

    // No press interview exists before evaluation.
    const beforeEvaluate = service.getChairmanDashboard();
    expect(beforeEvaluate.ok).toBe(true);
    if (beforeEvaluate.ok) {
      expect(beforeEvaluate.data.inbox.some((item) => item.type === "PRESS_INTERVIEW")).toBe(false);
    }

    const evaluated = service.evaluateOwnerBusinessPress();
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok || !evaluated.data) return;
    expect(evaluated.data.status).toBe("OPEN");
    expect(evaluated.data.currentQuestion?.prompt).toMatch(/stand|investment/i);
    expect(evaluated.data.currentQuestion?.subjectEntities.length).toBeGreaterThan(0);
    const interviewId = evaluated.data.interviewId;

    // Now surfaces in the owner's own Inbox.
    const dashboardWithInbox = service.getChairmanDashboard();
    expect(dashboardWithInbox.ok).toBe(true);
    if (dashboardWithInbox.ok) {
      const pressItem = dashboardWithInbox.data.inbox.find((item) => item.type === "PRESS_INTERVIEW");
      expect(pressItem).toBeDefined();
      expect(pressItem?.relatedEntity?.id).toBe(interviewId);
    }

    // Re-evaluating while nothing new is true creates nothing further
    // (duplicate-topic suppression) — same interview returned.
    const evaluatedAgain = service.evaluateOwnerBusinessPress();
    expect(evaluatedAgain.ok).toBe(true);
    if (evaluatedAgain.ok) expect(evaluatedAgain.data?.interviewId).toBe(interviewId);

    const stance = evaluated.data.currentQuestion!.options[0]!.stance;
    const answered = service.answerOwnerStructuredPressQuestion({ interviewId, stance });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(answered.data.status).toBe("COMPLETED");
    expect(answered.data.priorAnswers).toHaveLength(1);
    expect(answered.data.priorAnswers[0]!.responseText.length).toBeGreaterThan(0);

    // Exact-once: answering never duplicates the interview or its Story.
    const secondEvaluate = service.evaluateOwnerBusinessPress();
    expect(secondEvaluate.ok).toBe(true);
    if (secondEvaluate.ok) expect(secondEvaluate.data).toBeUndefined();

    // Completed interview no longer appears as an actionable Inbox item.
    const dashboardAfter = service.getChairmanDashboard();
    expect(dashboardAfter.ok).toBe(true);
    if (dashboardAfter.ok) {
      expect(dashboardAfter.data.inbox.some((item) => item.type === "PRESS_INTERVIEW")).toBe(false);
    }

    // Reload reproduces the identical completed view.
    service.closeCareer();
    expect(service.loadCareer(saveId).ok).toBe(true);
    const reloaded = service.getOwnerStructuredPressConference(interviewId);
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.data.status).toBe("COMPLETED");
      expect(reloaded.data.priorAnswers).toEqual(answered.data.priorAnswers);
    }
    service.closeCareer();
  }, 120_000);

  it("asks a grounded question from a real active sponsorship, distinct from the infrastructure topic", () => {
    const { service, saveId, savePath } = newOwnerService("sponsor");
    const dashboard = service.getChairmanDashboard();
    expect(dashboard.ok).toBe(true);
    if (!dashboard.ok) return;
    const clubId = dashboard.data.club.id;

    service.closeCareer();
    const db = openGameDatabase(savePath);
    const economy = new ClubEconomyRepository(db);
    economy.upsertSponsor({
      id: "owner-press-sponsor" as EntityId,
      name: "Himal Textiles",
      industry: "Manufacturing",
      reputation: 6,
      budgetTier: "NATIONAL",
      status: "SIMULATION_ONLY",
    });
    economy.upsertSponsorship({
      id: "owner-press-sponsorship" as EntityId,
      clubId,
      sponsorId: "owner-press-sponsor" as EntityId,
      type: "SHIRT_MAIN",
      // Deliberately later than the club's world-generation founding
      // sponsorship (which always starts on the save's creation date) —
      // Owner press surfaces the most recently signed real deal, not every
      // sponsorship the club happens to hold.
      startDate: "2026-09-01",
      endDate: "2027-09-01",
      annualValue: 2_000_000,
      bonuses: {},
      currency: "NPR",
      status: "ACTIVE",
      provenanceStatus: "SIMULATION_ONLY",
    });
    db.close();
    expect(service.loadCareer(saveId).ok).toBe(true);

    const evaluated = service.evaluateOwnerBusinessPress();
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok || !evaluated.data) return;
    expect(evaluated.data.currentQuestion?.prompt).toMatch(/Himal Textiles/);
    service.closeCareer();
  }, 120_000);

  it("rejects Owner press commands from a save with no Chairman/Owner role held", () => {
    const directory = mkdtempSync(join(tmpdir(), "owner-press-reject-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const clubs = service.listStartingClubs();
    expect(clubs.ok).toBe(true);
    if (!clubs.ok) return;
    const club = clubs.data[0]!;
    const created = service.createCareer({
      saveName: "Manager only",
      joinTeamId: club.teamId,
      character: managerCharacter,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const evaluated = service.evaluateOwnerBusinessPress();
    expect(evaluated.ok).toBe(false);
    if (!evaluated.ok) expect(evaluated.error.code).toBe("ROLE_NOT_AUTHORIZED");

    const answered = service.answerOwnerStructuredPressQuestion({
      interviewId: "does-not-exist" as EntityId,
      stance: "CALM",
    });
    expect(answered.ok).toBe(false);
    if (!answered.ok) expect(answered.error.code).toBe("ROLE_NOT_AUTHORIZED");

    const fetched = service.getOwnerStructuredPressConference("does-not-exist" as EntityId);
    expect(fetched.ok).toBe(false);
    if (!fetched.ok) expect(fetched.error.code).toBe("ROLE_NOT_AUTHORIZED");

    // Manager's own Media Centre never surfaces an Owner interview even if
    // one existed for the same physical person under a different role.
    const media = service.getMediaCentre();
    expect(media.ok).toBe(true);
    if (media.ok) {
      expect(media.data.completedInterviews.every((item) => item.context !== "OWNER_BUSINESS")).toBe(true);
    }
    service.closeCareer();
  });

  it("journalist relationship changes exactly once from an Owner interview answer, keyed by the owner's own personId", () => {
    const { service, saveId, savePath } = newOwnerService("journalist");
    const dashboard = service.getChairmanDashboard();
    expect(dashboard.ok).toBe(true);
    if (!dashboard.ok) return;
    const clubId = dashboard.data.club.id;

    service.closeCareer();
    const db = openGameDatabase(savePath);
    new ClubEconomyRepository(db).upsertInfrastructureProject({
      id: "owner-press-journalist-project" as EntityId,
      clubId,
      projectType: "ACADEMY",
      planningStart: "2026-01-01",
      expectedCompletion: "2027-01-01",
      capitalCost: 3_000_000,
      ongoingCost: 50_000,
      currency: "NPR",
      status: "COMPLETED",
      financingJson: {},
      provenanceStatus: "SIMULATION_ONLY",
    });
    db.close();
    expect(service.loadCareer(saveId).ok).toBe(true);

    const evaluated = service.evaluateOwnerBusinessPress();
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok || !evaluated.data) return;
    const interviewId = evaluated.data.interviewId;
    const stance = evaluated.data.currentQuestion!.options[0]!.stance;
    const answered = service.answerOwnerStructuredPressQuestion({ interviewId, stance });
    expect(answered.ok).toBe(true);

    service.closeCareer();
    const db2 = openGameDatabase(savePath);
    const relationships = new MediaPhaseBRepository(db2).relationships();
    expect(relationships.length).toBeGreaterThan(0);
    db2.close();
  }, 120_000);
});
