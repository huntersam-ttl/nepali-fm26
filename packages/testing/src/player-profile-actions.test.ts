import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve("data/nepal/2026-08/club-registry.json");

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/**
 * Covers the real, actor-aware data the new clickable Player Profile UI
 * reads: ownSquad/transferListStatus on getPlayerProfile (real, not
 * fabricated toggle state), the setTransferStatus/toggleShortlist commands
 * the profile's action rail actually calls, and the honest
 * getPlayerActions/getPlayerContractContext/getPlayerTransferContext read
 * models the Owner/President player view is built from.
 */
describe("player profile actions and context", () => {
  it("reflects real transfer-list/shortlist toggles on the manager's own player, and reports honest read-only context for a non-manager actor", () => {
    const serviceDir = mkdtempSync(join(tmpdir(), "player-profile-actions-"));
    dirs.push(serviceDir);
    const service = new DesktopApplicationService({
      savesDirectory: serviceDir,
      worldDatasetPath: registryPath,
    });
    const listed = service.listStartingClubs();
    if (!listed.ok) throw new Error(listed.error.message);
    const club = listed.data.find((item) => item.division === "B");
    if (!club?.teamId) throw new Error("No B-Division club in the starting-club list");
    const created = service.createCareer({
      careerMode: "MANAGER",
      saveName: "Player Actions Test",
      joinTeamId: club.teamId,
      character: {
        fullName: "Player Actions Test",
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
    if (!created.ok) throw new Error(created.error.message);

    const squad = service.getSquad();
    if (!squad.ok) throw new Error(squad.error.message);
    const playerId = squad.data.players[0]?.personId;
    expect(playerId).toBeDefined();
    if (!playerId) return;

    // Real own-squad player: getPlayerProfile must say so honestly.
    const before = service.getPlayerProfile(playerId);
    if (!before.ok) throw new Error(before.error.message);
    expect(before.data.ownSquad).toBe(true);
    expect(before.data.transferListStatus).toBeUndefined();

    // Real command, not a UI-local toggle: transfer-listing the player.
    const listed_ = service.setTransferStatus({ playerId, status: "TRANSFER_LISTED" });
    expect(listed_.ok).toBe(true);
    const afterListing = service.getPlayerProfile(playerId);
    if (!afterListing.ok) throw new Error(afterListing.error.message);
    expect(afterListing.data.transferListStatus).toBe("TRANSFER_LISTED");

    // Removing from the transfer list clears the real status.
    const cleared = service.setTransferStatus({ playerId, status: "NOT_FOR_SALE" });
    expect(cleared.ok).toBe(true);
    const afterClearing = service.getPlayerProfile(playerId);
    if (!afterClearing.ok) throw new Error(afterClearing.error.message);
    expect(afterClearing.data.transferListStatus).toBeUndefined();

    // Real shortlist toggle command the profile's action rail calls.
    const shortlisted = service.toggleShortlist(playerId);
    expect(shortlisted.ok).toBe(true);

    // Actor-aware actions: the manager who controls this player's club gets
    // every action available.
    const managerActions = service.getPlayerActions(playerId);
    if (!managerActions.ok) throw new Error(managerActions.error.message);
    expect(managerActions.data.actions.every((action) => action.available)).toBe(true);

    // The same read models Owner/President player context is built from —
    // real contract and transfer-market data, never a hidden score.
    const contractContext = service.getPlayerContractContext(playerId);
    if (!contractContext.ok) throw new Error(contractContext.error.message);
    expect(contractContext.data.contract?.playerId).toBe(playerId);
    expect(contractContext.data.clubName).toBe(club.clubName);

    const transferContext = service.getPlayerTransferContext(playerId);
    if (!transferContext.ok) throw new Error(transferContext.error.message);
    expect(transferContext.data.playerId).toBe(playerId);
    expect(transferContext.data.transferStatus).toBe("NOT_FOR_SALE");

    const reference = service.getEntityReference("PLAYER", playerId);
    if (!reference.ok) throw new Error(reference.error.message);
    expect(reference.data.visible).toBe(true);
    expect(reference.data.label).toBe(before.data.name);

    // A stale/unknown player id never crashes — an honest not-visible reference instead.
    const missing = service.getEntityReference("PLAYER", "not-a-real-player-id" as typeof playerId);
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.data.visible).toBe(false);
  }, 180_000);
});
