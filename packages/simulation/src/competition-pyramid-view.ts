import type { CareerRole, CompetitionPyramid, CompetitionPyramidTier, EntityId } from "@nepal-football-sim/shared-types";
import { CompetitionCommercialRepository, CompetitionRepository, type GameDatabase } from "@nepal-football-sim/database";
import { buildEntityReference } from "./entity-reference.js";
import { homeFootballContext } from "./home-context.js";

/** Real domestic tiers come from the promotion/relegation relationships between the
 * federation's competitions (the `competition_tiers` view), labelled by the country
 * pack. Only tiers that genuinely exist in the dataset appear; a division that isn't
 * there is never invented. */

/**
 * The domestic competition pyramid — every tier the dataset actually
 * contains, with the current season's real leading club, promotion/
 * relegation slots from the canonical rule set, and the real title
 * sponsor where one exists. Never fabricates a tier or a movement rule.
 */
export const buildCompetitionPyramid = (db: GameDatabase, federationId: EntityId, role: CareerRole, worldDate: string): CompetitionPyramid => {
  const repository = new CompetitionRepository(db);
  const tiers: CompetitionPyramidTier[] = [];
  const labels = homeFootballContext(db).tierLabels;
  const levels = (
    db
      .prepare("SELECT DISTINCT t.tier AS tier FROM competition_tiers t JOIN competitions c ON c.id = t.competition_id WHERE c.federation_id = ? AND c.scope = 'domestic' ORDER BY t.tier")
      .all(federationId) as Array<{ tier: number }>
  ).map((row) => row.tier);
  for (const level of levels) {
    const label = labels[level - 1] ?? `Tier ${level}`;
    const competition = db
      .prepare("SELECT id, name FROM competitions WHERE federation_id=? AND scope='domestic' AND (SELECT tier FROM competition_tiers WHERE competition_id = competitions.id) = ? ORDER BY (SELECT COUNT(*) FROM competition_seasons cs WHERE cs.competition_id = competitions.id) DESC, id LIMIT 1")
      .get(federationId, level) as { id: EntityId; name: string } | undefined;
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
    // Standings are empty until a match is played, so the registered members give the team count.
    const memberCount = season
      ? Number(
          (
            db
              .prepare(
                "SELECT COUNT(DISTINCT club_id) AS count FROM club_memberships WHERE competition_season_id=? AND status NOT IN ('WITHDRAWN','SUSPENDED','INELIGIBLE')",
              )
              .get(season.id) as { count?: number } | undefined
          )?.count ?? 0,
        )
      : 0;
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
      teamCount: standings.length > 0 ? standings.length : memberCount,
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
