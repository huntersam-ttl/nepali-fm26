import type { PackMedia } from "../country-pack.js";

/*
 * Nepal's football media: the outlets a save starts with (simulation-only identities in Nepal's
 * naming) and the journalists who write for them. Order matters: journalists are dealt to outlets
 * in this order.
 */
export const NEPAL_MEDIA: PackMedia = {
  outlets: [
    { name: "Kathmandu Football Desk", scope: "LOCAL", reputation: 5.8, reach: 3.5, bias: "CLUB_FOCUSED", style: "ANALYSIS", status: "SIMULATION_ONLY" },
    { name: "Nepal Football News", scope: "NATIONAL", reputation: 6.8, reach: 6.5, bias: "NATIONAL_FOCUS", style: "WIRE", status: "SIMULATION_ONLY" },
    { name: "South Asia Football Review", scope: "REGIONAL_INTERNATIONAL", reputation: 8.1, reach: 7.4, bias: "NEUTRAL", style: "TRADE", status: "SIMULATION_ONLY" },
    { name: "ANFA Federation Bulletin", scope: "NATIONAL", reputation: 7.2, reach: 5.5, bias: "DEVELOPMENT_FOCUS", style: "WIRE", status: "SIMULATION_ONLY" },
    { name: "Nepal Football Business Desk", scope: "NATIONAL", reputation: 6.2, reach: 4.8, bias: "NEUTRAL", style: "TRADE", status: "SIMULATION_ONLY" },
    { name: "Club Media Channel", scope: "LOCAL", reputation: 4.5, reach: 2.8, bias: "CLUB_FOCUSED", style: "TABLOID", status: "SIMULATION_ONLY" },
  ],
  journalists: [
    { name: "Asha Shrestha", beat: "Domestic football", temperament: "NEUTRAL", reputation: 6.5, status: "SIMULATION_ONLY" },
    { name: "Rijan Gurung", beat: "National teams", temperament: "SCEPTICAL", reputation: 7.2, status: "SIMULATION_ONLY" },
    { name: "Mina Rai", beat: "Player development", temperament: "FRIENDLY", reputation: 6.8, status: "SIMULATION_ONLY" },
  ],
};
