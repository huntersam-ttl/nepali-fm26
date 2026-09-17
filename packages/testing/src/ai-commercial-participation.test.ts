import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  runClubAiSeasonPlanning,
  SPONSORSHIP_SLOT_ORDER,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * AI clubs must participate in the commercial system.
 *
 * `generateSponsorOffers` and `acceptSponsorOffer` were only ever reachable
 * from the desktop application service, so only the human player's own club
 * ever went to market. Every AI club's commercial income sat permanently at
 * zero while the season AI emitted a "REVIEW_COMMERCIAL_OFFERS" label with no
 * behaviour behind it. The season planner now runs the same canonical
 * generate/accept path a player-controlled club uses.
 */

const dirs: string[] = [];
let db: GameDatabase;
let economy: ClubEconomyRepository;
// The AI season planner only runs on the world's August planning date.
const date = "2026-08-28";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "ai-commercial-"));
  dirs.push(dir);
  /*
   * A raw seeded world has no financial accounts, board policies or sponsor
   * organisations — those are created during career initialisation, and the
   * AI planner needs all three. So this fixture creates a real career the
   * same way the game does.
   */
  const service = new DesktopApplicationService({
    savesDirectory: dir,
    worldDatasetPath: resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"),
  });
  const listed = service.listStartingClubs();
  if (!listed.ok) throw new Error(listed.error.message);
  const club = listed.data.find((item) => item.division === "A");
  if (!club?.teamId) throw new Error("No A-Division club in the starting-club list");
  const created = service.createCareer({
    careerMode: "MANAGER",
    saveName: "AI Commercial",
    joinTeamId: club.teamId,
    character: {
      fullName: "AI Commercial Test",
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
  db = openGameDatabase(created.data.catalogEntry.filePath);
  economy = new ClubEconomyRepository(db);
});

afterAll(() => {
  db?.close();
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

// Nepal (playable) clubs only — the global dataset seed also populates this
// same `clubs` table with CONTEXT_ONLY foreign clubs, which the AI season
// planner never touches (it only runs commercial planning for real Nepal
// clubs), so those must never leak into this fixture's club list.
const clubIds = (): EntityId[] =>
  (
    db
      .prepare(
        "SELECT c.id FROM clubs c WHERE NOT EXISTS (SELECT 1 FROM external_club_context ecc WHERE ecc.club_id = c.id) ORDER BY c.id",
      )
      .all() as Array<{ id: EntityId }>
  ).map((row) => row.id);

const activeSponsorships = (clubId: EntityId) =>
  economy.sponsorships(clubId).filter((item) => item.status === "ACTIVE");

describe("AI clubs participate in the commercial system", () => {
  it("season planning signs a fresh commercial partner for a club with none", () => {
    // Every club is seeded with a one-off baseline sponsorship at world
    // creation, so this test clears one specific club's active deal to
    // reproduce the real in-game state the AI planner must recover from: a
    // club whose sponsorship has lapsed and needs a new one.
    const target = clubIds()[0];
    for (const deal of activeSponsorships(target)) {
      db.prepare("UPDATE sponsorship_contracts SET status = ? WHERE id = ?").run("EXPIRED", deal.id);
    }
    expect(activeSponsorships(target)).toHaveLength(0);

    const decisions = runClubAiSeasonPlanning(db, { date, seed: "ai-commercial-run" });
    expect(decisions.length).toBeGreaterThan(0);

    expect(activeSponsorships(target).length).toBeGreaterThan(0);
  });

  it("records the decision as a real action, not only a label", () => {
    const signed = clubIds()
      .flatMap((id) => economy.aiDecisions(id))
      .flatMap((decision) => decision.actions ?? []);
    expect(signed).toContain("SIGN_COMMERCIAL_PARTNER");
  });

  it("every signed AI deal is a canonical contract with Nepal-scale value", () => {
    for (const clubId of clubIds()) {
      for (const deal of activeSponsorships(clubId)) {
        expect(deal.clubId).toBe(clubId);
        expect(deal.sponsorId.length).toBeGreaterThan(0);
        expect(deal.annualValue).toBeGreaterThan(0);
        // A Nepali club sponsorship is not a European one. Bound generously
        // but firmly so a scale regression fails here.
        expect(deal.annualValue).toBeLessThan(60_000_000);
        expect(deal.endDate > deal.startDate).toBe(true);
        expect(deal.provenanceStatus).toBe("SIMULATION_ONLY");
      }
    }
  });

  it("never creates two conflicting exclusive deals for one club", () => {
    for (const clubId of clubIds()) {
      const groups = activeSponsorships(clubId)
        .map((item) => item.exclusivityGroup)
        .filter((group): group is string => Boolean(group));
      expect(new Set(groups).size).toBe(groups.length);
    }
  });

  it("converges — repeated planning runs sign every club up to the available slots, never duplicating one", () => {
    // A club can hold one sponsor per exclusivity slot, so re-running planning
    // on the same date is expected to keep filling additional open slots, not
    // stay flat after the very first signing — that would mean the pipeline
    // could never diversify past one sponsor. What must hold is convergence
    // (it eventually stops) and no club ever exceeding the canonical slot
    // count, with no exclusivity-group duplicate. The bound is read from
    // SPONSORSHIP_SLOT_ORDER rather than hardcoded, so adding a slot (kit
    // supply, most recently) does not silently turn a real behavioural
    // assertion into a stale number.
    for (let i = 0; i < 6; i += 1) runClubAiSeasonPlanning(db, { date, seed: "ai-commercial-run" });
    const saturated = clubIds().map((id) => activeSponsorships(id).length);
    runClubAiSeasonPlanning(db, { date, seed: "ai-commercial-run" });
    const after = clubIds().map((id) => activeSponsorships(id).length);
    expect(after).toEqual(saturated);
    for (const id of clubIds()) {
      const active = activeSponsorships(id);
      expect(active.length).toBeLessThanOrEqual(SPONSORSHIP_SLOT_ORDER.length);
      expect(new Set(active.map((item) => item.exclusivityGroup)).size).toBe(active.length);
    }
  });
});
