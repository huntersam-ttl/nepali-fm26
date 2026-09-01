import {
  CareerIdentityRepository,
  CareerTimelineRepository,
  StaffMarketRepository,
  TransferMarketRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type AgentCareerProfile,
  type AgentClient,
  type AgentProfile,
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
  return client;
};

export const releaseAgentClient = (
  db: GameDatabase,
  input: { playerId: EntityId; date: string },
): void => {
  const market = new TransferMarketRepository(db);
  if (market.agentForPlayer(input.playerId)) market.endActiveAgentClient(input.playerId);
};
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
): CareerTimelineEvent[] => new CareerTimelineRepository(db).events(filter);

/** Projects persisted career evidence into the shared timeline; it never invents prior history. */
export const syncCareerTimeline = (db: GameDatabase, personId: EntityId): CareerTimelineEvent[] => {
  const events: CareerTimelineEvent[] = [];
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
    recordCareerTimelineEvent(db, event);
    events.push(event);
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
    recordCareerTimelineEvent(db, event);
    events.push(event);
  }
  return events.sort(
    (a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id),
  );
};
