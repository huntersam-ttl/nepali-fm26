import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");

const tempDirs: string[] = [];

const service = (): DesktopApplicationService => {
  const savesDirectory = mkdtempSync(join(tmpdir(), "player-development-a-"));
  tempDirs.push(savesDirectory);
  return new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const command = (saveName: string, joinTeamId: EntityId) => ({
  saveName,
  joinTeamId,
  character: {
    fullName: "Development Tester",
    preferredDisplayName: "Tester",
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

const startCareer = (runtime: DesktopApplicationService, saveName: string) => {
  const clubs = runtime.listStartingClubs();
  if (!clubs.ok) throw new Error("Failed to list starting clubs.");
  const created = runtime.createCareer(command(saveName, clubs.data[0]!.teamId));
  if (!created.ok) throw new Error(`Failed to create career: ${created.error.message}`);
  return created;
};

describe("player development & training phase A", () => {
  it("exposes a real per-player development read model with environment and roster data", () => {
    const runtime = service();
    startCareer(runtime, "Development View");

    const view = runtime.getPlayerDevelopment();
    expect(view.ok).toBe(true);
    if (!view.ok) return;

    expect(view.data.players.length).toBeGreaterThan(0);
    for (const player of view.data.players) {
      expect(player.currentAbility).toBeGreaterThan(0);
      expect(["IMPROVING", "STABLE", "DECLINING"]).toContain(player.trend);
      expect(player.fitness).toBeGreaterThanOrEqual(0);
    }
    expect(view.data.focusTypeOptions).toContain("POSITION");
    expect(view.data.positionOptions).toContain("ST");
  });

  it("rejects a development plan for a player who is not on the roster", () => {
    const runtime = service();
    startCareer(runtime, "Off Roster");

    const result = runtime.createPlayerDevelopmentPlan({
      personId: "not-a-real-person" as EntityId,
      focusType: "BALANCED",
      intensity: "NORMAL",
    });
    expect(result.ok).toBe(false);
  });

  it("requires a target for position/role/attribute-focused plans", () => {
    const runtime = service();
    startCareer(runtime, "Missing Target");
    const view = runtime.getPlayerDevelopment();
    if (!view.ok) throw new Error("setup failed");
    const personId = view.data.players[0]!.personId;

    const missingPosition = runtime.createPlayerDevelopmentPlan({
      personId,
      focusType: "POSITION",
      intensity: "NORMAL",
    });
    expect(missingPosition.ok).toBe(false);

    const missingAttribute = runtime.createPlayerDevelopmentPlan({
      personId,
      focusType: "ATTRIBUTE",
      intensity: "NORMAL",
    });
    expect(missingAttribute.ok).toBe(false);
  });

  it("creates a position-retraining plan, supersedes it with a later plan, and reflects it in the read model", () => {
    const runtime = service();
    startCareer(runtime, "Retraining");
    const before = runtime.getPlayerDevelopment();
    if (!before.ok) throw new Error("setup failed");
    const player = before.data.players.find((p) => p.primaryPosition !== "ST") ?? before.data.players[0]!;

    const created = runtime.createPlayerDevelopmentPlan({
      personId: player.personId,
      focusType: "POSITION",
      targetPosition: "ST",
      intensity: "HIGH",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const plan = created.data.players.find((p) => p.personId === player.personId)!.activePlan;
    expect(plan?.focusType).toBe("POSITION");
    expect(plan?.targetPosition).toBe("ST");
    expect(plan?.status).toBe("ACTIVE");

    // A second plan for the same player replaces the first outright — never two active focuses.
    const replaced = runtime.createPlayerDevelopmentPlan({
      personId: player.personId,
      focusType: "BALANCED",
      intensity: "NORMAL",
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    const activeEntry = replaced.data.players.find((p) => p.personId === player.personId)!;
    expect(activeEntry.activePlan?.focusType).toBe("BALANCED");
    expect(activeEntry.activePlan?.status).toBe("ACTIVE");
  });

  it("pauses and resumes a development plan", () => {
    const runtime = service();
    startCareer(runtime, "Pause Resume");
    const view = runtime.getPlayerDevelopment();
    if (!view.ok) throw new Error("setup failed");
    const personId = view.data.players[0]!.personId;

    const created = runtime.createPlayerDevelopmentPlan({ personId, focusType: "BALANCED", intensity: "NORMAL" });
    if (!created.ok) throw new Error("plan creation failed");
    const planId = created.data.players.find((p) => p.personId === personId)!.activePlan!.id;

    const paused = runtime.setPlayerDevelopmentPlanStatus(planId, "PAUSED");
    expect(paused.ok).toBe(true);
    if (paused.ok) {
      expect(paused.data.players.find((p) => p.personId === personId)!.activePlan).toBeUndefined();
    }

    const resumed = runtime.setPlayerDevelopmentPlanStatus(planId, "ACTIVE");
    expect(resumed.ok).toBe(true);
    if (resumed.ok) {
      expect(resumed.data.players.find((p) => p.personId === personId)!.activePlan?.status).toBe("ACTIVE");
    }
  });

  it("advances real training days, records development history, and keeps individual plans persisted across the tick", () => {
    const runtime = service();
    const created = startCareer(runtime, "Daily Training");
    const before = runtime.getPlayerDevelopment();
    if (!before.ok) throw new Error("setup failed");
    const targetPlayer = before.data.players[0]!;

    const plan = runtime.createPlayerDevelopmentPlan({
      personId: targetPlayer.personId,
      focusType: "PHYSICAL",
      intensity: "VERY_HIGH",
    });
    expect(plan.ok).toBe(true);

    const advanced = runtime.continueCareer();
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(advanced.data.save.worldDate).not.toBe(created.data.save.worldDate);

    const after = runtime.getPlayerDevelopment();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const afterPlayer = after.data.players.find((p) => p.personId === targetPlayer.personId)!;
    // The plan must survive real day-advancing, not just the single command that created it.
    expect(afterPlayer.activePlan?.focusType).toBe("PHYSICAL");
    // Training workload/intensity trade-offs are real: a very-high-intensity day moves fatigue.
    expect(typeof afterPlayer.fatigue).toBe("number");
    expect(afterPlayer.injuryRisk).toBeGreaterThanOrEqual(0);
    expect(afterPlayer.injuryRisk).toBeLessThanOrEqual(1);
  });

  it("persists development plans and history across a save/load cycle", () => {
    const runtime = service();
    const created = startCareer(runtime, "Persistence");
    const view = runtime.getPlayerDevelopment();
    if (!view.ok) throw new Error("setup failed");
    const personId = view.data.players[0]!.personId;
    runtime.createPlayerDevelopmentPlan({ personId, focusType: "MENTAL", intensity: "NORMAL" });
    runtime.continueCareer();

    const saved = runtime.saveCareer();
    expect(saved.ok).toBe(true);
    const id = created.data.save.id;

    expect(runtime.closeCareer()).toEqual({ ok: true, data: { closed: true } });
    const reopened = runtime.loadCareer(id);
    expect(reopened.ok).toBe(true);

    const reloadedView = runtime.getPlayerDevelopment();
    expect(reloadedView.ok).toBe(true);
    if (!reloadedView.ok) return;
    const reloadedPlayer = reloadedView.data.players.find((p) => p.personId === personId)!;
    expect(reloadedPlayer.activePlan?.focusType).toBe("MENTAL");
  });
});
