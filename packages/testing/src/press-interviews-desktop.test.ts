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
    expect(opened.data.structuredQuestions!.length).toBeGreaterThan(0);
    const transferQuestion = opened.data.structuredQuestions!.find((q) => q.topic === "TRANSFER_REQUEST");
    expect(transferQuestion).toBeTruthy();
    expect(transferQuestion!.subjectEntities).toContainEqual({ id: player!.personId, type: "person" });

    // Re-requesting while one is open returns the SAME interview, not a new one.
    const reopened = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.data.id).toBe(opened.data.id);

    // Answering an interview id that doesn't belong to this manager is rejected.
    const bogus = service.answerStructuredPressQuestion({
      interviewId: "not-a-real-interview" as EntityId,
      stance: "COMMIT",
    });
    expect(bogus.ok).toBe(false);

    // Answer the real current question and confirm the persisted advance.
    const currentTopic =
      opened.data.structuredQuestions![opened.data.currentQuestionIndex ?? 0]!.topic;
    const stance = currentTopic === "TRANSFER_REQUEST" ? "COMMIT" : opened.data.structuredQuestions![0]!.options[0]!.stance;
    const answered = service.answerStructuredPressQuestion({ interviewId: opened.data.id, stance });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(answered.data.structuredAnswers!.length).toBe(1);

    service.closeCareer();
  });
});
