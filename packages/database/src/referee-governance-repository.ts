import type { EntityId, RefereeGovernanceReview } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const fromRow = (row: any): RefereeGovernanceReview => ({
  id: row.id,
  federationId: row.federation_id,
  reviewDate: row.review_date,
  assignments: Number(row.assignments),
  matchEvents: JSON.parse(row.match_events_json),
  appointmentConfidence: row.appointment_confidence,
  controversyPressure: row.controversy_pressure,
  developmentPriority: row.development_priority,
  stakeholderTrust: row.stakeholder_trust,
  status: row.status,
  provenanceStatus: "SIMULATION_ONLY",
});

export class RefereeGovernanceRepository {
  constructor(private readonly db: GameDatabase) {}

  upsert(review: RefereeGovernanceReview): void {
    this.db
      .prepare(
        `
      INSERT INTO referee_governance_reviews
        (id, federation_id, review_date, assignments, match_events_json,
         appointment_confidence, controversy_pressure, development_priority,
         stakeholder_trust, status, provenance_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(federation_id, review_date) DO UPDATE SET
        assignments=excluded.assignments, match_events_json=excluded.match_events_json,
        appointment_confidence=excluded.appointment_confidence,
        controversy_pressure=excluded.controversy_pressure,
        development_priority=excluded.development_priority,
        stakeholder_trust=excluded.stakeholder_trust, status=excluded.status
    `,
      )
      .run(
        review.id,
        review.federationId,
        review.reviewDate,
        review.assignments,
        JSON.stringify(review.matchEvents),
        review.appointmentConfidence,
        review.controversyPressure,
        review.developmentPriority,
        review.stakeholderTrust,
        review.status,
        review.provenanceStatus,
      );
  }

  latest(federationId: EntityId): RefereeGovernanceReview | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM referee_governance_reviews WHERE federation_id=? ORDER BY review_date DESC LIMIT 1",
      )
      .get(federationId) as any;
    return row ? fromRow(row) : undefined;
  }

  history(federationId: EntityId): RefereeGovernanceReview[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM referee_governance_reviews WHERE federation_id=? ORDER BY review_date",
        )
        .all(federationId) as any[]
    ).map(fromRow);
  }
}
