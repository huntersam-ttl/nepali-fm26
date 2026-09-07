import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GovernmentRepository, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import { buildStoryDetail, createNepalSave } from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId, type HistoricalEvent } from "@nepal-football-sim/shared-types";

/**
 * Per-family coverage of StoryDetail.additionalFacts. One shared world is
 * built once and reused read-only across every family — buildStoryDetail is
 * a pure read, so this stays fast while still exercising the real resolver
 * against real clubs/people rather than a stub.
 */

const dirs: string[] = [];
let db: GameDatabase;
let club: { id: EntityId; name: string };
let player: { id: EntityId; full_name: string };

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "story-detail-facts-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8")) as unknown,
    saveName: "story-detail-facts",
    gameVersion: "test",
    randomSeed: "story-detail-facts",
  });
  db = openGameDatabase(path);
  club = db.prepare("SELECT id, name FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId; name: string };
  player = db.prepare("SELECT id, full_name FROM persons ORDER BY id LIMIT 1").get() as { id: EntityId; full_name: string };
});

afterAll(() => {
  db?.close();
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

const event = (
  eventType: string,
  data: Record<string, unknown>,
  involved: HistoricalEvent["involvedEntities"] = [],
): HistoricalEvent => ({
  id: createStableEntityId("history", `facts:${eventType}:${JSON.stringify(data)}`),
  occurredOn: "2026-08-02",
  eventType,
  involvedEntities: involved,
  title: "A story",
  importance: "medium",
  scope: "club",
  data,
});

const factMap = (e: HistoricalEvent): Record<string, string> =>
  Object.fromEntries(
    buildStoryDetail(db, e, "CHAIRMAN_OWNER").contextRail.additionalFacts.map((f) => [f.label, f.value]),
  );

describe("story detail facts by family", () => {
  it("transfer/loan: fee, wage contribution, loan duration, respond-by, stage and an estimated market value", () => {
    const facts = factMap(
      event(
        "TRANSFER_OFFER_SUBMITTED",
        {
          offerId: "facts-offer",
          playerId: player.id,
          transferFee: 500_000,
          wageShare: 40,
          loanMonths: 6,
          respondBy: "2026-08-20",
          status: "SUBMITTED",
          currency: "NPR",
        },
        [
          { id: player.id, type: "person" },
          { id: club.id, type: "club" },
        ],
      ),
    );
    expect(facts["Player"]).toBe(player.full_name);
    expect(facts["Fee"]).toBe("NPR 500,000");
    expect(facts["Wage contribution"]).toBe("40%");
    expect(facts["Loan duration"]).toBe("6 months");
    expect(facts["Respond by"]).toBe("2026-08-20");
    expect(facts["Status"]).toBe("Submitted");
    // Derived from the canonical valuation model, clearly marked an estimate.
    expect(facts["Market value (estimated)"]).toMatch(/^NPR [\d,]+$/);
  });

  it("ownership: stake, implied valuation, proceeds, capital injection, control consequence, stance and board position", () => {
    const facts = factMap(
      event(
        "OWNERSHIP_BOARD_REVIEWED",
        {
          offerId: "facts-ownership",
          percentage: 55,
          impliedValuation: 12_000_000,
          ownerProceedsAmount: 6_600_000,
          capitalInjectionAmount: 2_000_000,
          dealStructure: "SECONDARY_STAKE_SALE",
          stance: "The board is supportive of this deal.",
          tier: "SUPPORTIVE",
          findings: ["Wage bill is above the division average"],
        },
        [{ id: club.id, type: "club" }],
      ),
    );
    expect(facts["Club"]).toBe(club.name);
    expect(facts["Stake"]).toBe("55%");
    expect(facts["Implied valuation"]).toBe("NPR 12,000,000");
    expect(facts["Owner proceeds"]).toBe("NPR 6,600,000");
    expect(facts["Capital injection"]).toBe("NPR 2,000,000");
    expect(facts["Control consequence"]).toBe("Secondary stake sale");
    expect(facts["Investor stance"]).toBe("The board is supportive of this deal.");
    expect(facts["Board position"]).toBe("Supportive");
    expect(facts["Due diligence findings"]).toBe("Wage bill is above the division average");
  });

  it("facility: project type, progress, total cost, expected completion, funding source and delay", () => {
    const facts = factMap(
      event("INFRASTRUCTURE_MILESTONE_REACHED", {
        projectId: "facts-project",
        projectType: "TRAINING_GROUND",
        progress: 52.4,
        capitalCost: 4_990_668,
        expectedCompletion: "2026-12-18",
        fundingSource: "GOVERNMENT_GRANT",
        delayDays: 12,
      }),
    );
    expect(facts["Project type"]).toBe("Training ground");
    expect(facts["Project progress"]).toBe("52%");
    expect(facts["Total cost"]).toBe("NPR 4,990,668");
    expect(facts["Expected completion"]).toBe("2026-12-18");
    expect(facts["Funding source"]).toBe("Government grant");
    expect(facts["Delay"]).toBe("12 days");
  });

  it("government: institution, club, requested and approved support, status and site", () => {
    const institutionId = "facts-institution" as EntityId;
    new GovernmentRepository(db).upsertInstitution({
      id: institutionId,
      name: "National Sports Council",
      institutionType: "NATIONAL_SPORTS_COUNCIL",
      profile: {
        budgetCapacity: 40_000_000,
        committedBudget: 0,
        footballPriority: 90,
        credibilityTowardFederation: 85,
        infrastructurePriority: 90,
        youthWomenPriority: 90,
      },
      provenanceStatus: "SIMULATION_ONLY",
    });
    const facts = factMap(
      event(
        "GOVERNMENT_SUPPORT_APPROVED",
        {
          applicationId: "facts-application",
          requestedAmount: 1_000_000,
          approvedAmount: 750_000,
          status: "APPROVED",
          municipalityName: "Lalitpur Metropolitan City",
        },
        [
          { id: club.id, type: "club" },
          { id: institutionId, type: "governmentInstitution" },
        ],
      ),
    );
    expect(facts["Institution"]).toBe("National Sports Council");
    expect(facts["Club"]).toBe(club.name);
    expect(facts["Requested support"]).toBe("NPR 1,000,000");
    expect(facts["Approved support"]).toBe("NPR 750,000");
    expect(facts["Status"]).toBe("Approved");
    expect(facts["Site"]).toBe("Lalitpur Metropolitan City");
  });

  it("competition: competition, club, outcome and tier movement", () => {
    const competition = db.prepare("SELECT id, name FROM competitions LIMIT 1").get() as { id: EntityId; name: string };
    const facts = factMap(
      event(
        "CLUB_PROMOTED",
        { clubId: club.id, competitionId: competition.id, movementType: "PROMOTION", status: "APPLIED" },
        [{ id: club.id, type: "club" }],
      ),
    );
    expect(facts["Competition"]).toBe(competition.name);
    expect(facts["Club"]).toBe(club.name);
    expect(facts["Outcome"]).toBe("Promoted");
    expect(facts["Tier movement"]).toBe("Promotion");
  });

  it("national team: programme, player, opponent and result", () => {
    const facts = factMap(
      event("NATIONAL_TEAM_CALLUP", { teamId: "facts-team", playerId: player.id, programme: "Senior Men", opponent: "Bhutan", result: "2-0" }, [
        { id: player.id, type: "person" },
      ]),
    );
    expect(facts["Programme"]).toBe("Senior Men");
    expect(facts["Player"]).toBe(player.full_name);
    expect(facts["Opponent"]).toBe("Bhutan");
    expect(facts["Result"]).toBe("2-0");
  });

  it("commercial: partner, property, scope, deal value, duration and expiry", () => {
    const facts = factMap(
      event(
        "SPONSORSHIP_ACCEPTED",
        {
          sponsorshipId: "facts-sponsorship",
          sponsorName: "Annapurna Training Supplies",
          category: "LEAGUE_TITLE_SPONSOR",
          scope: "COMPETITION",
          annualValue: 1_625_025,
          termYears: 2,
          endDate: "2028-08-01",
          currency: "NPR",
        },
        [{ id: club.id, type: "club" }],
      ),
    );
    expect(facts["Partner"]).toBe("Annapurna Training Supplies");
    expect(facts["Club"]).toBe(club.name);
    expect(facts["Property"]).toBe("League title sponsor");
    expect(facts["Scope"]).toBe("Competition");
    expect(facts["Deal value"]).toBe("NPR 1,625,025 / year");
    expect(facts["Duration"]).toBe("2 years");
    expect(facts["Runs until"]).toBe("2028-08-01");
  });
});

describe("story detail fact hygiene", () => {
  it("never emits a raw enum, snake_case, camelCase, uuid or duplicated currency in any label or value", () => {
    const samples: HistoricalEvent[] = [
      event("TRANSFER_OFFER_SUBMITTED", { offerId: "hygiene-1", playerId: player.id, transferFee: 250_000, status: "PLAYER_NEGOTIATING" }, [
        { id: player.id, type: "person" },
      ]),
      event("OWNERSHIP_BOARD_REVIEWED", { offerId: "hygiene-2", tier: "OPPOSED", dealStructure: "PRIMARY_CAPITAL_INJECTION" }, [
        { id: club.id, type: "club" },
      ]),
      event("INFRASTRUCTURE_PROJECT_DELAYED", { projectId: "hygiene-3", projectType: "ACADEMY", fundingSource: "MIXED" }),
      event("SPONSORSHIP_ACCEPTED", { sponsorshipId: "hygiene-4", category: "OFFICIAL_PARTNER", scope: "FEDERATION", annualValue: 900_000 }, [
        { id: club.id, type: "club" },
      ]),
      event("GOVERNMENT_SUPPORT_REJECTED", { applicationId: "hygiene-5", status: "REJECTED", requestedAmount: 400_000 }, [
        { id: club.id, type: "club" },
      ]),
    ];
    for (const sample of samples) {
      for (const fact of buildStoryDetail(db, sample, "CHAIRMAN_OWNER").contextRail.additionalFacts) {
        for (const text of [fact.label, fact.value]) {
          expect(text).not.toMatch(/[A-Z][A-Z0-9]*_[A-Z0-9]+/);
          expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
          expect(text).not.toMatch(/\b[a-z]+_[a-z]+\b/);
          expect(text).not.toMatch(/NPR.*NPR/);
          expect(text).not.toMatch(/undefined|null|\[object/i);
        }
      }
    }
  });

  it("stays bounded — an event with no recognized fields produces no fabricated facts", () => {
    expect(buildStoryDetail(db, event("SOME_UNKNOWN_EVENT", {}), "MANAGER").contextRail.additionalFacts).toHaveLength(0);
  });

  it("never repeats the same fact label twice for one story", () => {
    const facts = buildStoryDetail(
      db,
      event("SPONSORSHIP_ACCEPTED", { sponsorshipId: "dupe", annualValue: 100_000, termYears: 3, term: 5 }, [{ id: club.id, type: "club" }]),
      "CHAIRMAN_OWNER",
    ).contextRail.additionalFacts;
    const labels = facts.map((fact) => fact.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
