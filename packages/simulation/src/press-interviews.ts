import {
  ClubEconomyRepository,
  CompetitionRepository,
  EventRepository,
  FederationGovernanceRepository,
  MediaPhaseBRepository,
  MediaRepository,
  SquadDynamicsRepository,
  TransferMarketRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";

type SqlRow = Record<string, any>;
import {
  createStableEntityId,
  type EntityId,
  type EntityRef,
  type MediaInterview,
  type PressAnswer,
  type PressQuestion,
  type PressQuestionOption,
  type PressQuestionTopic,
  type PressResponseStance,
} from "@nepal-football-sim/shared-types";
import { initializeMediaForSave, initializeMediaJournalists } from "./media.js";
import { adjustRelationship } from "./squad-dynamics.js";
import { createStructuredCommitment } from "./commitments.js";
import { responsibilityOwner } from "./staff-market.js";

/**
 * The structured, context-grounded press-interview flow. This extends the
 * existing MediaOutlet/MediaJournalist/MediaInterview pipeline (media.ts) —
 * it does not create a second press system. A PRE_MATCH/POST_MATCH/TRANSFER/
 * PLAYER_ISSUE interview is a real MediaInterview row, answered through the
 * same journalist-relationship trust mechanism, with the addition of a real
 * multi-question flow and structured, bounded consequences instead of one
 * generic stance and free text.
 */

const personName = (db: GameDatabase, id: EntityId): string => {
  const row = db.prepare("SELECT * FROM persons WHERE id = ?").get(id) as SqlRow | undefined;
  return (row?.display_name as string) ?? (row?.full_name as string) ?? "the player";
};

const teamName = (db: GameDatabase, id: EntityId): string => {
  const row = db.prepare("SELECT name FROM teams WHERE id = ?").get(id) as SqlRow | undefined;
  return (row?.name as string) ?? "the opponent";
};

/** A "club" EntityRef must carry a real clubs.id, never a teams.id — teams
 * and clubs are different tables/ids, and resolving a team id against
 * "club" silently produced "Unknown entity" for every opponent reference
 * until this was caught live. Returns undefined (never fabricates a ref)
 * when the team has no club on record. */
const clubIdForTeam = (db: GameDatabase, teamId: EntityId): EntityId | undefined => {
  const row = db.prepare("SELECT club_id FROM teams WHERE id = ?").get(teamId) as
    | { club_id?: EntityId }
    | undefined;
  return row?.club_id;
};

const managerProfileIdForPerson = (db: GameDatabase, personId: EntityId): EntityId | undefined => {
  const row = db
    .prepare("SELECT id FROM manager_profiles WHERE person_id = ?")
    .get(personId) as SqlRow | undefined;
  return row?.id as EntityId | undefined;
};

// ---------------------------------------------------------------------------
// Candidate topic detection — each one only fires when the real fact it
// names genuinely exists. No topic is ever fabricated.
// ---------------------------------------------------------------------------

type Candidate = {
  topic: PressQuestionTopic;
  prompt: string;
  subjectEntities: EntityRef[];
  priority: number; // higher = asked first when a conference is capped
};

/**
 * Bounded, deterministic decision for whether an upcoming fixture is
 * material enough to naturally offer a pre-match press conference — never
 * every mundane fixture. Reuses the exact same real-context checks
 * preMatchCandidates already performs (never a second data source), so a
 * fixture is only ever offered a conference when it would genuinely produce
 * at least one grounded question beyond the always-present opponent
 * preview: real title/relegation table stakes, a real active player
 * concern/demand, or a real active transfer interest on a squad player.
 */
export const shouldCreatePreMatchPress = (
  db: GameDatabase,
  input: { teamId: EntityId; fixtureId: EntityId },
): { trigger: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  const fixture = db.prepare("SELECT * FROM fixtures WHERE id = ?").get(input.fixtureId) as SqlRow | undefined;
  if (!fixture) return { trigger: false, reasons };

  const standings = new CompetitionRepository(db).standings(fixture.competition_season_id as EntityId);
  if (standings.length > 0) {
    const position = standings.findIndex((row) => row.teamId === input.teamId) + 1;
    const total = standings.length;
    if (position > 0 && (position <= 3 || position > total - 3)) {
      reasons.push(position <= 3 ? "title-race table stakes" : "relegation table stakes");
    }
  }

  const dynamics = new SquadDynamicsRepository(db);
  if (dynamics.concernsForTeam(input.teamId).some((concern) => concern.status !== "RESOLVED")) {
    reasons.push("active player concern");
  }
  if (dynamics.demandsForTeam(input.teamId).some((demand) => demand.status === "OPEN")) {
    reasons.push("active player demand");
  }

  const clubRow = db.prepare("SELECT club_id FROM teams WHERE id = ?").get(input.teamId) as
    | { club_id?: EntityId }
    | undefined;
  if (clubRow?.club_id) {
    const activeStatuses = new Set(["SUBMITTED", "NEGOTIATING", "COUNTERED", "PLAYER_NEGOTIATING", "COMPETING_OFFER"]);
    if (
      new TransferMarketRepository(db)
        .transferOffers()
        .some((offer) => offer.sellingClubId === clubRow.club_id && activeStatuses.has(offer.status))
    ) {
      reasons.push("active transfer interest");
    }
  }

  return { trigger: reasons.length > 0, reasons };
};

const preMatchCandidates = (
  db: GameDatabase,
  input: { teamId: EntityId; fixtureId: EntityId },
): Candidate[] => {
  const fixture = db
    .prepare("SELECT * FROM fixtures WHERE id = ?")
    .get(input.fixtureId) as SqlRow | undefined;
  if (!fixture) return [];
  const opponentId = (fixture.home_team_id === input.teamId ? fixture.away_team_id : fixture.home_team_id) as EntityId;
  const isHome = fixture.home_team_id === input.teamId;
  const opponentClubId = clubIdForTeam(db, opponentId);
  const candidates: Candidate[] = [
    {
      topic: "OPPONENT_PREVIEW",
      prompt: `What do you expect from ${teamName(db, opponentId)} ${isHome ? "at home" : "away"}?`,
      subjectEntities: opponentClubId ? [{ id: opponentClubId, type: "club" }] : [],
      priority: 5,
    },
  ];

  const standings = new CompetitionRepository(db).standings(fixture.competition_season_id as EntityId);
  if (standings.length > 0) {
    const position = standings.findIndex((row) => row.teamId === input.teamId) + 1;
    const total = standings.length;
    if (position > 0 && (position <= 3 || position > total - 3)) {
      candidates.push({
        topic: "TABLE_STAKES",
        prompt:
          position <= 3
            ? "How much are you thinking about the position at the top of the table?"
            : "How concerned are you about the position near the bottom of the table?",
        subjectEntities: [],
        priority: 6,
      });
    }
  }

  const unavailable = db
    .prepare(
      `SELECT person_id AS personId FROM player_availability_states
       WHERE team_id = ? AND availability IN ('INJURED','SUSPENDED') LIMIT 1`,
    )
    .get(input.teamId) as { personId: EntityId } | undefined;
  if (unavailable) {
    candidates.push({
      topic: "SELECTION_ISSUE",
      prompt: `Can ${personName(db, unavailable.personId)} play any part in this game?`,
      subjectEntities: [{ id: unavailable.personId, type: "person" }],
      priority: 4,
    });
  }

  return candidates;
};

/** The formation this team started most often across its last few played
 * matches before the given date (bounded — at most 5 rows, never a full
 * match-history scan), used only as a comparison baseline for "that's a
 * change from your recent setup" — never treated as fact on its own. */
const recentStableFormation = (
  db: GameDatabase,
  teamId: EntityId,
  beforeDate: string,
  excludeMatchId: EntityId,
): string | undefined => {
  const rows = db
    .prepare(
      `SELECT m.tactical_snapshot_json, f.home_team_id, f.away_team_id
       FROM matches m JOIN fixtures f ON f.id = m.fixture_id
       WHERE (f.home_team_id = ? OR f.away_team_id = ?)
         AND m.played_date IS NOT NULL AND m.played_date < ? AND m.id != ?
       ORDER BY m.played_date DESC LIMIT 5`,
    )
    .all(teamId, teamId, beforeDate, excludeMatchId) as SqlRow[];
  const formations = rows
    .map((row) => {
      if (!row.tactical_snapshot_json) return undefined;
      const snapshot = JSON.parse(row.tactical_snapshot_json as string) as {
        home?: { formationId?: string };
        away?: { formationId?: string };
      };
      const side = row.home_team_id === teamId ? snapshot.home : snapshot.away;
      return side?.formationId;
    })
    .filter((id): id is string => Boolean(id));
  if (formations.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const formation of formations) counts.set(formation, (counts.get(formation) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
};

const postMatchCandidates = (
  db: GameDatabase,
  input: { teamId: EntityId; fixtureId: EntityId },
): Candidate[] => {
  const fixture = db
    .prepare("SELECT * FROM fixtures WHERE id = ?")
    .get(input.fixtureId) as SqlRow | undefined;
  const match = fixture
    ? (db.prepare("SELECT * FROM matches WHERE fixture_id = ?").get(fixture.id) as SqlRow | undefined)
    : undefined;
  if (!fixture || !match) return [];
  const opponentId = (fixture.home_team_id === input.teamId ? fixture.away_team_id : fixture.home_team_id) as EntityId;
  const opponentClubId = clubIdForTeam(db, opponentId);
  const homeGoals = Number(match.home_goals ?? 0);
  const awayGoals = Number(match.away_goals ?? 0);
  const managedIsHome = fixture.home_team_id === input.teamId;
  const own = managedIsHome ? homeGoals : awayGoals;
  const other = managedIsHome ? awayGoals : homeGoals;

  const candidates: Candidate[] = [
    {
      topic: "MATCH_RESULT",
      prompt:
        own > other
          ? `What pleased you most about the ${own}-${other} win?`
          : own === other
            ? `Is a ${own}-${other} draw a fair result?`
            : `What went wrong in the ${own}-${other} defeat?`,
      subjectEntities: opponentClubId ? [{ id: opponentClubId, type: "club" }] : [],
      priority: 7,
    },
  ];

  const events = db
    .prepare("SELECT * FROM match_events WHERE match_id = ? ORDER BY minute")
    .all(match.id) as SqlRow[];

  const redCard = events.find((event) => event.type === "RED_CARD");
  if (redCard?.primary_person_id) {
    candidates.push({
      topic: "RED_CARD",
      prompt: `Was the red card for ${personName(db, redCard.primary_person_id as EntityId)} decisive?`,
      subjectEntities: [{ id: redCard.primary_person_id as EntityId, type: "person" }],
      priority: 8,
    });
  }

  const goals = events.filter((event) => event.type === "GOAL" && event.team_id === input.teamId);
  const setPieceGoal = goals.find((event) => {
    const data = event.data_json ? (JSON.parse(event.data_json as string) as Record<string, unknown>) : {};
    return Boolean(data.fromSetPiece);
  });
  if (setPieceGoal?.primary_person_id) {
    candidates.push({
      topic: "SET_PIECE_GOAL",
      prompt: `The goal from ${personName(db, setPieceGoal.primary_person_id as EntityId)} came from a set piece — is that a deliberate strength?`,
      subjectEntities: [{ id: setPieceGoal.primary_person_id as EntityId, type: "person" }],
      priority: 4,
    });
  }

  const lateGoal = goals.find((event) => Number(event.minute ?? 0) >= 80);
  if (lateGoal?.primary_person_id && own !== other) {
    candidates.push({
      topic: "LATE_WINNER",
      prompt: `How big was ${personName(db, lateGoal.primary_person_id as EntityId)}'s goal so late in the game?`,
      subjectEntities: [{ id: lateGoal.primary_person_id as EntityId, type: "person" }],
      priority: 7,
    });
  }

  const tacticalChange = events.find(
    (event) =>
      event.type === "TACTICAL_CHANGE" &&
      event.team_id === input.teamId &&
      (event.data_json ? (JSON.parse(event.data_json as string) as Record<string, unknown>).decidedBy : undefined) ===
        "MANAGER",
  );
  if (tacticalChange) {
    candidates.push({
      topic: "TACTICAL_SWITCH_REVIEW",
      prompt: "Why did you change the approach during the game?",
      subjectEntities: [],
      priority: 6,
    });
  }

  // Starting formation/mentality questions — only from the match's own
  // immutable kickoff tacticalSnapshot (never today's current tactic, and
  // never fabricated when a match predates snapshot tracking).
  if (match.tactical_snapshot_json) {
    const snapshot = JSON.parse(match.tactical_snapshot_json as string) as {
      home?: { formationId: string; formationName: string; mentality: string };
      away?: { formationId: string; formationName: string; mentality: string };
    };
    const mySide = managedIsHome ? snapshot.home : snapshot.away;
    if (mySide) {
      const stableFormation = recentStableFormation(db, input.teamId, fixture.scheduled_date as string, match.id as EntityId);
      if (stableFormation && stableFormation !== mySide.formationId) {
        candidates.push({
          topic: "STARTING_FORMATION",
          prompt: `You started in a ${mySide.formationName} today, a change from your recent setup. What was behind that?`,
          subjectEntities: [{ id: input.fixtureId, type: "fixture" }],
          priority: 6,
        });
      }
      if (mySide.mentality === "VERY_ATTACKING" || mySide.mentality === "ATTACKING") {
        candidates.push({
          topic: "MENTALITY_CHOICE",
          prompt: "You set up on the front foot today. Were you looking to take control early?",
          subjectEntities: [{ id: input.fixtureId, type: "fixture" }],
          priority: 3,
        });
      } else if (mySide.mentality === "VERY_DEFENSIVE" || mySide.mentality === "DEFENSIVE") {
        candidates.push({
          topic: "MENTALITY_CHOICE",
          prompt: "You set up cautiously today. Was that a reaction to the opposition?",
          subjectEntities: [{ id: input.fixtureId, type: "fixture" }],
          priority: 3,
        });
      }
    }
  }

  const topScorer = [...goals]
    .filter((event) => event.primary_person_id)
    .reduce<Record<string, number>>((acc, event) => {
      const id = event.primary_person_id as string;
      acc[id] = (acc[id] ?? 0) + 1;
      return acc;
    }, {});
  const standoutId = Object.entries(topScorer).find(([, count]) => count >= 2)?.[0] as EntityId | undefined;
  if (standoutId) {
    candidates.push({
      topic: "PLAYER_PERFORMANCE",
      prompt: `${personName(db, standoutId)} scored twice — how important has he become?`,
      subjectEntities: [{ id: standoutId, type: "person" }],
      priority: 5,
    });
  }

  return candidates;
};

const transferCandidates = (db: GameDatabase, input: { teamId: EntityId }): Candidate[] => {
  const clubRow = db.prepare("SELECT club_id FROM teams WHERE id = ?").get(input.teamId) as
    | { club_id?: EntityId }
    | undefined;
  const clubId = clubRow?.club_id;
  if (!clubId) return [];
  const candidates: Candidate[] = [];
  // Transfer business (an active bid, a completed sale) is press-worthy for
  // the Manager only while the Manager actually owns the TRANSFERS domain.
  // Once a club delegates it to a Sporting Director/Director of Football,
  // the same facts belong to that executive's own Recruitment Interview
  // (sdCandidates below) — never both. Squad-morale fallout from a transfer
  // request stays the Manager's own concern regardless of who owns
  // recruitment, so it is intentionally outside this guard.
  if (responsibilityOwner(db, clubId, "TRANSFERS").ownerType === "MANAGER") {
    const offers = new TransferMarketRepository(db).transferOffers();

    const activeStatuses = new Set(["SUBMITTED", "NEGOTIATING", "COUNTERED", "PLAYER_NEGOTIATING", "COMPETING_OFFER"]);
    const activeBid = offers.find(
      (offer) => offer.sellingClubId === clubId && activeStatuses.has(offer.status),
    );
    if (activeBid) {
      candidates.push({
        topic: "TRANSFER_BID",
        prompt: `There's a bid on the table for ${personName(db, activeBid.playerId)} — what's your stance?`,
        subjectEntities: [{ id: activeBid.playerId, type: "person" }],
        priority: 6,
      });
    }

    const completed = offers.find(
      (offer) => offer.sellingClubId === clubId && offer.status === "COMPLETED",
    );
    if (completed && !activeBid) {
      candidates.push({
        topic: "TRANSFER_COMPLETED",
        prompt: `What does letting ${personName(db, completed.playerId)} leave mean for the squad?`,
        subjectEntities: [{ id: completed.playerId, type: "person" }],
        priority: 5,
      });
    }
  }

  const concerns = new SquadDynamicsRepository(db)
    .concernsForTeam(input.teamId)
    .filter((concern) => concern.type === "TRANSFER_INTEREST" && concern.status !== "RESOLVED");
  if (concerns[0]) {
    candidates.push({
      topic: "TRANSFER_REQUEST",
      prompt: `${personName(db, concerns[0].personId)} has been linked with a move away — will he stay?`,
      subjectEntities: [{ id: concerns[0].personId, type: "person" }],
      priority: 6,
    });
  }

  return candidates;
};

const playerIssueCandidates = (db: GameDatabase, input: { teamId: EntityId }): Candidate[] => {
  const dynamics = new SquadDynamicsRepository(db);
  const candidates: Candidate[] = [];

  const playingTime = dynamics
    .concernsForTeam(input.teamId)
    .find((concern) => concern.type === "PLAYING_TIME" && concern.status !== "RESOLVED");
  if (playingTime) {
    candidates.push({
      topic: "PLAYING_TIME_CONCERN",
      prompt: `${personName(db, playingTime.personId)} hasn't played much lately — is he still part of your plans?`,
      subjectEntities: [{ id: playingTime.personId, type: "person" }],
      priority: 6,
    });
  }

  const captaincy = dynamics
    .demandsForTeam(input.teamId)
    .find((demand) => demand.type === "CAPTAINCY_CONCERN" && demand.status === "OPEN");
  if (captaincy) {
    candidates.push({
      topic: "CAPTAINCY_REACTION",
      prompt: `${personName(db, captaincy.personId)} has raised a concern about the captaincy — how do you respond?`,
      subjectEntities: [{ id: captaincy.personId, type: "person" }],
      priority: 7,
    });
  }

  const roleStatus = dynamics
    .concernsForTeam(input.teamId)
    .find((concern) => concern.type === "ROLE_STATUS" && concern.status !== "RESOLVED" && concern.personId !== playingTime?.personId);
  if (roleStatus) {
    candidates.push({
      topic: "ROLE_CONCERN",
      prompt: `Is ${personName(db, roleStatus.personId)} happy with his role in the squad?`,
      subjectEntities: [{ id: roleStatus.personId, type: "person" }],
      priority: 5,
    });
  }

  return candidates;
};

/**
 * Owner press candidates — real club-business events only, never invented
 * corporate news. An infrastructure project is offered once when it first
 * reaches APPROVED and again once it first reaches COMPLETED (two genuinely
 * different moments); a sponsorship is offered once it first becomes ACTIVE.
 * Deduplication against a prior interview on the exact same event is the
 * caller's job (startPressConference's own existing-topic check, keyed by
 * sourceEntityId), matching every other context in this file.
 */
const ownerCandidates = (db: GameDatabase, input: { clubId: EntityId }): Candidate[] => {
  const economy = new ClubEconomyRepository(db);
  const candidates: Candidate[] = [];

  // Only the single most-recently-true fact per topic becomes a candidate —
  // a club can carry several qualifying projects/sponsorships at once (most
  // notably the founding sponsorship every club is seeded with at world
  // generation), but an Owner press conference asks about one grounded,
  // genuinely-new event at a time, not every real fact simultaneously. The
  // exclude-set the caller passes into generatePressQuestions still lets a
  // fact that has already been asked-and-completed drop out in favour of
  // whatever is now the most recent, so press naturally advances to newer
  // events as they occur rather than getting stuck re-picking the same one.
  const latestProject = economy
    .infrastructureProjects(input.clubId)
    .filter((project) => project.status === "APPROVED" || project.status === "COMPLETED")
    .sort((a, b) => (a.planningStart < b.planningStart ? 1 : a.planningStart > b.planningStart ? -1 : 0))[0];
  if (latestProject) {
    const label = latestProject.projectType.replace(/_/g, " ").toLowerCase();
    candidates.push({
      topic: "INFRASTRUCTURE_PROJECT",
      prompt:
        latestProject.status === "COMPLETED"
          ? `The ${label} project is complete — what does it mean for the club's long-term ambitions?`
          : `Investment has been approved for a new ${label} — what does this mean for the club's long-term ambitions?`,
      subjectEntities: [{ id: latestProject.id, type: "infrastructureProject" }],
      priority: 6,
    });
  }

  const latestSponsorship = economy
    .sponsorships(input.clubId)
    .filter((sponsorship) => sponsorship.status === "ACTIVE")
    .sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0))[0];
  if (latestSponsorship) {
    const sponsor = economy.sponsors().find((item) => item.id === latestSponsorship.sponsorId);
    candidates.push({
      topic: "SPONSORSHIP_SIGNED",
      prompt: sponsor
        ? `How important is the agreement with ${sponsor.name} to the club?`
        : "How important is this commercial agreement to the club?",
      subjectEntities: sponsor ? [{ id: sponsor.id, type: "sponsor" }] : [],
      priority: 5,
    });
  }

  return candidates;
};

/**
 * Federation President press candidates — real federation-governance events
 * only, sourced from FederationGovernanceRepository/staff_appointments,
 * never invented. Only three topics have a genuinely unambiguous single
 * milestone to ground a question in: a federation infrastructure project
 * reaching a real construction/completion milestone, a competition reform
 * actually decided (IMPLEMENTED, never a still-PROPOSED one), and a national
 * team head coach appointment. Other plausible-sounding topics (routine
 * funding/grant activity, open-ended "national team strategy") were left out
 * because the federation model has no single bounded fact to key them on —
 * adding them would mean inventing materiality thresholds rather than
 * reading one.
 */
const presidentCandidates = (db: GameDatabase, input: { federationId: EntityId }): Candidate[] => {
  const governance = new FederationGovernanceRepository(db);
  const candidates: Candidate[] = [];

  const latestProject = governance
    .projects(input.federationId)
    .filter((project) => ["CONSTRUCTION", "IMPLEMENTATION", "COMPLETED"].includes(project.status))
    .sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0))[0];
  if (latestProject) {
    candidates.push({
      topic: "INFRASTRUCTURE_PROJECT",
      prompt:
        latestProject.status === "COMPLETED"
          ? `The ${latestProject.name} is complete — what does it mean for the federation's long-term ambitions?`
          : `Why is the ${latestProject.name} a priority for the federation right now?`,
      subjectEntities: [{ id: latestProject.id, type: "federationProject" }],
      priority: 6,
    });
  }

  const latestReform = governance
    .competitionReforms(input.federationId)
    .filter((reform) => reform.status === "IMPLEMENTED")
    .sort((a, b) => ((a.decidedAt ?? "") < (b.decidedAt ?? "") ? 1 : (a.decidedAt ?? "") > (b.decidedAt ?? "") ? -1 : 0))[0];
  if (latestReform) {
    candidates.push({
      topic: "COMPETITION_REFORM",
      prompt: "What do you expect this competition reform to change for domestic football?",
      subjectEntities: [{ id: latestReform.competitionId, type: "competition" }],
      priority: 5,
    });
  }

  const latestCoach = db
    .prepare(
      `SELECT sa.person_id AS personId, sa.team_id AS teamId, sa.start_date AS startDate
       FROM staff_appointments sa
       JOIN teams t ON t.id = sa.team_id
       WHERE t.federation_id = ? AND sa.role = 'NATIONAL_TEAM_HEAD_COACH' AND sa.employment_status = 'ACTIVE'
       ORDER BY sa.start_date DESC LIMIT 1`,
    )
    .get(input.federationId) as { personId?: EntityId; teamId?: EntityId; startDate?: string } | undefined;
  if (latestCoach?.personId) {
    candidates.push({
      topic: "COACH_APPOINTMENT",
      prompt: "What convinced the federation this was the right appointment?",
      subjectEntities: [{ id: latestCoach.personId, type: "person" }],
      priority: 4,
    });
  }

  return candidates;
};

/**
 * Sporting Director / Director of Football press candidates — real
 * completed/failed transfer business only, and only for a club whose
 * TRANSFERS domain is actually delegated away from the Manager (see the
 * guard in transferCandidates above; a club still running transfers through
 * its Manager has nothing for this executive to be asked about). Sourced
 * from the exact same TransferMarketRepository rows the Manager's own
 * Transfer Centre and the executive Recruitment Desk already read — never a
 * second transfer engine.
 */
const sdCandidates = (db: GameDatabase, input: { clubId: EntityId }): Candidate[] => {
  const candidates: Candidate[] = [];
  if (responsibilityOwner(db, input.clubId, "TRANSFERS").ownerType !== "STAFF") return candidates;

  const offers = new TransferMarketRepository(db)
    .transferOffers()
    .filter((offer) => offer.buyingClubId === input.clubId || offer.sellingClubId === input.clubId);

  const latestIncoming = offers
    .filter((offer) => offer.buyingClubId === input.clubId && offer.status === "COMPLETED")
    .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : a.submittedAt > b.submittedAt ? -1 : 0))[0];
  if (latestIncoming) {
    candidates.push({
      topic: "INCOMING_TRANSFER",
      prompt: `What convinced you ${personName(db, latestIncoming.playerId)} was the right player to bring in?`,
      subjectEntities: [{ id: latestIncoming.playerId, type: "person" }],
      priority: 6,
    });
  }

  const latestOutgoing = offers
    .filter((offer) => offer.sellingClubId === input.clubId && offer.status === "COMPLETED")
    .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : a.submittedAt > b.submittedAt ? -1 : 0))[0];
  if (latestOutgoing) {
    candidates.push({
      topic: "OUTGOING_TRANSFER",
      prompt: `Why did the club decide to let ${personName(db, latestOutgoing.playerId)} leave?`,
      subjectEntities: [{ id: latestOutgoing.playerId, type: "person" }],
      priority: 5,
    });
  }

  const failedStatuses = new Set(["REJECTED", "WITHDRAWN", "PLAYER_REJECTED", "EXPIRED"]);
  const latestFailed = offers
    .filter((offer) => failedStatuses.has(offer.status))
    .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : a.submittedAt > b.submittedAt ? -1 : 0))[0];
  if (latestFailed) {
    candidates.push({
      topic: "FAILED_TRANSFER",
      prompt: `Why was the club unable to complete the move for ${personName(db, latestFailed.playerId)}?`,
      subjectEntities: [{ id: latestFailed.playerId, type: "person" }],
      priority: 4,
    });
  }

  return candidates;
};

// ---------------------------------------------------------------------------
// Response options per topic — only the stances that make sense, each with
// distinct, bounded consequences (see applyConsequence below).
// ---------------------------------------------------------------------------

const OPTION_TEXT: Partial<Record<PressQuestionTopic, Partial<Record<PressResponseStance, string>>>> = {
  MATCH_RESULT: {
    CALM: "The result matters more than the system today.",
    ASSERTIVE: "We deserved exactly what we got out there.",
    CRITICAL: "We weren't good enough today.",
  },
  RED_CARD: {
    CALM: "I'll look at it again, but the referee has a hard job.",
    CRITICAL: "That's a moment of indiscipline we can't afford.",
    PROTECT_PLAYER: "He's still an important part of the squad, and one incident doesn't change that.",
  },
  SET_PIECE_GOAL: {
    PRAISE: "We work on that in training every week — credit to the players for executing it.",
    CALM: "Every goal counts the same on the scoreboard.",
  },
  LATE_WINNER: {
    PRAISE: "He's trained well and deserves a moment like that.",
    CALM: "We kept going until the whistle — that's all it was.",
  },
  TACTICAL_SWITCH_REVIEW: {
    ASSERTIVE: "It changed the game, and I'll make that call again if it's needed.",
    DEFLECT: "I'm not going to give away our thinking in detail.",
    CALM: "It was a reaction to what we were seeing on the pitch.",
  },
  STARTING_FORMATION: {
    ASSERTIVE: "It was the right setup for this opponent, and I'd make the same call again.",
    DEFLECT: "I'm not going to break down the thinking behind every team sheet.",
    CALM: "It was simply the shape that suited the players available today.",
  },
  INFRASTRUCTURE_PROJECT: {
    ASSERTIVE: "This is exactly the kind of investment that shows real ambition.",
    CALM: "It's one step in a longer-term plan.",
    NON_COMMITTAL: "There's more still to come, but I won't get ahead of things.",
  },
  SPONSORSHIP_SIGNED: {
    PRAISE: "It's a real vote of confidence in where this club is heading.",
    CALM: "It strengthens the club financially, which matters as much as anything on the pitch.",
    DEFLECT: "The commercial side isn't something I discuss in detail.",
  },
  COMPETITION_REFORM: {
    ASSERTIVE: "This is a change domestic football genuinely needed.",
    CALM: "It's a considered adjustment, not a reaction to any one result.",
    NON_COMMITTAL: "We'll review how it plays out before considering anything further.",
  },
  COACH_APPOINTMENT: {
    ASSERTIVE: "This is exactly the appointment the national team needed at this moment.",
    PRAISE: "Their record and their plan for the squad convinced the committee.",
    CALM: "It was a thorough process, and we're confident in the outcome.",
    NON_COMMITTAL: "I'll let their work on the training pitch do the talking.",
  },
  INCOMING_TRANSFER: {
    ASSERTIVE: "He was exactly the profile we identified and went out to get.",
    PRAISE: "Everything about his character and ability fit what we needed.",
    CALM: "It's the result of a long process, not a reaction to one gap in the squad.",
  },
  OUTGOING_TRANSFER: {
    PRAISE: "We wish him well — it was the right move for player and club alike.",
    CALM: "Football moves on, and this business made sense for both sides.",
    DEFLECT: "The details of the negotiation stay between the clubs.",
  },
  FAILED_TRANSFER: {
    CALM: "These things don't always come together, and we move on to the next priority.",
    DEFLECT: "I'm not going to discuss the specifics of a deal that didn't happen.",
    NON_COMMITTAL: "It's not the end of the story — we'll keep working on the squad.",
  },
  MENTALITY_CHOICE: {
    ASSERTIVE: "We set out to impose ourselves from the first minute.",
    CALM: "It was a considered response to how we expected the game to go.",
    DEFLECT: "That's something I'd rather keep between the group and myself.",
  },
  PLAYER_PERFORMANCE: {
    PRAISE: "He's trained well and deserves the opportunity he's getting.",
    CALM: "It's a team game — everyone contributed.",
    DEFLECT: "Let's not put too much on one performance.",
  },
  OPPONENT_PREVIEW: {
    CALM: "We're focused on our own game more than theirs.",
    ASSERTIVE: "We go into every match expecting to win.",
    DEFLECT: "I'm not discussing another club's team in detail.",
  },
  TABLE_STAKES: {
    CALM: "We take it one match at a time.",
    ASSERTIVE: "We're not hiding from where we want to finish.",
    NON_COMMITTAL: "It's far too early to talk about where we'll end up.",
  },
  SELECTION_ISSUE: {
    CALM: "We'll make that decision closer to kick-off.",
    PROTECT_PLAYER: "He's working hard to be available, and I won't rush him.",
    DEFLECT: "I'm not confirming the team today.",
  },
  RIVALRY_PREVIEW: {
    CALM: "It's three points like any other match.",
    ASSERTIVE: "Our supporters know how much this one matters, and so do we.",
  },
  TRANSFER_BID: {
    DEFLECT: "I'm not discussing another club's interest in our player.",
    COMMIT: "We won't be selling him.",
    NON_COMMITTAL: "Nothing has changed from our side.",
  },
  TRANSFER_COMPLETED: {
    PRAISE: "We wish him well — he gave a lot to this club.",
    CALM: "Football moves on, and so do we.",
  },
  TRANSFER_REQUEST: {
    DEFLECT: "I'm not going to discuss speculation about one of our players.",
    COMMIT: "He's going nowhere — he's part of our plans.",
    CHALLENGE_PLAYER: "If he wants to leave, that's a conversation for inside the building, not out here.",
  },
  PLAYING_TIME_CONCERN: {
    PROTECT_PLAYER: "He's training well, and his chance will come.",
    CHALLENGE_PLAYER: "He knows what he needs to do to force his way into the team.",
    COMMIT: "I've told him directly he'll get more minutes soon.",
    DEFLECT: "Team selection is a private conversation.",
  },
  CAPTAINCY_REACTION: {
    PROTECT_PLAYER: "I understand his frustration, and we'll talk it through.",
    CALM: "The armband is my decision, and I stand by it.",
    ASSERTIVE: "That decision isn't changing.",
  },
  ROLE_CONCERN: {
    PROTECT_PLAYER: "He's valued here, whatever role he's playing.",
    CHALLENGE_PLAYER: "Everyone has to earn their role through performances.",
    COMMIT: "I've promised him a clearer path back into the side.",
  },
};

const optionsFor = (topic: PressQuestionTopic): PressQuestionOption[] =>
  Object.entries(OPTION_TEXT[topic] ?? { CALM: "We'll leave it there." }).map(([stance, text]) => ({
    stance: stance as PressResponseStance,
    text: text!,
  }));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MAX_QUESTIONS = 4;

/** Minimum days between two manually-requested TRANSFER/PLAYER_ISSUE
 * interviews for the same manager before a new one is genuinely offered
 * again — a bounded frequency control, not a hardcoded calendar rule. */
const PRESS_COOLDOWN_DAYS = 3;

export const generatePressQuestions = (
  db: GameDatabase,
  input: {
    context: MediaInterview["context"];
    teamId?: EntityId;
    fixtureId?: EntityId;
    /** OWNER_BUSINESS is club-scoped, not team-scoped — an owner has no team. */
    clubId?: EntityId;
    /** FEDERATION_GOVERNANCE is federation-scoped — a President has no club or team. */
    federationId?: EntityId;
    /** Candidates whose topic + every subject id already appears in this set
     * (as "topic:subjectId") are dropped before the MAX_QUESTIONS cap, not
     * after — otherwise a genuinely new fact could be crowded out of the cap
     * by facts that were merely already asked about (e.g. Owner press,
     * where a club's founding sponsorship must never crowd out a freshly
     * signed one just because it sorts first). */
    excludeTopicSubjectKeys?: ReadonlySet<string>;
  },
): PressQuestion[] => {
  const candidates: Candidate[] =
    input.context === "PRE_MATCH" && input.fixtureId && input.teamId
      ? preMatchCandidates(db, { teamId: input.teamId, fixtureId: input.fixtureId })
      : input.context === "POST_MATCH" && input.fixtureId && input.teamId
        ? postMatchCandidates(db, { teamId: input.teamId, fixtureId: input.fixtureId })
        : input.context === "TRANSFER" && input.teamId
          ? transferCandidates(db, { teamId: input.teamId })
          : input.context === "PLAYER_ISSUE" && input.teamId
            ? playerIssueCandidates(db, { teamId: input.teamId })
            : input.context === "OWNER_BUSINESS" && input.clubId
              ? ownerCandidates(db, { clubId: input.clubId })
              : input.context === "FEDERATION_GOVERNANCE" && input.federationId
                ? presidentCandidates(db, { federationId: input.federationId })
                : input.context === "RECRUITMENT" && input.clubId
                  ? sdCandidates(db, { clubId: input.clubId })
                  : [];
  const sourceEntityId = input.fixtureId ?? input.clubId ?? input.federationId ?? input.teamId;
  const excluded = input.excludeTopicSubjectKeys;
  return candidates
    .filter(
      (candidate) =>
        !excluded ||
        candidate.subjectEntities.length === 0 ||
        candidate.subjectEntities.some((subject) => !excluded.has(`${candidate.topic}:${subject.id}`)),
    )
    .sort((a, b) => b.priority - a.priority || a.topic.localeCompare(b.topic))
    .slice(0, MAX_QUESTIONS)
    .map((candidate, index) => ({
      id: createStableEntityId("press-question", `${sourceEntityId}:${input.context}:${index}`),
      topic: candidate.topic,
      prompt: candidate.prompt,
      subjectEntities: candidate.subjectEntities,
      options: optionsFor(candidate.topic),
    }));
};

const PLAYER_TOPICS = new Set<PressQuestionTopic>([
  "RED_CARD",
  "SET_PIECE_GOAL",
  "LATE_WINNER",
  "PLAYER_PERFORMANCE",
  "SELECTION_ISSUE",
  "TRANSFER_BID",
  "TRANSFER_COMPLETED",
  "TRANSFER_REQUEST",
  "PLAYING_TIME_CONCERN",
  "CAPTAINCY_REACTION",
  "ROLE_CONCERN",
]);

/** Bounded, explainable consequence for one answer. Never a giant swing. */
const applyConsequence = (
  db: GameDatabase,
  input: { question: PressQuestion; stance: PressResponseStance; managerPersonId: EntityId; teamId?: EntityId; date: string },
): string | undefined => {
  const subjectPlayer = input.question.subjectEntities.find((ref) => ref.type === "person");
  if (!subjectPlayer || !PLAYER_TOPICS.has(input.question.topic)) return undefined;
  const managerProfileId = managerProfileIdForPerson(db, input.managerPersonId);
  if (!managerProfileId) return undefined;

  const delta =
    input.stance === "PRAISE"
      ? 4
      : input.stance === "PROTECT_PLAYER"
        ? 3
        : input.stance === "COMMIT"
          ? 2
          : input.stance === "CHALLENGE_PLAYER"
            ? -3
            : input.stance === "CRITICAL"
              ? -4
              : 0;
  if (delta !== 0) {
    adjustRelationship(db, managerProfileId, subjectPlayer.id, delta, input.date);
  }

  if (
    input.stance === "COMMIT" &&
    input.teamId &&
    (input.question.topic === "TRANSFER_BID" || input.question.topic === "TRANSFER_REQUEST")
  ) {
    createStructuredCommitment(db, input.date, {
      source: "PRESS_CONFERENCE",
      managerProfileId,
      managerPersonId: input.managerPersonId,
      teamId: input.teamId,
      type: "TRANSFER_STANCE",
      targetCriteria: subjectPlayer.id,
      dueOn: addDays(input.date, 90),
      description: `Publicly committed to keeping ${personName(db, subjectPlayer.id)} at the club.`,
      originEventId: input.question.id,
      recipientType: "MEDIA",
    });
  }

  if (delta === 0) return undefined;
  return `${personName(db, subjectPlayer.id)}'s relationship with the manager ${delta > 0 ? "improved" : "cooled"} slightly.`;
};

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Which career-role's press pipeline a MediaInterview context belongs to —
 * used only to scope "one open conference at a time" per role, so a
 * protagonist holding two press-producing roles (e.g. Manager of one club
 * and Owner of another) never has one role's open interview block the
 * other's. */
const contextRole = (context: MediaInterview["context"]): "MANAGER" | "OWNER" | "PRESIDENT" | "SPORTING_DIRECTOR" =>
  context === "OWNER_BUSINESS"
    ? "OWNER"
    : context === "FEDERATION_GOVERNANCE"
      ? "PRESIDENT"
      : context === "RECRUITMENT"
        ? "SPORTING_DIRECTOR"
        : "MANAGER";

/** Opens (or returns the already-open) structured press conference for this
 * exact context — one open conference per manager at a time, matching the
 * existing single-conference-at-a-time rule. */
export const startPressConference = (
  db: GameDatabase,
  input: {
    context: MediaInterview["context"];
    managerPersonId: EntityId;
    teamId?: EntityId;
    /** OWNER_BUSINESS is club-scoped, not team-scoped — an owner has no team. */
    clubId?: EntityId;
    /** FEDERATION_GOVERNANCE is federation-scoped — a President has no club or team. */
    federationId?: EntityId;
    date: string;
    fixtureId?: EntityId;
    importance?: number;
    /** Overrides the source-entity part of this interview's dedup id.
     * Fixture-bound contexts (PRE_MATCH/POST_MATCH) are already naturally
     * unique per fixture; a club-scoped context like OWNER_BUSINESS is not —
     * the same club can produce several genuinely distinct real events
     * (a new sponsorship, a new infrastructure project) on the very same
     * calendar date, and without a per-event key they would collide onto
     * one interview id and silently resolve to whichever was created first. */
    dedupeKey?: string;
    /** Forwarded to generatePressQuestions so the interview this function
     * actually persists reflects the same "already asked" exclusions the
     * caller used to decide whether anything new exists at all. */
    excludeTopicSubjectKeys?: ReadonlySet<string>;
  },
): MediaInterview => {
  const repo = new MediaPhaseBRepository(db);
  // Interviews are keyed by personId only, and the same physical person can
  // hold more than one press-producing career role (e.g. Manager and Owner
  // of different clubs) — so "one open conference at a time" is scoped to
  // this same role's own contexts, never blocking (or being blocked by)
  // another role's unrelated open interview for the same person.
  const existingOpen = repo
    .interviews(input.managerPersonId)
    .find((item) => item.status === "OPEN" && contextRole(item.context) === contextRole(input.context));
  if (existingOpen) return existingOpen;

  // The exact same subject/context/date has already produced an interview —
  // whether still open or already completed — so resolve that one instead
  // of regenerating. Without this, re-requesting the same topic after
  // completing it earlier the same day would silently reroll a COMPLETED
  // interview back to OPEN with its answers discarded.
  const sourceEntityId =
    input.fixtureId ?? input.clubId ?? input.federationId ?? input.teamId ?? input.managerPersonId;
  const stableId = createStableEntityId(
    "media-interview",
    `${input.dedupeKey ?? sourceEntityId}:${input.context}:${input.date}`,
  );
  const existingSameTopic = repo.interviews(input.managerPersonId).find((item) => item.id === stableId);
  if (existingSameTopic) return existingSameTopic;

  // Frequency control for the two manually-requestable, non-fixture-bound
  // contexts (TRANSFER/PLAYER_ISSUE): without a real new fixture to key off,
  // a manager could otherwise re-request the same still-unresolved subject
  // every day. A short cooldown after the most recent COMPLETED interview of
  // the same context avoids that spam without inventing a second frequency
  // system — PRE_MATCH/POST_MATCH are already naturally bounded by real
  // fixture occurrence and the pre-match trigger's own materiality check.
  if (input.context === "TRANSFER" || input.context === "PLAYER_ISSUE") {
    const recentCompleted = repo
      .interviews(input.managerPersonId)
      .filter((item) => item.context === input.context && item.status === "COMPLETED")
      .sort((a, b) => (a.interviewDate < b.interviewDate ? 1 : a.interviewDate > b.interviewDate ? -1 : 0))[0];
    if (recentCompleted && addDays(recentCompleted.interviewDate, PRESS_COOLDOWN_DAYS) > input.date) {
      return recentCompleted;
    }
  }

  initializeMediaForSave(db);
  initializeMediaJournalists(db);
  const questions = generatePressQuestions(db, {
    context: input.context,
    teamId: input.teamId,
    fixtureId: input.fixtureId,
    clubId: input.clubId,
    federationId: input.federationId,
    excludeTopicSubjectKeys: input.excludeTopicSubjectKeys,
  });
  const outlet =
    new MediaRepository(db)
      .outlets()
      .sort((a, b) => b.reach - a.reach || a.id.localeCompare(b.id))
      .find((candidate) => candidate.scope !== "REGIONAL_INTERNATIONAL") ?? new MediaRepository(db).outlets()[0]!;
  const journalist =
    new MediaPhaseBRepository(db).journalists(outlet.id)[0] ?? new MediaPhaseBRepository(db).journalists()[0]!;
  const interview: MediaInterview = {
    id: stableId,
    outletId: outlet.id,
    journalistId: journalist.id,
    sourceEntityId,
    managerPersonId: input.managerPersonId,
    interviewDate: input.date,
    context: input.context,
    importance: input.importance ?? (questions.length > 0 ? 6 : 3),
    questions: questions.map((question) => question.prompt),
    responses: [],
    summary: `${input.context === "PRE_MATCH" ? "Pre-match" : input.context === "POST_MATCH" ? "Post-match" : input.context === "TRANSFER" ? "Transfer" : input.context === "OWNER_BUSINESS" ? "Owner" : input.context === "FEDERATION_GOVERNANCE" ? "Federation" : input.context === "RECRUITMENT" ? "Recruitment" : "Player issue"} interview opened.`,
    managerReputationEffect: 0,
    clubSupportEffect: 0,
    status: "OPEN",
    provenanceStatus: "SIMULATION_ONLY",
    structuredQuestions: questions,
    structuredAnswers: [],
    currentQuestionIndex: 0,
  };
  repo.upsertInterview(interview);
  return interview;
};

/** Answers the CURRENT question in a structured press conference, applies
 * its bounded consequence, and advances to the next question (or completes
 * the interview once every question has been answered). Resumable: reload
 * mid-conference and the next call answers the same next question, never a
 * reroll. */
export const answerPressQuestion = (
  db: GameDatabase,
  input: { interviewId: EntityId; stance: PressResponseStance; teamId?: EntityId; date: string },
): MediaInterview => {
  const repo = new MediaPhaseBRepository(db);
  const interview = repo.interviews().find((item) => item.id === input.interviewId);
  if (!interview) throw new Error("Press conference not found");
  if (interview.status !== "OPEN" || !interview.structuredQuestions) return interview;
  const index = interview.currentQuestionIndex ?? 0;
  const question = interview.structuredQuestions[index];
  if (!question) return interview;
  const option = question.options.find((candidate) => candidate.stance === input.stance);
  if (!option) throw new Error("That response is not available for this question");
  if (!interview.managerPersonId) throw new Error("No manager on this interview");

  const consequenceSummary = applyConsequence(db, {
    question,
    stance: input.stance,
    managerPersonId: interview.managerPersonId,
    teamId: input.teamId,
    date: input.date,
  });

  const answer: PressAnswer = {
    questionId: question.id,
    stance: input.stance,
    text: option.text,
    consequenceSummary,
    answeredOn: input.date,
  };
  const structuredAnswers = [...(interview.structuredAnswers ?? []), answer];
  const nextIndex = index + 1;
  const complete = nextIndex >= interview.structuredQuestions.length;

  // Journalist trust: same bounded, temperament-based nudge the existing
  // single-question flow already uses.
  const journalist = new MediaPhaseBRepository(db).journalists().find((item) => item.id === interview.journalistId);
  const previousRelationship = new MediaPhaseBRepository(db)
    .relationships(interview.journalistId)
    .find((item) => item.managerPersonId === interview.managerPersonId);
  const temperamentAdjustment =
    journalist?.temperament === "FRIENDLY" && input.stance !== "CHALLENGE_PLAYER" && input.stance !== "CRITICAL"
      ? 0.03
      : journalist?.temperament === "SCEPTICAL" && (input.stance === "DEFLECT" || input.stance === "NON_COMMITTAL")
        ? -0.02
        : 0.01;
  const trust = Math.max(0, Math.min(1, (previousRelationship?.trust ?? 0.5) + temperamentAdjustment));
  new MediaPhaseBRepository(db).upsertRelationship({
    id:
      previousRelationship?.id ??
      createStableEntityId("media-journalist-relationship", `${interview.journalistId}:${interview.managerPersonId}`),
    journalistId: interview.journalistId,
    managerPersonId: interview.managerPersonId,
    trust,
    lastInteraction: input.date,
    status: "SIMULATION_ONLY",
  });

  const next: MediaInterview = {
    ...interview,
    responses: structuredAnswers.map((item) => item.text),
    structuredAnswers,
    currentQuestionIndex: complete ? nextIndex : nextIndex,
    status: complete ? "COMPLETED" : "OPEN",
    summary: complete
      ? `${interview.summary} Completed after ${structuredAnswers.length} question${structuredAnswers.length === 1 ? "" : "s"}.`
      : interview.summary,
  };
  repo.upsertInterview(next);

  if (complete) publishMaterialPressEvent(db, next, structuredAnswers);
  return next;
};

/** A press conference publishes a real historical event only when a material
 * (non-neutral) stance was actually taken — never for every routine answer. */
const publishMaterialPressEvent = (db: GameDatabase, interview: MediaInterview, answers: PressAnswer[]): void => {
  // FEDERATION_GOVERNANCE and RECRUITMENT have no COMMIT/PROTECT_PLAYER/
  // CHALLENGE_PLAYER/CRITICAL stances of their own (a President is never
  // asked to commit to keeping a player, and neither is a Sporting
  // Director) — ASSERTIVE is their equivalent "took a real position"
  // stance, scoped to these contexts only so it never changes what counts
  // as material for the existing Manager/Owner topics.
  const material =
    interview.context === "FEDERATION_GOVERNANCE" || interview.context === "RECRUITMENT"
      ? answers.find((answer) => answer.stance === "ASSERTIVE")
      : answers.find(
          (answer) =>
            answer.stance === "COMMIT" ||
            answer.stance === "PROTECT_PLAYER" ||
            answer.stance === "CHALLENGE_PLAYER" ||
            answer.stance === "CRITICAL",
        );
  if (!material || !interview.managerPersonId) return;
  const question = interview.structuredQuestions?.find((item) => item.id === material.questionId);
  const eventId = createStableEntityId("historical-event", `press-conference:${interview.id}:${material.questionId}`);
  const eventRepo = new EventRepository(db);
  if (eventRepo.historicalEvents().some((event) => event.id === eventId)) return;
  eventRepo.insertHistoricalEvent({
    id: eventId,
    occurredOn: interview.interviewDate,
    eventType:
      interview.context === "FEDERATION_GOVERNANCE"
        ? "PRESIDENT_PRESS_STATEMENT"
        : interview.context === "RECRUITMENT"
          ? "SPORTING_DIRECTOR_PRESS_STATEMENT"
          : material.stance === "COMMIT"
            ? "MANAGER_PRESS_COMMITMENT"
            : material.stance === "PROTECT_PLAYER"
              ? "MANAGER_PRESS_SUPPORT"
              : material.stance === "CHALLENGE_PLAYER"
                ? "MANAGER_PRESS_CHALLENGE"
                : "MANAGER_PRESS_CRITICISM",
    involvedEntities: [
      { id: interview.managerPersonId, type: "person" },
      ...(question?.subjectEntities ?? []),
    ],
    title: material.text,
    importance: "medium",
    scope: interview.context === "FEDERATION_GOVERNANCE" ? "federation" : "club",
  });
};

/** Deterministic AI response: picks the stance a manager profile would
 * plausibly take from the interview's own context, never re-simulating the
 * question interactively. */
export const answerPressQuestionAsAi = (
  db: GameDatabase,
  input: { interviewId: EntityId; teamId: EntityId; date: string; seed: string },
): MediaInterview => {
  const interview = new MediaPhaseBRepository(db).interviews().find((item) => item.id === input.interviewId);
  if (!interview || !interview.structuredQuestions) throw new Error("Structured press conference not found");
  const index = interview.currentQuestionIndex ?? 0;
  const question = interview.structuredQuestions[index];
  if (!question) return interview;
  // Deterministic from the interview id + question index — same world state
  // always produces the same AI stance.
  const hash = `${input.seed}:${interview.id}:${index}`
    .split("")
    .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 1000, 7);
  const preferredOrder: PressResponseStance[] = ["CALM", "PROTECT_PLAYER", "DEFLECT", "PRAISE", "ASSERTIVE", "NON_COMMITTAL"];
  const available = preferredOrder.filter((stance) => question.options.some((option) => option.stance === stance));
  const stance = available[hash % Math.max(1, available.length)] ?? question.options[0]!.stance;
  return answerPressQuestion(db, { interviewId: input.interviewId, stance, teamId: input.teamId, date: input.date });
};

/**
 * Bounded AI press participation for an AI-controlled manager: opens (or
 * resumes) a real PRE_MATCH/POST_MATCH/TRANSFER/PLAYER_ISSUE conference
 * through the exact same startPressConference/generatePressQuestions path a
 * human uses, then answers every question with answerPressQuestionAsAi
 * until the interview is COMPLETED — never leaving one open, never a second
 * "AI Inbox". Idempotent: startPressConference's own existing-topic/
 * existingOpen checks make a second call for the same source fact resolve
 * to the same interview rather than creating a duplicate, so calling this
 * once per source fact (never on a fixed schedule, never for a fact with
 * nothing grounded) is the only frequency control this function itself
 * needs — the caller is still responsible for deciding *when* a fact is
 * material enough to bother calling this at all (e.g. reusing
 * shouldCreatePreMatchPress for PRE_MATCH).
 */
export const runAiPressConference = (
  db: GameDatabase,
  input: {
    context: "PRE_MATCH" | "POST_MATCH" | "TRANSFER" | "PLAYER_ISSUE";
    managerPersonId: EntityId;
    teamId: EntityId;
    fixtureId?: EntityId;
    date: string;
    seed: string;
  },
): MediaInterview | undefined => {
  const interview = startPressConference(db, {
    context: input.context,
    managerPersonId: input.managerPersonId,
    teamId: input.teamId,
    fixtureId: input.fixtureId,
    date: input.date,
  });
  if (!interview.structuredQuestions || interview.structuredQuestions.length === 0) return undefined;
  let current = interview;
  // A structured conference has at most MAX_QUESTIONS questions, so this
  // loop is inherently bounded — never a risk of looping indefinitely on a
  // malformed interview.
  while (current.status === "OPEN") {
    const next = answerPressQuestionAsAi(db, {
      interviewId: current.id,
      teamId: input.teamId,
      date: input.date,
      seed: input.seed,
    });
    if (next.id === current.id && next.currentQuestionIndex === current.currentQuestionIndex) break;
    current = next;
  }
  return current;
};
