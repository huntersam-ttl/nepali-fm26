import type { CountryPack } from "../country-pack.js";
import type { NamePool } from "../country-pack.js";

/*
 * TESTING-ONLY country pack. It exists to prove that a second, structurally different country can
 * be played through the generic paths (save creation, calendar, markets, economy, geography). It is
 * not a model of real Japanese football: every club, person, company and place in the matching
 * fixture (packages/testing/src/fixtures/japan-testing-dataset.ts) is fictional, and every number
 * below is a test calibration. It is not registered by default; a test registers it.
 *
 * Deliberately unlike Nepal: a calendar year season (Feb-Dec) instead of Aug-Jul, region "EAFF"
 * instead of "SAFF" (its confederation/region come from the international registry, not from this
 * pack), a two-level geography of prefectures and cities with no districts, no pack geography
 * at all (the save's own places are used), and a money scale of 2 (a test value, not a claim that
 * Japan is twice as rich as Nepal).
 */

/** Invented name material (given names are common; surnames are made up), so no real person is implied. */
const JAPAN_TESTING_NAME_POOL: NamePool = {
  id: "japan-testing-names",
  languageCodes: ["ja"],
  languageNames: ["Japanese"],
  managerFullNames: ["Haruto Akimori", "Ren Tsukishiro", "Sora Nagamine", "Kaito Fujimaru", "Yuma Hoshizaki", "Daichi Mizukawa"],
  staffFullNames: ["Riku Amagawa", "Takumi Sakurai-Ono", "Hinata Kuramori", "Yuto Shiraishi", "Sota Minakata", "Kenta Uryuzaki", "Aoi Tachibara", "Naoki Kusanagi"],
  officials: {
    maleFirst: ["Hiroshi", "Kazuki", "Shun", "Taiga", "Ryota", "Minato"],
    femaleFirst: ["Yui", "Sakura", "Hana", "Mio", "Rina", "Airi"],
    surnames: ["Akimori", "Tsukishiro", "Nagamine", "Fujimaru", "Hoshizaki", "Mizukawa", "Amagawa", "Kuramori"],
  },
  players: {
    maleFirst: ["Haruto", "Ren", "Sora", "Kaito", "Yuma", "Daichi", "Riku", "Takumi", "Hinata", "Yuto", "Sota", "Kenta", "Naoki", "Shota", "Ryusei", "Asahi"],
    femaleFirst: ["Yui", "Sakura", "Hana", "Mio", "Rina", "Airi", "Himari", "Koharu"],
    maleMiddle: ["", "Ichi", "Ta", "Ro", "Shin"],
    femaleMiddle: ["", "No", "Mi", "Ka"],
    surnames: ["Akimori", "Tsukishiro", "Nagamine", "Fujimaru", "Hoshizaki", "Mizukawa", "Amagawa", "Kuramori", "Shiraishi", "Minakata", "Uryuzaki", "Tachibara", "Kusanagi", "Sakurai", "Yamanaka", "Kirishima", "Tanikawa", "Ashihara", "Noguchi-Ito", "Matsuzaki"],
  },
};
export const JAPAN_TESTING_PACK_ID = "japan-testing-v0";

export const japanTestingPack: CountryPack = {
  packId: JAPAN_TESTING_PACK_ID,
  countryName: "Japan",
  nationalTeamCodePrefix: "JPN",
  isoCodes: ["JP", "JPN"],
  currency: "JPY",
  locale: "ja-JP",
  federationAbbreviation: "TJFA",
  seasonRules: { seasonStart: "02-01", seasonEnd: "12-15", youthIntake: "02-15" },
  nationalTeams: [
    { teamType: "SENIOR_MEN", level: "senior", gender: "men", label: "Senior Men", strengthMultiplier: 1 },
    { teamType: "SENIOR_WOMEN", level: "senior", gender: "women", label: "Senior Women", strengthMultiplier: 0.84 },
    { teamType: "U23", level: "u23", gender: "men", label: "U23 Men", strengthMultiplier: 0.91 },
    { teamType: "U20", level: "u20", gender: "men", label: "U20 Men", strengthMultiplier: 0.86 },
    { teamType: "U17", level: "u17", gender: "men", label: "U17 Men", strengthMultiplier: 0.8 },
  ],
  tierLabels: ["Testing Division"],
  namePool: JAPAN_TESTING_NAME_POOL,
  economy: { priceLevel: 2, wageLevel: 2, ticketPriceLevel: 2 },
  commercial: {
    lenders: [{ name: "Testing Japan Bank (fictional)", institutionType: "COMMERCIAL_BANK", status: "SIMULATION_ONLY" }],
    sponsors: [
      { name: "Testing Japan Telecom (fictional)", industry: "Telecommunications", identityProvenance: "SIMULATION_ONLY" },
      { name: "Testing Japan Foods (fictional)", industry: "Food and beverage", identityProvenance: "SIMULATION_ONLY" },
    ],
    suppliers: [
      { name: "Testing Japan Football Supply (fictional)", region: "Japan", reputation: 6.4, priceLevel: 0.92, reliability: 0.86, foreign: false, status: "SIMULATION_ONLY" },
      { name: "Testing Overseas Football Systems (fictional)", region: "Overseas", reputation: 7.2, priceLevel: 1.08, reliability: 0.82, foreign: true, status: "SIMULATION_ONLY" },
    ],
    federationSponsors: [{ name: "Testing Japan Football Partner (fictional)", industry: "Development services" }],
  },
  media: {
    outlets: [
      { name: "Testing Japan Football Daily (fictional)", scope: "NATIONAL", reputation: 6.5, reach: 6, bias: "NEUTRAL", style: "WIRE", status: "SIMULATION_ONLY" },
      { name: "Testing Japan Club Channel (fictional)", scope: "LOCAL", reputation: 4.5, reach: 3, bias: "CLUB_FOCUSED", style: "TABLOID", status: "SIMULATION_ONLY" },
    ],
    journalists: [{ name: "Testing Reporter One", beat: "Domestic football", temperament: "NEUTRAL", reputation: 6, status: "SIMULATION_ONLY" }],
  },
};
