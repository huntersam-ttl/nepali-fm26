import type {
  EntityId,
  JobApplicationStatus,
  ManagerJobMarketReadModel,
  PersonPersonalityProfile,
  PersonRelationship,
  StaffJobCandidateInput,
  StaffJobDecision,
  StaffPersonalityClues,
  BackroomSummary,
} from "@nepal-football-sim/shared-types";

const band = (value: number): "LOW" | "STEADY" | "HIGH" =>
  value >= 8 ? "HIGH" : value <= 4 ? "LOW" : "STEADY";
export const staffPersonalityClues = (
  profile?: PersonPersonalityProfile,
): StaffPersonalityClues => ({
  professionalism: band(profile?.traits.professionalism ?? 5),
  ambition:
    (profile?.traits.ambition ?? 5) >= 8
      ? "HIGH"
      : (profile?.traits.ambition ?? 5) <= 4
        ? "LOW"
        : "MODERATE",
  loyalty: band(profile?.traits.loyalty ?? 5),
  adaptability: band(profile?.traits.adaptability ?? 5),
});

export const managerJobMarketStage = (
  status: JobApplicationStatus,
): ManagerJobMarketReadModel["stage"] =>
  (
    ({
      PENDING: "APPLICATION",
      OFFERED: "OFFER",
      ACCEPTED: "ACCEPTED",
      DECLINED: "REJECTED",
      REJECTED: "REJECTED",
      WITHDRAWN: "WITHDRAWN",
    }) satisfies Record<JobApplicationStatus, ManagerJobMarketReadModel["stage"]>
  )[status];

export const managerJobMarketReadModel = (input: {
  vacancyId: EntityId;
  managerProfileId: EntityId;
  status: JobApplicationStatus;
  fitScore: number;
  rationale?: string[];
}): ManagerJobMarketReadModel => ({
  vacancyId: input.vacancyId,
  managerProfileId: input.managerProfileId,
  status: input.status,
  stage: managerJobMarketStage(input.status),
  fitLabel: input.fitScore >= 70 ? "STRONG" : input.fitScore >= 50 ? "POSSIBLE" : "WEAK",
  rationale: input.rationale ?? [],
  humanDecisionRequired: input.status === "OFFERED",
});

export const decideStaffJob = (input: StaffJobCandidateInput): StaffJobDecision => {
  const personality = input.personality?.traits;
  const wageDelta = input.offeredSalaryMinor - (input.currentSalaryMinor ?? 0);
  const score =
    input.clubFit * 0.45 +
    input.jobSecurity * 0.2 +
    Math.min(20, Math.max(-20, wageDelta / 20_000)) +
    (personality?.ambition ?? 5) * 1.2 +
    (personality?.adaptability ?? 5) * 0.8 +
    (personality?.loyalty ?? 5) * (input.currentAppointment ? -0.8 : 0.3);
  return score >= 62 ? "ACCEPT" : score >= 48 ? "WAIT" : "DECLINE";
};

export const backroomSummary = (input: {
  clubId: EntityId;
  activeStaff: number;
  relationships: PersonRelationship[];
}): BackroomSummary => {
  const relevant = input.relationships.filter(
    (relationship) => relationship.kind === "STAFF_MANAGER" || relationship.kind === "STAFF_PLAYER",
  );
  const aligned = relevant.filter(
    (relationship) => relationship.trust >= 60 && relationship.tension <= 40,
  ).length;
  const strained = relevant.filter(
    (relationship) => relationship.tension >= 60 || relationship.trust <= 40,
  ).length;
  const atmosphere =
    strained >= 2 && strained > aligned
      ? "CONFLICT"
      : strained > aligned
        ? "STRAINED"
        : aligned > strained
          ? "ALIGNED"
          : "NEUTRAL";
  return {
    clubId: input.clubId,
    atmosphere,
    activeStaff: input.activeStaff,
    alignedRelationships: aligned,
    strainedRelationships: strained,
    clue:
      atmosphere === "ALIGNED"
        ? "The backroom appears aligned."
        : atmosphere === "CONFLICT"
          ? "Several backroom relationships need attention."
          : atmosphere === "STRAINED"
            ? "Some backroom relationships are under pressure."
            : "The backroom is broadly neutral.",
  };
};
