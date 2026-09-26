import { describe, expect, it } from "vitest";
import { isPresentableHeadline, presentStoryHeadline } from "@nepal-football-sim/simulation";

/**
 * Table-driven coverage of every story-headline family and state. These are
 * pure presentation assertions — no database, no world — so the whole matrix
 * runs in milliseconds and every family stays covered as producers change.
 */

const NAMES = {
  player: "Bikash Karki",
  club: "Church Boys United",
  otherClub: "Machhindra FC",
  sponsor: "Annapurna Training Supplies",
  institution: "National Sports Council",
  competition: "Martyr's Memorial A-Division League",
  season: "A-Division 2026",
  programme: "Senior Men",
  project: "training ground",
  nation: "Nepal",
};

/** [family, eventType, expected headline with full canonical names]. */
const FAMILY_MATRIX: ReadonlyArray<readonly [string, string, string]> = [
  // TRANSFER / LOAN
  ["transfer", "TRANSFER_REQUESTED", "Bikash Karki asks to leave Church Boys United"],
  ["transfer", "TRANSFER_OFFER_SUBMITTED", "Church Boys United open talks for Bikash Karki"],
  ["transfer", "TRANSFER_OFFER_COUNTERED", "Revised terms keep talks alive for Bikash Karki"],
  ["transfer", "TRANSFER_OFFER_REJECTED", "Church Boys United reject the offer for Bikash Karki"],
  ["transfer", "TRANSFER_COMPLETED", "Bikash Karki completes move to Machhindra FC"],
  ["loan", "LOAN_STARTED", "Bikash Karki joins Machhindra FC on loan"],
  ["loan", "LOAN_ENDED", "Bikash Karki returns from a loan spell"],
  // OWNERSHIP
  ["ownership", "OWNERSHIP_INVESTOR_INTEREST", "An investor expresses interest in Church Boys United"],
  ["ownership", "OWNERSHIP_REVISED_PROPOSAL", "Investor returns with a revised proposal"],
  ["ownership", "OWNERSHIP_DUE_DILIGENCE_CONCERN", "Due diligence raises a concern over the deal"],
  ["ownership", "OWNERSHIP_BOARD_REVIEWED", "The board reviews the offer for Church Boys United"],
  ["ownership", "CLUB_OWNERSHIP_TRANSFERRED", "Control of Church Boys United changes hands"],
  ["ownership", "OWNERSHIP_CAPITAL_INJECTION_COMPLETED", "New investment arrives at Church Boys United"],
  ["ownership", "OWNERSHIP_NEGOTIATION_COLLAPSED", "Takeover talks collapse"],
  ["ownership", "OWNERSHIP_INVESTOR_WALKED_AWAY", "Takeover talks collapse"],
  // FACILITY
  ["facility", "INFRASTRUCTURE_PROJECT_STARTED", "Construction begins on Church Boys United's training ground"],
  ["facility", "INFRASTRUCTURE_PROJECT_DELAYED", "The training ground falls behind schedule"],
  ["facility", "INFRASTRUCTURE_MILESTONE_REACHED", "The training ground reaches a construction milestone"],
  ["facility", "FACILITY_PROJECT_COMPLETED", "Church Boys United open the completed training ground"],
  // GOVERNMENT
  ["government", "GOVERNMENT_SUPPORT_REQUESTED", "Church Boys United open a government support request"],
  ["government", "GOVERNMENT_SUPPORT_APPROVED", "National Sports Council approves support for Church Boys United"],
  ["government", "GOVERNMENT_SUPPORT_REJECTED", "National Sports Council turns down Church Boys United's support request"],
  ["government", "GOVERNMENT_RESPONSE", "National Sports Council notes Church Boys United's request for review"],
  // COMMERCIAL
  ["commercial", "SPONSORSHIP_ACCEPTED", "Church Boys United agree a new partnership with Annapurna Training Supplies"],
  ["commercial", "SPONSOR_ACTIVATION", "Church Boys United activate matchday branding as the new partnership begins"],
  ["commercial", "SPONSORSHIP_EXPIRED", "Church Boys United part ways with Annapurna Training Supplies"],
  ["commercial", "FEDERATION_COMMERCIAL_RIGHTS_AWARDED", "The federation awards commercial rights to Annapurna Training Supplies"],
  // NATIONAL TEAM
  ["national team", "NATIONAL_TEAM_CALLUP", "Nepal call up Bikash Karki for Senior Men"],
  ["national team", "NATIONAL_TEAM_DEBUT", "Bikash Karki earns a first Senior Men appearance"],
  ["national team", "NATIONAL_TEAM_CAMP_COMPLETED", "Senior Men completes its training camp"],
  ["national team", "WOMENS_PROGRAMME_STARTED", "The Women & Girls programme takes its next step"],
  ["national team", "YOUTH_PLAYER_PROMOTED", "Church Boys United move a youth prospect up the pathway"],
  // COMPETITION
  ["competition", "COMPETITION_CHAMPION_DECLARED", "Church Boys United crowned champions of Martyr's Memorial A-Division League"],
  ["competition", "CLUB_PROMOTED", "Church Boys United secure promotion to Martyr's Memorial A-Division League"],
  ["competition", "CLUB_RELEGATED", "Church Boys United relegated after A-Division 2026"],
  ["competition", "CLUB_QUALIFIED", "Church Boys United qualify for Martyr's Memorial A-Division League"],
  ["competition", "PROMOTION_SUSPENDED", "Promotion is suspended for Martyr's Memorial A-Division League"],
  ["competition", "RELEGATION_SUSPENDED", "Relegation is suspended for Martyr's Memorial A-Division League"],
  ["competition", "COMPETITION_EXPANDED", "Martyr's Memorial A-Division League expands for the new season"],
];

describe("story headline families", () => {
  it.each(FAMILY_MATRIX)("%s / %s renders a natural headline with canonical names", (_family, eventType, expected) => {
    expect(presentStoryHeadline({ eventType, names: NAMES })).toBe(expected);
  });

  it.each(FAMILY_MATRIX)("%s / %s never leaks a raw enum, id, or placeholder even with no names at all", (_family, eventType) => {
    const headline = presentStoryHeadline({ eventType });
    expect(headline).not.toMatch(/[A-Z][A-Z0-9]*_[A-Z0-9]+/);
    expect(headline).not.toMatch(/undefined|null|\[object/i);
    expect(headline).not.toMatch(/^(status|state|event) /i);
    expect(headline.length).toBeGreaterThan(8);
    expect(headline).toMatch(/^[A-Z]/);
  });

  it.each(FAMILY_MATRIX)("%s / %s is deterministic across repeated calls", (_family, eventType) => {
    const once = presentStoryHeadline({ eventType, names: NAMES });
    const twice = presentStoryHeadline({ eventType, names: NAMES });
    expect(twice).toBe(once);
  });

  it("never invents an entity name when the caller supplies none", () => {
    const headline = presentStoryHeadline({ eventType: "TRANSFER_OFFER_SUBMITTED" });
    expect(headline).toBe("A club open talks for a player");
    for (const name of Object.values(NAMES)) expect(headline).not.toContain(name);
  });

  it("uses whatever partial names exist without fabricating the missing ones", () => {
    expect(presentStoryHeadline({ eventType: "SPONSORSHIP_ACCEPTED", names: { club: "Friends Club" } })).toBe(
      "Friends Club agree a new sponsorship deal",
    );
    expect(presentStoryHeadline({ eventType: "COMPETITION_CHAMPION_DECLARED", names: { competition: "B-Division" } })).toBe(
      "A club crowned champions of B-Division",
    );
  });
});

describe("producer-title passthrough", () => {
  it("keeps a producer's already-natural title verbatim", () => {
    const title = "Church Boys United agrees new partnership with Annapurna Training Supplies";
    expect(presentStoryHeadline({ eventType: "SPONSORSHIP_ACCEPTED", title, names: NAMES })).toBe(title);
    expect(isPresentableHeadline(title)).toBe(true);
  });

  it.each([
    ["a raw SCREAMING_SNAKE enum", "Scheduled event processed: GOVERNMENT_SUPPORT_REQUESTED"],
    ["a bare raw enum subject", "TRANSFER_OFFER_SUBMITTED"],
    ["a snake_case leak", "Contract player_negotiating"],
    ["a camelCase leak", "Project status projectType changed"],
    ["a raw uuid", "Offer c3b12628-9519-54a5-b4af-1c22cfbc2047 updated"],
    ["a lowercase sentence fragment", "promotion suspended for A-Division 2026"],
    ["a generic placeholder", "Status updated"],
    ["an empty title", ""],
  ])("rejects %s and falls back to a family headline instead", (_case, title) => {
    expect(isPresentableHeadline(title)).toBe(false);
    const headline = presentStoryHeadline({ eventType: "TRANSFER_OFFER_SUBMITTED", title, names: NAMES });
    expect(headline).toBe("Church Boys United open talks for Bikash Karki");
  });

  it("falls back to humanized words — never the raw token — for an unmapped event type", () => {
    const headline = presentStoryHeadline({ eventType: "SOME_FUTURE_STORY_TYPE" });
    expect(headline).toBe("Some future story type");
    expect(headline).not.toMatch(/_/);
  });
});
