import {
  CareerWorldRepository,
  PeopleFoundationRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import type {
  CoachingIdentity,
  CoachingJobMarketListing,
  JobVacancy,
  ManagerAttributeSet,
  ManagerProfile,
  PersonRelationship,
} from "@nepal-football-sim/shared-types";
import { listVacancies } from "./manager-career-world.js";

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
const average = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 50;

const scoreLabels = (attributes: ManagerAttributeSet): Array<[string, number]> => [
  ["tactical knowledge", attributes.tactical.tacticalKnowledge],
  ["match management", attributes.tactical.matchManagement],
  ["attacking coaching", attributes.coaching.attackingCoaching],
  ["defensive coaching", attributes.coaching.defensiveCoaching],
  ["youth development", attributes.coaching.youthDevelopment],
  ["man management", attributes.people.manManagement],
  ["motivation", attributes.people.motivation],
  ["recruitment judgement", attributes.recruitment.playerJudgement],
];

const managerPlayerRelationships = (relationships: PersonRelationship[], personId: string) =>
  relationships.filter(
    (relationship) =>
      relationship.kind === "MANAGER_PLAYER" && relationship.fromPersonId === personId,
  );

/** Builds a read model from canonical manager, personality, and relationship records. */
export const buildCoachingIdentity = (
  db: GameDatabase,
  managerProfile: ManagerProfile,
): CoachingIdentity => {
  const people = new PeopleFoundationRepository(db);
  const personality = people.personality(managerProfile.personId);
  const relationships = managerPlayerRelationships(
    people.relationshipsForPerson(managerProfile.personId),
    managerProfile.personId,
  );
  const ranked = scoreLabels(managerProfile.attributes).sort((a, b) => b[1] - a[1]);
  const strengths = ranked.slice(0, 3).map(([label]) => label);
  const developmentFocus = ranked
    .slice(-2)
    .reverse()
    .map(([label]) => label);
  return {
    managerProfileId: managerProfile.id,
    personId: managerProfile.personId,
    preferredStyle: managerProfile.preferredStyle,
    reputationProfile: managerProfile.reputationProfile,
    reputation: clamp(managerProfile.attributes.personality.reputation * 5),
    archetype: personality?.archetype ?? "UNDEFINED",
    strengths,
    developmentFocus,
    managerPlayerRelationships: relationships.length,
    averagePlayerTrust: Math.round(
      average(relationships.map((relationship) => relationship.trust)),
    ),
    averagePlayerTension: Math.round(
      average(relationships.map((relationship) => relationship.tension)),
    ),
    provenanceStatus: "SIMULATION_ONLY",
  };
};

const expectationFit = (attributes: ManagerAttributeSet, expectation: string): number => {
  switch (expectation) {
    case "TITLE_CHALLENGE":
      return attributes.tactical.matchManagement * 0.5 + attributes.people.motivation * 0.5;
    case "PROMOTION":
      return (
        attributes.tactical.tacticalKnowledge * 0.45 + attributes.coaching.attackingCoaching * 0.55
      );
    case "YOUTH_DEVELOPMENT":
      return attributes.coaching.youthDevelopment;
    case "PLAYER_TRADING":
      return attributes.recruitment.playerJudgement;
    case "SURVIVE":
      return attributes.people.manManagement * 0.5 + attributes.tactical.adaptability * 0.5;
    default:
      return attributes.people.manManagement * 0.5 + attributes.coaching.mentalCoaching * 0.5;
  }
};

/** Pure, bounded fit score so callers can preview vacancies without mutating applications. */
export const coachingJobFit = (
  managerProfile: ManagerProfile,
  vacancy: JobVacancy,
  identity?: CoachingIdentity,
): { eligible: boolean; fitScore: number; rationale: string[] } => {
  const demanding =
    vacancy.boardExpectation === "TITLE_CHALLENGE" || vacancy.boardExpectation === "PROMOTION";
  const reputable = ["LOCAL_RESPECTED", "FORMER_PLAYER", "EDUCATED_COACH"].includes(
    managerProfile.reputationProfile,
  );
  const eligible = !demanding || reputable || managerProfile.attributes.personality.reputation >= 8;
  const score = clamp(
    expectationFit(managerProfile.attributes, vacancy.boardExpectation) * 0.65 +
      managerProfile.attributes.personality.reputation * 5 * 0.2 +
      (identity ? identity.averagePlayerTrust * 0.15 : 7.5),
  );
  const rationale = [
    `${vacancy.boardExpectation.replaceAll("_", " ").toLowerCase()} fit ${Math.round(expectationFit(managerProfile.attributes, vacancy.boardExpectation))}/20`,
    `reputation ${managerProfile.attributes.personality.reputation}/20`,
  ];
  if (identity && identity.averagePlayerTension > 65)
    rationale.push("existing player tensions reduce fit");
  if (!eligible) rationale.push("reputation threshold not met");
  return { eligible, fitScore: score, rationale };
};

/** Ranks existing open vacancies; applications and vacancy state remain owned by CareerWorldRepository. */
export const rankCoachingVacancies = (
  db: GameDatabase,
  managerProfile: ManagerProfile,
): CoachingJobMarketListing[] => {
  const identity = buildCoachingIdentity(db, managerProfile);
  return listVacancies(db, managerProfile)
    .map((listing) => {
      const fit = coachingJobFit(managerProfile, listing.vacancy, identity);
      return {
        vacancyId: listing.vacancy.id,
        teamId: listing.vacancy.teamId,
        boardExpectation: listing.vacancy.boardExpectation,
        eligible: fit.eligible,
        fitScore: fit.fitScore,
        rationale: fit.rationale,
      };
    })
    .sort(
      (a, b) => b.fitScore - a.fitScore || String(a.vacancyId).localeCompare(String(b.vacancyId)),
    );
};

export const openCoachingVacancies = (db: GameDatabase): JobVacancy[] =>
  new CareerWorldRepository(db).openVacancies();
