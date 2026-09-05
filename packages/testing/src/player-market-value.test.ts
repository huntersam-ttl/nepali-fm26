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

const command = () => ({
  saveName: "Player Market Value",
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
  savesDirectory = mkdtempSync(join(tmpdir(), "player-market-value-"));
  service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
  const created = service.createCareer(command());
  if (!created.ok) throw new Error(`career creation failed: ${created.error.message}`);
  saveId = created.data.save.id;
}, 240_000);

afterAll(() => {
  service.closeCareer();
  rmSync(savesDirectory, { recursive: true, force: true });
});

describe("player market value", () => {
  it("computes a sane SIMULATION_ONLY valuation and records one history snapshot per day", () => {
    const squad = service.getSquad();
    expect(squad.ok).toBe(true);
    if (!squad.ok) return;
    const target = squad.data.players[0]!;

    const first = service.getPlayerMarketValue(target.personId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.provenanceStatus).toBe("SIMULATION_ONLY");
    expect(first.data.currentValue).toBeGreaterThan(0);
    expect(first.data.valuationMin).toBeLessThanOrEqual(first.data.valuationMax);
    expect(first.data.askingMin).toBeLessThanOrEqual(first.data.askingMax);
    expect(first.data.history.length).toBeGreaterThanOrEqual(1);

    // Viewing again the same day must not create a second history row —
    // the whole point of the (player, day) uniqueness is no snapshot
    // explosion from repeated profile views.
    const second = service.getPlayerMarketValue(target.personId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.history.length).toBe(first.data.history.length);
    expect(second.data.currentValue).toBe(first.data.currentValue);
  });

  it("persists valuation history across reload", () => {
    const squad = service.getSquad();
    expect(squad.ok).toBe(true);
    if (!squad.ok) return;
    const target = squad.data.players[1]!;

    const before = service.getPlayerMarketValue(target.personId);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    service.closeCareer();
    const reloaded = service.loadCareer(saveId);
    expect(reloaded.ok).toBe(true);

    const after = service.getPlayerMarketValue(target.personId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.data.history.length).toBeGreaterThanOrEqual(before.data.history.length);
    expect(after.data.history[0]!.provenanceStatus).toBe("SIMULATION_ONLY");
  });

  it("never gates the squadStatus fallback into a raw UNKNOWN string", () => {
    const squad = service.getSquad();
    expect(squad.ok).toBe(true);
    if (!squad.ok) return;
    for (const player of squad.data.players) {
      expect(player.squadStatus).not.toBe("UNKNOWN");
    }
  });

  it("only shows full per-attribute detail for players the manager actually knows well", () => {
    const squad = service.getSquad();
    expect(squad.ok).toBe(true);
    if (!squad.ok) return;
    const own = squad.data.players[0]!;
    const profile = service.getPlayerProfile(own.personId);
    expect(profile.ok).toBe(true);
    if (!profile.ok) return;
    // Own-squad players are EXTENSIVE knowledge by construction, so the full
    // attribute breakdown should be present.
    expect(profile.data.ownSquad).toBe(true);
    expect(profile.data.attributeGroups.length).toBeGreaterThan(0);
  });
});
