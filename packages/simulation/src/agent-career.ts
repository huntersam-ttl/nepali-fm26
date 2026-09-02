import {
  CareerIdentityRepository,
  CareerTimelineRepository,
  AgentCareerRepository,
  ClubEconomyRepository,
  StaffMarketRepository,
  TransferMarketRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type AgentCareerProfile,
  type AgentClient,
  type AgentClientStrategy,
  type AgentFeeSettlement,
  type AgentProfile,
  type AgentStrategyObjective,
  type AgentReputationOutcome,
  type CareerTimelineEvent,
  type CareerTimelineFilter,
  type EntityId,
  type Person,
  type PersonRelationship,
} from "@nepal-football-sim/shared-types";
import { upsertPersonRelationship } from "./people-foundation.js";

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
export const agentReputationLabel = (reputation: number): AgentCareerProfile["reputationLabel"] =>
  reputation >= 70 ? "RESPECTED" : reputation >= 40 ? "ESTABLISHED" : "EMERGING";
export const deriveAgentReputation = (outcome: AgentReputationOutcome): number =>
  clamp(
    35 +
      outcome.successfulTransfers * 4 +
      outcome.strongContracts * 3 +
      outcome.clientProgressions * 4 +
      outcome.relationshipQuality * 0.15 -
      outcome.failedNegotiations * 3,
  );

export const createAgentCareer = (
  db: GameDatabase,
  input: { person: Person; profile: AgentProfile; date: string },
): AgentCareerProfile => {
  const world = new WorldRepository(db);
  if (!world.getPerson(input.person.id)) world.insertPerson(input.person);
  if (
    !db
      .prepare(
        "SELECT 1 FROM person_roles WHERE person_id=? AND role='AGENT' AND active_to IS NULL",
      )
      .get(input.person.id)
  )
    world.insertPersonRole({
      id: createStableEntityId("person-role", `${input.person.id}:AGENT`),
      personId: input.person.id,
      role: "AGENT",
      activeFrom: input.date,
    });
  new TransferMarketRepository(db).upsertAgent(input.profile);
  const economy = new ClubEconomyRepository(db);
  if (!economy.personalFinancialProfile(input.person.id)) {
    economy.upsertPersonalFinancialProfile({
      personId: input.person.id,
      cash: 0,
      investments: 0,
      assets: 0,
      liabilities: 0,
      netWorth: 0,
      currency: "NPR",
      lastUpdatedAt: input.date,
      status: "SIMULATION_ONLY",
    });
  }
  return {
    agent: input.profile,
    personId: input.person.id,
    careerRole: "AGENT",
    reputationLabel: agentReputationLabel(input.profile.reputation),
    activeClients: 0,
    provenanceStatus: "SIMULATION_ONLY",
  };
};

export const signAgentClient = (
  db: GameDatabase,
  input: { agentId: EntityId; playerId: EntityId; date: string },
): AgentClient => {
  const market = new TransferMarketRepository(db);
  if (market.agentForPlayer(input.playerId))
    throw new Error("Player already has active representation.");
  const agent = market.agents().find((item) => item.id === input.agentId);
  if (!agent) throw new Error("Agent not found.");
  const client: AgentClient = {
    id: createStableEntityId(
      "agent-client-career",
      `${input.agentId}:${input.playerId}:${input.date}`,
    ),
    agentId: input.agentId,
    playerId: input.playerId,
    startedAt: input.date,
    status: "ACTIVE",
  };
  market.upsertAgentClient(client);
  upsertPersonRelationship({
    db,
    fromPersonId: input.playerId,
    toPersonId: agent.personId,
    kind: "PLAYER_AGENT",
    affinity: 62,
    trust: 60,
    respect: 58,
    tension: 4,
    date: input.date,
  });
  recordCareerTimelineEvent(db, {
    id: createStableEntityId("career-timeline-agent-client", client.id),
    personId: agent.personId,
    occurredOn: input.date,
    role: "AGENT",
    category: "REPRESENTATION",
    title: "Client signed",
    importance: "MEDIUM",
    sourceEntityId: input.playerId,
    provenanceStatus: "SIMULATION_ONLY",
  });
  return client;
};

export const releaseAgentClient = (
  db: GameDatabase,
  input: { playerId: EntityId; date: string },
): void => {
  const market = new TransferMarketRepository(db);
  const agent = market.agentForPlayer(input.playerId);
  if (agent) {
    market.endActiveAgentClient(input.playerId);
    recordCareerTimelineEvent(db, {
      id: createStableEntityId(
        "career-timeline-agent-client-ended",
        `${agent.id}:${input.playerId}:${input.date}`,
      ),
      personId: agent.personId,
      occurredOn: input.date,
      role: "AGENT",
      category: "REPRESENTATION",
      title: "Client representation ended",
      importance: "LOW",
      sourceEntityId: input.playerId,
      provenanceStatus: "SIMULATION_ONLY",
    });
  }
};

/** Persist the human/AI agent's current objective; only one strategy is active per client. */
export const setAgentClientStrategy = (
  db: GameDatabase,
  input: { agentId: EntityId; playerId: EntityId; objective: AgentStrategyObjective; date: string },
): AgentClientStrategy => {
  const market = new TransferMarketRepository(db);
  const client = market.agentClients(input.playerId).find((item) => item.status === "ACTIVE");
  if (!client || client.agentId !== input.agentId)
    throw new Error("Agent does not represent player.");
  const repo = new AgentCareerRepository(db);
  const previous = repo.activeStrategy(input.playerId);
  repo.cancelActiveStrategies(input.playerId, input.date);
  const strategy: AgentClientStrategy = {
    id: createStableEntityId(
      "agent-client-strategy",
      `${input.agentId}:${input.playerId}:${input.date}`,
    ),
    agentId: input.agentId,
    playerId: input.playerId,
    objective: input.objective,
    createdAt: previous?.createdAt ?? input.date,
    updatedAt: input.date,
    status: "ACTIVE",
    provenanceStatus: "SIMULATION_ONLY",
  };
  repo.upsertStrategy(strategy);
  return strategy;
};

export const agentClientStrategies = (
  db: GameDatabase,
  playerId?: EntityId,
): AgentClientStrategy[] => new AgentCareerRepository(db).strategies(playerId);

/** Apply a deliberately modest agent preference signal while retaining the player's own inputs. */
export const effectiveAgentPlayerPreferences = <T extends Record<string, any>>(
  db: GameDatabase,
  playerId: EntityId,
  preferences: T,
): T => {
  const strategy = new AgentCareerRepository(db).activeStrategy(playerId);
  if (!strategy) return preferences;
  const next: Record<string, any> = { ...preferences };
  switch (strategy.objective) {
    case "STAY":
    case "RENEWAL":
      next.currentClubSatisfaction = Math.min(100, (next.currentClubSatisfaction ?? 50) + 12);
      break;
    case "TRANSFER":
      next.currentClubSatisfaction = Math.max(0, (next.currentClubSatisfaction ?? 50) - 12);
      next.ambition = Math.min(100, (next.ambition ?? 50) + 6);
      break;
    case "PLAYING_TIME":
    case "LOAN":
      next.expectedPlayingTime = next.expectedPlayingTime ?? "FIRST_TEAM";
      break;
    case "WAGE":
      next.ambition = Math.min(100, (next.ambition ?? 50) + 5);
      break;
    case "REPUTATION":
      next.minimumClubLevel = Math.min(100, (next.minimumClubLevel ?? 0) + 8);
      break;
    case "SECURITY":
      next.securityPreference = Math.min(10, (next.securityPreference ?? 6) + 1);
      break;
    case "FREE_TRANSFER":
      next.currentClubSatisfaction = Math.max(0, (next.currentClubSatisfaction ?? 50) - 6);
      break;
  }
  return next as T;
};

export const agentFeeForContract = (salary: number, agent: AgentProfile): number =>
  Math.max(0, Math.round(salary * (0.02 + agent.feeExpectation / 500)));

/** Credit the agent only after the existing club transfer/contract expense has posted. */
export const settleAgentFee = (
  db: GameDatabase,
  input: {
    playerId: EntityId;
    payerClubId: EntityId;
    amount: number;
    sourceEntityId: EntityId;
    eventType: AgentFeeSettlement["eventType"];
    date: string;
  },
): AgentFeeSettlement | undefined => {
  const market = new TransferMarketRepository(db);
  const agent = market.agentForPlayer(input.playerId);
  const amount = Math.max(0, Math.round(input.amount));
  if (!agent || amount <= 0) return undefined;
  const economy = new ClubEconomyRepository(db);
  const account = economy.financialAccount(input.payerClubId);
  const profile = economy.personalFinancialProfile(agent.personId);
  if (!profile) {
    economy.upsertPersonalFinancialProfile({
      personId: agent.personId,
      cash: 0,
      investments: 0,
      assets: 0,
      liabilities: 0,
      netWorth: 0,
      currency: account?.currency ?? "NPR",
      lastUpdatedAt: input.date,
      status: "SIMULATION_ONLY",
    });
  }
  const settlement: AgentFeeSettlement = {
    id: createStableEntityId("agent-fee-settlement", `${input.sourceEntityId}:${input.eventType}`),
    agentId: agent.id,
    playerId: input.playerId,
    payerClubId: input.payerClubId,
    amount,
    currency: account?.currency ?? profile?.currency ?? "NPR",
    eventType: input.eventType,
    sourceEntityId: input.sourceEntityId,
    settledOn: input.date,
    personalLedgerEntryId: createStableEntityId(
      "agent-personal-ledger",
      `${input.sourceEntityId}:${input.eventType}`,
    ),
    provenanceStatus: "SIMULATION_ONLY",
  };
  if (!new AgentCareerRepository(db).insertFeeSettlement(settlement)) return undefined;
  economy.updatePersonalCash(agent.personId, amount, input.date);
  const updatedAgent = {
    ...agent,
    reputation: clamp(agent.reputation + 2),
  };
  market.upsertAgent(updatedAgent);
  const strategy = new AgentCareerRepository(db).activeStrategy(input.playerId);
  if (strategy) {
    new AgentCareerRepository(db).upsertStrategy({
      ...strategy,
      status: "COMPLETED",
      updatedAt: input.date,
      outcomeSummary: `${input.eventType.replaceAll("_", " ").toLowerCase()} completed`,
    });
  }
  recordCareerTimelineEvent(db, {
    id: createStableEntityId("career-timeline-agent-outcome", settlement.id),
    personId: agent.personId,
    occurredOn: input.date,
    role: "AGENT",
    category: input.eventType === "CONTRACT_RENEWAL" ? "CONTRACT" : "TRANSFER",
    title:
      input.eventType === "CONTRACT_RENEWAL" ? "Client contract renewed" : "Client move completed",
    importance: input.amount >= 500000 ? "HIGH" : "MEDIUM",
    clubId: input.payerClubId,
    sourceEntityId: settlement.sourceEntityId,
    provenanceStatus: "SIMULATION_ONLY",
  });
  return settlement;
};

export const agentFeeSettlements = (db: GameDatabase, agentId?: EntityId): AgentFeeSettlement[] =>
  new AgentCareerRepository(db).feeSettlements(agentId);
export const agentPortfolioReadModel = (
  db: GameDatabase,
  agentId: EntityId,
): { clients: AgentClient[]; profile?: AgentProfile } => {
  const market = new TransferMarketRepository(db);
  const profile = market.agents().find((item) => item.id === agentId);
  return {
    profile,
    clients: market
      .agentClients()
      .filter((client) => client.agentId === agentId && client.status === "ACTIVE"),
  };
};

export const recordCareerTimelineEvent = (
  db: GameDatabase,
  event: CareerTimelineEvent,
): CareerTimelineEvent => {
  new CareerTimelineRepository(db).upsert(event);
  return event;
};
export const careerTimeline = (
  db: GameDatabase,
  filter: CareerTimelineFilter,
): CareerTimelineEvent[] => {
  syncCareerTimeline(db, filter.personId);
  return new CareerTimelineRepository(db).events(filter);
};

/** Projects persisted career evidence into the shared timeline; it never invents prior history. */
export const syncCareerTimeline = (db: GameDatabase, personId: EntityId): CareerTimelineEvent[] => {
  const events: CareerTimelineEvent[] = [];
  const timeline = new CareerTimelineRepository(db);
  const add = (event: CareerTimelineEvent) => {
    if (event.sourceEntityId && timeline.hasSource(personId, event.sourceEntityId)) return;
    recordCareerTimelineEvent(db, event);
    events.push(event);
  };
  const identity = new CareerIdentityRepository(db).get(personId);
  for (const milestone of identity?.milestones ?? []) {
    const event: CareerTimelineEvent = {
      id: createStableEntityId("career-timeline-milestone", milestone.id),
      personId,
      occurredOn: milestone.date,
      role: milestone.role,
      category: "MILESTONE",
      title: milestone.title,
      importance: ["TROPHY", "MAJOR_TRANSFER", "RETIREMENT", "PROMOTION", "OWNERSHIP"].includes(
        milestone.type,
      )
        ? "HIGH"
        : "MEDIUM",
      sourceEntityId: milestone.sourceEntityId,
      provenanceStatus: "SIMULATION_ONLY",
    };
    add(event);
  }
  for (const history of new StaffMarketRepository(db).staffHistoryForPerson(personId)) {
    const isDeparture =
      history.eventType.includes("LEFT") ||
      history.eventType.includes("SACKED") ||
      history.eventType.includes("RESIGNED");
    const event: CareerTimelineEvent = {
      id: createStableEntityId("career-timeline-staff", history.id),
      personId,
      occurredOn: history.occurredOn,
      role: "STAFF",
      category: isDeparture ? "DEPARTURE" : "APPOINTMENT",
      title: history.description ?? history.eventType.replaceAll("_", " "),
      importance: "MEDIUM",
      clubId: history.clubId,
      federationId: history.federationId,
      sourceEntityId: history.appointmentId,
      provenanceStatus: "SIMULATION_ONLY",
    };
    add(event);
  }
  const transferRows = db
    .prepare("SELECT * FROM transfer_history_events WHERE player_id=? ORDER BY occurred_on,id")
    .all(personId) as any[];
  for (const history of transferRows) {
    add({
      id: createStableEntityId("career-timeline-transfer", history.id),
      personId,
      occurredOn: history.occurred_on,
      role: "PLAYER",
      category: "TRANSFER",
      title: String(history.event_type).replaceAll("_", " "),
      importance: "HIGH",
      clubId: history.club_id ?? undefined,
      sourceEntityId: history.id,
      seasonLabel: String(history.occurred_on).slice(0, 4),
      provenanceStatus: "SIMULATION_ONLY",
    });
  }
  const contractRows = db
    .prepare(
      "SELECT id,start_date,end_date,status,club_id FROM player_contracts WHERE player_id=? ORDER BY start_date,id",
    )
    .all(personId) as any[];
  for (const contract of contractRows) {
    add({
      id: createStableEntityId("career-timeline-contract", contract.id),
      personId,
      occurredOn: contract.start_date,
      role: "PLAYER",
      category: "CONTRACT",
      title: `Contract ${String(contract.status).toLowerCase()}`,
      importance: "MEDIUM",
      clubId: contract.club_id,
      sourceEntityId: contract.id,
      seasonLabel: String(contract.start_date).slice(0, 4),
      provenanceStatus: "SIMULATION_ONLY",
    });
  }
  const historicalRows = db
    .prepare(
      "SELECT * FROM historical_events WHERE involved_entities_json LIKE ? ORDER BY occurred_on,id",
    )
    .all(`%${personId}%`) as any[];
  for (const history of historicalRows) {
    let entities: Array<{ id?: string; type?: string }> = [];
    try {
      const parsed = JSON.parse(history.involved_entities_json);
      entities = Array.isArray(parsed) ? parsed : [];
    } catch {
      continue;
    }
    if (!entities.some((entity) => entity.id === personId)) continue;
    const type = String(history.event_type).toUpperCase();
    const category: CareerTimelineEvent["category"] =
      type.includes("TRANSFER") || type.includes("SIGNING")
        ? "TRANSFER"
        : type.includes("CONTRACT")
          ? "CONTRACT"
          : type.includes("PROJECT") || type.includes("FACILITY") || type.includes("HOSTING")
            ? "PROJECT"
            : type.includes("APPOINT") || type.includes("ELECT") || type.includes("OWNERSHIP")
              ? "GOVERNANCE"
              : type.includes("RETIR") || type.includes("MILESTONE")
                ? "MILESTONE"
                : "OTHER";
    const club = entities.find((entity) => entity.type === "club")?.id;
    const federation = entities.find((entity) => entity.type === "federation")?.id;
    add({
      id: createStableEntityId("career-timeline-history", `${history.id}:${personId}`),
      personId,
      occurredOn: history.occurred_on,
      role: type.includes("AGENT") ? "AGENT" : type.includes("PRESIDENT") ? "PRESIDENT" : "PLAYER",
      category,
      title: history.title,
      importance:
        history.importance === "high" ? "HIGH" : history.importance === "low" ? "LOW" : "MEDIUM",
      clubId: club as EntityId | undefined,
      federationId: federation as EntityId | undefined,
      sourceEntityId: history.id,
      seasonLabel: String(history.occurred_on).slice(0, 4),
      provenanceStatus: "SIMULATION_ONLY",
    });
  }
  return events.sort(
    (a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id),
  );
};
