import { CareerWorldRepository, ClubEconomyRepository, CompetitionRepository, ManagerRepository, UniversalInteractionRepository, type GameDatabase } from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type Club,
  type ClubBudgetCategory,
  type EntityId,
  type OwnerManagerCommitmentType,
  type OwnerManagerMeetingOverview,
  type OwnerManagerMeetingStance,
  type OwnerManagerMeetingTopic,
  type UniversalInteraction,
} from "@nepal-football-sim/shared-types";
import { openInteraction, submitInteractionAction } from "./universal-interaction-adapters.js";
import { boardPolitics, buildClubVision } from "./club-vision-politics.js";
import { generatedBoardPolicy } from "./club-economy.js";

export type { OwnerManagerMeetingTopic, OwnerManagerMeetingStance, OwnerManagerCommitmentType } from "@nepal-football-sim/shared-types";

const managerForClub = (db: GameDatabase, clubId: EntityId) => new ManagerRepository(db).allActiveContracts().find((contract) => contract.clubId === clubId);

/**
 * club_board_policies.chairman_person_id is only ever written by the
 * chairman demo/CLI helper (a fake demo person, not the real player) — on
 * every real save it is unset even though the club has a genuine
 * controlling owner. Rather than invent a new authority concept, this
 * resolves the chairman the same way every other authority check in the
 * codebase already determines "the owner" (club_ownership_stakes, active,
 * >=51%), and self-heals the board-policy row so later reads of
 * boardPolicy(clubId).chairmanPersonId — used by boardPolitics,
 * refreshManagerBoardRelationship, and the OWNER_MANAGER_MEETING execution
 * check itself — see the same, now-consistent value.
 *
 * Some real clubs (e.g. ones created after the initial economy seed pass, or
 * otherwise never touched by initializeClubEconomyForSave) have NO
 * club_board_policies row at all, not merely one with an unset
 * chairman_person_id. The self-heal must therefore be able to create the row
 * from scratch — reusing the exact same default-policy generation the
 * initial seed pass uses (generatedBoardPolicy) rather than inventing new
 * defaults — not only update an existing one, or the write is silently
 * dropped and every later authoritative read (including the meeting's own
 * execution step) still sees no chairman and fails.
 */
const resolveChairmanPersonId = (db: GameDatabase, clubId: EntityId, date: string): EntityId | undefined => {
  const economy = new ClubEconomyRepository(db);
  const policy = economy.boardPolicy(clubId);
  if (policy?.chairmanPersonId) return policy.chairmanPersonId;
  const controllingOwner = db
    .prepare(
      "SELECT holder_id FROM club_ownership_stakes WHERE club_id=? AND holder_type='PERSON' AND status='ACTIVE' AND percentage>=51 LIMIT 1",
    )
    .get(clubId) as { holder_id?: EntityId } | undefined;
  if (!controllingOwner?.holder_id) return undefined;
  if (policy) {
    economy.upsertBoardPolicy({ ...policy, chairmanPersonId: controllingOwner.holder_id });
  } else {
    const clubRow = db
      .prepare(
        "SELECT id, name, country_id AS countryId, ownership_type AS ownershipType, organisation_type AS organisationType, canonical_external_id AS canonicalExternalId FROM clubs WHERE id=?",
      )
      .get(clubId) as Club | undefined;
    if (!clubRow) return undefined;
    const club = { ...clubRow, organisationType: clubRow.organisationType ?? undefined, canonicalExternalId: clubRow.canonicalExternalId ?? undefined };
    economy.upsertBoardPolicy({ ...generatedBoardPolicy(club, date), chairmanPersonId: controllingOwner.holder_id });
  }
  return controllingOwner.holder_id;
};

export const createOwnerManagerMeeting = (db: GameDatabase, input: { clubId: EntityId; date: string; topic: OwnerManagerMeetingTopic; deadline?: string }): UniversalInteraction => {
  const chairmanPersonId = resolveChairmanPersonId(db, input.clubId, input.date);
  const contract = managerForClub(db, input.clubId);
  if (!chairmanPersonId || !contract) throw new Error("OWNER_MANAGER_MEETING_REQUIRES_ACTIVE_MANAGER_AND_CHAIRMAN");
  const manager = new ManagerRepository(db).getProfile(contract.managerProfileId);
  if (!manager) throw new Error("OWNER_MANAGER_MEETING_MANAGER_PROFILE_MISSING");
  const confidence = new CareerWorldRepository(db).boardConfidence(input.clubId)?.confidence ?? 60;
  const idempotencySubject = `Owner-manager meeting:${input.clubId}:${input.topic}:${input.date}`;
  const existing = new UniversalInteractionRepository(db).all().find((item) => item.subject === idempotencySubject);
  if (existing) return existing;
  return openInteraction(db, {
    interactionType: "OWNER_MANAGER_MEETING",
    initiator: { type: "CHAIRMAN", entityId: chairmanPersonId },
    counterpart: { type: "MANAGER", entityId: manager.personId },
    organisationId: input.clubId,
    worldDate: input.date,
    subject: idempotencySubject,
    linkedReference: { type: "OWNER_MANAGER_MEETING", canonicalId: input.clubId },
    deadline: input.deadline,
    demands: { topic: input.topic, boardConfidence: confidence, expectation: new ClubEconomyRepository(db).boardPolicy(input.clubId)?.strategicObjective ?? "STABILITY" },
    relationshipState: 60,
    trust: Math.max(70, confidence),
    leverage: 70,
  });
};

export const resolveOwnerManagerMeeting = (db: GameDatabase, input: { interactionId: EntityId; date: string; seed: string; stance: OwnerManagerMeetingStance; commitment?: { type: OwnerManagerCommitmentType; targetCriteria: string; description: string; dueOn: string; importance?: number } }): UniversalInteraction => {
  const repo = new UniversalInteractionRepository(db);
  const current = repo.session(input.interactionId);
  if (!current) throw new Error("OWNER_MANAGER_MEETING_NOT_FOUND");
  if (current.stage === "ACCEPTED" && current.execution?.status === "APPLIED") return current;
  if (current.stage === "OPENED") submitInteractionAction(db, { interactionId: input.interactionId, action: "STATE_POSITION", tone: "PROFESSIONAL", date: input.date, seed: input.seed });
  const updated = repo.session(input.interactionId)!;
  const offers = { ...updated.offers, stance: input.stance, ...(input.commitment ? { commitmentType: input.commitment.type, targetCriteria: input.commitment.targetCriteria, commitmentDescription: input.commitment.description, commitmentDueOn: input.commitment.dueOn, importance: input.commitment.importance ?? 6 } : {}) };
  return submitInteractionAction(db, { interactionId: input.interactionId, action: "ACCEPT", tone: input.stance === "CONCERN" ? "ASSERTIVE" : "SUPPORTIVE", date: input.date, seed: input.seed, offer: offers });
};

export const defaultOwnerManagerStance = (db: GameDatabase, clubId: EntityId): OwnerManagerMeetingStance => {
  const confidence = new CareerWorldRepository(db).boardConfidence(clubId)?.confidence ?? 60;
  return confidence < 40 ? "CONCERN" : confidence >= 70 ? "SUPPORT" : "REQUEST";
};

const RELEVANT_BUDGET_CATEGORIES: ClubBudgetCategory[] = [
  "TRANSFER_BUDGET",
  "WAGE_BUDGET",
  "STAFF_BUDGET",
  "ACADEMY_BUDGET",
  "FACILITY_BUDGET",
];

/**
 * Read model behind the owner-manager meeting UI. Board confidence, budgets,
 * and infrastructure are already-canonical read models reused as-is; league
 * position/form and club vision/board-politics are resolved only when the
 * underlying system has something real to report — this never invents a
 * relationship, vision, or standing that doesn't exist yet.
 */
export const ownerManagerMeetingOverview = (
  db: GameDatabase,
  clubId: EntityId,
  date: string,
): OwnerManagerMeetingOverview => {
  const club = db.prepare("SELECT name FROM clubs WHERE id=?").get(clubId) as { name?: string } | undefined;
  const contract = managerForClub(db, clubId);
  if (!club?.name || !contract) throw new Error(`Club or active manager missing for owner-manager meeting: ${clubId}`);
  const managerRepo = new ManagerRepository(db);
  const profile = managerRepo.getProfile(contract.managerProfileId);
  if (!profile) throw new Error(`Manager profile missing: ${contract.managerProfileId}`);
  const person = db.prepare("SELECT display_name, full_name FROM persons WHERE id=?").get(profile.personId) as
    | { display_name?: string; full_name?: string }
    | undefined;

  const boardConfidence = new CareerWorldRepository(db).boardConfidence(clubId);
  const politics = boardPolitics(db, clubId, profile);
  const vision = buildClubVision(db, clubId, date);

  const membership = contract.teamId
    ? (db
        .prepare(
          "SELECT competition_season_id FROM club_memberships WHERE club_id=? AND status='ACTIVE' ORDER BY competition_season_id DESC LIMIT 1",
        )
        .get(clubId) as { competition_season_id?: EntityId } | undefined)
    : undefined;
  const standings = membership?.competition_season_id
    ? new CompetitionRepository(db).standings(membership.competition_season_id)
    : [];
  const standingIndex = contract.teamId ? standings.findIndex((row) => row.teamId === contract.teamId) : -1;
  const standing = standingIndex >= 0 ? standings[standingIndex] : undefined;

  const recentForm = contract.teamId
    ? (
        db
          .prepare(
            `SELECT m.home_goals, m.away_goals, f.home_team_id
             FROM matches m JOIN fixtures f ON f.id = m.fixture_id
             WHERE (f.home_team_id = ? OR f.away_team_id = ?) AND m.played_date IS NOT NULL
             ORDER BY m.played_date DESC LIMIT 5`,
          )
          .all(contract.teamId, contract.teamId) as Array<{ home_goals: number; away_goals: number; home_team_id: EntityId }>
      ).map((row): "W" | "D" | "L" => {
        const teamGoals = row.home_team_id === contract.teamId ? row.home_goals : row.away_goals;
        const opponentGoals = row.home_team_id === contract.teamId ? row.away_goals : row.home_goals;
        return teamGoals === opponentGoals ? "D" : teamGoals > opponentGoals ? "W" : "L";
      })
    : [];

  const economy = new ClubEconomyRepository(db);
  const interactions = new UniversalInteractionRepository(db)
    .all()
    .filter((item) => item.interactionType === "OWNER_MANAGER_MEETING" && item.organisationId === clubId)
    .sort((a, b) => (a.worldDate < b.worldDate ? 1 : -1));
  const terminal = new Set(["ACCEPTED", "REJECTED", "WALKED_AWAY", "COMPLETED", "CANCELLED"]);

  return {
    clubId,
    clubName: club.name,
    managerPersonId: profile.personId,
    managerProfileId: profile.id,
    managerName: person?.display_name ?? person?.full_name ?? profile.personId,
    boardConfidence: boardConfidence?.confidence ?? 60,
    boardExpectation: boardConfidence?.expectation,
    pressure: politics?.pressure,
    relationshipTrust: politics?.relationshipTrust,
    relationshipTension: politics?.relationshipTension,
    activePromises: politics?.activePromises,
    brokenPromises: politics?.brokenPromises,
    vision: vision
      ? {
          objective: vision.objective,
          identity: vision.identity,
          transferPhilosophy: vision.transferPhilosophy,
          financialHealth: vision.financialHealth,
          youthPriority: vision.priorities?.youth,
        }
      : undefined,
    leaguePosition: standingIndex >= 0 ? standingIndex + 1 : undefined,
    played: standing?.played,
    points: standing?.points,
    recentForm,
    budgets: economy
      .budgets(clubId)
      .filter((budget) => budget.status === "ACTIVE" && RELEVANT_BUDGET_CATEGORIES.includes(budget.category)),
    infrastructure: economy.infrastructureProjects(clubId),
    openMeeting: interactions.find((item) => !terminal.has(item.stage)),
    history: interactions.filter((item) => terminal.has(item.stage)),
  };
};
