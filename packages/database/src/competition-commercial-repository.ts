import type { CompetitionCommercialSponsorship, EntityId } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const map = (row: any): CompetitionCommercialSponsorship => ({
  id: row.id,
  competitionSeasonId: row.competition_season_id,
  rightsOfferId: row.rights_offer_id,
  sponsorId: row.sponsor_id,
  displayTitle: row.display_title,
  startDate: row.start_date,
  endDate: row.end_date,
  status: row.status,
  revenueDestination: row.revenue_destination,
  provenanceStatus: row.provenance_status,
});

export class CompetitionCommercialRepository {
  constructor(private readonly db: GameDatabase) {}

  upsert(value: CompetitionCommercialSponsorship): void {
    this.db
      .prepare(
        `INSERT INTO competition_commercial_sponsorships
          (id, competition_season_id, rights_offer_id, sponsor_id, display_title,
           start_date, end_date, status, revenue_destination, provenance_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(competition_season_id) DO UPDATE SET
           rights_offer_id=excluded.rights_offer_id, sponsor_id=excluded.sponsor_id,
           display_title=excluded.display_title, start_date=excluded.start_date,
           end_date=excluded.end_date, status=excluded.status,
           revenue_destination=excluded.revenue_destination`,
      )
      .run(
        value.id,
        value.competitionSeasonId,
        value.rightsOfferId,
        value.sponsorId,
        value.displayTitle,
        value.startDate,
        value.endDate,
        value.status,
        value.revenueDestination,
        value.provenanceStatus,
      );
  }

  bySeason(competitionSeasonId: EntityId): CompetitionCommercialSponsorship | undefined {
    const row = this.db
      .prepare("SELECT * FROM competition_commercial_sponsorships WHERE competition_season_id=?")
      .get(competitionSeasonId);
    return row ? map(row) : undefined;
  }

  byOffer(rightsOfferId: EntityId): CompetitionCommercialSponsorship | undefined {
    const row = this.db
      .prepare("SELECT * FROM competition_commercial_sponsorships WHERE rights_offer_id=?")
      .get(rightsOfferId);
    return row ? map(row) : undefined;
  }

  all(competitionSeasonId?: EntityId): CompetitionCommercialSponsorship[] {
    const rows = (
      competitionSeasonId
        ? this.db
            .prepare(
              "SELECT * FROM competition_commercial_sponsorships WHERE competition_season_id=?",
            )
            .all(competitionSeasonId)
        : this.db
            .prepare("SELECT * FROM competition_commercial_sponsorships ORDER BY start_date, id")
            .all()
    ) as any[];
    return rows.map(map);
  }
}
