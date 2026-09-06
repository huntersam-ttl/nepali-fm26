import type { CareerRole, CompetitionPyramid, CompetitionPyramidTier, EntityId } from "@nepal-football-sim/shared-types";
import { CompetitionCommercialRepository, CompetitionRepository, type GameDatabase } from "@nepal-football-sim/database";
import { buildEntityReference } from "./entity-reference.js";

/** Real domestic tiers are identified by name today (there is no explicit
 * tier-number column on `competitions`) — the same pattern already used by
 * commercial-rights.ts to find the league title-sponsor competition. Only
 * recognizes tiers that genuinely exist in the dataset; never invents a
 * division that isn't there. */
const TIER_PATTERNS: Array<{ level: number; label: string; pattern: string }> = [
  { level: 1, label: "A Division", pattern: "%a-division%" },
  { level: 2, label: "B Division", pattern: "%b-division%" },
  { level: 3, label: "C Division", pattern: "%c-division%" },
];

/**
 * The domestic competition pyramid — every tier the dataset actually
 * contains, with the current season's real leading club, promotion/
 * relegation slots from the canonical rule set, and the real title
 * sponsor where one exists. Never fabricates a tier or a movement rule.
 */
export const buildCompetitionPyramid = (db: GameDatabase, federationId: EntityId, role: CareerRole, worldDate: string): CompetitionPyramid => {
  const repository = new CompetitionRepository(db);
  const tiers: CompetitionPyramidTier[] = [];
  for (const { level, label, pattern } of TIER_PATTERNS) {
    const competition = db
      .prepare("SELECT id, name FROM competitions WHERE federation_id=? AND scope='domestic' AND lower(name) LIKE ? ORDER BY id LIMIT 1")
      .get(federationId, pattern) as { id: EntityId; name: string } | undefined;
    if (!competition) continue;
    const season = db
      .prepare("SELECT id, name, start_date, end_date FROM competition_seasons WHERE competition_id=? ORDER BY end_date DESC, id DESC LIMIT 1")
      .get(competition.id) as { id: EntityId; name: string; start_date: string; end_date: string } | undefined;
    const seasonStatus = season
      ? worldDate < season.start_date
        ? "Upcoming"
        : worldDate > season.end_date
          ? "Concluded"
          : "In progress"
      : undefined;
    const standings = season ? repository.standings(season.id) : [];
    const clubIdForTeam = db.prepare("SELECT club_id FROM teams WHERE id=?");
    const leadingTeam = standings[0];
    const leadingClub = leadingTeam
      ? (clubIdForTeam.get(leadingTeam.teamId) as { club_id?: EntityId } | undefined)?.club_id
      : undefined;
    const ruleSet = season ? repository.getRuleSet(season.id) : undefined;
    const sponsorship = season ? new CompetitionCommercialRepository(db).bySeason(season.id) : undefined;
    tiers.push({
      level,
      label,
      competition: buildEntityReference(db, "COMPETITION", competition.id, role),
      currentSeasonName: season?.name,
      seasonStatus,
      teamCount: standings.length,
      leadingClub: leadingClub ? buildEntityReference(db, "CLUB", leadingClub, role) : undefined,
      leadingClubPoints: leadingTeam?.points,
      promotionSlots: ruleSet?.promotionEnabled ? ruleSet.promotionSlots : undefined,
      relegationSlots: ruleSet?.relegationEnabled ? ruleSet.relegationSlots : undefined,
      titleSponsor: sponsorship ? buildEntityReference(db, "SPONSOR", sponsorship.sponsorId, role) : undefined,
      commercialDisplayTitle: sponsorship?.displayTitle,
    });
  }
  return { tiers: tiers.sort((a, b) => a.level - b.level), provenanceStatus: "SIMULATION_ONLY" };
};
