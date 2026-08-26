import type { MatchEvent } from "@nepal-football-sim/shared-types";

/**
 * Deterministic match commentary.
 *
 * Templates are chosen by hashing the event's identity, not by drawing from the
 * match RNG, so wording never influences the football and the same event always
 * reads the same way. No runtime model calls.
 */

export type CommentaryContext = {
  homeTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  /** Resolves a person id to a display name. */
  playerName: (personId: string) => string;
  homeGoals: number;
  awayGoals: number;
};

export type CommentaryLine = {
  eventId: string;
  minute?: number;
  stoppageTime?: number;
  type: string;
  importance: string;
  teamId?: string;
  text: string;
};

/** FNV-1a over the event identity. Stable across runs and platforms. */
const hash = (value: string): number => {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result >>> 0;
};

const pick = (options: readonly string[], key: string): string =>
  options[hash(key) % options.length]!;

const TEMPLATES: Record<string, readonly string[]> = {
  KICK_OFF: ["{home} get us under way against {away}.", "We are under way at kick-off."],
  HALF_TIME: ["Half time. {score}.", "The referee ends the first half. {score}."],
  SECOND_HALF: ["Back under way for the second half.", "We restart. {score}."],
  FULL_TIME: ["Full time. {score}.", "That is the end of the match. {score}."],
  GOAL: [
    "GOAL! {player} finds the net for {team}. {score}.",
    "{player} scores for {team}! {score}.",
    "It's in! {player} makes it {score}.",
  ],
  GOAL_ASSIST: [
    "GOAL! {player} converts after {assist} sets it up. {score}.",
    "{assist} picks out {player}, who finishes for {team}. {score}.",
  ],
  SHOT_CLEAR: [
    "A clear opening for {player}, but it goes begging.",
    "{player} works a real chance for {team} and cannot take it.",
  ],
  SHOT: [
    "{player} drives a shot wide for {team}.",
    "An effort from {player} that drifts off target.",
    "{player} tries his luck from distance. Off target.",
  ],
  SHOT_ON_TARGET: [
    "{player} forces the goalkeeper into action.",
    "A shot on target from {player}.",
  ],
  SAVE: ["Save! {player} keeps {team} level.", "{player} gets down well to deny the effort."],
  CORNER: ["Corner to {team}.", "{team} win a corner after sustained pressure."],
  FOUL: ["Foul by {player}.", "{player} gives away a free kick."],
  YELLOW_CARD: [
    "Yellow card for {player} after a late challenge.",
    "{player} goes into the book for {team}.",
  ],
  SECOND_YELLOW: [
    "Second yellow for {player}. He is off.",
    "{player} picks up a second booking and will take no further part.",
  ],
  RED_CARD: [
    "Red card! {player} is dismissed and {team} are down to ten.",
    "{player} is sent off. {team} must play on a man short.",
  ],
  RED_CARD_SECOND_YELLOW: [
    "{player} is dismissed for a second bookable offence. {team} are a man down.",
  ],
  INJURY: ["{player} is down and needs treatment.", "Concern for {team} as {player} pulls up."],
  INJURY_SERIOUS: [
    "{player} looks in real trouble and cannot continue.",
    "A worrying moment for {team}; {player} is unable to carry on.",
  ],
  SUBSTITUTION: [
    "Substitution for {team}: {player} replaces {assist}.",
    "{team} make a change, {assist} off and {player} on.",
  ],
  TACTICAL_CHANGE: ["{team} adjust their approach.", "A tactical switch from {team}."],
  ASSIST: ["The assist goes to {player}."],
};

/** Renders one event as a line of commentary. */
export const commentaryFor = (event: MatchEvent, context: CommentaryContext): CommentaryLine => ({
  eventId: String(event.id),
  minute: event.minute,
  stoppageTime: event.stoppageTime,
  type: event.type,
  importance: String(event.data?.importance ?? "MINOR"),
  teamId: event.teamId ? String(event.teamId) : undefined,
  text: renderText(event, context),
});

const renderText = (event: MatchEvent, context: CommentaryContext): string => {
  const teamName =
    event.teamId === undefined
      ? ""
      : String(event.teamId) === context.homeTeamId
        ? context.homeTeamName
        : context.awayTeamName;
  const player = event.primaryPersonId ? context.playerName(String(event.primaryPersonId)) : "";
  const other = event.secondaryPersonId ? context.playerName(String(event.secondaryPersonId)) : "";
  const score = `${context.homeGoals}-${context.awayGoals}`;

  const key = templateKey(event);
  const template = pick(TEMPLATES[key] ?? TEMPLATES.FOUL!, `${event.id}:${key}`);
  return template
    .replace("{home}", context.homeTeamName)
    .replace("{away}", context.awayTeamName)
    .replace(/\{team\}/g, teamName || context.homeTeamName)
    .replace(/\{player\}/g, player || "A player")
    .replace(/\{assist\}/g, other || player || "a team-mate")
    .replace(/\{score\}/g, score);
};

/** Chooses the template family, including the richer context variants. */
const templateKey = (event: MatchEvent): string => {
  switch (event.type) {
    case "GOAL":
      return event.secondaryPersonId ? "GOAL_ASSIST" : "GOAL";
    case "SHOT":
      return event.data?.chanceType === "clear" ? "SHOT_CLEAR" : "SHOT";
    case "RED_CARD":
      return event.data?.secondYellow ? "RED_CARD_SECOND_YELLOW" : "RED_CARD";
    case "INJURY":
      return event.data?.severity && event.data.severity !== "minor" ? "INJURY_SERIOUS" : "INJURY";
    default:
      return event.type;
  }
};

/**
 * The commentary score is the score at the time of the event, so a goal line
 * reads with the score it produced rather than the final score.
 */
export const commentaryTimeline = (
  events: readonly MatchEvent[],
  base: Omit<CommentaryContext, "homeGoals" | "awayGoals">,
): CommentaryLine[] => {
  let homeGoals = 0;
  let awayGoals = 0;
  return events.map((event) => {
    if (event.type === "GOAL") {
      if (String(event.teamId) === base.homeTeamId) homeGoals += 1;
      else awayGoals += 1;
    }
    return commentaryFor(event, { ...base, homeGoals, awayGoals });
  });
};
