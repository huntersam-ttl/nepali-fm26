import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");

let service: DesktopApplicationService;
let savesDirectory: string;
let saveId: EntityId;

const command = (saveName: string) => ({
  saveName,
  character: {
    fullName: "Maya Adhikari",
    preferredDisplayName: "Maya",
    dateOfBirth: "1993-05-12",
    startingAge: 33,
    languages: ["ne", "en"],
    footballBackground: "COMMUNITY_COACHING",
    education: "SPORTS_RELATED_DEGREE",
    playingExperience: "AMATEUR_PLAYER",
    coachingExperience: "YOUTH_COACH",
    businessBackground: "SMALL_BUSINESS",
    startingReputationProfile: "LOCAL_RESPECTED",
  },
});

beforeAll(() => {
  savesDirectory = mkdtempSync(join(tmpdir(), "nepal-tactical-history-"));
  service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
  const created = service.createCareer(command("Tactical History"));
  if (!created.ok) throw new Error(`career creation failed: ${created.error.message}`);
  saveId = created.data.save.id;
}, 240_000);

afterAll(() => {
  service.closeCareer();
  rmSync(savesDirectory, { recursive: true, force: true });
});

describe("tactical history snapshot", () => {
  it("a completed match's historical report keeps showing the formation/mentality it was actually played with, even after the club later changes tactic", () => {
    const before = service.getTactics();
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const squad = service.getSquad();
    expect(squad.ok).toBe(true);
    if (!squad.ok) return;
    const eleven = squad.data.players.slice(0, 11);

    const formationA = before.data.formations.find((f) => f.name === "4-4-2")!;
    const setA = service.updateTactics({
      formationId: formationA.id,
      name: "Tactic A",
      style: "LOW_BLOCK",
      assignments: formationA.slots.map((slot, index) => ({
        slotId: slot.id,
        playerId: eleven[index]!.personId,
        roleId: slot.position === "GK" ? "GOALKEEPER" : "CENTRAL_MIDFIELDER",
      })),
      bench: squad.data.players.slice(11, 18).map((player) => player.personId),
    });
    expect(setA.ok).toBe(true);
    if (!setA.ok) return;
    expect(setA.data.setup.formation.name).toBe("4-4-2");
    expect(setA.data.setup.instructions.mentality).toBeTruthy();

    service.continueCareer();
    const fixtures = service.getFixtures();
    expect(fixtures.ok).toBe(true);
    if (!fixtures.ok) return;
    const target = fixtures.data.upcoming[0]!;

    const played = service.quickSimMatch(target.id);
    expect(played.ok).toBe(true);
    if (!played.ok) return;

    // The club now switches to a materially different tactic (formation and
    // mentality) — this must never rewrite what the already-played match
    // report shows.
    const formationB = before.data.formations.find((f) => f.name === "3-5-2")!;
    const setB = service.updateTactics({
      formationId: formationB.id,
      name: "Tactic B",
      style: "GEGENPRESS",
      assignments: formationB.slots.map((slot, index) => ({
        slotId: slot.id,
        playerId: eleven[index]!.personId,
        roleId: slot.position === "GK" ? "GOALKEEPER" : "CENTRAL_MIDFIELDER",
      })),
      bench: squad.data.players.slice(11, 18).map((player) => player.personId),
    });
    expect(setB.ok).toBe(true);
    if (!setB.ok) return;
    expect(setB.data.setup.formation.name).toBe("3-5-2");

    const report = service.getPostMatchReport(target.id);
    expect(report.ok).toBe(true);
    if (!report.ok || !report.data) return;
    expect(report.data.startingTactics).not.toBe("UNAVAILABLE");
    if (report.data.startingTactics === "UNAVAILABLE") return;

    // The managed club appears as one of the two sides in the snapshot; it
    // must show the formation actually played (Tactic A's 4-4-2), never the
    // formation the club later switched to (Tactic B's 3-5-2).
    const sawTacticA =
      report.data.startingTactics.home.formationName === "4-4-2" ||
      report.data.startingTactics.away.formationName === "4-4-2";
    const sawTacticB =
      report.data.startingTactics.home.formationName === "3-5-2" ||
      report.data.startingTactics.away.formationName === "3-5-2";
    expect(sawTacticA).toBe(true);
    expect(sawTacticB).toBe(false);
  }, 180_000);
});
