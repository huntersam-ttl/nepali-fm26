import type {
  EntityId,
  MentoringAssignment,
  PersonPersonalityProfile,
  PersonRelationship,
} from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const personality = (row: any): PersonPersonalityProfile => ({
  personId: row.person_id,
  traits: JSON.parse(row.traits_json),
  archetype: row.archetype,
  updatedOn: row.updated_on,
  provenanceStatus: row.provenance_status,
});

const relationship = (row: any): PersonRelationship => ({
  id: row.id,
  fromPersonId: row.from_person_id,
  toPersonId: row.to_person_id,
  kind: row.relationship_kind,
  affinity: row.affinity,
  trust: row.trust,
  respect: row.respect,
  tension: row.tension,
  updatedOn: row.updated_on,
  provenanceStatus: row.provenance_status,
});

const mentoring = (row: any): MentoringAssignment => ({
  id: row.id,
  mentorPersonId: row.mentor_person_id,
  menteePersonId: row.mentee_person_id,
  teamId: row.team_id,
  focus: row.focus,
  startDate: row.start_date,
  endDate: row.end_date ?? undefined,
  progress: row.progress,
  status: row.status,
  updatedOn: row.updated_on,
  provenanceStatus: row.provenance_status,
});

export class PeopleFoundationRepository {
  constructor(private readonly db: GameDatabase) {}

  upsertPersonality(profile: PersonPersonalityProfile): void {
    this.db
      .prepare(
        `
      INSERT INTO person_personality_profiles (person_id, traits_json, archetype, updated_on, provenance_status)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(person_id) DO UPDATE SET traits_json=excluded.traits_json, archetype=excluded.archetype, updated_on=excluded.updated_on
    `,
      )
      .run(
        profile.personId,
        JSON.stringify(profile.traits),
        profile.archetype,
        profile.updatedOn,
        profile.provenanceStatus,
      );
  }

  personality(personId: EntityId): PersonPersonalityProfile | undefined {
    const row = this.db
      .prepare("SELECT * FROM person_personality_profiles WHERE person_id=?")
      .get(personId);
    return row ? personality(row) : undefined;
  }

  personalities(): PersonPersonalityProfile[] {
    return (
      this.db.prepare("SELECT * FROM person_personality_profiles ORDER BY person_id").all() as any[]
    ).map(personality);
  }

  upsertRelationship(value: PersonRelationship): void {
    this.db
      .prepare(
        `
      INSERT INTO person_relationships
        (id, from_person_id, to_person_id, relationship_kind, affinity, trust, respect, tension, updated_on, provenance_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(from_person_id, to_person_id, relationship_kind) DO UPDATE SET
        affinity=excluded.affinity, trust=excluded.trust, respect=excluded.respect,
        tension=excluded.tension, updated_on=excluded.updated_on
    `,
      )
      .run(
        value.id,
        value.fromPersonId,
        value.toPersonId,
        value.kind,
        value.affinity,
        value.trust,
        value.respect,
        value.tension,
        value.updatedOn,
        value.provenanceStatus,
      );
  }

  relationship(
    fromPersonId: EntityId,
    toPersonId: EntityId,
    kind: PersonRelationship["kind"],
  ): PersonRelationship | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM person_relationships WHERE from_person_id=? AND to_person_id=? AND relationship_kind=?",
      )
      .get(fromPersonId, toPersonId, kind);
    return row ? relationship(row) : undefined;
  }

  relationshipsForPerson(personId: EntityId): PersonRelationship[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM person_relationships WHERE from_person_id=? OR to_person_id=? ORDER BY id",
        )
        .all(personId, personId) as any[]
    ).map(relationship);
  }

  upsertMentoringAssignment(value: MentoringAssignment): void {
    this.db
      .prepare(
        `
      INSERT INTO mentoring_assignments
        (id, mentor_person_id, mentee_person_id, team_id, focus, start_date, end_date, progress, status, updated_on, provenance_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mentor_person_id, mentee_person_id, team_id, focus) DO UPDATE SET
        end_date=excluded.end_date, progress=excluded.progress, status=excluded.status, updated_on=excluded.updated_on
    `,
      )
      .run(
        value.id,
        value.mentorPersonId,
        value.menteePersonId,
        value.teamId,
        value.focus,
        value.startDate,
        value.endDate ?? null,
        value.progress,
        value.status,
        value.updatedOn,
        value.provenanceStatus,
      );
  }

  activeMentoringForTeam(teamId: EntityId): MentoringAssignment[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM mentoring_assignments WHERE team_id=? AND status='ACTIVE' ORDER BY id",
        )
        .all(teamId) as any[]
    ).map(mentoring);
  }

  mentoringForPerson(personId: EntityId): MentoringAssignment[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM mentoring_assignments WHERE mentor_person_id=? OR mentee_person_id=? ORDER BY id",
        )
        .all(personId, personId) as any[]
    ).map(mentoring);
  }
}
