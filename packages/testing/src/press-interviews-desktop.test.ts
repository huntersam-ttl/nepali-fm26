import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase, migrateDatabase, SquadDynamicsRepository } from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("structured press conference — desktop command layer", () => {
  it("is only reachable through the manager desktop command, grounds a real transfer question, and persists the answer", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "press-desktop-"));
    tempDirs.push(savesDirectory);
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const created = service.createCareer({
      saveName: "Press Desktop",
      character: {
        fullName: "Rita Gurung",
        preferredDisplayName: "Rita",
        dateOfBirth: "1990-01-01",
        startingAge: 36,
        languages: ["ne", "en"],
        footballBackground: "COMMUNITY_COACHING",
        education: "SPORTS_RELATED_DEGREE",
        playingExperience: "AMATEUR_PLAYER",
        coachingExperience: "YOUTH_COACH",
        businessBackground: "SMALL_BUSINESS",
        startingReputationProfile: "LOCAL_RESPECTED",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const savePath = created.data.catalogEntry.filePath;
    const worldDate = created.data.save.worldDate;
    service.closeCareer();

    // Ground a real transfer question: give one of the manager's own players
    // an active TRANSFER_INTEREST concern, directly through the canonical
    // squad-dynamics table, exactly as an in-world transfer bid would.
    const db = openGameDatabase(savePath);
    migrateDatabase(db);
    const personId = (
      db.prepare("SELECT person_id FROM career_characters WHERE id = ?").get(created.data.save.playerCharacterId!) as {
        person_id: EntityId;
      }
    ).person_id;
    const managerClub = db
      .prepare("SELECT team_id, club_id FROM manager_contracts WHERE person_id = ? AND status = 'ACTIVE'")
      .get(personId) as { team_id: EntityId; club_id: EntityId };
    const player = db
      .prepare(
        `SELECT player_id AS personId FROM player_contracts
         WHERE club_id = ? AND status = 'ACTIVE' AND start_date <= ? AND end_date >= ? LIMIT 1`,
      )
      .get(managerClub.club_id, worldDate, worldDate) as { personId: EntityId } | undefined;
    expect(player).toBeTruthy();
    new SquadDynamicsRepository(db).upsertConcern({
      id: "press-desktop-concern" as EntityId,
      personId: player!.personId,
      teamId: managerClub.team_id,
      type: "TRANSFER_INTEREST",
      status: "ACTIVE",
      severity: 5,
      raisedOn: worldDate,
      updatedOn: worldDate,
    });
    db.close();

    expect(service.loadCareer(created.data.save.id).ok).toBe(true);

    const opened = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.data.status).toBe("OPEN");
    expect(opened.data.totalQuestions).toBeGreaterThan(0);
    expect(opened.data.journalist.visible).toBe(true);
    expect(opened.data.journalist.entityType).toBe("JOURNALIST");
    expect(opened.data.outlet.visible).toBe(true);
    expect(opened.data.outlet.entityType).toBe("MEDIA_OUTLET");
    const question = opened.data.currentQuestion;
    expect(question).toBeTruthy();
    // The subject player is already a real, resolved, clickable reference —
    // never a raw EntityRef — and the response options carry only real text.
    expect(question!.subjectEntities.some((ref) => ref.id === player!.personId && ref.visible)).toBe(true);
    expect(question!.options.every((option) => option.text.length > 0)).toBe(true);

    // Re-requesting while one is open returns the SAME interview, not a new one.
    const reopened = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.data.interviewId).toBe(opened.data.interviewId);

    // Answering an interview id that doesn't belong to this manager is rejected.
    const bogus = service.answerStructuredPressQuestion({
      interviewId: "not-a-real-interview" as EntityId,
      stance: "COMMIT",
    });
    expect(bogus.ok).toBe(false);

    // Answer the real current question and confirm the persisted advance.
    const stance = question!.options.find((option) => option.stance === "COMMIT")?.stance ?? question!.options[0]!.stance;
    const answered = service.answerStructuredPressQuestion({ interviewId: opened.data.interviewId, stance });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(answered.data.priorAnswers.length).toBe(1);
    expect(answered.data.priorAnswers[0]!.responseText.length).toBeGreaterThan(0);

    // Re-fetching the view (as a reload/resume would) reproduces it identically.
    const refetched = service.getStructuredPressConference(opened.data.interviewId);
    expect(refetched.ok).toBe(true);
    if (refetched.ok) expect(refetched.data).toEqual(answered.data);

    service.closeCareer();
  });

  it("rejects a Manager-owned press command from any other held role, and the pending item reappears when switching back to Manager", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "press-desktop-guard-"));
    tempDirs.push(savesDirectory);
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const created = service.createCareer({
      saveName: "Press Guard",
      character: {
        fullName: "Sita Thapa",
        preferredDisplayName: "Sita",
        dateOfBirth: "1988-03-01",
        startingAge: 38,
        languages: ["ne", "en"],
        footballBackground: "COMMUNITY_COACHING",
        education: "SPORTS_RELATED_DEGREE",
        playingExperience: "AMATEUR_PLAYER",
        coachingExperience: "YOUTH_COACH",
        businessBackground: "SMALL_BUSINESS",
        startingReputationProfile: "LOCAL_RESPECTED",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const worldDate = created.data.save.worldDate;
    service.closeCareer();

    // Grant this same person a second held role (Owner) and a real transfer
    // concern to ground a Manager press interview, exactly as
    // career-role-switching.test.ts does.
    const db = openGameDatabase(created.data.catalogEntry.filePath);
    migrateDatabase(db);
    const personId = (
      db.prepare("SELECT person_id FROM career_characters WHERE id = ?").get(created.data.save.playerCharacterId!) as {
        person_id: EntityId;
      }
    ).person_id;
    const managerClub = db
      .prepare("SELECT team_id, club_id FROM manager_contracts WHERE person_id = ? AND status = 'ACTIVE'")
      .get(personId) as { team_id: EntityId; club_id: EntityId };
    db.prepare(`INSERT INTO club_ownership_stakes
      (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,end_date,status,ownership_model,provenance_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "press-guard-owner" as EntityId, managerClub.club_id, "PERSON", personId, "Sita Thapa",
      "MAJORITY_OWNER", 75, 75, worldDate, null, "ACTIVE", "PARTIALLY_BUYABLE", "SIMULATION_ONLY",
    );
    const player = db
      .prepare(
        `SELECT player_id AS personId FROM player_contracts
         WHERE club_id = ? AND status = 'ACTIVE' AND start_date <= ? AND end_date >= ? LIMIT 1`,
      )
      .get(managerClub.club_id, worldDate, worldDate) as { personId: EntityId };
    new SquadDynamicsRepository(db).upsertConcern({
      id: "press-guard-concern" as EntityId,
      personId: player.personId,
      teamId: managerClub.team_id,
      type: "TRANSFER_INTEREST",
      status: "ACTIVE",
      severity: 5,
      raisedOn: worldDate,
      updatedOn: worldDate,
    });
    db.close();

    expect(service.loadCareer(created.data.save.id).ok).toBe(true);

    // As Manager: open a real, pending press interview.
    const opened = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const beforeSwitch = service.getManagerDashboard();
    expect(beforeSwitch.ok).toBe(true);
    if (beforeSwitch.ok) {
      expect(beforeSwitch.data.inbox.some((item) => item.type === "PRESS_INTERVIEW")).toBe(true);
    }

    // Switch to the Owner role — the exact same Manager-owned interview must
    // now be completely unreachable through the command layer, not merely
    // hidden by client-side routing.
    expect(service.switchActiveCareerRole("CHAIRMAN_OWNER")).toMatchObject({ ok: true, data: { activeRole: "CHAIRMAN_OWNER" } });

    const rejectedAnswer = service.answerStructuredPressQuestion({
      interviewId: opened.data.interviewId,
      stance: opened.data.currentQuestion!.options[0]!.stance,
    });
    expect(rejectedAnswer).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });

    const rejectedRequest = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(rejectedRequest).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });

    const rejectedGet = service.getStructuredPressConference(opened.data.interviewId);
    expect(rejectedGet).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });

    // Note: getManagerDashboard() itself is a read-only query gated by
    // tryManagerContext (soft — it falls back rather than rejecting), not by
    // managerCommand's strict active-role check the way every *mutating* or
    // interview-scoped press command above is. So this call alone does not
    // reject while active role is Owner — that's pre-existing, press-
    // unrelated dashboard-access behavior. What actually matters for press
    // authority is already proven above: no press command that reads or
    // answers a *specific* Manager-owned interview is reachable as Owner,
    // and the real Owner-facing UI never calls this Manager-only bridge
    // method in the first place.

    // Switching back to Manager: the exact same pending interview is
    // reachable again, unchanged and unanswered.
    expect(service.switchActiveCareerRole("MANAGER")).toMatchObject({ ok: true, data: { activeRole: "MANAGER" } });
    const afterSwitchBack = service.getManagerDashboard();
    expect(afterSwitchBack.ok).toBe(true);
    if (afterSwitchBack.ok) {
      const item = afterSwitchBack.data.inbox.find((entry) => entry.type === "PRESS_INTERVIEW");
      expect(item).toBeTruthy();
      expect(item!.relatedEntity).toEqual({ id: opened.data.interviewId, type: "mediaInterview" });
    }
    const resumed = service.getStructuredPressConference(opened.data.interviewId);
    expect(resumed).toMatchObject({ ok: true, data: { status: "OPEN", priorAnswers: [] } });

    service.closeCareer();
  });
});
