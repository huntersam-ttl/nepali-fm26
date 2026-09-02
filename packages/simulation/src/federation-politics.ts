import {
  createStableEntityId,
  type EntityId,
  type Federation,
  type FederationCoalitionState,
  type FederationCandidacyAssessment,
  type FederationElectionCandidate,
  type FederationElectionCycle,
  type FederationElectionResult,
  type FederationGovernanceProposal,
  type FederationManifestoCommitment,
  type FederationStrategicPriority,
  type Person,
} from "@nepal-football-sim/shared-types";
import {
  CareerIdentityRepository,
  FederationGovernancePhaseBRepository,
  FederationGovernanceRepository,
  FederationPoliticsRepository,
  EventRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { SeededRandom } from "./rng.js";
import { proposeCompetitionReform, createFederationProject } from "./federation-governance.js";
import { activateManifestoPolicies, campaignSupportEstimate } from "./federation-policy.js";

const status = "SIMULATION_ONLY" as const;
const addYears = (date: string, years: number): string =>
  `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;
const addDays = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string): number =>
  Math.max(
    0,
    Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000),
  );
const federation = (db: GameDatabase, id: EntityId): Federation => {
  const row = db
    .prepare("SELECT id,country_id,name,founded_year FROM federations WHERE id=?")
    .get(id) as any;
  if (!row) throw new Error("Federation not found");
  return {
    id: row.id,
    countryId: row.country_id,
    name: row.name,
    foundedYear: row.founded_year ?? undefined,
  };
};
const nepaliFederationIds = (db: GameDatabase): Set<EntityId> =>
  new Set(
    (
      db
        .prepare(
          "SELECT f.id FROM federations f JOIN countries c ON c.id=f.country_id WHERE c.iso_code IN ('NP','NPL')",
        )
        .all() as Array<{ id: EntityId }>
    ).map((row) => row.id),
  );

export const assessFederationCandidacy = (
  db: GameDatabase,
  input: { personId: EntityId; date: string },
): FederationCandidacyAssessment => {
  const identity = new CareerIdentityRepository(db).get(input.personId);
  const starts = (
    db
      .prepare(
        "SELECT contract_start AS date FROM manager_contracts WHERE person_id=? UNION ALL SELECT start_date AS date FROM club_ownership_stakes WHERE holder_type='PERSON' AND holder_id=? ORDER BY date",
      )
      .all(input.personId, input.personId) as Array<{ date?: string }>
  )
    .map((row) => row.date)
    .filter((date): date is string => Boolean(date));
  const careerSeasons = starts[0] ? Math.floor(daysBetween(starts[0], input.date) / 365) : 0;
  const reputation =
    Math.round(
      ((identity?.reputation.sporting ?? 0) +
        (identity?.reputation.businessOwnership ?? 0) +
        (identity?.reputation.governance ?? 0) +
        (identity?.reputation.nationalInternational ?? 0)) *
        10,
    ) / 10;
  const reasons: string[] = [];
  if (careerSeasons < 3) reasons.push(`Requires 3 seasons in Nepal football (${careerSeasons}/3).`);
  if (reputation < 45) reasons.push(`Requires game reputation of 45 (${reputation}/45).`);
  const nepaliIds = nepaliFederationIds(db);
  const cycle = new FederationPoliticsRepository(db)
    .cycles()
    .find(
      (item) =>
        nepaliIds.has(item.federationId) &&
        item.status !== "COMPLETED" &&
        item.nominationStart <= input.date &&
        input.date < item.electionDate,
    );
  if (!cycle) reasons.push("No election is currently accepting nominations.");
  const candidate = cycle
    ? new FederationPoliticsRepository(db)
        .candidates(cycle.id)
        .find((item) => item.personId === input.personId)
    : undefined;
  return {
    eligible: reasons.length === 0,
    reasons,
    careerSeasons,
    reputation,
    nextElectionDate: cycle?.electionDate,
    candidateId: candidate?.id,
  };
};

export const declareFederationElectionCandidacy = (
  db: GameDatabase,
  input: { personId: EntityId; date: string; seed: string },
): FederationCandidacyAssessment => {
  let assessment = assessFederationCandidacy(db, input);
  if (!assessment.eligible) throw new Error(assessment.reasons.join(" "));
  const politics = new FederationPoliticsRepository(db);
  const nepaliIds = nepaliFederationIds(db);
  let cycle = politics
    .cycles()
    .find(
      (item) =>
        nepaliIds.has(item.federationId) &&
        item.status !== "COMPLETED" &&
        item.nominationStart <= input.date &&
        input.date < item.electionDate,
    );
  if (!cycle) throw new Error("No election is currently accepting nominations.");
  generateFederationCandidates(db, {
    cycleId: cycle.id,
    federationId: cycle.federationId,
    date: input.date,
    seed: input.seed,
  });
  const identity = new CareerIdentityRepository(db).get(input.personId)!;
  const reputation = Math.min(9, Math.max(3, assessment.reputation / 15));
  const candidate: FederationElectionCandidate = {
    id: createStableEntityId("federation-election-candidate", `${cycle.id}:${input.personId}`),
    cycleId: cycle.id,
    federationId: cycle.federationId,
    personId: input.personId,
    reputation: Number(reputation.toFixed(2)),
    supportBase: Number(Math.min(8, 3.5 + assessment.reputation / 30).toFixed(2)),
    committeeInfluence: Number(
      Math.min(0.65, 0.25 + (identity.reputation.governance ?? 0) / 100).toFixed(2),
    ),
    votingBlocs: { clubs: 0.5, districts: 0.5, regions: 0.5 },
    manifesto: {
      CLUB_PROFESSIONALISATION: 0.7,
      YOUTH_ELITE_DEVELOPMENT: 0.7,
      COACH_EDUCATION: 0.65,
    },
    incumbent: false,
    status: "ELIGIBLE",
    provenanceStatus: status,
  };
  politics.upsertCandidate(candidate);
  assessment = assessFederationCandidacy(db, input);
  return { ...assessment, candidateId: candidate.id };
};

export const createFederationElectionCycle = (
  db: GameDatabase,
  input: { federationId: EntityId; electionDate: string },
): FederationElectionCycle => {
  const cycle: FederationElectionCycle = {
    id: createStableEntityId(
      "federation-election-cycle",
      `${input.federationId}:${input.electionDate}`,
    ),
    federationId: input.federationId,
    nominationStart: addDays(input.electionDate, -90),
    electionDate: input.electionDate,
    termYears: 4,
    status: "NOMINATIONS",
    provenanceStatus: status,
  };
  new FederationPoliticsRepository(db).upsertCycle(cycle);
  return cycle;
};

const ensurePerson = (
  db: GameDatabase,
  id: EntityId,
  name: string,
  countryId: EntityId,
  date: string,
): Person => {
  const world = new WorldRepository(db);
  const existing = world.getPerson(id);
  if (existing) return existing;
  const person: Person = {
    id,
    fullName: name,
    displayName: name,
    dateOfBirth: "1968-01-01",
    nationalityCountryId: countryId,
    genderPresentation: "unknown",
    languages: ["Nepali", "English"],
  };
  world.insertPerson(person);
  world.insertPersonRole({
    id: createStableEntityId("person-role", `${id}:FEDERATION_OFFICIAL`),
    personId: id,
    role: "FEDERATION_OFFICIAL",
    activeFrom: date,
  });
  return person;
};

export const generateFederationCandidates = (
  db: GameDatabase,
  input: { cycleId: EntityId; federationId: EntityId; date: string; seed: string },
): FederationElectionCandidate[] => {
  const politics = new FederationPoliticsRepository(db);
  const existing = politics.candidates(input.cycleId);
  if (existing.length) return existing;
  const fed = federation(db, input.federationId);
  const governance = new FederationGovernanceRepository(db);
  const profile = governance.profile(input.federationId);
  const active = governance
    .leadershipTenures(input.federationId)
    .find((item) => item.role === "FEDERATION_PRESIDENT" && item.status === "ACTIVE");
  const clubCount = (
    db.prepare("SELECT COUNT(*) AS count FROM clubs WHERE country_id=?").get(fed.countryId) as {
      count: number;
    }
  ).count;
  const rng = new SeededRandom(`${input.seed}:election:${input.cycleId}`);
  const manifests: Array<Record<string, number>> = [
    {
      NATIONAL_TEAM_PERFORMANCE: 0.85,
      YOUTH_ELITE_DEVELOPMENT: 0.62,
      CLUB_PROFESSIONALISATION: 0.48,
    },
    { GRASSROOTS_EXPANSION: 0.86, WOMENS_FOOTBALL: 0.7, COACH_EDUCATION: 0.64 },
    { INFRASTRUCTURE: 0.78, COMMERCIAL_GROWTH: 0.72, INTERNATIONAL_EXPOSURE: 0.6 },
  ];
  return manifests.map((manifesto, index) => {
    const isIncumbent = Boolean(active && index === 0);
    const personId = isIncumbent
      ? active!.personId
      : createStableEntityId("person", `federation-candidate:${input.cycleId}:${index}`);
    ensurePerson(
      db,
      personId,
      isIncumbent ? "Incumbent Federation President" : `Federation Candidate ${index + 1}`,
      fed.countryId,
      input.date,
    );
    const candidate: FederationElectionCandidate = {
      id: createStableEntityId("federation-election-candidate", `${input.cycleId}:${index}`),
      cycleId: input.cycleId,
      federationId: input.federationId,
      personId,
      reputation: Number(
        Math.min(
          9,
          Math.max(3, (profile?.reputation ?? 5) + (isIncumbent ? 0.35 : rng.next() * 1.2 - 0.25)),
        ).toFixed(2),
      ),
      supportBase: Number(
        Math.min(9, Math.max(2, 3.5 + clubCount * 0.04 + rng.next() * 1.8)).toFixed(2),
      ),
      committeeInfluence: Number((isIncumbent ? 0.72 : 0.35 + rng.next() * 0.3).toFixed(2)),
      votingBlocs: {
        clubs: Number((0.35 + rng.next() * 0.4).toFixed(2)),
        districts: Number((0.3 + rng.next() * 0.45).toFixed(2)),
        regions: Number((0.3 + rng.next() * 0.45).toFixed(2)),
      },
      manifesto,
      incumbent: isIncumbent,
      status: "ELIGIBLE",
      provenanceStatus: status,
    };
    politics.upsertCandidate(candidate);
    return candidate;
  });
};

const priorityMap: Record<string, FederationStrategicPriority> = {
  NATIONAL_TEAM_PERFORMANCE: "NATIONAL_TEAM_PERFORMANCE",
  YOUTH_ELITE_DEVELOPMENT: "YOUTH_ELITE_DEVELOPMENT",
  CLUB_PROFESSIONALISATION: "CLUB_PROFESSIONALISATION",
  GRASSROOTS_EXPANSION: "GRASSROOTS_EXPANSION",
  WOMENS_FOOTBALL: "WOMENS_FOOTBALL",
  COACH_EDUCATION: "COACH_EDUCATION",
  INFRASTRUCTURE: "INFRASTRUCTURE",
  COMMERCIAL_GROWTH: "COMMERCIAL_GROWTH",
  INTERNATIONAL_EXPOSURE: "INTERNATIONAL_EXPOSURE",
};

export const runFederationElection = (
  db: GameDatabase,
  input: { cycleId: EntityId; date: string; seed: string },
): FederationElectionResult => {
  const politics = new FederationPoliticsRepository(db);
  const existingResult = politics.results().find((item) => item.cycleId === input.cycleId);
  if (existingResult) return existingResult;
  const cycle = politics.cycles().find((item) => item.id === input.cycleId);
  if (!cycle) throw new Error("Election cycle not found");
  const candidates = generateFederationCandidates(db, {
    cycleId: cycle.id,
    federationId: cycle.federationId,
    date: input.date,
    seed: input.seed,
  }).filter((item) => item.status === "ELIGIBLE");
  if (!candidates.length) throw new Error("No eligible federation candidates");
  const governance = new FederationGovernanceRepository(db);
  const profile = governance.profile(cycle.federationId);
  const account = governance.financialAccount(cycle.federationId);
  const scores = candidates.map((candidate) => ({
    candidate,
    score:
      candidate.supportBase * 0.42 +
      candidate.reputation * 0.2 +
      candidate.committeeInfluence * 1.7 +
      Object.values(candidate.votingBlocs).reduce((sum, value) => sum + value, 0) * 0.8 +
      campaignSupportEstimate({ candidate }) * 0.04 +
      (candidate.incumbent
        ? (profile?.governanceStability ?? 5) * 0.18 +
          (account?.financialHealth === "INSOLVENT" ? -1.4 : 0.5)
        : 0),
  }));
  scores.sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
  const total = scores.reduce((sum, item) => sum + Math.max(0.1, item.score), 0);
  const votes = Object.fromEntries(
    scores.map((item) => [
      item.candidate.id,
      Number((Math.max(0.1, item.score) / total).toFixed(6)),
    ]),
  );
  const winner = scores[0].candidate;
  for (const candidate of candidates)
    politics.upsertCandidate({
      ...candidate,
      status: candidate.id === winner.id ? "ELECTED" : "DEFEATED",
    });
  for (const tenure of governance
    .leadershipTenures(cycle.federationId)
    .filter(
      (item) =>
        item.role === "FEDERATION_PRESIDENT" &&
        (item.status === "ACTIVE" || item.status === "INTERIM"),
    ))
    governance.upsertLeadershipTenure({ ...tenure, termEnd: input.date, status: "FORMER" });
  governance.upsertLeadershipTenure({
    id: createStableEntityId(
      "federation-leadership",
      `${cycle.federationId}:${winner.personId}:${input.date}`,
    ),
    personId: winner.personId,
    federationId: cycle.federationId,
    role: "FEDERATION_PRESIDENT",
    termStart: input.date,
    termEnd: addYears(input.date, cycle.termYears),
    status: "ACTIVE",
    provenanceStatus: status,
  });
  db.prepare(
    "UPDATE staff_appointments SET employment_status='ENDED', end_date=? WHERE federation_id=? AND role='FEDERATION_PRESIDENT' AND employment_status='ACTIVE'",
  ).run(input.date, cycle.federationId);
  db.prepare(
    "INSERT OR IGNORE INTO staff_appointments (id,person_id,organisation_type,federation_id,role,start_date,employment_status) VALUES (?,?,?,?,?,?,?)",
  ).run(
    createStableEntityId(
      "staff-appointment",
      `${winner.personId}:${cycle.federationId}:federation-president:${input.date}`,
    ),
    winner.personId,
    "FEDERATION",
    cycle.federationId,
    "FEDERATION_PRESIDENT",
    input.date,
    "ACTIVE",
  );
  const result: FederationElectionResult = {
    id: createStableEntityId("federation-election-result", cycle.id),
    cycleId: cycle.id,
    federationId: cycle.federationId,
    winnerCandidateId: winner.id,
    electedPersonId: winner.personId,
    votes,
    decidedAt: input.date,
    status: "COMPLETED",
    provenanceStatus: status,
  };
  politics.upsertResult(result);
  politics.upsertCycle({ ...cycle, status: "COMPLETED" });
  const electionEventId = createStableEntityId(
    "historical-event",
    `federation-election:${cycle.id}`,
  );
  if (!db.prepare("SELECT 1 FROM historical_events WHERE id=?").get(electionEventId)) {
    new EventRepository(db).insertHistoricalEvent({
      id: electionEventId,
      occurredOn: input.date,
      eventType: "FEDERATION_ELECTION_COMPLETED",
      involvedEntities: [
        { id: cycle.federationId, type: "federation" },
        { id: winner.personId, type: "person" },
      ],
      title: "Federation election completed",
      data: { cycleId: cycle.id, winnerCandidateId: winner.id, electedPersonId: winner.personId },
      importance: "high",
      scope: "federation",
    });
  }
  const activePriorities = governance
    .strategyPriorities(cycle.federationId)
    .filter((item) => item.status === "ACTIVE");
  for (const priority of activePriorities)
    governance.upsertStrategyPriority({ ...priority, effectiveTo: input.date, status: "INACTIVE" });
  for (const [key, weight] of Object.entries(winner.manifesto)) {
    const priority = priorityMap[key];
    if (!priority) continue;
    governance.upsertStrategyPriority({
      id: createStableEntityId(
        "federation-strategy",
        `${cycle.federationId}:${priority}:${input.date}`,
      ),
      federationId: cycle.federationId,
      priority,
      weight,
      effectiveFrom: input.date,
      status: "ACTIVE",
      provenanceStatus: status,
    });
  }
  const phaseB = new FederationGovernancePhaseBRepository(db);
  const committees = governance.committees(cycle.federationId);
  for (const member of phaseB
    .memberships(cycle.federationId)
    .filter((item) => item.status === "ACTIVE"))
    phaseB.upsertMembership({ ...member, endsOn: input.date, status: "FORMER" });
  for (const committee of committees)
    phaseB.upsertMembership({
      id: createStableEntityId(
        "federation-committee-membership",
        `${committee.id}:${winner.personId}:${input.date}`,
      ),
      federationId: cycle.federationId,
      committeeId: committee.id,
      personId: winner.personId,
      influence: 0.7,
      startsOn: input.date,
      status: "ACTIVE",
      provenanceStatus: status,
    });
  for (const [key, targetValue] of Object.entries(winner.manifesto)) {
    phaseB.upsertCommitment({
      id: createStableEntityId("federation-manifesto", `${cycle.id}:${key}`),
      federationId: cycle.federationId,
      presidentPersonId: winner.personId,
      electionCycleId: cycle.id,
      policyArea: key,
      promise: `Advance ${key.toLowerCase().replaceAll("_", " ")}`,
      targetValue,
      progress: 0,
      dueDate: addYears(input.date, cycle.termYears),
      status: "OPEN",
      lastUpdated: input.date,
      provenanceStatus: status,
    });
  }
  activateManifestoPolicies(
    db,
    phaseB
      .commitments(cycle.federationId)
      .filter((commitment) => commitment.electionCycleId === cycle.id),
  );
  phaseB.upsertCoalition({
    federationId: cycle.federationId,
    presidentPersonId: winner.personId,
    confidence: 0.68,
    coalitionSupport: 0.62,
    noConfidenceThreshold: 0.3,
    lastUpdated: input.date,
    status: "CONFIDENT",
    provenanceStatus: status,
  });
  return result;
};

export const advanceFederationElections = (
  db: GameDatabase,
  input: { date: string; seed: string },
): FederationElectionResult[] => {
  const politics = new FederationPoliticsRepository(db);
  const results: FederationElectionResult[] = [];
  for (const cycle of politics
    .cycles()
    .filter((item) => item.status !== "COMPLETED" && item.electionDate <= input.date))
    results.push(
      runFederationElection(db, { cycleId: cycle.id, date: cycle.electionDate, seed: input.seed }),
    );
  return results;
};

/** Keeps the existing election lifecycle reachable during normal world progression. */
export const ensureFederationLeadershipContinuity = (
  db: GameDatabase,
  input: { date: string; seed: string },
): FederationElectionResult[] => {
  const governance = new FederationGovernanceRepository(db);
  const politics = new FederationPoliticsRepository(db);
  for (const federation of db
    .prepare("SELECT id,country_id FROM federations ORDER BY id")
    .all() as Array<{ id: EntityId; country_id: EntityId }>) {
    let active = governance
      .leadershipTenures(federation.id)
      .find((item) => item.role === "FEDERATION_PRESIDENT" && item.status === "ACTIVE");
    if (active?.termEnd && active.termEnd <= input.date) {
      governance.upsertLeadershipTenure({ ...active, status: "FORMER" });
      active = undefined;
    }
    const cycles = politics.cycles(federation.id);
    const pending = cycles.find((cycle) => cycle.status !== "COMPLETED");
    if (!pending) {
      const electionDate = active?.termEnd ?? addDays(input.date, 30);
      createFederationElectionCycle(db, { federationId: federation.id, electionDate });
    }
    const nextCycle = politics.cycles(federation.id).find((cycle) => cycle.status !== "COMPLETED");
    if (
      !active &&
      nextCycle &&
      !governance
        .leadershipTenures(federation.id)
        .some((item) => item.role === "FEDERATION_PRESIDENT" && item.status === "INTERIM")
    ) {
      const interimId = createStableEntityId(
        "person",
        `federation-interim:${federation.id}:${nextCycle.id}`,
      );
      const interim = ensurePerson(
        db,
        interimId,
        "Simulation Federation Interim",
        federation.country_id,
        input.date,
      );
      governance.upsertLeadershipTenure({
        id: createStableEntityId(
          "federation-leadership",
          `${federation.id}:${interim.id}:${nextCycle.id}:interim`,
        ),
        personId: interim.id,
        federationId: federation.id,
        role: "FEDERATION_PRESIDENT",
        termStart: input.date,
        termEnd: nextCycle.electionDate,
        status: "INTERIM",
        provenanceStatus: status,
      });
    }
  }
  return advanceFederationElections(db, input);
};

const committeeFor = (
  area: FederationGovernanceProposal["policyArea"],
): FederationGovernanceProposal["targetCommittee"] =>
  ({
    COMPETITION: "COMPETITION_COMMITTEE",
    DEVELOPMENT: "TECHNICAL_COMMITTEE",
    INFRASTRUCTURE: "FINANCE_COMMITTEE",
    GRANTS: "FINANCE_COMMITTEE",
    COMMERCIAL: "COMMERCIAL_COMMITTEE",
  })[area] as FederationGovernanceProposal["targetCommittee"];

export const createFederationGovernanceProposal = (
  db: GameDatabase,
  input: Omit<
    FederationGovernanceProposal,
    "id" | "targetCommittee" | "status" | "votes" | "provenanceStatus"
  >,
): FederationGovernanceProposal => {
  const governance = new FederationGovernanceRepository(db);
  const active = governance
    .leadershipTenures(input.federationId)
    .some(
      (item) =>
        item.personId === input.proposedByPersonId &&
        item.role === "FEDERATION_PRESIDENT" &&
        item.status === "ACTIVE",
    );
  if (!active) throw new Error("Only the active president may submit a governance proposal");
  const proposal: FederationGovernanceProposal = {
    ...input,
    id: createStableEntityId(
      "federation-governance-proposal",
      `${input.federationId}:${input.proposedAt}:${input.title}`,
    ),
    targetCommittee: committeeFor(input.policyArea),
    status: "PROPOSED",
    votes: {},
    provenanceStatus: status,
  };
  const repo = new FederationGovernancePhaseBRepository(db);
  repo.upsertProposal(proposal);
  repo.event({
    id: createStableEntityId("federation-governance-event", proposal.id),
    federationId: input.federationId,
    date: input.proposedAt,
    eventType: "PROPOSAL",
    subjectId: proposal.id,
    summary: proposal.title,
    payload: { policyArea: proposal.policyArea },
    provenanceStatus: status,
  });
  return proposal;
};

/**
 * Role-facing command adapter for the already-authoritative proposal service.
 * The active presidency check remains in createFederationGovernanceProposal;
 * this boundary only rejects non-presidential callers and context-only targets.
 */
export const submitFederationGovernanceProposalCommand = (
  db: GameDatabase,
  input: Omit<
    FederationGovernanceProposal,
    "id" | "targetCommittee" | "status" | "votes" | "provenanceStatus"
  > & {
    callerRole: "MANAGER" | "CHAIRMAN_OWNER" | "FEDERATION_PRESIDENT";
  },
): FederationGovernanceProposal => {
  if (input.callerRole !== "FEDERATION_PRESIDENT") {
    throw new Error("Only the federation president may submit a governance proposal");
  }
  const country = db
    .prepare(
      "SELECT co.iso_code FROM federations f JOIN countries co ON co.id = f.country_id WHERE f.id = ?",
    )
    .get(input.federationId) as { iso_code?: string } | undefined;
  if (!country || !["NP", "NPL"].includes(country.iso_code ?? "")) {
    throw new Error("Governance commands are unavailable for context-only federations");
  }
  return createFederationGovernanceProposal(db, input);
};

export const reviewFederationGovernanceProposal = (
  db: GameDatabase,
  proposalId: EntityId,
  date: string,
): FederationGovernanceProposal => {
  const repo = new FederationGovernancePhaseBRepository(db);
  const proposal = repo.proposals().find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "PROPOSED")
    throw new Error("Proposal is not awaiting committee review");
  const reviewed = { ...proposal, status: "COMMITTEE_REVIEW" as const, reviewedAt: date };
  repo.upsertProposal(reviewed);
  repo.event({
    id: createStableEntityId("federation-governance-event", `${proposal.id}:review`),
    federationId: proposal.federationId,
    date,
    eventType: "COMMITTEE_REVIEW",
    subjectId: proposal.id,
    summary: "Committee review opened",
    payload: { committee: proposal.targetCommittee },
    provenanceStatus: status,
  });
  return reviewed;
};

export const decideFederationGovernanceProposal = (
  db: GameDatabase,
  proposalId: EntityId,
  input: { date: string; seed: string; approve?: boolean },
): FederationGovernanceProposal => {
  const repo = new FederationGovernancePhaseBRepository(db);
  const proposal = repo.proposals().find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "COMMITTEE_REVIEW")
    throw new Error("Proposal must complete committee review first");
  const governance = new FederationGovernanceRepository(db);
  const committee = governance
    .committees(proposal.federationId)
    .find((item) => item.committeeType === proposal.targetCommittee);
  const members = committee
    ? repo
        .memberships(proposal.federationId, committee.id)
        .filter((item) => item.status === "ACTIVE")
    : [];
  const support = members.length
    ? members.reduce((sum, member) => sum + member.influence, 0) / members.length
    : 0.5;
  const approve = input.approve ?? support >= 0.5;
  const decided = {
    ...proposal,
    decidedAt: input.date,
    status: approve ? ("APPROVED" as const) : ("REJECTED" as const),
    votes: { committeeSupport: Number(support.toFixed(3)), approve: approve ? 1 : 0 },
  };
  repo.upsertProposal(decided);
  repo.event({
    id: createStableEntityId("federation-governance-event", `${proposal.id}:decision`),
    federationId: proposal.federationId,
    date: input.date,
    eventType: "POLICY_DECISION",
    subjectId: proposal.id,
    summary: approve ? "Committee approved proposal" : "Committee rejected proposal",
    payload: decided.votes,
    provenanceStatus: status,
  });
  return decided;
};

export const implementFederationGovernanceProposal = (
  db: GameDatabase,
  proposalId: EntityId,
  date: string,
): FederationGovernanceProposal => {
  const repo = new FederationGovernancePhaseBRepository(db);
  const proposal = repo.proposals().find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "APPROVED")
    throw new Error("Only approved proposals can be implemented");
  if (proposal.policyArea === "COMPETITION" && typeof proposal.payload.competitionId === "string")
    proposeCompetitionReform(db, {
      federationId: proposal.federationId,
      competitionId: proposal.payload.competitionId as EntityId,
      effectiveSeason: String(proposal.payload.effectiveSeason ?? date.slice(0, 4)),
      changes: (proposal.payload.changes ?? {}) as any,
      proposedAt: proposal.proposedAt,
      decidedAt: date,
      status: "APPROVED",
    });
  if (
    (proposal.policyArea === "INFRASTRUCTURE" || proposal.policyArea === "DEVELOPMENT") &&
    typeof proposal.payload.projectType === "string"
  )
    createFederationProject(db, {
      federationId: proposal.federationId,
      projectType: proposal.payload.projectType as any,
      name: proposal.title,
      date,
      seed: `proposal:${proposal.id}`,
      funding: (proposal.payload.funding ?? undefined) as Record<string, number> | undefined,
    });
  const implemented = { ...proposal, status: "IMPLEMENTED" as const };
  repo.upsertProposal(implemented);
  return implemented;
};

/** Role-facing adapter for implementing an already-approved proposal. */
export const implementFederationGovernanceProposalCommand = (
  db: GameDatabase,
  input: {
    proposalId: EntityId;
    personId: EntityId;
    callerRole: "MANAGER" | "CHAIRMAN_OWNER" | "FEDERATION_PRESIDENT";
    date: string;
  },
): FederationGovernanceProposal => {
  if (input.callerRole !== "FEDERATION_PRESIDENT")
    throw new Error("Only the federation president may implement a governance proposal");
  const proposal = new FederationGovernancePhaseBRepository(db)
    .proposals()
    .find((item) => item.id === input.proposalId);
  if (!proposal) throw new Error("Governance proposal not found");
  const country = db
    .prepare(
      "SELECT co.iso_code FROM federations f JOIN countries co ON co.id=f.country_id WHERE f.id=?",
    )
    .get(proposal.federationId) as { iso_code?: string } | undefined;
  if (!country || !["NP", "NPL"].includes(country.iso_code ?? ""))
    throw new Error("Governance commands are unavailable for context-only federations");
  const active = new FederationGovernanceRepository(db)
    .leadershipTenures(proposal.federationId)
    .some(
      (item) =>
        item.personId === input.personId &&
        item.role === "FEDERATION_PRESIDENT" &&
        item.status === "ACTIVE",
    );
  if (!active)
    throw new Error("Only the active president of this federation may implement a proposal");
  return implementFederationGovernanceProposal(db, input.proposalId, input.date);
};

export const updateFederationManifesto = (
  db: GameDatabase,
  input: { federationId: EntityId; date: string; progressByPolicy: Record<string, number> },
): FederationManifestoCommitment[] => {
  const repo = new FederationGovernancePhaseBRepository(db);
  const updated: FederationManifestoCommitment[] = [];
  for (const commitment of repo
    .commitments(input.federationId)
    .filter((item) => item.status === "OPEN")) {
    const progress = Math.max(
      commitment.progress,
      Math.min(
        commitment.targetValue,
        input.progressByPolicy[commitment.policyArea] ?? commitment.progress,
      ),
    );
    const done = progress >= commitment.targetValue;
    const next = {
      ...commitment,
      progress,
      status: done
        ? ("FULFILLED" as const)
        : input.date >= commitment.dueDate
          ? ("BROKEN" as const)
          : ("OPEN" as const),
      lastUpdated: input.date,
    };
    repo.upsertCommitment(next);
    updated.push(next);
  }
  return updated;
};

export const updateFederationConfidence = (
  db: GameDatabase,
  input: { federationId: EntityId; date: string; outcome: "SUCCESS" | "FAILURE" },
): FederationCoalitionState => {
  const repo = new FederationGovernancePhaseBRepository(db);
  const current = repo.coalition(input.federationId);
  if (!current) throw new Error("Coalition state not initialized");
  const delta = input.outcome === "SUCCESS" ? 0.06 : -0.08;
  const confidence = Math.max(0, Math.min(1, current.confidence + delta));
  const next = {
    ...current,
    confidence,
    coalitionSupport: Math.max(0, Math.min(1, current.coalitionSupport + delta * 0.7)),
    status:
      confidence <= current.noConfidenceThreshold
        ? ("NO_CONFIDENCE" as const)
        : confidence < 0.5
          ? ("STRAINED" as const)
          : ("CONFIDENT" as const),
    lastUpdated: input.date,
  };
  repo.upsertCoalition(next);
  repo.event({
    id: createStableEntityId(
      "federation-governance-event",
      `${input.federationId}:confidence:${input.date}`,
    ),
    federationId: input.federationId,
    date: input.date,
    eventType: "CONFIDENCE_CHANGE",
    subjectId: current.presidentPersonId,
    summary: `Leadership confidence ${next.status.toLowerCase()}`,
    payload: { confidence: next.confidence },
    provenanceStatus: status,
  });
  return next;
};

export const transitionFederationLeadership = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    date: string;
    replacementPersonId: EntityId;
    reason: "RESIGNATION" | "REMOVAL";
  },
): FederationCoalitionState => {
  const governance = new FederationGovernanceRepository(db);
  const current = governance
    .leadershipTenures(input.federationId)
    .find((item) => item.role === "FEDERATION_PRESIDENT" && item.status === "ACTIVE");
  if (!current) throw new Error("No active federation president");
  governance.upsertLeadershipTenure({ ...current, termEnd: input.date, status: "FORMER" });
  governance.upsertLeadershipTenure({
    id: createStableEntityId(
      "federation-leadership",
      `${input.federationId}:${input.replacementPersonId}:${input.date}:interim`,
    ),
    personId: input.replacementPersonId,
    federationId: input.federationId,
    role: "FEDERATION_PRESIDENT",
    termStart: input.date,
    status: "INTERIM",
    provenanceStatus: status,
  });
  const repo = new FederationGovernancePhaseBRepository(db);
  const previous = repo.coalition(input.federationId);
  const next: FederationCoalitionState = {
    federationId: input.federationId,
    presidentPersonId: input.replacementPersonId,
    confidence: 0.42,
    coalitionSupport: previous?.coalitionSupport ?? 0.4,
    noConfidenceThreshold: previous?.noConfidenceThreshold ?? 0.3,
    lastUpdated: input.date,
    status: "STRAINED",
    provenanceStatus: status,
  };
  repo.upsertCoalition(next);
  repo.event({
    id: createStableEntityId(
      "federation-governance-event",
      `${input.federationId}:${input.reason}:${input.date}`,
    ),
    federationId: input.federationId,
    date: input.date,
    eventType: input.reason,
    subjectId: current.personId,
    summary: `President ${input.reason.toLowerCase()}`,
    payload: { replacementPersonId: input.replacementPersonId },
    provenanceStatus: status,
  });
  return next;
};
