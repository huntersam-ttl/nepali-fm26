import {
  CompetitionRepository,
  EventRepository,
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
  const offers = new TransferMarketRepository(db).transferOffers();
  const candidates: Candidate[] = [];

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

export const generatePressQuestions = (
  db: GameDatabase,
  input: {
    context: MediaInterview["context"];
    teamId: EntityId;
    fixtureId?: EntityId;
  },
): PressQuestion[] => {
  const candidates: Candidate[] =
    input.context === "PRE_MATCH" && input.fixtureId
      ? preMatchCandidates(db, { teamId: input.teamId, fixtureId: input.fixtureId })
      : input.context === "POST_MATCH" && input.fixtureId
        ? postMatchCandidates(db, { teamId: input.teamId, fixtureId: input.fixtureId })
        : input.context === "TRANSFER"
          ? transferCandidates(db, { teamId: input.teamId })
          : input.context === "PLAYER_ISSUE"
            ? playerIssueCandidates(db, { teamId: input.teamId })
            : [];
  return candidates
    .sort((a, b) => b.priority - a.priority || a.topic.localeCompare(b.topic))
    .slice(0, MAX_QUESTIONS)
    .map((candidate, index) => ({
      id: createStableEntityId("press-question", `${input.fixtureId ?? input.teamId}:${input.context}:${index}`),
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
  input: { question: PressQuestion; stance: PressResponseStance; managerPersonId: EntityId; teamId: EntityId; date: string },
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

/** Opens (or returns the already-open) structured press conference for this
 * exact context — one open conference per manager at a time, matching the
 * existing single-conference-at-a-time rule. */
export const startPressConference = (
  db: GameDatabase,
  input: {
    context: MediaInterview["context"];
    managerPersonId: EntityId;
    teamId: EntityId;
    date: string;
    fixtureId?: EntityId;
    importance?: number;
  },
): MediaInterview => {
  const repo = new MediaPhaseBRepository(db);
  const existingOpen = repo.interviews(input.managerPersonId).find((item) => item.status === "OPEN");
  if (existingOpen) return existingOpen;

  initializeMediaForSave(db);
  initializeMediaJournalists(db);
  const questions = generatePressQuestions(db, {
    context: input.context,
    teamId: input.teamId,
    fixtureId: input.fixtureId,
  });
  const outlet =
    new MediaRepository(db)
      .outlets()
      .sort((a, b) => b.reach - a.reach || a.id.localeCompare(b.id))
      .find((candidate) => candidate.scope !== "REGIONAL_INTERNATIONAL") ?? new MediaRepository(db).outlets()[0]!;
  const journalist =
    new MediaPhaseBRepository(db).journalists(outlet.id)[0] ?? new MediaPhaseBRepository(db).journalists()[0]!;
  const sourceEntityId = input.fixtureId ?? input.teamId;
  const interview: MediaInterview = {
    id: createStableEntityId("media-interview", `${sourceEntityId}:${input.context}:${input.date}`),
    outletId: outlet.id,
    journalistId: journalist.id,
    sourceEntityId,
    managerPersonId: input.managerPersonId,
    interviewDate: input.date,
    context: input.context,
    importance: input.importance ?? (questions.length > 0 ? 6 : 3),
    questions: questions.map((question) => question.prompt),
    responses: [],
    summary: `${input.context === "PRE_MATCH" ? "Pre-match" : input.context === "POST_MATCH" ? "Post-match" : input.context === "TRANSFER" ? "Transfer" : "Player issue"} press conference opened.`,
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
  input: { interviewId: EntityId; stance: PressResponseStance; teamId: EntityId; date: string },
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
  const material = answers.find(
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
      material.stance === "COMMIT"
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
    scope: "club",
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
