import {
  createStableEntityId,
  type EntityId,
  type InternationalTrialRecord,
  type InternationalTrialSource,
  type PlayerKnowledgeLevel,
} from "@nepal-football-sim/shared-types";
import {
  InternationalTrialsRepository,
  GlobalFootballContextRepository,
  RecruitmentRepository,
  TransferMarketRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  getPlayerKnowledge,
  recordTrialObservation,
  searchRegionalCandidatesForClubCached,
} from "./scouting.js";
import { createTransferOffer } from "./transfer-market.js";
import { sameCountryIdentity } from "./market-regions.js";

export const MAX_INTERNATIONAL_TRIAL_DAYS = 28;
const KNOWLEDGE_RANK: Record<PlayerKnowledgeLevel, number> = {
  NONE: 0,
  MINIMAL: 1,
  BASIC: 2,
  GOOD: 3,
  EXTENSIVE: 4,
  COMPLETE: 5,
};

type TrialInvitationInput = {
  playerId: EntityId;
  hostClubId: EntityId;
  invitedOn: string;
  startDate: string;
  endDate: string;
  source?: InternationalTrialSource;
  reason?: string;
  parentClubPermissionGranted?: boolean;
};

const isoDate = (value: string): number => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.NaN;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const daysBetween = (from: string, to: string): number =>
  Math.floor((isoDate(to) - isoDate(from)) / 86_400_000);

const clubCountry = (db: GameDatabase, clubId: EntityId): EntityId | undefined =>
  (db.prepare("SELECT country_id FROM clubs WHERE id = ?").get(clubId) as { country_id?: EntityId } | undefined)?.country_id;

const playerContext = (
  db: GameDatabase,
  playerId: EntityId,
):
  | {
      currentClubId?: EntityId;
      countryId?: EntityId;
    }
  | undefined => {
  const row = db
    .prepare(
      `SELECT p.id AS player_id,
              COALESCE(pfp.current_club_id, pc.club_id) AS current_club_id,
              COALESCE(current_club.country_id, p.nationality_country_id) AS country_id
       FROM persons p
       LEFT JOIN player_factual_profiles pfp ON pfp.player_id = p.id
       LEFT JOIN player_contracts pc ON pc.player_id = p.id AND pc.status = 'ACTIVE'
       LEFT JOIN clubs current_club ON current_club.id = COALESCE(pfp.current_club_id, pc.club_id)
       WHERE p.id = ?`,
    )
    .get(playerId) as
    { player_id?: EntityId; current_club_id?: EntityId; country_id?: EntityId } | undefined;
  return row?.player_id
    ? { currentClubId: row.current_club_id, countryId: row.country_id }
    : undefined;
};

const isPlayer = (db: GameDatabase, playerId: EntityId): boolean =>
  Boolean(
    db
      .prepare(
        `SELECT 1 FROM persons p
         LEFT JOIN player_attributes pa ON pa.person_id = p.id
         LEFT JOIN player_factual_profiles pfp ON pfp.player_id = p.id
         WHERE p.id = ? AND (pa.person_id IS NOT NULL OR pfp.player_id IS NOT NULL)`,
      )
      .get(playerId),
  );

const isClub = (db: GameDatabase, clubId: EntityId): boolean =>
  Boolean(db.prepare("SELECT 1 FROM clubs WHERE id = ?").get(clubId));

const validateInvitation = (
  db: GameDatabase,
  input: TrialInvitationInput,
): {
  currentClubId?: EntityId;
  currentContract?: ReturnType<TransferMarketRepository["activeContract"]>;
} => {
  if (!isPlayer(db, input.playerId))
    throw new Error("International trial player is not a valid player");
  if (!isClub(db, input.hostClubId))
    throw new Error("International trial host club does not exist");
  const invitedAt = isoDate(input.invitedOn);
  const startsAt = isoDate(input.startDate);
  const endsAt = isoDate(input.endDate);
  if (
    ![invitedAt, startsAt, endsAt].every(Number.isFinite) ||
    invitedAt > startsAt ||
    endsAt <= startsAt
  ) {
    throw new Error("International trial dates are invalid");
  }
  if (daysBetween(input.startDate, input.endDate) > MAX_INTERNATIONAL_TRIAL_DAYS) {
    throw new Error(`International trial cannot exceed ${MAX_INTERNATIONAL_TRIAL_DAYS} days`);
  }
  const market = new TransferMarketRepository(db);
  const currentContract = market.activeContract(input.playerId, input.startDate);
  const context = playerContext(db, input.playerId);
  if (!context) throw new Error("International trial player context is unavailable");
  if (currentContract && input.parentClubPermissionGranted !== true) {
    throw new Error("Parent-club permission is required for a contracted player trial");
  }
  const hostCountry = clubCountry(db, input.hostClubId);
  if (!hostCountry || !context.countryId || sameCountryIdentity(db, hostCountry, context.countryId)) {
    throw new Error("International trial requires a cross-border host club");
  }
  if (context.currentClubId === input.hostClubId) {
    throw new Error("Player is already affiliated with the trial host club");
  }
  const activePair = new InternationalTrialsRepository(db)
    .activeForPlayer(input.playerId)
    .find((trial) => trial.hostClubId === input.hostClubId);
  if (activePair) throw new Error("An active trial already exists for this player and club");
  return { currentClubId: context.currentClubId, currentContract };
};

export const createInternationalTrial = (
  db: GameDatabase,
  input: TrialInvitationInput,
): InternationalTrialRecord => {
  const context = validateInvitation(db, input);
  const repository = new InternationalTrialsRepository(db);
  const id = createStableEntityId(
    "international-trial",
    `${input.playerId}:${input.hostClubId}:${input.startDate}:${input.endDate}`,
  );
  const existing = repository.get(id);
  if (existing) return existing;
  const record: InternationalTrialRecord = {
    id,
    playerId: input.playerId,
    hostClubId: input.hostClubId,
    currentClubIdAtInvitation: context.currentClubId,
    parentClubPermissionGranted: input.parentClubPermissionGranted === true,
    invitedOn: input.invitedOn,
    startDate: input.startDate,
    endDate: input.endDate,
    invitationStatus: "PENDING",
    playerResponse: "PENDING",
    state: "INVITED",
    source: input.source ?? "MANUAL",
    reason: input.reason,
  };
  repository.insert(record);
  return record;
};

export const createInternationalTrialFromScouting = (
  db: GameDatabase,
  input: TrialInvitationInput,
): InternationalTrialRecord => {
  const knowledge = getPlayerKnowledge(db, input.hostClubId, input.playerId);
  if (!knowledge || KNOWLEDGE_RANK[knowledge.knowledgeLevel] === 0) {
    throw new Error("International trial requires an existing scouting target");
  }
  return createInternationalTrial(db, { ...input, source: input.source ?? "SCOUTING" });
};

export const createInternationalTrialFromForeignScouting = (
  db: GameDatabase,
  input: Omit<TrialInvitationInput, "hostClubId" | "source"> & { interestId: EntityId },
): InternationalTrialRecord => {
  const interest = new GlobalFootballContextRepository(db)
    .interests()
    .find((item) => item.id === input.interestId);
  if (!interest || !["INTERESTED", "ACTIVE_SCOUTING", "TRIAL_INTEREST"].includes(interest.level)) {
    throw new Error("Foreign scouting interest is not strong enough for a trial invitation");
  }
  return createInternationalTrial(db, {
    ...input,
    hostClubId: interest.externalClubId,
    source: "EXTERNAL_SCOUTING",
  });
};

export type TrialDecision = { accepted: boolean; score: number; reason: string };

/** A player-side decision projection; it never mutates a trial or creates terms. */
export const evaluateInternationalTrialInvitation = (
  db: GameDatabase,
  trial: InternationalTrialRecord,
  worldDate: string,
): TrialDecision => {
  const profile = new RecruitmentRepository(db).clubRecruitmentProfile(trial.hostClubId);
  const contract = new TransferMarketRepository(db).activeContract(trial.playerId, worldDate);
  const simulation = db
    .prepare("SELECT simulation_json FROM player_factual_profiles WHERE player_id = ?")
    .get(trial.playerId) as { simulation_json?: string } | undefined;
  const playerSimulation = JSON.parse(simulation?.simulation_json ?? "{}");
  const duration = daysBetween(trial.startDate, trial.endDate);
  const score =
    (profile?.internationalKnowledge ?? 0) * 40 +
    (profile?.networkReach === "GLOBAL" ? 12 : profile?.networkReach === "SOUTH_ASIA" ? 7 : 3) +
    Number(playerSimulation.reputation ?? 5) * 1.5 +
    (contract ? -8 : 10) +
    (duration <= 21 ? 8 : 2) +
    (getPlayerKnowledge(db, trial.hostClubId, trial.playerId)?.knowledgeLevel === "GOOD" ? 4 : 0);
  const rounded = Math.round(score * 100) / 100;
  return rounded >= 25
    ? { accepted: true, score: rounded, reason: "Trial offers a credible cross-border opportunity" }
    : {
        accepted: false,
        score: rounded,
        reason: "Trial opportunity does not meet the player's current career threshold",
      };
};

export const respondToInternationalTrial = (
  db: GameDatabase,
  input: {
    trialId: EntityId;
    response: "ACCEPTED" | "REJECTED";
    responseDate: string;
    seed: string;
  },
): InternationalTrialRecord => {
  const repository = new InternationalTrialsRepository(db);
  const trial = repository.get(input.trialId);
  if (!trial) throw new Error("International trial invitation does not exist");
  if (["INVITED", "ACTIVE"].includes(trial.state) && input.responseDate >= trial.endDate) {
    processInternationalTrials(db, { worldDate: input.responseDate });
  }
  const current = repository.get(input.trialId)!;
  if (current.state !== "INVITED") {
    if (input.response === "ACCEPTED" && current.state === "ACTIVE") return current;
    throw new Error("International trial invitation is no longer open");
  }
  if (input.responseDate < current.invitedOn || input.responseDate >= current.endDate) {
    throw new Error("International trial response date is invalid");
  }
  if (input.response === "REJECTED") {
    const rejected = {
      ...current,
      invitationStatus: "REJECTED" as const,
      playerResponse: "REJECTED" as const,
      state: "REJECTED" as const,
      decidedOn: input.responseDate,
    };
    repository.insert(rejected);
    return rejected;
  }
  const active = {
    ...current,
    invitationStatus: "ACCEPTED" as const,
    playerResponse: "ACCEPTED" as const,
    state: "ACTIVE" as const,
    decidedOn: input.responseDate,
  };
  repository.insert(active);
  recordTrialObservation(db, {
    clubId: active.hostClubId,
    playerId: active.playerId,
    observedAt: input.responseDate,
    seed: input.seed,
  });
  return active;
};

export const processInternationalTrials = (
  db: GameDatabase,
  input: { worldDate: string },
): { expired: number; completed: number } => {
  const repository = new InternationalTrialsRepository(db);
  let expired = 0;
  let completed = 0;
  for (const trial of repository.due(input.worldDate)) {
    if (trial.state === "INVITED") {
      repository.insert({
        ...trial,
        invitationStatus: "EXPIRED",
        state: "EXPIRED",
        completedOn: input.worldDate,
      });
      expired += 1;
    } else if (trial.state === "ACTIVE") {
      repository.insert({
        ...trial,
        invitationStatus: "COMPLETED",
        state: "COMPLETED",
        completedOn: input.worldDate,
      });
      completed += 1;
    }
  }
  return { expired, completed };
};

export const createTransferOfferAfterInternationalTrial = (
  db: GameDatabase,
  input: {
    trialId: EntityId;
    submittedAt: string;
    fee?: number;
    installments?: number;
    addOns?: number;
    sellOnPercentage?: number;
  },
) => {
  const trial = new InternationalTrialsRepository(db).get(input.trialId);
  if (!trial || !["ACTIVE", "COMPLETED"].includes(trial.state)) {
    throw new Error("A normal offer requires an active or completed international trial");
  }
  const contract = new TransferMarketRepository(db).activeContract(
    trial.playerId,
    input.submittedAt,
  );
  return createTransferOffer(db, {
    buyingClubId: trial.hostClubId,
    sellingClubId: contract?.clubId,
    playerId: trial.playerId,
    submittedAt: input.submittedAt,
    fee: input.fee,
    installments: input.installments,
    addOns: input.addOns,
    sellOnPercentage: input.sellOnPercentage,
  });
};

/**
 * Bounded AI hook for the existing seasonal club-planning cadence. It only
 * evaluates a short regional/scouting candidate list and skips contracted
 * players because no parent permission is available to an autonomous club.
 */
export const considerInternationalTrialsForClub = (
  db: GameDatabase,
  input: { clubId: EntityId; worldDate: string; seed: string; maxCandidates?: number },
): InternationalTrialRecord[] => {
  const limit = Math.max(0, Math.min(2, input.maxCandidates ?? 2));
  if (limit === 0) return [];
  const recruitment = new RecruitmentRepository(db);
  const shortlistIds = recruitment
    .shortlist(input.clubId)
    .slice(0, 8)
    .map((item) => item.playerId);
  const regional = searchRegionalCandidatesForClubCached(db, input.clubId, {}, input.worldDate, 16);
  const byId = new Map(regional.map((candidate) => [candidate.playerId, candidate]));
  const ordered = [...shortlistIds.map((id) => byId.get(id)).filter(Boolean), ...regional].filter(
    (candidate, index, all) =>
      candidate && all.findIndex((item) => item?.playerId === candidate.playerId) === index,
  );
  const market = new TransferMarketRepository(db);
  const created: InternationalTrialRecord[] = [];
  for (const candidate of ordered) {
    if (!candidate || created.length >= limit) break;
    if (KNOWLEDGE_RANK[candidate.knowledgeLevel] > KNOWLEDGE_RANK.BASIC) continue;
    if (market.activeContract(candidate.playerId, input.worldDate)) continue;
    if (new InternationalTrialsRepository(db).activeForPlayer(candidate.playerId).length > 0)
      continue;
    try {
      const invitation = createInternationalTrialFromScouting(db, {
        playerId: candidate.playerId,
        hostClubId: input.clubId,
        invitedOn: input.worldDate,
        startDate: input.worldDate,
        endDate: addDays(input.worldDate, 14),
        source: "AI_RECRUITMENT",
        reason: "Bounded uncertain regional scouting target",
      });
      const decision = evaluateInternationalTrialInvitation(db, invitation, input.worldDate);
      created.push(
        respondToInternationalTrial(db, {
          trialId: invitation.id,
          response: decision.accepted ? "ACCEPTED" : "REJECTED",
          responseDate: input.worldDate,
          seed: `${input.seed}:${invitation.id}`,
        }),
      );
    } catch {
      // Eligibility and existing market state remain authoritative.
    }
  }
  return created;
};

/**
 * External clubs remain context-only. Their seasonal scouting signal may
 * create at most one invitation per interested target, and only for a player
 * without an active contract; contracted Nepal players still require an
 * explicit parent-club permission through the command above.
 */
export const considerForeignInternationalTrials = (
  db: GameDatabase,
  input: { worldDate: string; seed: string; maxCandidates?: number },
): InternationalTrialRecord[] => {
  const limit = Math.max(0, Math.min(2, input.maxCandidates ?? 2));
  const market = new TransferMarketRepository(db);
  const created: InternationalTrialRecord[] = [];
  for (const interest of new GlobalFootballContextRepository(db)
    .interests()
    .filter((item) => ["INTERESTED", "ACTIVE_SCOUTING", "TRIAL_INTEREST"].includes(item.level))
    .slice(0, limit * 2)) {
    if (created.length >= limit || market.activeContract(interest.targetPlayerId, input.worldDate))
      continue;
    try {
      created.push(
        createInternationalTrialFromForeignScouting(db, {
          interestId: interest.id,
          playerId: interest.targetPlayerId,
          invitedOn: input.worldDate,
          startDate: input.worldDate,
          endDate: addDays(input.worldDate, 14),
          reason: "Bounded external scouting interest",
        }),
      );
    } catch {
      // A parent-club permission or cross-border rule can legitimately block this.
    }
  }
  return created;
};

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};
