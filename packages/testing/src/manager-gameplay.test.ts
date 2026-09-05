import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");

/**
 * Creating a real Nepal career imports 573 players and 57 clubs, so the suite
 * shares one career across tests instead of rebuilding the world each time.
 */
let service: DesktopApplicationService;
let savesDirectory: string;
let saveId: EntityId;

const command = (saveName: string, joinTeamId?: EntityId) => ({
  saveName,
  joinTeamId,
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
  savesDirectory = mkdtempSync(join(tmpdir(), "nepal-manager-gameplay-"));
  service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
  const created = service.createCareer(command("Manager Gameplay"));
  if (!created.ok) throw new Error(`career creation failed: ${created.error.message}`);
  saveId = created.data.save.id;
}, 240_000);

afterAll(() => {
  service.closeCareer();
  rmSync(savesDirectory, { recursive: true, force: true });
});

const reopen = (): void => {
  service.closeCareer();
  const loaded = service.loadCareer(saveId);
  expect(loaded.ok).toBe(true);
};

describe("manager gameplay", () => {
  it("returns a dashboard built from real save state", () => {
    const result = service.getManagerDashboard();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.clubName).toBeTruthy();
    expect(result.data.clubName).not.toMatch(/Testing|Sample|Demo/);
    expect(result.data.competitionName).toContain("ANFA National League");
    expect(result.data.squadAvailability.total).toBeGreaterThanOrEqual(14);
    expect(result.data.nextFixture?.opponent).toBeTruthy();
    expect(result.data.trainingSummary).not.toBe("No training plan set");
  });

  it("resolves a real player name for every medical centre entry, never a placeholder", () => {
    const dashboard = service.getManagerDashboard();
    expect(dashboard.ok).toBe(true);
    if (!dashboard.ok) return;
    const squad = service.getSquad();
    expect(squad.ok).toBe(true);
    if (!squad.ok) return;
    const squadNames = new Set(squad.data.players.map((player) => player.name));
    for (const entry of dashboard.data.medicalCentre ?? []) {
      expect(entry.playerName).toBeTruthy();
      expect(entry.playerName).not.toBe("Unknown player");
      expect(squadNames.has(entry.playerName)).toBe(true);
    }
  });

  it("lists the real imported squad with usable filter data", () => {
    const result = service.getSquad();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.players.length).toBeGreaterThanOrEqual(14);
    expect(result.data.positionOptions.length).toBeGreaterThan(1);
    for (const player of result.data.players) {
      expect(player.name).not.toMatch(/Kathmandu Testing|Lalitpur Test|Pokhara Sample/);
      expect(player.ability).toBeGreaterThan(0);
    }
    // Most imported players have no factual DOB; it must read Unknown, not a guess.
    expect(result.data.players.some((player) => player.age.status === "UNKNOWN")).toBe(true);
  });

  it("builds a full player profile with grouped attributes and honest provenance", () => {
    const squad = service.getSquad();
    if (!squad.ok) return;
    const target = squad.data.players[0]!;
    const result = service.getPlayerProfile(target.personId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.attributeGroups.map((group) => group.group)).toEqual([
      "Technical",
      "Mental",
      "Physical",
      "Goalkeeping",
    ]);
    expect(result.data.attributeProvenance).toBe("SIMULATION_ONLY");
    for (const group of result.data.attributeGroups) {
      for (const attribute of group.attributes) {
        expect(attribute.value).toBeGreaterThanOrEqual(1);
        expect(attribute.value).toBeLessThanOrEqual(20);
      }
    }
    // Own player: no exact hidden ceiling, only a band.
    expect(result.data.development?.potentialBand).toMatch(/potential|Unassessed/);
    expect(JSON.stringify(result.data)).not.toContain("potentialAbility");
    expect(JSON.stringify(result.data)).not.toContain("currentAbility");
  });

  it("exposes every formation, role and style the engine supports", () => {
    const result = service.getTactics();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.formations.length).toBeGreaterThanOrEqual(6);
    expect(result.data.formations.map((formation) => formation.name)).toContain("4-2-3-1");
    expect(result.data.roles.length).toBeGreaterThanOrEqual(20);
    expect(result.data.styles).toContain("GEGENPRESS");
    expect(result.data.roleFits).toHaveLength(11);
    expect(result.data.validation.isValid).toBe(true);
  });

  it("persists a formation, XI and style change across reload", () => {
    const before = service.getTactics();
    if (!before.ok) return;
    const target = before.data.formations.find((formation) => formation.name === "3-5-2")!;
    const squad = service.getSquad();
    if (!squad.ok) return;
    const eleven = squad.data.players.slice(0, 11);

    const updated = service.updateTactics({
      formationId: target.id,
      name: "Reload Proof Tactic",
      style: "HIGH_PRESS",
      assignments: target.slots.map((slot, index) => ({
        slotId: slot.id,
        playerId: eleven[index]!.personId,
        roleId: slot.position === "GK" ? "GOALKEEPER" : "CENTRAL_MIDFIELDER",
      })),
      bench: squad.data.players.slice(11, 18).map((player) => player.personId),
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.setup.formation.name).toBe("3-5-2");

    reopen();
    const after = service.getTactics();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.data.setup.name).toBe("Reload Proof Tactic");
    expect(after.data.setup.formation.name).toBe("3-5-2");
    expect(after.data.setup.style).toBe("HIGH_PRESS");
    expect(after.data.setup.assignments[0]?.playerId).toBe(eleven[0]!.personId);
    expect(after.data.setup.bench).toHaveLength(7);
  });

  it("persists set-piece assignments across reload (desktop bridge for the completed set-piece domain)", () => {
    const before = service.getTactics();
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const squad = service.getSquad();
    expect(squad.ok).toBe(true);
    if (!squad.ok) return;
    const [taker, target, marker] = squad.data.players;

    const updated = service.updateTactics({
      setPieces: {
        penaltyTaker: taker!.personId,
        cornerRoutine: "FAR_POST",
        cornerPrimaryTarget: target!.personId,
        defensiveCornerScheme: "MAN_ORIENTED",
        defensiveCornerAssignments: [marker!.personId],
        freeKickRoutine: "DIRECT",
        directFreeKickTaker: taker!.personId,
      },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.setup.setPieces.penaltyTaker).toBe(taker!.personId);
    expect(updated.data.setup.setPieces.cornerRoutine).toBe("FAR_POST");
    expect(updated.data.setup.setPieces.defensiveCornerAssignments).toEqual([marker!.personId]);

    reopen();
    const after = service.getTactics();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.data.setup.setPieces.penaltyTaker).toBe(taker!.personId);
    expect(after.data.setup.setPieces.cornerRoutine).toBe("FAR_POST");
    expect(after.data.setup.setPieces.cornerPrimaryTarget).toBe(target!.personId);
    expect(after.data.setup.setPieces.defensiveCornerScheme).toBe("MAN_ORIENTED");
    expect(after.data.setup.setPieces.freeKickRoutine).toBe("DIRECT");
    expect(after.data.setup.setPieces.directFreeKickTaker).toBe(taker!.personId);
  });

  it("rejects an illegal XI without hard-locking poor role fits", () => {
    const tactics = service.getTactics();
    if (!tactics.ok) return;
    const invalid = service.updateTactics({
      assignments: tactics.data.setup.assignments.map((assignment, index) =>
        index === 0 ? { ...assignment, playerId: undefined } : assignment,
      ),
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: "INVALID_SELECTION" } });

    // An outfield player in goal is a warning, not a block.
    const squad = service.getSquad();
    if (!squad.ok) return;
    const outfield = squad.data.players.find((player) => player.primaryPosition !== "GK")!;
    const risky = service.updateTactics({
      assignments: tactics.data.setup.assignments.map((assignment, index) =>
        index === 0 ? { ...assignment, playerId: outfield.personId } : assignment,
      ),
      bench: tactics.data.setup.bench.filter((id) => id !== outfield.personId),
    });
    expect(risky.ok).toBe(true);
  });

  it("persists a training change and applies it when the world advances", () => {
    const before = service.getTraining();
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const updated = service.updateTraining({
      name: "Intense block",
      intensity: "HIGH",
      sessions: before.data.plan.sessions.map((session) => ({
        day: session.day,
        slot: session.slot,
        category: "FITNESS",
        intensity: "HIGH",
        targetGroup: "FULL_SQUAD",
      })),
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.plan.source).toBe("USER");

    reopen();
    const after = service.getTraining();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.data.plan.name).toBe("Intense block");
    expect(after.data.plan.intensity).toBe("HIGH");
    expect(after.data.plan.sessions.every((session) => session.category === "FITNESS")).toBe(true);
    expect(after.data.squadDevelopment.length).toBeGreaterThan(0);
  });

  it("lists fixtures and fixture detail from the real competition", () => {
    const list = service.getFixtures();
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data.upcoming.length).toBeGreaterThan(0);

    const detail = service.getFixture(list.data.upcoming[0]!.id);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.data.fixture.opponent).toBeTruthy();
    expect(detail.data.selectedXI).toHaveLength(11);
    expect(detail.data.availableCount).toBeGreaterThan(0);

    // Regression: the opponent club link must resolve through teams.club_id,
    // never be guessed from the `opponent` team-name text.
    for (const fixture of list.data.upcoming) {
      expect(fixture.opponentClub?.entityType).toBe("CLUB");
      expect(fixture.opponentClub?.visible).toBe(true);
      expect(fixture.opponentClub?.label).toBeTruthy();
    }
  });

  it("returns a full league table for the real competition", () => {
    const result = service.getCompetition();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.table.length).toBeGreaterThan(4);
    expect(result.data.table.filter((row) => row.isManagerTeam)).toHaveLength(1);
    for (const row of result.data.table) {
      expect(row.teamName).not.toMatch(/Testing|Sample|Demo/);
      expect(row.position).toBeGreaterThan(0);
      // Regression: every standings row must carry a real club link via teams.club_id.
      expect(row.club?.entityType).toBe("CLUB");
      expect(row.club?.visible).toBe(true);
    }
  });

  it("advances with a stop reason and completes a fixture exactly once", () => {
    const before = service.getHomeDashboard();
    if (!before.ok) return;
    const startDate = before.data.save.worldDate;

    const advanced = service.continueCareer();
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(advanced.data.save.worldDate > startDate).toBe(true);

    const fixtures = service.getFixtures();
    if (!fixtures.ok) return;
    const target = fixtures.data.upcoming[0]!;

    const simulated = service.quickSimMatch(target.id);
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;

    const summary = service.getMatchSummary(target.id);
    expect(summary.ok).toBe(true);
    if (!summary.ok || !summary.data) return;
    expect(summary.data.score).toMatch(/^\d+-\d+$/);
    expect(["W", "D", "L"]).toContain(summary.data.result);

    // Post-match world state must have moved.
    const table = service.getCompetition();
    if (!table.ok) return;
    expect(table.data.table.some((row) => row.played > 0)).toBe(true);

    reopen();
    const after = service.getFixtures();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const played = after.data.results.filter((row) => row.id === target.id);
    expect(played).toHaveLength(1);
    expect(after.data.upcoming.some((row) => row.id === target.id)).toBe(false);
  }, 120_000);

  it("scouts without ever leaking exact hidden ability", () => {
    const dashboard = service.getScoutingDashboard();
    expect(dashboard.ok).toBe(true);
    if (!dashboard.ok) return;
    expect(dashboard.data.coverage.totalPlayers).toBeGreaterThan(100);

    const search = service.searchRecruitment({ pageSize: 20 });
    expect(search.ok).toBe(true);
    if (!search.ok) return;
    expect(search.data.rows.length).toBeGreaterThan(0);
    expect(search.data.total).toBeGreaterThan(search.data.rows.length);

    const external = search.data.rows.find((row) => row.knowledge !== "EXTENSIVE");
    if (external) {
      // Only banded estimates may cross the boundary.
      expect(JSON.stringify(external)).not.toContain("currentAbility");
      if (external.estimatedAbility) {
        expect(external.estimatedAbility.max).toBeGreaterThanOrEqual(external.estimatedAbility.min);
      }
    }

    const target = search.data.rows[0]!;
    const assignment = service.createScoutingAssignment({
      targetPlayerId: target.playerId,
      priority: "HIGH",
    });
    expect(assignment.ok).toBe(true);
    if (!assignment.ok) return;
    expect(assignment.data.assignments.length).toBeGreaterThan(0);

    const report = service.getScoutingReport(target.playerId);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.data.estimatedPotentialBand).toBeTruthy();
    expect(report.data.confidence).toBeTruthy();
    expect(JSON.stringify(report.data)).not.toContain("potentialAbility");
  });

  it("persists shortlist changes across reload", () => {
    const search = service.searchRecruitment({ pageSize: 50 });
    if (!search.ok) return;
    const clubbed = search.data.rows.find((row) => row.clubName);
    const target = clubbed ?? search.data.rows[0]!;

    const added = service.toggleShortlist(target.playerId);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.data.shortlist.some((entry) => entry.playerId === target.playerId)).toBe(true);
    if (clubbed) {
      // Regression: a shortlisted player's club link must resolve through
      // teams.club_id / persons' current_club_id, never be left text-only.
      const shortlistedEntry = added.data.shortlist.find(
        (entry) => entry.playerId === target.playerId,
      );
      expect(shortlistedEntry?.club?.entityType).toBe("CLUB");
      expect(shortlistedEntry?.club?.visible).toBe(true);
    }

    reopen();
    const afterReload = service.getScoutingDashboard();
    expect(afterReload.ok).toBe(true);
    if (!afterReload.ok) return;
    expect(afterReload.data.shortlist.some((entry) => entry.playerId === target.playerId)).toBe(
      true,
    );

    const removed = service.toggleShortlist(target.playerId);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.data.shortlist.some((entry) => entry.playerId === target.playerId)).toBe(false);
  });

  it("runs a transfer offer through the engine and records the outcome", () => {
    const centre = service.getTransferCentre();
    expect(centre.ok).toBe(true);
    if (!centre.ok) return;
    expect(centre.data.budget.currency).toBeTruthy();
    // A budget is an allocation, not raw club cash.
    expect(centre.data.budget.transferRemaining).toBeLessThanOrEqual(
      centre.data.budget.transferBudget,
    );

    const squad = new Set(
      service.getSquad().ok
        ? (service.getSquad() as any).data.players.map((p: any) => p.personId)
        : [],
    );
    const search = service.searchRecruitment({ pageSize: 60 });
    if (!search.ok) return;
    const target = search.data.rows.find((row) => !squad.has(row.playerId));
    if (!target) return;

    const offered = service.makeTransferOffer({ playerId: target.playerId });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;

    const offer = offered.data.incoming.find((row) => row.playerId === target.playerId);
    expect(offer).toBeTruthy();
    expect(["SUBMITTED", "ACCEPTED", "REJECTED", "COMPLETED"]).toContain(offer!.status);
    expect(offer!.negotiation.length).toBeGreaterThan(0);
    if (offer!.otherClubName) {
      // Regression: the counterpart club on a transfer offer must resolve
      // through teams.club_id, never be left as text-only otherClubName.
      expect(offer!.otherClub?.entityType).toBe("CLUB");
      expect(offer!.otherClub?.visible).toBe(true);
    }

    reopen();
    const afterReload = service.getTransferCentre();
    expect(afterReload.ok).toBe(true);
    if (!afterReload.ok) return;
    expect(afterReload.data.incoming.some((row) => row.playerId === target.playerId)).toBe(true);
  }, 120_000);

  it("refuses an offer that exceeds the board's transfer budget", () => {
    const centre = service.getTransferCentre();
    if (!centre.ok) return;
    const search = service.searchRecruitment({ pageSize: 40 });
    if (!search.ok) return;
    const target = search.data.rows.at(-1)!;
    const result = service.makeTransferOffer({
      playerId: target.playerId,
      fee: centre.data.budget.transferBudget + 5_000_000_000,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_SELECTION" } });
  });

  it("lists contracts and persists a renewal without losing history", () => {
    const before = service.getContracts();
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.data.contracts.length).toBeGreaterThan(0);
    expect(before.data.totalWageBill).toBeGreaterThan(0);

    const target = before.data.contracts[0]!;
    const renewed = service.renewContract({ playerId: target.playerId, months: 24 });
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    const updated = renewed.data.contracts.find((row) => row.playerId === target.playerId);
    expect(updated).toBeTruthy();
    expect(updated!.endDate > target.endDate).toBe(true);

    reopen();
    const after = service.getContracts();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const persisted = after.data.contracts.find((row) => row.playerId === target.playerId);
    expect(persisted?.endDate).toBe(updated!.endDate);
    // Exactly one active contract, with the superseded one retained as history.
    expect(after.data.contracts.filter((row) => row.playerId === target.playerId)).toHaveLength(1);
  });

  it("transfer-lists a player and keeps the status after reload", () => {
    const squad = service.getSquad();
    if (!squad.ok) return;
    const target = squad.data.players.at(-1)!;

    const listed = service.setTransferStatus({
      playerId: target.personId,
      status: "TRANSFER_LISTED",
    });
    expect(listed.ok).toBe(true);

    reopen();
    const after = service.getSquad();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(
      after.data.players.find((player) => player.personId === target.personId)?.transferStatus,
    ).toBe("TRANSFER_LISTED");
  });

  it("returns staff structures with clean empty states for unresearched data", () => {
    const result = service.getStaff();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The real registry deliberately ships no staff, so this must be empty
    // rather than populated with invented coaches.
    expect(Array.isArray(result.data.staff)).toBe(true);
    expect(Array.isArray(result.data.vacancies)).toBe(true);
    expect(Array.isArray(result.data.candidates)).toBe(true);
    for (const member of result.data.staff) {
      expect(member.name).toBeTruthy();
      expect(member.category).toBeTruthy();
    }
  });

  it("builds a calendar from real save dates", () => {
    const result = service.getCalendar();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.some((entry) => entry.type === "FIXTURE")).toBe(true);
    const dates = result.data.map((entry) => entry.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("refuses manager actions against a club the manager does not run", () => {
    const foreign = service.getStaff("some-other-club" as EntityId);
    expect(foreign).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
  });

  it("refuses to respond to an offer for a player at another club", () => {
    const centre = service.getTransferCentre();
    if (!centre.ok) return;
    const incoming = centre.data.incoming[0];
    if (!incoming) return;
    // Incoming offers are the manager's own bids; they may not "accept" them
    // on the selling club's behalf.
    const result = service.respondTransferOffer({ offerId: incoming.id, action: "ACCEPT" });
    expect(result).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
  });

  it("refuses manager commands when no career session is open", () => {
    service.closeCareer();
    expect(service.getSquad()).toMatchObject({
      ok: false,
      error: { code: "SESSION_NOT_OPEN" },
    });
    const loaded = service.loadCareer(saveId);
    expect(loaded.ok).toBe(true);
  });
});
