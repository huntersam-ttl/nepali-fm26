import type { FixtureOfficialAssignment } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const fromRow = (row: any): FixtureOfficialAssignment => ({
  id: row.id,
  fixtureId: row.fixture_id,
  refereePersonId: row.referee_person_id ?? undefined,
  assistantReferee1PersonId: row.assistant_referee_1_person_id ?? undefined,
  assistantReferee2PersonId: row.assistant_referee_2_person_id ?? undefined,
  fourthOfficialPersonId: row.fourth_official_person_id ?? undefined,
  varPersonId: row.var_person_id ?? undefined,
  assignedOn: row.assigned_on,
  status: row.status,
  competitionLevel: row.competition_level ?? undefined,
  refereeQuality: row.referee_quality ?? undefined,
  failureReason: row.failure_reason ?? undefined,
  provenanceStatus: row.provenance_status,
});

export class RefereeAssignmentRepository {
  constructor(private readonly db: GameDatabase) {}

  forFixture(fixtureId: string): FixtureOfficialAssignment | undefined {
    const row = this.db
      .prepare("SELECT * FROM fixture_official_assignments WHERE fixture_id = ?")
      .get(fixtureId) as any;
    return row ? fromRow(row) : undefined;
  }

  upsert(value: FixtureOfficialAssignment): void {
    this.db
      .prepare(
        `
      INSERT INTO fixture_official_assignments
        (id, fixture_id, referee_person_id, assistant_referee_1_person_id,
         assistant_referee_2_person_id, fourth_official_person_id, var_person_id,
         assigned_on, status, competition_level, referee_quality, failure_reason, provenance_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fixture_id) DO UPDATE SET
        id=excluded.id, referee_person_id=excluded.referee_person_id,
        assistant_referee_1_person_id=excluded.assistant_referee_1_person_id,
        assistant_referee_2_person_id=excluded.assistant_referee_2_person_id,
        fourth_official_person_id=excluded.fourth_official_person_id,
        var_person_id=excluded.var_person_id, assigned_on=excluded.assigned_on,
        status=excluded.status, competition_level=excluded.competition_level,
        referee_quality=excluded.referee_quality, failure_reason=excluded.failure_reason,
        provenance_status=excluded.provenance_status
    `,
      )
      .run(
        value.id,
        value.fixtureId,
        value.refereePersonId ?? null,
        value.assistantReferee1PersonId ?? null,
        value.assistantReferee2PersonId ?? null,
        value.fourthOfficialPersonId ?? null,
        value.varPersonId ?? null,
        value.assignedOn,
        value.status,
        value.competitionLevel ?? null,
        value.refereeQuality ?? null,
        value.failureReason ?? null,
        value.provenanceStatus,
      );
  }
}
