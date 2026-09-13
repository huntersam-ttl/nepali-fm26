import { describe, expect, it } from "vitest";
import {
  buildAiTacticalSetup,
  selectTeamFromTacticalSetup,
  simulateMatch,
} from "@nepal-football-sim/simulation";
import type { FixtureRecord, PlayerAttributeSet } from "@nepal-football-sim/shared-types";

/*
 * Root cause of the release-long-soak crash ("Cannot pick from an empty
 * collection" in chooseShooter, packages/simulation/src/match-engine.ts:1520),
 * reproduced with an instrumented run (release-soak seed, Nepal Super League
 * 2029, 2029-08-01 fixture) that confirmed BOTH sides had a fully healthy,
 * un-depleted 22-player registered and available roster at the moment of the
 * crash — ruling out population depletion entirely:
 *
 * A team's persisted tactical assignments go stale over a long career as
 * players transfer out or retire — a slot's assigned playerId may no longer
 * be on the roster passed in for selection at all. selectTeamFromTacticalSetup
 * fell through to a fallback pool for every such slot, but (unlike
 * selectTeam's `selected` Set) never tracked which player it had already
 * picked for an earlier slot in the SAME selection. With several slots
 * simultaneously stale and only a couple of genuinely eligible players left,
 * multiple slots could independently pick the SAME best-remaining player —
 * so one person occupied several slots in the XI at once.
 *
 * dismissPlayer (a red card) removes every SelectedPlayer entry whose
 * personId matches the dismissed player — correct when a person occupies
 * exactly one slot, but if they occupied several duplicate slots, one
 * dismissal removed all of them at once, capable of collapsing the side's
 * on-pitch selection to zero, at which point chooseShooter has nothing left
 * to pick from and throws.
 */

const technical = (base: number) => ({
  firstTouch: base, passing: base, crossing: base, dribbling: base, finishing: base,
  heading: base, tackling: base, technique: base, longShots: base, setPieces: base,
});
const mental = (base: number) => ({
  decisions: base, vision: base, composure: base, positioning: base, anticipation: base,
  workRate: base, teamwork: base, leadership: base, aggression: base, determination: base,
  professionalism: base,
});
const physical = (base: number) => ({
  pace: base, acceleration: base, strength: base, stamina: base, agility: base,
  balance: base, jumping: base, naturalFitness: base,
});
const goalkeeping = (base: number) => ({
  handling: base, reflexes: base, oneOnOnes: base, aerialReach: base,
  kicking: base, distribution: base, commandOfArea: base,
});

const FULL_SHAPE = ["GK", "LB", "CB", "CB", "RB", "CM", "CM", "CM", "LW", "RW", "ST"] as const;

const squad = (teamId: string): PlayerAttributeSet[] =>
  FULL_SHAPE.map((position, index) => ({
    id: `${teamId}-attr-${index}`,
    personId: `${teamId}-p${index}`,
    primaryPosition: position,
    secondaryPositions: [],
    technical: technical(12),
    mental: mental(12),
    physical: physical(12),
    goalkeeping: goalkeeping(position === "GK" ? 14 : 3),
  })) as unknown as PlayerAttributeSet[];

describe("tactical selection: one player can never occupy two slots at once", () => {
  it("new signings with no assignment record no longer flood every stale slot with the same player", () => {
    const teamId = "stale-assignment-club" as never;
    // A team's saved tactical setup, built when it had a full, real 11-player
    // squad — every slot has a valid, distinct playerId assignment.
    const fullSquad = squad("stale-assignment-club");
    const setup = buildAiTacticalSetup(teamId, fullSquad);
    expect(new Set(setup.assignments.map((a) => a.playerId)).size).toBe(11);

    // Time passes: 9 of the originally-assigned players have since left the
    // club (transfer, retirement) — their slots' saved assignments now point
    // at players absent from the current roster entirely. Only 2 of the
    // ORIGINAL 11 remain (still correctly excluded from other slots' fallback
    // pools by their own assignment record), replaced by 2 brand-new signings
    // who joined after this tactic was last saved and so have NO assignment
    // record anywhere — nothing marks them as "claimed" by a specific slot.
    const originalSurvivors = fullSquad.slice(0, 2);
    const newSignings = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((index) => ({
      ...fullSquad[index]!,
      id: `stale-assignment-club-newsign-attr-${index}`,
      personId: `stale-assignment-club-newsign-p${index}`,
    })) as unknown as PlayerAttributeSet[];
    const currentRoster = [...originalSurvivors, ...newSignings];
    const stillRegistered = new Set(originalSurvivors.map((p) => p.personId));
    const departedSlotCount = setup.assignments.filter(
      (assignment) => assignment.playerId && !stillRegistered.has(assignment.playerId),
    ).length;
    expect(departedSlotCount).toBeGreaterThanOrEqual(9);

    const selection = selectTeamFromTacticalSetup({ teamId, players: currentRoster, setup });

    // Exactly one formation slot per player, but never the same player twice.
    expect(selection).toHaveLength(setup.formation.slots.length);
    const ids = selection.map((entry) => entry.personId);
    expect(new Set(ids).size).toBe(ids.length);
    // Both original survivors keep their own slot.
    for (const survivor of originalSurvivors) {
      expect(ids).toContain(survivor.personId);
    }
    // The unclaimed new signings fill the stale slots — genuinely different
    // people, not one signing repeated across all of them.
    const newSigningIdsUsed = ids.filter((id) => newSignings.some((p) => p.personId === id));
    expect(new Set(newSigningIdsUsed).size).toBe(newSigningIdsUsed.length);
    expect(newSigningIdsUsed.length).toBeGreaterThan(1);
  });

  it("a corrupted assignment pointing two slots at the same still-registered player does not duplicate them either", () => {
    const teamId = "corrupt-assignment-club" as never;
    const fullSquad = squad("corrupt-assignment-club");
    const setup = buildAiTacticalSetup(teamId, fullSquad);
    // Corrupt the data directly: point a second slot at the same player
    // already assigned to the first slot.
    const corrupted = {
      ...setup,
      assignments: setup.assignments.map((assignment, index) =>
        index === 1 ? { ...assignment, playerId: setup.assignments[0]!.playerId } : assignment,
      ),
    };
    const selection = selectTeamFromTacticalSetup({ teamId, players: fullSquad, setup: corrupted });
    const ids = selection.map((entry) => entry.personId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("release-long-soak crash: stale tactical assignments must never crash match simulation", () => {
  it("plays to completion under the exact staleness conditions that used to crash chooseShooter", () => {
    const homeTeamId = "soak-crash-home" as never;
    const awayTeamId = "soak-crash-away" as never;
    const homeFullSquad = squad("soak-crash-home");
    const awayFullSquad = squad("soak-crash-away");
    // Both sides' saved tactics were built for a full squad, then most of the
    // squad departed — exactly the accumulated state an 8-season soak
    // produces. Only 2 real players per side remain registered; the engine
    // must fill the rest with unique replacement players, never a duplicate.
    const homeSetup = buildAiTacticalSetup(homeTeamId, homeFullSquad);
    const awaySetup = buildAiTacticalSetup(awayTeamId, awayFullSquad);
    // The whole ORIGINAL 11-player squad each side's tactic was built for has
    // since departed entirely — every one of the 11 saved assignments is now
    // stale — and exactly one new signing per side remains on the roster,
    // never referenced by any assignment at all. Under the old code every one
    // of the 11 slots' fallback resolves to this same lone candidate (nothing
    // in the "assigned elsewhere" check excludes them, since they were never
    // assigned anywhere), fielding one real person across the entire pitch;
    // any single dismissal in the match then empties the side outright.
    const homeRoster = [
      { ...homeFullSquad[0]!, id: "soak-crash-home-newsign-attr", personId: "soak-crash-home-newsign-p" },
    ] as unknown as PlayerAttributeSet[];
    const awayRoster = [
      { ...awayFullSquad[0]!, id: "soak-crash-away-newsign-attr", personId: "soak-crash-away-newsign-p" },
    ] as unknown as PlayerAttributeSet[];

    const fixture = {
      id: "soak-crash-fixture",
      competitionSeasonId: "soak-crash-season",
      homeTeamId,
      awayTeamId,
      scheduledDate: "2029-08-01",
      status: "scheduled",
      round: 1,
    } as unknown as FixtureRecord;

    // Every dismissal in a match still reduces one side's on-pitch selection
    // (the exact trigger for the crash), so search seeds for one containing
    // at least one red card and confirm the match still completes normally.
    // 400 matches mirrors the seed budget the codebase's own second-yellow
    // regression (match-engine-session.test.ts) already needs to find one.
    let sawDismissal = false;
    for (let index = 0; index < 400; index += 1) {
      const seed = `soak-crash-seed-${index}`;
      const result = simulateMatch({
        fixture,
        homeTacticalSetup: homeSetup,
        awayTacticalSetup: awaySetup,
        homePlayers: homeRoster,
        awayPlayers: awayRoster,
        seed,
      });
      // The crash under the old code threw before a result could ever be
      // produced; reaching this line at all for every seed is already the
      // regression proof. Scores must still be finite, sane numbers.
      expect(Number.isFinite(result.match.homeGoals)).toBe(true);
      expect(Number.isFinite(result.match.awayGoals)).toBe(true);
      expect(result.events.some((event) => event.type === "SHOT")).toBe(true);
      const redCards = result.playerStates.filter((state) => state.redCard).length;
      expect(result.homeStats.redCards + result.awayStats.redCards).toBe(redCards);
      if (redCards > 0) sawDismissal = true;
    }
    expect(sawDismissal, "no dismissal produced in 60 seeds — search range too small to prove the fix under load").toBe(true);
  });
});
