import {
  createStableEntityId,
  type ClubRecruitmentProfile,
  type ClubShortlistItem,
  type EntityId,
  type ExternalFootballRegion,
  type KnowledgeConfidence,
  type KnowledgeRange,
  type PlayerDiscoveryStatus,
  type PlayerKnowledge,
  type PlayerKnowledgeLevel,
  type PlayerKnowledgeSourceType,
  type PlayerPosition,
  type ScoutReport,
  type ScoutReportRecommendation,
  type ScoutingAssignment,
  type ScoutingAssignmentPriority,
} from "@nepal-football-sim/shared-types";
import { ClubNetworkRepository, RecruitmentRepository, type GameDatabase } from "@nepal-football-sim/database";
import { SeededRandom } from "./rng.js";
type ScoutingCoverage = { clubId: EntityId; reachable: boolean; effectiveQuality: number; budgetAvailable: number; rationale: string };

type TruePlayer = {
  playerId: EntityId;
  fullName: string;
  dateOfBirth?: string;
  currentClubId?: EntityId;
  teamId?: EntityId;
  nationality?: string;
  factualPositionGroup?: string;
  simulationPosition: PlayerPosition;
  currentAbility: number;
  potentialAbility: number;
  hiddenTraits: Record<string, number>;
  attributes: Record<string, number>;
  appearances: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  marketRegion?: ExternalFootballRegion;
};

export type RecruitmentSearchFilters = {
  position?: PlayerPosition;
  positionGroup?: string;
  ageMin?: number;
  ageMax?: number;
  nationality?: string;
  clubId?: EntityId;
  estimatedAbilityMin?: number;
  estimatedPotentialBand?: string;
};

export type RecruitmentSearchResult = {
  playerId: EntityId;
  name?: string;
  discoveryStatus: PlayerDiscoveryStatus;
  knowledgeLevel: PlayerKnowledgeLevel;
  confidence: KnowledgeConfidence;
  clubId?: EntityId;
  publicPositionGroup?: string;
  knownPosition?: string;
  estimatedAbility?: KnowledgeRange;
  estimatedPotential?: string;
  recentAppearances?: number;
  marketRegion?: ExternalFootballRegion;
};

const REGION_COUNTRIES: Record<ExternalFootballRegion, readonly string[]> = {
  SOUTH_ASIA: ["NP", "NPL", "IN", "IND", "BD", "BGD", "MV", "MDV", "BT", "BTN", "PK", "PAK", "LK", "LKA", "AF", "AFG"],
  WIDER_ASIA: ["CN", "CHN", "HK", "HKG", "MO", "MAC", "MN", "MNG", "KP", "PRK", "KR", "KOR", "TW", "TPE", "JP", "JPN"],
  MIDDLE_EAST: ["AE", "ARE", "SA", "SAU", "QA", "QAT", "IR", "IRN", "IQ", "IRQ", "IL", "ISR", "JO", "JOR", "KW", "KWT", "OM", "OMN", "BH", "BHR", "YE", "YEM"],
  AUSTRALIA: ["AU", "AUS", "NZ", "NZL", "FJ", "FJI", "PG", "PNG"],
  EUROPE: ["GB", "GBR", "IE", "IRL", "FR", "FRA", "DE", "DEU", "ES", "ESP", "IT", "ITA", "PT", "PRT", "NL", "NLD", "BE", "BEL", "CH", "CHE", "AT", "AUT", "SE", "SWE", "NO", "NOR", "DK", "DNK", "FI", "FIN", "IS", "ISL", "PL", "POL", "CZ", "CZE", "SK", "SVK", "HU", "HUN", "RO", "ROU", "BG", "BGR", "GR", "GRC", "HR", "HRV", "RS", "SRB", "UA", "UKR", "TR", "TUR"],
  AFRICA: ["NG", "NGA", "GH", "GHA", "CM", "CMR", "SN", "SEN", "CI", "CIV", "ZA", "ZAF", "KE", "KEN", "TZ", "TZA", "UG", "UGA", "ET", "ETH", "MA", "MAR", "DZ", "DZA", "TN", "TUN", "EG", "EGY", "ZM", "ZMB", "ZW", "ZWE", "MZ", "MOZ", "AO", "AGO", "CD", "COD", "CG", "COG", "RW", "RWA"],
  SOUTH_AMERICA: ["BR", "BRA", "AR", "ARG", "UY", "URY", "CL", "CHL", "CO", "COL", "PE", "PER", "EC", "ECU", "BO", "BOL", "PY", "PRY", "VE", "VEN"],
  NORTH_CENTRAL_AMERICA: ["US", "USA", "CA", "CAN", "MX", "MEX", "CR", "CRI", "PA", "PAN", "HN", "HND", "GT", "GTM", "SV", "SLV", "JM", "JAM", "HT", "HTI"],
  OCEANIA: ["WS", "WSM", "TO", "TON", "VU", "VUT", "SB", "SLB"],
};

export const countryToRecruitmentRegion = (value?: string): ExternalFootballRegion | undefined => {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return undefined;
  return (Object.entries(REGION_COUNTRIES).find(([, countries]) => countries.includes(normalized))?.[0] ?? undefined) as ExternalFootballRegion | undefined;
};

export type ScoutingDiagnostic = {
  clubId: EntityId;
  clubName: string;
  knownPlayers: number;
  discoveredPlayers: number;
  fullyUnknownPlayers: number;
  assignmentsCompleted: number;
  averageKnowledge: number;
  before: RecruitmentSearchResult;
  after: RecruitmentSearchResult;
  report: ScoutReport;
};

const levelRank: Record<PlayerKnowledgeLevel, number> = {
  NONE: 0,
  MINIMAL: 1,
  BASIC: 2,
  GOOD: 3,
  EXTENSIVE: 4,
  COMPLETE: 5,
};

const levels: PlayerKnowledgeLevel[] = [
  "NONE",
  "MINIMAL",
  "BASIC",
  "GOOD",
  "EXTENSIVE",
  "COMPLETE",
];

export const initializeRecruitmentForSave = (input: {
  db: GameDatabase;
  worldDate: string;
  seed: string;
}): void => {
  const recruitment = new RecruitmentRepository(input.db);
  for (const club of clubs(input.db)) {
    recruitment.upsertClubRecruitmentProfile(defaultClubRecruitmentProfile(club, input.seed));
    // External clubs use the bounded global-context scouting layer. Seeding
    // full player knowledge for every imported club is both redundant and
    // quadratic; Nepal clubs retain the normal detailed knowledge bootstrap.
    if (club.canonicalExternalId?.startsWith("CLB-") || club.canonicalExternalId?.startsWith("SIM-FOREIGN-")) continue;
    seedClubKnowledge(input.db, club.id, input.worldDate, input.seed);
  }
};

export const seedClubKnowledge = (
  db: GameDatabase,
  clubId: EntityId,
  worldDate: string,
  seed: string,
): void => {
  const recruitment = new RecruitmentRepository(db);
  const ownPlayerIds = new Set(playersForClub(db, clubId).map((player) => player.playerId));
  const competitionPeerIds = new Set(
    playersSharingCompetitions(db, clubId).map((player) => player.playerId),
  );
  for (const player of allTruePlayers(db)) {
    if (ownPlayerIds.has(player.playerId)) {
      recruitment.upsertPlayerKnowledge(
        knowledgeFor(player, clubId, {
          level: "EXTENSIVE",
          discoveryStatus: "SCOUTED",
          confidence: "HIGH",
          sourceType: "OWN_PLAYER",
          observations: 8,
          date: worldDate,
          seed,
        }),
      );
    } else if (
      competitionPeerIds.has(player.playerId) ||
      player.appearances > 0 ||
      player.goals > 2
    ) {
      recruitment.upsertPlayerKnowledge(
        knowledgeFor(player, clubId, {
          level: competitionPeerIds.has(player.playerId) ? "BASIC" : "MINIMAL",
          discoveryStatus: "DISCOVERED",
          confidence: "LOW",
          sourceType: "PUBLIC",
          observations: Math.max(1, Math.min(3, player.appearances)),
          date: worldDate,
          seed,
        }),
      );
    }
  }
};

export const getPlayerKnowledge = (
  db: GameDatabase,
  clubId: EntityId,
  playerId: EntityId,
): PlayerKnowledge | undefined => new RecruitmentRepository(db).playerKnowledge(clubId, playerId);

/**
 * Applies the bounded extra evaluation earned by a completed trial. This is
 * deliberately the same knowledge projection used by scouting reports; a
 * trial improves familiarity and confidence without exposing raw attributes.
 */
export const recordTrialObservation = (
  db: GameDatabase,
  input: { clubId: EntityId; playerId: EntityId; observedAt: string; seed: string },
): PlayerKnowledge | undefined => {
  const player = truePlayer(db, input.playerId);
  if (!player) return undefined;
  const recruitment = new RecruitmentRepository(db);
  const existing = recruitment.playerKnowledge(input.clubId, input.playerId);
  const currentLevel = existing?.knowledgeLevel ?? "NONE";
  const nextLevel = levels[Math.min(levels.length - 1, levelRank[currentLevel] + 2)]!;
  const knowledge = knowledgeFor(player, input.clubId, {
    level: nextLevel,
    discoveryStatus: "SCOUTED",
    confidence: levelRank[nextLevel] >= levelRank.GOOD ? "HIGH" : "MEDIUM",
    sourceType: "TRIAL",
    observations: (existing?.observations ?? 0) + 4,
    date: input.observedAt,
    seed: `${input.seed}:trial:${input.clubId}:${input.playerId}`,
  });
  recruitment.upsertPlayerKnowledge(knowledge);
  return knowledge;
};

export const searchPlayersForClub = (
  db: GameDatabase,
  clubId: EntityId,
  filters: RecruitmentSearchFilters = {},
  worldDate = "2026-08-01",
): RecruitmentSearchResult[] => {
  const recruitment = new RecruitmentRepository(db);
  const knowledge = new Map(
    recruitment
      .playerKnowledgeForClub(clubId)
      .map((item) => [item.playerId, decayKnowledge(item, worldDate)]),
  );
  return allTruePlayers(db)
    .map((player) => searchResult(player, knowledge.get(player.playerId)))
    .filter((result) => passesFilters(result, filters, worldDate, db))
    .sort(
      (a, b) =>
        levelRank[b.knowledgeLevel] - levelRank[a.knowledgeLevel] ||
        String(a.playerId).localeCompare(String(b.playerId)),
    );
};

export const marketRegionForPlayer = (db: GameDatabase, playerId: EntityId): ExternalFootballRegion | undefined => {
  const row = db.prepare(`
    SELECT co.iso_code AS iso_code
    FROM persons p
    LEFT JOIN player_factual_profiles pfp ON pfp.player_id = p.id
    LEFT JOIN player_contracts pc ON pc.player_id = p.id AND pc.status = 'ACTIVE'
    LEFT JOIN clubs c ON c.id = COALESCE(pfp.current_club_id, pc.club_id)
    LEFT JOIN countries co ON co.id = c.country_id
    WHERE p.id = ?
  `).get(playerId) as { iso_code?: string } | undefined;
  return countryToRecruitmentRegion(row?.iso_code);
};

export const accessibleRecruitmentRegions = (db: GameDatabase, clubId: EntityId, worldDate = "2026-08-01"): ExternalFootballRegion[] => {
  const profile = new RecruitmentRepository(db).clubRecruitmentProfile(clubId);
  if (!profile) return [];
  if (profile.networkReach === "GLOBAL") return Object.keys(REGION_COUNTRIES) as ExternalFootballRegion[];
  const regions: ExternalFootballRegion[] = ["SOUTH_ASIA"];
  if (profile.networkReach === "SOUTH_ASIA" || profile.internationalKnowledge >= 0.2) regions.push("WIDER_ASIA");
  if (profile.internationalKnowledge >= 0.2) regions.push("AFRICA");
  if (profile.internationalKnowledge >= 0.28 && profile.networkReach !== "REGIONAL") regions.push("EUROPE");
  for (const partnership of activeScoutingPartnerships(db, clubId, worldDate)) {
    const region = clubRegion(db, partnership.toClubId);
    if (region && !regions.includes(region)) regions.push(region);
  }
  for (const relatedClubId of new ClubNetworkRepository(db).activeRelatedClubIds(clubId, worldDate)) {
    const region = clubRegion(db, relatedClubId);
    if (region && !regions.includes(region)) regions.push(region);
  }
  return regions;
};

export const searchRegionalCandidatesForClub = (
  db: GameDatabase,
  clubId: EntityId,
  filters: RecruitmentSearchFilters = {},
  worldDate = "2026-08-01",
  limit = 12,
): RecruitmentSearchResult[] => {
  const partnerships = activeScoutingPartnerships(db, clubId, worldDate);
  const accessible = new Set(accessibleRecruitmentRegions(db, clubId, worldDate));
  const partnerClubIds = new Set([
    ...partnerships.map((partnership) => partnership.toClubId),
    ...new ClubNetworkRepository(db).activeRelatedClubIds(clubId, worldDate),
  ]);
  const visible = searchPlayersForClub(db, clubId, filters, worldDate);
  // A partnership supplies a small discovery signal for players at the actual
  // partner club. It is derived per search, not accumulated in save state, and
  // remains MINIMAL so exact knowledge and ordinary filters still govern.
  const visibleIds = new Set(visible.map((candidate) => candidate.playerId));
  for (const partnerClubId of partnerClubIds) {
    for (const player of playersForClub(db, partnerClubId)) {
      if (!visibleIds.has(player.playerId)) {
        const derived = searchResult(
          player,
          knowledgeFor(player, clubId, {
            level: "MINIMAL",
            discoveryStatus: "DISCOVERED",
            confidence: "LOW",
            sourceType: "PUBLIC",
            observations: 1,
            date: worldDate,
            seed: `partnership:${clubId}:${player.playerId}`,
          }),
        );
        if (passesFilters(derived, filters, worldDate, db)) visible.push(derived);
      }
    }
  }
  return visible
    .map((candidate) => candidate)
    .filter((candidate) => candidate.marketRegion && accessible.has(candidate.marketRegion))
    .sort((a, b) => String(a.marketRegion).localeCompare(String(b.marketRegion)) || String(a.playerId).localeCompare(String(b.playerId)))
    .slice(0, Math.max(1, Math.min(limit, 24)));
};

/** Derived, minimal candidate access for an active preferred-transfer source. */
export const searchPreferredTransferCandidatesForClub = (
  db: GameDatabase,
  clubId: EntityId,
  partnerClubIds: readonly EntityId[],
  worldDate = "2026-08-01",
): RecruitmentSearchResult[] => {
  const recruitment = new RecruitmentRepository(db);
  const results: RecruitmentSearchResult[] = [];
  const seen = new Set<EntityId>();
  for (const partnerClubId of [...new Set(partnerClubIds)].sort()) {
    for (const player of playersForClub(db, partnerClubId)) {
      if (seen.has(player.playerId)) continue;
      seen.add(player.playerId);
      const existing = recruitment.playerKnowledge(clubId, player.playerId);
      const knowledge = existing ?? knowledgeFor(player, clubId, {
        level: "MINIMAL",
        discoveryStatus: "DISCOVERED",
        confidence: "LOW",
        sourceType: "PUBLIC",
        observations: 1,
        date: worldDate,
        seed: `preferred-transfer:${clubId}:${player.playerId}`,
      });
      results.push(searchResult(player, knowledge));
    }
  }
  return results;
};

const activeScoutingPartnerships = (
  db: GameDatabase,
  clubId: EntityId,
  worldDate: string,
) => new ClubNetworkRepository(db).activeScoutingPartnerships(clubId, worldDate);

const clubRegion = (db: GameDatabase, clubId: EntityId): ExternalFootballRegion | undefined => {
  const row = db.prepare("SELECT co.iso_code AS iso_code FROM clubs c LEFT JOIN countries co ON co.id = c.country_id WHERE c.id = ? LIMIT 1").get(clubId) as { iso_code?: string } | undefined;
  return countryToRecruitmentRegion(row?.iso_code);
};

export const createScoutingAssignment = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    targetPlayerId?: EntityId;
    targetClubId?: EntityId;
    targetCompetitionId?: EntityId;
    targetLocationId?: EntityId;
    scoutPersonId?: EntityId;
    startedAt: string;
    priority?: ScoutingAssignmentPriority;
  },
): ScoutingAssignment => {
  const priority = input.priority ?? "NORMAL";
  const days = priority === "HIGH" ? 7 : priority === "LOW" ? 21 : 14;
  const assignment: ScoutingAssignment = {
    id: createStableEntityId(
      "scouting-assignment",
      `${input.clubId}:${input.targetPlayerId ?? input.targetClubId ?? input.targetCompetitionId ?? input.targetLocationId}:${input.startedAt}:${priority}`,
    ),
    clubId: input.clubId,
    scoutPersonId: input.scoutPersonId,
    assignmentType: input.targetPlayerId
      ? "PLAYER"
      : input.targetClubId
        ? "CLUB"
        : input.targetCompetitionId
          ? "COMPETITION"
          : "REGION",
    targetPlayerId: input.targetPlayerId,
    targetClubId: input.targetClubId,
    targetCompetitionId: input.targetCompetitionId,
    targetLocationId: input.targetLocationId,
    startedAt: input.startedAt,
    expectedCompletionAt: addDays(input.startedAt, days),
    status: "ACTIVE",
    priority,
  };
  new RecruitmentRepository(db).insertAssignment(assignment);
  return assignment;
};

export const scoutingCoverage = (db: GameDatabase, clubId: EntityId, worldDate: string): ScoutingCoverage => {
  const recruitment = new RecruitmentRepository(db); const profile = recruitment.clubRecruitmentProfile(clubId); const staff = db.prepare("SELECT COUNT(*) AS count FROM staff_appointments WHERE club_id=? AND employment_status='ACTIVE' AND role IN ('SCOUT','RECRUITMENT_ANALYST','HEAD_SCOUT')").get(clubId) as { count?: number } | undefined; const budget = profile?.scoutingBudget ?? 0; const quality = Math.min(10, (staff?.count ?? 0) * 2 + (profile?.domesticKnowledge ?? 0) / 10); return { clubId, reachable: Boolean(profile && budget > 0 && (staff?.count ?? 0) > 0), effectiveQuality: quality, budgetAvailable: budget, rationale: profile ? `Coverage ${profile.networkReach} with ${staff?.count ?? 0} active scouting staff on a ${budget} budget.` : "No recruitment network profile is available." };
};

export const planScoutingAssignment = (db: GameDatabase, input: Parameters<typeof createScoutingAssignment>[1]): ScoutingAssignment => {
  const coverage = scoutingCoverage(db, input.clubId, input.startedAt); if (!coverage.reachable) throw new Error("Scouting network cannot support this assignment"); return createScoutingAssignment(db, input);
};

export const simulateScoutingDay = (input: {
  db: GameDatabase;
  worldDate: string;
  seed: string;
}): { assignmentsCompleted: number } => {
  const recruitment = new RecruitmentRepository(input.db);
  let completed = 0;
  for (const assignment of recruitment.activeAssignments(input.worldDate)) {
    const targets = assignmentTargets(input.db, assignment);
    for (const player of targets) {
      const existing = recruitment.playerKnowledge(assignment.clubId, player.playerId);
      const nextLevel = improveLevel(existing?.knowledgeLevel ?? "MINIMAL", assignment.priority);
      const observations = (existing?.observations ?? 0) + (assignment.priority === "HIGH" ? 3 : 2);
      const knowledge = knowledgeFor(player, assignment.clubId, {
        level: nextLevel,
        discoveryStatus: "SCOUTED",
        confidence:
          nextLevel === "GOOD" || nextLevel === "EXTENSIVE" || nextLevel === "COMPLETE"
            ? "MEDIUM"
            : "LOW",
        sourceType: "SCOUT_REPORT",
        observations,
        date: input.worldDate,
        seed: `${input.seed}:${assignment.id}`,
      });
      recruitment.upsertPlayerKnowledge(knowledge);
      recruitment.insertScoutReport(
        generateScoutReport(
          input.db,
          assignment.clubId,
          player.playerId,
          input.worldDate,
          input.seed,
          assignment.scoutPersonId,
        ),
      );
    }
    recruitment.markAssignmentCompleted(assignment.id);
    completed += 1;
  }
  return { assignmentsCompleted: completed };
};

export const completeScoutingAssignment = (
  db: GameDatabase,
  assignmentId: EntityId,
  worldDate: string,
  seed: string,
): { reportsGenerated: number } => {
  const assignment = new RecruitmentRepository(db)
    .activeAssignments(worldDate)
    .find((item) => item.id === assignmentId);
  if (!assignment) {
    return { reportsGenerated: 0 };
  }
  const recruitment = new RecruitmentRepository(db);
  let reportsGenerated = 0;
  for (const player of assignmentTargets(db, assignment)) {
    const existing = recruitment.playerKnowledge(assignment.clubId, player.playerId);
    const nextLevel = improveLevel(existing?.knowledgeLevel ?? "MINIMAL", assignment.priority);
    recruitment.upsertPlayerKnowledge(
      knowledgeFor(player, assignment.clubId, {
        level: nextLevel,
        discoveryStatus: "SCOUTED",
        confidence: levelRank[nextLevel] >= levelRank.GOOD ? "MEDIUM" : "LOW",
        sourceType: "SCOUT_REPORT",
        observations: (existing?.observations ?? 0) + (assignment.priority === "HIGH" ? 3 : 2),
        date: worldDate,
        seed: `${seed}:${assignment.id}`,
      }),
    );
    recruitment.insertScoutReport(
      generateScoutReport(
        db,
        assignment.clubId,
        player.playerId,
        worldDate,
        seed,
        assignment.scoutPersonId,
      ),
    );
    reportsGenerated += 1;
  }
  recruitment.markAssignmentCompleted(assignment.id);
  return { reportsGenerated };
};

export const recordMatchObservation = (
  db: GameDatabase,
  observerClubId: EntityId,
  opponentPlayerIds: readonly EntityId[],
  observedAt: string,
  seed: string,
): void => {
  const recruitment = new RecruitmentRepository(db);
  const playerIds = [...new Set(opponentPlayerIds)];
  const playersById = new Map(
    truePlayers(db, playerIds).map((player) => [player.playerId, player]),
  );
  for (const playerId of playerIds) {
    const player = playersById.get(playerId);
    if (!player) {
      continue;
    }
    const existing = recruitment.playerKnowledge(observerClubId, playerId);
    const nextLevel = improveLevel(existing?.knowledgeLevel ?? "NONE", "LOW");
    recruitment.upsertPlayerKnowledge(
      knowledgeFor(player, observerClubId, {
        level: nextLevel,
        discoveryStatus: levelRank[nextLevel] >= levelRank.BASIC ? "KNOWN" : "DISCOVERED",
        confidence: levelRank[nextLevel] >= levelRank.GOOD ? "MEDIUM" : "LOW",
        sourceType: "MATCH_OBSERVATION",
        observations: (existing?.observations ?? 0) + 1,
        date: observedAt,
        seed,
      }),
    );
  }
};

export const generateScoutReport = (
  db: GameDatabase,
  clubId: EntityId,
  playerId: EntityId,
  generatedAt: string,
  seed: string,
  scoutId?: EntityId,
): ScoutReport => {
  const recruitment = new RecruitmentRepository(db);
  const player = truePlayer(db, playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  const knowledge =
    recruitment.playerKnowledge(clubId, playerId) ??
    knowledgeFor(player, clubId, {
      level: "MINIMAL",
      discoveryStatus: "DISCOVERED",
      confidence: "LOW",
      sourceType: "PUBLIC",
      observations: 1,
      date: generatedAt,
      seed,
    });
  const known = decayKnowledge(knowledge, generatedAt);
  const ability =
    (known.abilityKnowledge.estimatedAbility as KnowledgeRange | undefined) ??
    estimateRange(player.currentAbility, "MINIMAL", seed);
  const potential = String(
    known.potentialKnowledge.estimatedPotential ?? potentialBand(player.potentialAbility, "BASIC"),
  );
  return {
    id: createStableEntityId(
      "scout-report",
      `${clubId}:${playerId}:${generatedAt}:${known.observations}`,
    ),
    playerId,
    observerClubId: clubId,
    scoutId,
    estimatedAbilityBand: ability,
    estimatedPotentialBand: potential,
    strengths: visibleStrengths(player, known.knowledgeLevel),
    weaknesses: visibleWeaknesses(player, known.knowledgeLevel),
    positionAssessment: String(
      known.positionKnowledge.exactPosition ?? known.positionKnowledge.positionGroup ?? "Unknown",
    ),
    roleAssessment: roleAssessment(player, ability),
    personalityAssessment: personalityAssessment(player, known.knowledgeLevel),
    medicalAssessment: medicalAssessment(player, known.knowledgeLevel),
    recommendation: recommendation(ability, potential),
    confidence: known.confidence,
    observations: known.observations,
    generatedAt,
  };
};

export const addPlayerToShortlist = (
  db: GameDatabase,
  item: Omit<ClubShortlistItem, "id" | "scoutingStatus"> & {
    scoutingStatus?: ClubShortlistItem["scoutingStatus"];
  },
): ClubShortlistItem => {
  const shortlistItem: ClubShortlistItem = {
    id: createStableEntityId("club-shortlist", `${item.clubId}:${item.playerId}`),
    clubId: item.clubId,
    playerId: item.playerId,
    addedAt: item.addedAt,
    priority: item.priority,
    notes: item.notes,
    scoutingStatus: item.scoutingStatus ?? "NONE",
  };
  new RecruitmentRepository(db).addShortlistItem(shortlistItem);
  return shortlistItem;
};

export const removePlayerFromShortlist = (
  db: GameDatabase,
  clubId: EntityId,
  playerId: EntityId,
): void => {
  new RecruitmentRepository(db).removeShortlistItem(clubId, playerId);
};

export const runScoutingDiagnostic = (
  db: GameDatabase,
  input: { clubKey?: string; seed: string; worldDate: string },
): ScoutingDiagnostic => {
  const club = input.clubKey
    ? clubByCanonical(db, input.clubKey)!
    : clubByCanonical(db, "NEP-DIVA-MAC")!;
  initializeRecruitmentForSave({ db, worldDate: input.worldDate, seed: input.seed });
  const candidates = allTruePlayers(db).filter((player) => player.currentClubId !== club.id);
  const obscure = candidates.sort(
    (a, b) => a.appearances - b.appearances || String(a.playerId).localeCompare(String(b.playerId)),
  )[0]!;
  const before =
    searchPlayersForClub(db, club.id, {}, input.worldDate).find(
      (item) => item.playerId === obscure.playerId,
    ) ?? searchResult(obscure, undefined);
  createScoutingAssignment(db, {
    clubId: club.id,
    targetPlayerId: obscure.playerId,
    startedAt: input.worldDate,
    priority: "HIGH",
  });
  const completed = simulateScoutingDay({
    db,
    worldDate: addDays(input.worldDate, 7),
    seed: input.seed,
  });
  const after = searchPlayersForClub(db, club.id, {}, addDays(input.worldDate, 7)).find(
    (item) => item.playerId === obscure.playerId,
  )!;
  const report = generateScoutReport(
    db,
    club.id,
    obscure.playerId,
    addDays(input.worldDate, 7),
    input.seed,
  );
  const knowledge = new RecruitmentRepository(db).playerKnowledgeForClub(club.id);
  return {
    clubId: club.id,
    clubName: club.name,
    knownPlayers: knowledge.filter((item) => levelRank[item.knowledgeLevel] >= levelRank.BASIC)
      .length,
    discoveredPlayers: knowledge.length,
    fullyUnknownPlayers: allTruePlayers(db).length - knowledge.length,
    assignmentsCompleted: completed.assignmentsCompleted,
    averageKnowledge: round(
      knowledge.reduce((total, item) => total + levelRank[item.knowledgeLevel], 0) /
        Math.max(1, knowledge.length),
    ),
    before,
    after,
    report,
  };
};

const knowledgeFor = (
  player: TruePlayer,
  clubId: EntityId,
  input: {
    level: PlayerKnowledgeLevel;
    discoveryStatus: PlayerDiscoveryStatus;
    confidence: KnowledgeConfidence;
    sourceType: PlayerKnowledgeSourceType;
    observations: number;
    date: string;
    seed: string;
  },
): PlayerKnowledge => {
  const exactPositionVisible = levelRank[input.level] >= levelRank.GOOD;
  const personalityVisible = levelRank[input.level] >= levelRank.EXTENSIVE;
  return {
    id: createStableEntityId("player-knowledge", `CLUB:${clubId}:${player.playerId}`),
    observerType: "CLUB",
    observerOrganisationId: clubId,
    playerId: player.playerId,
    discoveryStatus: input.discoveryStatus,
    knowledgeLevel: input.level,
    confidence: input.confidence,
    sourceType: input.sourceType,
    identityKnowledge: {
      name: player.fullName,
      nationality: player.nationality ?? "Nepal",
      clubId: player.currentClubId,
    },
    positionKnowledge: {
      positionGroup: player.factualPositionGroup ?? positionGroup(player.simulationPosition),
      exactPosition: exactPositionVisible ? player.simulationPosition : undefined,
      exactPositionStatus: exactPositionVisible ? "GAMEPLAY_KNOWLEDGE" : undefined,
    },
    abilityKnowledge: {
      estimatedAbility: estimateRange(player.currentAbility, input.level, input.seed),
      rangeOnly: true,
    },
    potentialKnowledge: {
      estimatedPotential: potentialBand(player.potentialAbility, input.level),
      rangeOnly: true,
    },
    contractKnowledge: {
      status:
        input.sourceType === "OWN_PLAYER"
          ? "Known internally"
          : "Contracted or recently registered",
      exactDetailsVisible: input.sourceType === "OWN_PLAYER",
    },
    personalityKnowledge: personalityVisible
      ? {
          professionalism: traitBand(player.hiddenTraits.professionalism),
          consistency: traitBand(player.hiddenTraits.consistency),
        }
      : { summary: "Unknown" },
    medicalKnowledge: { concern: medicalAssessment(player, input.level) },
    careerKnowledge: {
      recentAppearances: player.appearances,
      recentGoals: player.goals,
      recentCards: player.yellowCards + player.redCards,
    },
    observations: input.observations,
    lastObservedAt: input.date,
    lastScoutedAt: input.sourceType === "SCOUT_REPORT" ? input.date : undefined,
    updatedAt: input.date,
  };
};

const defaultClubRecruitmentProfile = (
  club: { id: EntityId; canonicalExternalId?: string; name: string },
  seed: string,
): ClubRecruitmentProfile => {
  const rng = new SeededRandom(`${seed}:recruitment:${club.id}`);
  const topClub =
    club.canonicalExternalId?.startsWith("NEP-DEP-") ||
    ["NEP-DIVA-MAC", "NEP-DIVA-MMC", "NEP-DIVA-CBU"].includes(club.canonicalExternalId ?? "");
  const nsl = club.canonicalExternalId?.startsWith("NEP-NSL-");
  return {
    id: createStableEntityId("club-recruitment-profile", club.id),
    clubId: club.id,
    domesticKnowledge: round((topClub ? 0.72 : nsl ? 0.64 : 0.52) + rng.next() * 0.1),
    regionalKnowledge: round((topClub || nsl ? 0.42 : 0.26) + rng.next() * 0.08),
    internationalKnowledge: round((nsl ? 0.24 : topClub ? 0.18 : 0.08) + rng.next() * 0.04),
    scoutingBudget: topClub ? 45 : nsl ? 40 : 18,
    networkReach: nsl ? "SOUTH_ASIA" : topClub ? "NATIONAL" : "REGIONAL",
    preferredMarkets: topClub || nsl ? ["Nepal", "South Asia"] : ["Nepal"],
    status: "SIMULATION_ONLY",
  };
};

const decayKnowledge = (knowledge: PlayerKnowledge, worldDate: string): PlayerKnowledge => {
  const months = monthsBetween(knowledge.updatedAt, worldDate);
  if (months < 12 || knowledge.sourceType === "OWN_PLAYER") {
    return knowledge;
  }
  const decay = months >= 24 ? 2 : 1;
  const nextLevel = levels[Math.max(1, levelRank[knowledge.knowledgeLevel] - decay)]!;
  return {
    ...knowledge,
    knowledgeLevel: nextLevel,
    confidence: nextLevel === "MINIMAL" || nextLevel === "BASIC" ? "LOW" : "MEDIUM",
    abilityKnowledge: {
      ...knowledge.abilityKnowledge,
      stale: true,
    },
    contractKnowledge: {
      ...knowledge.contractKnowledge,
      stale: true,
    },
  };
};

const estimateRange = (
  actual: number,
  level: PlayerKnowledgeLevel,
  seed: string,
): KnowledgeRange => {
  const width = { NONE: 10, MINIMAL: 7, BASIC: 5, GOOD: 2, EXTENSIVE: 1, COMPLETE: 1 }[level];
  const rng = new SeededRandom(`${seed}:estimate:${actual}:${level}`);
  const bias = (rng.next() - 0.5) * Math.max(1, width / 2);
  const center = actual + bias;
  return {
    min: Math.max(1, Math.floor(center - width / 2)),
    max: Math.min(20, Math.ceil(center + width / 2)),
  };
};

const potentialBand = (actual: number, level: PlayerKnowledgeLevel): string => {
  const shifted = actual - (levelRank[level] < levelRank.GOOD ? 1.2 : 0);
  if (shifted >= 15) return "Exceptional for Level";
  if (shifted >= 13) return "High Potential";
  if (shifted >= 11) return "Promising";
  if (shifted >= 9) return "Could Improve";
  return "Limited";
};

const searchResult = (
  player: TruePlayer,
  knowledge: PlayerKnowledge | undefined,
): RecruitmentSearchResult => ({
  playerId: player.playerId,
  name: knowledge?.identityKnowledge.name as string | undefined,
  discoveryStatus: knowledge?.discoveryStatus ?? "UNDISCOVERED",
  knowledgeLevel: knowledge?.knowledgeLevel ?? "NONE",
  confidence: knowledge?.confidence ?? "LOW",
  clubId: knowledge?.identityKnowledge.clubId as EntityId | undefined,
  publicPositionGroup: knowledge?.positionKnowledge.positionGroup as string | undefined,
  knownPosition: knowledge?.positionKnowledge.exactPosition as string | undefined,
  estimatedAbility: knowledge?.abilityKnowledge.estimatedAbility as KnowledgeRange | undefined,
  estimatedPotential: knowledge?.potentialKnowledge.estimatedPotential as string | undefined,
  recentAppearances: knowledge?.careerKnowledge.recentAppearances as number | undefined,
  marketRegion: player.marketRegion,
});

const passesFilters = (
  result: RecruitmentSearchResult,
  filters: RecruitmentSearchFilters,
  worldDate: string,
  db: GameDatabase,
): boolean => {
  if (result.discoveryStatus === "UNDISCOVERED") return false;
  if (filters.position && result.knownPosition !== filters.position) return false;
  if (filters.positionGroup && result.publicPositionGroup !== filters.positionGroup) return false;
  if (filters.nationality) {
    const player = truePlayer(db, result.playerId);
    if ((player?.nationality ?? "Nepal") !== filters.nationality) return false;
  }
  if (filters.clubId && result.clubId !== filters.clubId) return false;
  if (
    filters.estimatedAbilityMin &&
    (!result.estimatedAbility || result.estimatedAbility.max < filters.estimatedAbilityMin)
  )
    return false;
  if (
    filters.estimatedPotentialBand &&
    result.estimatedPotential !== filters.estimatedPotentialBand
  )
    return false;
  if (filters.ageMin !== undefined || filters.ageMax !== undefined) {
    const player = truePlayer(db, result.playerId);
    const age = player?.dateOfBirth ? ageOn(player.dateOfBirth, worldDate) : undefined;
    if (age === undefined) return false;
    if (filters.ageMin !== undefined && age < filters.ageMin) return false;
    if (filters.ageMax !== undefined && age > filters.ageMax) return false;
  }
  return true;
};

const assignmentTargets = (db: GameDatabase, assignment: ScoutingAssignment): TruePlayer[] => {
  if (assignment.targetPlayerId) {
    const player = truePlayer(db, assignment.targetPlayerId);
    return player ? [player] : [];
  }
  if (assignment.targetClubId) return playersForClub(db, assignment.targetClubId);
  return [];
};

const improveLevel = (
  current: PlayerKnowledgeLevel,
  priority: ScoutingAssignmentPriority,
): PlayerKnowledgeLevel => {
  const step = priority === "HIGH" ? 2 : 1;
  return levels[Math.min(levels.length - 2, levelRank[current] + step)]!;
};

const allTruePlayers = (db: GameDatabase): TruePlayer[] => truePlayers(db);

const truePlayers = (db: GameDatabase, playerIds?: readonly EntityId[]): TruePlayer[] => {
  const ids = playerIds?.filter(Boolean) ?? [];
  if (playerIds && ids.length === 0) {
    return [];
  }
  const where = ids.length > 0 ? `WHERE p.id IN (${ids.map(() => "?").join(",")})` : "";
  return db
    .prepare(
      `SELECT p.id AS player_id, p.full_name, p.date_of_birth, COALESCE(pfp.current_club_id, pc.club_id) AS current_club_id,
        co.iso_code AS market_region,
        pfp.factual_json, pfp.simulation_json, pa.primary_position, pa.technical_json,
        pa.mental_json, pa.physical_json, pa.goalkeeping_json, tpa.team_id,
        COALESCE(SUM(pss.appearances), 0) AS appearances,
        COALESCE(SUM(pss.goals), 0) AS goals,
        COALESCE(SUM(pss.assists), 0) AS assists,
        COALESCE(SUM(pss.yellow_cards), 0) AS yellow_cards,
        COALESCE(SUM(pss.red_cards), 0) AS red_cards
      FROM persons p
      LEFT JOIN player_factual_profiles pfp ON pfp.player_id = p.id
      LEFT JOIN player_attributes pa ON pa.person_id = p.id
      LEFT JOIN player_contracts pc ON pc.player_id = p.id AND pc.status = 'ACTIVE'
      LEFT JOIN clubs c ON c.id = COALESCE(pfp.current_club_id, pc.club_id)
      LEFT JOIN countries co ON co.id = c.country_id
      LEFT JOIN team_person_assignments tpa ON tpa.person_id = p.id AND tpa.role = 'PLAYER'
      LEFT JOIN player_season_stats pss ON pss.person_id = p.id
      ${where}
      GROUP BY p.id
      ORDER BY p.full_name, p.id`,
    )
    .all(...ids)
    .map(mapTruePlayer);
};

const truePlayer = (db: GameDatabase, playerId: EntityId): TruePlayer | undefined =>
  truePlayers(db, [playerId])[0];

const playersForClub = (db: GameDatabase, clubId: EntityId): TruePlayer[] =>
  db
    .prepare(
      `SELECT p.id AS player_id, p.full_name, p.date_of_birth, COALESCE(pfp.current_club_id, pc.club_id) AS current_club_id,
        co.iso_code AS market_region,
        pfp.factual_json, pfp.simulation_json, pa.primary_position, pa.technical_json,
        pa.mental_json, pa.physical_json, pa.goalkeeping_json, tpa.team_id,
        COALESCE(SUM(pss.appearances), 0) AS appearances,
        COALESCE(SUM(pss.goals), 0) AS goals,
        COALESCE(SUM(pss.assists), 0) AS assists,
        COALESCE(SUM(pss.yellow_cards), 0) AS yellow_cards,
        COALESCE(SUM(pss.red_cards), 0) AS red_cards
      FROM persons p
      LEFT JOIN player_factual_profiles pfp ON pfp.player_id = p.id
      LEFT JOIN player_attributes pa ON pa.person_id = p.id
      LEFT JOIN player_contracts pc ON pc.player_id = p.id AND pc.status = 'ACTIVE'
      LEFT JOIN clubs c ON c.id = COALESCE(pfp.current_club_id, pc.club_id)
      LEFT JOIN countries co ON co.id = c.country_id
      LEFT JOIN team_person_assignments tpa ON tpa.person_id = p.id AND tpa.role = 'PLAYER'
      LEFT JOIN player_season_stats pss ON pss.person_id = p.id
      WHERE COALESCE(pfp.current_club_id, pc.club_id) = ?
      GROUP BY p.id
      ORDER BY p.full_name, p.id`,
    )
    .all(clubId)
    .map(mapTruePlayer);

const playersSharingCompetitions = (db: GameDatabase, clubId: EntityId): TruePlayer[] => {
  const seasonIds = db
    .prepare(
      "SELECT competition_season_id FROM club_memberships WHERE club_id = ? AND competition_season_id IS NOT NULL",
    )
    .all(clubId)
    .map((row: any) => row.competition_season_id as EntityId);
  if (seasonIds.length === 0) return [];
  const clubsInSameCompetitions = new Set(
    db
      .prepare(
        `SELECT DISTINCT club_id FROM club_memberships
        WHERE competition_season_id IN (${seasonIds.map(() => "?").join(",")})`,
      )
      .all(...seasonIds)
      .map((row: any) => row.club_id as EntityId),
  );
  clubsInSameCompetitions.delete(clubId);
  const clubIds = [...clubsInSameCompetitions];
  if (clubIds.length === 0) return [];
  return db
    .prepare(
      `SELECT p.id AS player_id, p.full_name, p.date_of_birth, pfp.current_club_id,
        pfp.factual_json, pfp.simulation_json, pa.primary_position, pa.technical_json,
        pa.mental_json, pa.physical_json, pa.goalkeeping_json, tpa.team_id,
        COALESCE(SUM(pss.appearances), 0) AS appearances,
        COALESCE(SUM(pss.goals), 0) AS goals,
        COALESCE(SUM(pss.assists), 0) AS assists,
        COALESCE(SUM(pss.yellow_cards), 0) AS yellow_cards,
        COALESCE(SUM(pss.red_cards), 0) AS red_cards
      FROM persons p
      JOIN player_factual_profiles pfp ON pfp.player_id = p.id
      LEFT JOIN player_attributes pa ON pa.person_id = p.id
      LEFT JOIN team_person_assignments tpa ON tpa.person_id = p.id AND tpa.role = 'PLAYER'
      LEFT JOIN player_season_stats pss ON pss.person_id = p.id
      WHERE pfp.current_club_id IN (${clubIds.map(() => "?").join(",")})
      GROUP BY p.id
      ORDER BY p.full_name, p.id`,
    )
    .all(...clubIds)
    .map(mapTruePlayer);
};

const mapTruePlayer = (row: any): TruePlayer => {
  const factual = JSON.parse(row.factual_json ?? "{}");
  const simulation = JSON.parse(row.simulation_json ?? "{}");
  const technical = JSON.parse(row.technical_json ?? "{}");
  const mental = JSON.parse(row.mental_json ?? "{}");
  const physical = JSON.parse(row.physical_json ?? "{}");
  const goalkeeping = JSON.parse(row.goalkeeping_json ?? "{}");
  const factualPosition = factual.primary_position as PlayerPosition | undefined;
  return {
    playerId: row.player_id,
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth ?? simulation.simulationDateOfBirth,
    currentClubId: row.current_club_id ?? undefined,
    teamId: row.team_id ?? undefined,
    nationality: factual.nationality,
    factualPositionGroup: factual.factualPositionGroup ?? (factualPosition ? positionGroup(factualPosition) : undefined),
    simulationPosition: simulation.simulationPrimaryPosition ?? row.primary_position ?? factualPosition ?? "MID",
    currentAbility:
      simulation.currentAbility ?? (Object.keys({ ...technical, ...mental, ...physical }).length > 0 ? averageObject({ ...technical, ...mental, ...physical }) : 7),
    potentialAbility: simulation.potentialAbility ?? 10,
    hiddenTraits: simulation.hiddenTraits ?? {},
    attributes: { ...technical, ...mental, ...physical, ...goalkeeping },
    appearances: Number(row.appearances ?? 0),
    goals: Number(row.goals ?? 0),
    assists: Number(row.assists ?? 0),
    yellowCards: Number(row.yellow_cards ?? 0),
    redCards: Number(row.red_cards ?? 0),
    marketRegion: countryToRecruitmentRegion(row.market_region),
  };
};

const clubs = (
  db: GameDatabase,
): Array<{ id: EntityId; name: string; canonicalExternalId?: string }> =>
  db
    .prepare("SELECT id, name, canonical_external_id FROM clubs ORDER BY name")
    .all()
    .map((row: any) => ({
      id: row.id,
      name: row.name,
      canonicalExternalId: row.canonical_external_id ?? undefined,
    }));

const clubByCanonical = (
  db: GameDatabase,
  canonicalExternalId: string,
): { id: EntityId; name: string; canonicalExternalId?: string } | undefined =>
  clubs(db).find((club) => club.canonicalExternalId === canonicalExternalId);

const visibleStrengths = (player: TruePlayer, level: PlayerKnowledgeLevel): string[] => {
  if (levelRank[level] < levelRank.BASIC) return [];
  return sortedAttributes(player)
    .slice(0, levelRank[level] >= levelRank.GOOD ? 3 : 1)
    .map(([name]) => name);
};

const visibleWeaknesses = (player: TruePlayer, level: PlayerKnowledgeLevel): string[] => {
  if (levelRank[level] < levelRank.GOOD) return [];
  return sortedAttributes(player)
    .slice(-2)
    .map(([name]) => name);
};

const sortedAttributes = (player: TruePlayer): Array<[string, number]> =>
  Object.entries(player.attributes)
    .filter(([, value]) => typeof value === "number")
    .sort(([, a], [, b]) => b - a);

const roleAssessment = (player: TruePlayer, ability: KnowledgeRange): string =>
  ability.max >= 11
    ? `Can contribute as ${player.simulationPosition}`
    : `Depth option at ${player.simulationPosition}`;

const personalityAssessment = (player: TruePlayer, level: PlayerKnowledgeLevel): string =>
  levelRank[level] >= levelRank.EXTENSIVE
    ? `Professionalism ${traitBand(player.hiddenTraits.professionalism)}, consistency ${traitBand(player.hiddenTraits.consistency)}`
    : "Unknown";

const medicalAssessment = (player: TruePlayer, level: PlayerKnowledgeLevel): string => {
  if (levelRank[level] < levelRank.GOOD) return "Unknown";
  const injury = player.hiddenTraits.injuryProneness ?? 8;
  if (injury >= 15) return "Significant Concern";
  if (injury >= 10) return "Some Concern";
  return "Low Concern";
};

const recommendation = (ability: KnowledgeRange, potential: string): ScoutReportRecommendation => {
  if (potential === "High Potential" || potential === "Exceptional for Level") return "PROSPECT";
  if (ability.min >= 10) return "STARTER";
  if (ability.max >= 9) return "ROTATION";
  if (ability.max >= 7) return "BACKUP";
  return "DO_NOT_SIGN";
};

const traitBand = (value: number | undefined): string => {
  if (value === undefined) return "Unknown";
  if (value >= 15) return "High";
  if (value >= 9) return "Moderate";
  return "Low";
};

const positionGroup = (position: PlayerPosition): string => {
  if (position === "GK") return "GOALKEEPER";
  if (["CB", "LB", "RB"].includes(position)) return "DEFENDER";
  if (["DM", "CM", "AM"].includes(position)) return "MIDFIELDER";
  return "FORWARD";
};

const ageOn = (dateOfBirth: string, worldDate: string): number =>
  Math.floor(
    (Date.parse(`${worldDate}T00:00:00.000Z`) - Date.parse(`${dateOfBirth}T00:00:00.000Z`)) /
      31557600000,
  );

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const monthsBetween = (from: string, to: string): number =>
  Math.max(
    0,
    Math.floor(
      (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 2629800000,
    ),
  );

const averageObject = (values: Record<string, number>): number => {
  const numbers = Object.values(values).filter((value) => typeof value === "number");
  return numbers.reduce((total, value) => total + value, 0) / Math.max(1, numbers.length);
};

const round = (value: number): number => Math.round(value * 100) / 100;
