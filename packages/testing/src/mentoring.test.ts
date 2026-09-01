import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase, PeopleFoundationRepository } from "@nepal-football-sim/database";
import {
  advanceMentoring,
  computeSquadHierarchy,
  createMentoringAssignment,
  createNepalSave,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve("data/nepal/2026-08/club-registry.json");

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("mentoring foundation", () => {
  it("creates an eligible same-squad assignment and advances canonical relationship state", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-mentoring-"));
    dirs.push(dir);
    const path = join(dir, "mentoring.sqlite");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")),
      saveName: "Mentoring",
      gameVersion: "0.3.0",
      randomSeed: "mentoring",
      globalSeedPath: null,
    });
    const db = openGameDatabase(path);
    try {
      const team = (
        db
          .prepare("SELECT id FROM teams WHERE level='senior' AND gender='men' ORDER BY id LIMIT 1")
          .get() as { id: EntityId }
      ).id;
      const hierarchy = computeSquadHierarchy(db, team, "2026-08-01");
      const mentor = hierarchy.find(
        (entry) =>
          entry.role === "CAPTAIN" ||
          entry.role === "VICE_CAPTAIN" ||
          entry.role === "SENIOR_PLAYER",
      );
      const mentee =
        hierarchy.find(
          (entry) => entry.personId !== mentor?.personId && entry.role === "FRINGE_PLAYER",
        ) ?? hierarchy.find((entry) => entry.personId !== mentor?.personId);
      if (!mentor || !mentee) throw new Error("Test squad lacks an eligible pair");
      const created = createMentoringAssignment({
        db,
        teamId: team,
        mentorPersonId: mentor.personId,
        menteePersonId: mentee.personId,
        focus: "LEADERSHIP",
        startDate: "2026-08-01",
      });
      expect(created.created).toBe(true);
      const progressed = advanceMentoring({
        db,
        teamId: team,
        date: "2026-09-01",
        seed: "mentoring",
      });
      expect(progressed[0]?.progress).toBeGreaterThan(0);
      expect(
        new PeopleFoundationRepository(db).relationship(
          mentor.personId,
          mentee.personId,
          "TEAMMATE",
        )?.trust,
      ).toBeGreaterThan(50);
      expect(new PeopleFoundationRepository(db).activeMentoringForTeam(team)).toHaveLength(
        progressed[0]?.status === "ACTIVE" ? 1 : 0,
      );
    } finally {
      db.close();
    }
  });
});
