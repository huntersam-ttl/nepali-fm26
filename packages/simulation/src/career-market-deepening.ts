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
  StaffCooperationSummary,
  StaffDepartureAssessment,
  StaffDevelopmentWillingness,
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

const bounded = (value: number): number => Math.max(-5, Math.min(5, Math.round(value)));

/**
 * Personality changes whether a staff member wants to start a course, not
 * whether the course can grant a qualification. Missing personality data is
 * deliberately neutral so existing saves retain their previous behaviour.
 */
export const assessStaffDevelopmentWillingness = (input: {
  professionalism?: number;
  ambition?: number;
  adaptability?: number;
  currentQualification?: number;
  clubSupport?: number;
  managerTrust?: number;
  careerStage?: "EARLY" | "ESTABLISHED" | "LATE";
}): StaffDevelopmentWillingness => {
  const score =
    (input.professionalism ?? 5) * 2 +
    (input.ambition ?? 5) * 2 +
    (input.adaptability ?? 5) * 1.5 +
    (input.clubSupport ?? 5) * 1.5 +
    (input.managerTrust ?? 5) * 0.5 -
    (input.currentQualification ?? 0) * 1.5 +
    (input.careerStage === "EARLY" ? 4 : input.careerStage === "LATE" ? -3 : 0);
  if (score >= 60)
    return {
      decision: "PURSUE",
      label: "HIGH",
      reason: "Development aligns with their professional ambitions.",
    };
  if (score >= 42)
    return {
      decision: "DEFER",
      label: "MODERATE",
      reason: "They are open to development when timing and support improve.",
    };
  return {
    decision: "DECLINE",
    label: "LOW",
    reason: "The course has low priority for them at present.",
  };
};

/** Shared, bounded cooperation assessment for staff-manager decisions and read models. */
export const assessStaffCooperation = (input: {
  trust?: number;
  respect?: number;
  tension?: number;
  personalityCompatibility?: number;
  roleOverlap?: number;
  recentDecisionPressure?: number;
}): StaffCooperationSummary => {
  const score =
    ((input.trust ?? 50) + (input.respect ?? 50)) / 2 +
    ((input.personalityCompatibility ?? 50) - 50) * 0.25 -
    (input.tension ?? 50) * 0.55 -
    (input.roleOverlap ?? 0) * 0.15 -
    (input.recentDecisionPressure ?? 0) * 0.2;
  const label =
    score >= 67
      ? "STRONG"
      : score >= 55
        ? "GOOD"
        : score >= 43
          ? "NEUTRAL"
          : score >= 28
            ? "STRAINED"
            : "CONFLICT";
  const modifier =
    label === "STRONG"
      ? 3
      : label === "GOOD"
        ? 1
        : label === "STRAINED"
          ? -2
          : label === "CONFLICT"
            ? -4
            : 0;
  return {
    label,
    trainingModifier: bounded(modifier),
    recruitmentModifier: bounded(modifier),
    retentionModifier: bounded(modifier),
    reason:
      label === "STRONG" || label === "GOOD"
        ? "Working relationships support cooperation."
        : label === "NEUTRAL"
          ? "Working relationships are professional but unremarkable."
          : "Working relationships are under pressure.",
  };
};

/** Departure assessment is only an assessment; callers still enforce tenure and authority. */
export const assessStaffDeparture = (input: {
  ambition?: number;
  loyalty?: number;
  clubReputation?: number;
  wageStatus?: number;
  managerTrust?: number;
  tension?: number;
  opportunity?: number;
  clubInstability?: number;
  tenureMonths?: number;
  cooldownEligible?: boolean;
}): StaffDepartureAssessment => {
  if (input.cooldownEligible === false || (input.tenureMonths ?? 12) < 6) {
    return {
      decision: "STAY",
      riskLabel: "LOW",
      reason: "Recent appointment stability limits movement.",
    };
  }
  const pressure =
    (input.ambition ?? 5) * 1.2 +
    (input.opportunity ?? 0) * 0.8 +
    (input.clubInstability ?? 0) * 0.7 +
    (input.tension ?? 0) * 0.35 +
    Math.max(0, 50 - (input.clubReputation ?? 50)) * 0.25 +
    Math.max(0, 50 - (input.wageStatus ?? 50)) * 0.2 -
    (input.loyalty ?? 5) * 1.4 -
    (input.managerTrust ?? 50) * 0.12;
  if (pressure >= 42)
    return {
      decision: "LEAVE",
      riskLabel: "HIGH",
      reason: "A stronger opportunity and sustained pressure outweigh current loyalty.",
    };
  if (pressure >= 24)
    return {
      decision: "CONSIDER",
      riskLabel: "MODERATE",
      reason: "Some career or relationship pressure could prompt a move.",
    };
  return {
    decision: "STAY",
    riskLabel: "LOW",
    reason: "Loyalty and current conditions support staying.",
  };
};

export const backroomSummary = (input: {
  clubId: EntityId;
  activeStaff: number;
  relationships: PersonRelationship[];
}): BackroomSummary => {
  const relevant = input.relationships.filter(
    (relationship) => relationship.kind === "STAFF_MANAGER" || relationship.kind === "STAFF_PLAYER",
  );
  const aligned = relevant.filter((relationship) =>
    ["STRONG", "GOOD"].includes(
      assessStaffCooperation({
        trust: relationship.trust,
        respect: relationship.respect,
        tension: relationship.tension,
      }).label,
    ),
  ).length;
  const strained = relevant.filter((relationship) =>
    ["STRAINED", "CONFLICT"].includes(
      assessStaffCooperation({
        trust: relationship.trust,
        respect: relationship.respect,
        tension: relationship.tension,
      }).label,
    ),
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
