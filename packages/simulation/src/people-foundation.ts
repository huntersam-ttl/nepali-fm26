import {
  PeopleFoundationRepository,
  PlayerRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type EntityId,
  type PersonPersonalityProfile,
  type PersonalityArchetype,
  type PersonalityTraits,
  type PersonRelationship,
  type PersonRelationshipKind,
} from "@nepal-football-sim/shared-types";
import { SeededRandom } from "./rng.js";

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
const fromTwenty = (value: number | undefined, fallback: number): number =>
  clamp((value ?? fallback) * 5);

const archetypeFor = (traits: PersonalityTraits): PersonalityArchetype => {
  const scores: Array<[PersonalityArchetype, number]> = [
    [
      "LEADER",
      traits.sociability * 0.3 +
        traits.determination * 0.35 +
        traits.pressureHandling * 0.2 +
        traits.loyalty * 0.15,
    ],
    [
      "PROFESSIONAL",
      traits.professionalism * 0.55 +
        traits.adaptability * 0.2 +
        traits.loyalty * 0.15 +
        traits.pressureHandling * 0.1,
    ],
    [
      "DRIVEN",
      traits.ambition * 0.55 + traits.determination * 0.3 + traits.pressureHandling * 0.15,
    ],
    [
      "ADAPTABLE",
      traits.adaptability * 0.6 + traits.sociability * 0.2 + traits.pressureHandling * 0.2,
    ],
    ["SOCIABLE", traits.sociability * 0.65 + traits.loyalty * 0.2 + traits.adaptability * 0.15],
    [
      "STEADY",
      traits.professionalism * 0.35 + traits.loyalty * 0.3 + traits.pressureHandling * 0.35,
    ],
  ];
  return scores.sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNDEFINED";
};

const generatedTraits = (personId: EntityId, seed: string): PersonalityTraits => {
  const rng = new SeededRandom(`${seed}:personality:${personId}`);
  const value = (base: number): number => clamp(base + (rng.next() - 0.5) * 34);
  return {
    professionalism: value(58),
    ambition: value(55),
    loyalty: value(54),
    sociability: value(55),
    adaptability: value(52),
    pressureHandling: value(50),
    determination: value(57),
  };
};

const profileFor = (
  db: GameDatabase,
  personId: EntityId,
  date: string,
  seed: string,
): PersonPersonalityProfile => {
  const attributes = new PlayerRepository(db).getAttributes(personId);
  const generated = generatedTraits(personId, seed);
  const traits = attributes
    ? {
        professionalism: fromTwenty(
          attributes.mental.professionalism,
          generated.professionalism / 5,
        ),
        ambition: generated.ambition,
        loyalty: generated.loyalty,
        sociability: fromTwenty(attributes.mental.teamwork, generated.sociability / 5),
        adaptability: generated.adaptability,
        pressureHandling: generated.pressureHandling,
        determination: fromTwenty(attributes.mental.determination, generated.determination / 5),
      }
    : generated;
  return {
    personId,
    traits,
    archetype: archetypeFor(traits),
    updatedOn: date,
    provenanceStatus: "SIMULATION_ONLY",
  };
};

/** Initializes stable normalized people profiles and active manager-player edges. */
export const initializePeopleFoundation = (input: {
  db: GameDatabase;
  date: string;
  seed: string;
}): { profilesCreated: number; relationshipsCreated: number } => {
  const people = new PeopleFoundationRepository(input.db);
  const rows = input.db
    .prepare(
      `SELECT DISTINCT p.id FROM persons p JOIN person_roles pr ON pr.person_id=p.id WHERE pr.role IN ('PLAYER','STAFF','MANAGER','AGENT','CHAIRMAN','FEDERATION_OFFICIAL') AND pr.active_to IS NULL ORDER BY p.id`,
    )
    .all() as Array<{ id: EntityId }>;
  let profilesCreated = 0;
  for (const row of rows) {
    if (people.personality(row.id)) continue;
    people.upsertPersonality(profileFor(input.db, row.id, input.date, input.seed));
    profilesCreated += 1;
  }
  const pairs = input.db
    .prepare(
      `SELECT DISTINCT mp.person_id AS manager_person_id, tpa.person_id AS player_person_id FROM manager_contracts mc JOIN manager_profiles mp ON mp.id=mc.manager_profile_id JOIN team_person_assignments tpa ON tpa.team_id=mc.team_id AND tpa.role='PLAYER' AND tpa.ended_on IS NULL WHERE mc.status='ACTIVE' AND mc.team_id IS NOT NULL ORDER BY mp.person_id, tpa.person_id`,
    )
    .all() as Array<{ manager_person_id: EntityId; player_person_id: EntityId }>;
  let relationshipsCreated = 0;
  for (const pair of pairs) {
    if (people.relationship(pair.manager_person_id, pair.player_person_id, "MANAGER_PLAYER"))
      continue;
    const manager = people.personality(pair.manager_person_id)!;
    const player = people.personality(pair.player_person_id)!;
    const affinity = clamp(
      52 + (manager.traits.sociability + player.traits.sociability - 100) * 0.18,
    );
    const trust = clamp(
      50 + (manager.traits.professionalism + player.traits.professionalism - 100) * 0.2,
    );
    const respect = clamp(
      48 + (manager.traits.determination + player.traits.determination - 100) * 0.22,
    );
    people.upsertRelationship({
      id: createStableEntityId(
        "person-relationship",
        `${pair.manager_person_id}:${pair.player_person_id}:MANAGER_PLAYER`,
      ),
      fromPersonId: pair.manager_person_id,
      toPersonId: pair.player_person_id,
      kind: "MANAGER_PLAYER",
      affinity,
      trust,
      respect,
      tension: clamp(100 - (affinity + trust + respect) / 3),
      updatedOn: input.date,
      provenanceStatus: "SIMULATION_ONLY",
    });
    relationshipsCreated += 1;
  }
  return { profilesCreated, relationshipsCreated };
};

export const upsertPersonRelationship = (input: {
  db: GameDatabase;
  fromPersonId: EntityId;
  toPersonId: EntityId;
  kind: PersonRelationshipKind;
  affinity?: number;
  trust?: number;
  respect?: number;
  tension?: number;
  date: string;
}): PersonRelationship => {
  const value: PersonRelationship = {
    id: createStableEntityId(
      "person-relationship",
      `${input.fromPersonId}:${input.toPersonId}:${input.kind}`,
    ),
    fromPersonId: input.fromPersonId,
    toPersonId: input.toPersonId,
    kind: input.kind,
    affinity: clamp(input.affinity ?? 50),
    trust: clamp(input.trust ?? 50),
    respect: clamp(input.respect ?? 50),
    tension: clamp(input.tension ?? 0),
    updatedOn: input.date,
    provenanceStatus: "SIMULATION_ONLY",
  };
  new PeopleFoundationRepository(input.db).upsertRelationship(value);
  return value;
};
