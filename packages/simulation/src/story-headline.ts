import type { HistoricalEvent } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "@nepal-football-sim/database";
import { findHomeFootballContext } from "./home-context.js";

/**
 * The single deterministic presentation layer for story headlines.
 *
 * Producers write their own titles, and most are already natural sentences
 * with real entity names — those are returned verbatim. This module exists
 * for the cases where a producer's title is weak or machine-shaped: a raw
 * SCREAMING_SNAKE_CASE token, a lowercase-leading fragment, or a generic
 * "<Thing> updated" placeholder with no subject. Nothing here rewrites
 * persisted history — it is a read/render-time decision only.
 *
 * Two hard rules:
 *   1. Canonical names are used when the caller supplies them, and NEVER
 *      invented. A missing name degrades to neutral contextual copy
 *      ("A club opens talks for a player"), never to a placeholder token,
 *      a raw id, or a fabricated club/person.
 *   2. Output is deterministic — the same input always produces the same
 *      headline. No randomness, no date-dependent phrasing, no drama that
 *      the event itself does not support.
 */

/** Canonical, already-resolved names. Every field is optional: the family
 * builders below degrade to neutral copy rather than inventing anything. */
export type StoryHeadlineNames = {
  player?: string;
  club?: string;
  otherClub?: string;
  sponsor?: string;
  institution?: string;
  competition?: string;
  season?: string;
  programme?: string;
  project?: string;
  opponent?: string;
  result?: string;
  /** The home country, for headlines about its national teams. */
  nation?: string;
};

export type StoryHeadlineInput = {
  eventType: string;
  /** The producer's own title, when the event has one. */
  title?: string;
  names?: StoryHeadlineNames;
};

const RAW_ENUM = /(^|\s|:)[A-Z][A-Z0-9]*(_[A-Z0-9]+)+(\s|$|\.)/;
const SNAKE_OR_CAMEL_LEAK = /(^|\s)[a-z]+_[a-z_]+(\s|$)|(^|\s)[a-z]+[A-Z][a-zA-Z]*(\s|$)/;
const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Placeholder shapes a producer should never have shipped as a headline. */
const GENERIC_PLACEHOLDER = /^(status|state|event|record)\b|^\w+ (updated|processed|changed)$|^(scheduled event processed)/i;

/** A producer title is kept verbatim only when it reads as real prose: no raw
 * enum, no snake/camel leak, no bare id, not a generic placeholder, and it
 * starts like a sentence rather than a fragment. */
export const isPresentableHeadline = (title: string | undefined): title is string => {
  if (!title) return false;
  const trimmed = title.trim();
  if (trimmed.length === 0) return false;
  if (RAW_ENUM.test(trimmed)) return false;
  if (SNAKE_OR_CAMEL_LEAK.test(trimmed)) return false;
  if (UUID_LIKE.test(trimmed)) return false;
  if (GENERIC_PLACEHOLDER.test(trimmed)) return false;
  // A headline that opens lowercase is a fragment, not a sentence
  // ("promotion suspended for ..."), so it goes through a family builder.
  return /^[A-Z0-9"“]/.test(trimmed);
};

const subjectClub = (names: StoryHeadlineNames | undefined): string => names?.club ?? "A club";
const subjectPlayer = (names: StoryHeadlineNames | undefined): string => names?.player ?? "a player";
const namedCompetition = (names: StoryHeadlineNames | undefined): string =>
  names?.competition ?? names?.season ?? "the competition";

/**
 * Family builders, matched in order against the event type. Each returns a
 * complete natural headline for that family/state using whatever canonical
 * names are available.
 */
const FAMILIES: readonly { match: RegExp; build: (names: StoryHeadlineNames | undefined) => string }[] = [
  // ---- TRANSFER / LOAN -------------------------------------------------
  {
    match: /^TRANSFER_REQUESTED$/,
    build: (n) => `${subjectPlayer(n)} asks to leave ${n?.club ?? "the club"}`.replace(/^./, (c) => c.toUpperCase()),
  },
  { match: /^TRANSFER_OFFER_SUBMITTED$/, build: (n) => `${subjectClub(n)} open talks for ${subjectPlayer(n)}` },
  { match: /^TRANSFER_OFFER_COUNTERED$/, build: (n) => `Revised terms keep talks alive for ${subjectPlayer(n)}` },
  { match: /^TRANSFER_OFFER_REJECTED$/, build: (n) => `${subjectClub(n)} reject the offer for ${subjectPlayer(n)}` },
  {
    match: /^(TRANSFER_COMPLETED|TRANSFER_OFFER_ACCEPTED)$/,
    build: (n) => (n?.otherClub ? `${subjectPlayer(n)} completes move to ${n.otherClub}` : `${subjectPlayer(n)} completes the move`).replace(/^./, (c) => c.toUpperCase()),
  },
  {
    match: /^LOAN_STARTED$/,
    build: (n) => `${subjectPlayer(n)} joins ${n?.otherClub ?? "a new club"} on loan`.replace(/^./, (c) => c.toUpperCase()),
  },
  {
    match: /^LOAN_ENDED$/,
    build: (n) => `${subjectPlayer(n)} returns from a loan spell`.replace(/^./, (c) => c.toUpperCase()),
  },
  // ---- OWNERSHIP -------------------------------------------------------
  { match: /^OWNERSHIP_INVESTOR_INTEREST$/, build: (n) => `An investor expresses interest in ${n?.club ?? "the club"}` },
  { match: /^OWNERSHIP_REVISED_PROPOSAL$/, build: () => "Investor returns with a revised proposal" },
  { match: /^OWNERSHIP_DUE_DILIGENCE_CONCERN$/, build: () => "Due diligence raises a concern over the deal" },
  { match: /^OWNERSHIP_BOARD_REVIEWED$/, build: (n) => `The board reviews the offer for ${n?.club ?? "the club"}` },
  { match: /^CLUB_OWNERSHIP_TRANSFERRED$/, build: (n) => `Control of ${n?.club ?? "the club"} changes hands` },
  { match: /^OWNERSHIP_CAPITAL_INJECTION_COMPLETED$/, build: (n) => `New investment arrives at ${n?.club ?? "the club"}` },
  { match: /^(OWNERSHIP_NEGOTIATION_COLLAPSED|OWNERSHIP_INVESTOR_WALKED_AWAY)$/, build: () => "Takeover talks collapse" },
  { match: /^CLUB_OWNERSHIP_SUCCESSION_STARTED$/, build: (n) => `Ownership succession begins at ${n?.club ?? "the club"}` },
  // ---- FACILITY --------------------------------------------------------
  {
    match: /^INFRASTRUCTURE_PROJECT_STARTED$/,
    build: (n) => `Construction begins on ${n?.club ? `${n.club}'s ` : "the club's "}${n?.project ?? "new facility"}`,
  },
  { match: /^INFRASTRUCTURE_PROJECT_DELAYED$/, build: (n) => `${n?.project ? `The ${n.project}` : "The facility project"} falls behind schedule` },
  { match: /^INFRASTRUCTURE_MILESTONE_REACHED$/, build: (n) => `${n?.project ? `The ${n.project}` : "The facility project"} reaches a construction milestone` },
  { match: /^FACILITY_PROJECT_COMPLETED$/, build: (n) => `${subjectClub(n)} open the completed ${n?.project ?? "facility"}` },
  // ---- GOVERNMENT ------------------------------------------------------
  {
    match: /^GOVERNMENT_SUPPORT_REQUESTED$/,
    build: (n) => `${subjectClub(n)} open a government support request`,
  },
  { match: /^GOVERNMENT_SUPPORT_APPROVED$/, build: (n) => `${n?.institution ?? "The government"} approves support for ${n?.club ?? "the club"}` },
  { match: /^GOVERNMENT_SUPPORT_REJECTED$/, build: (n) => `${n?.institution ?? "The government"} turns down ${n?.club ? `${n.club}'s` : "the club's"} support request` },
  { match: /^GOVERNMENT_RESPONSE$/, build: (n) => `${n?.institution ?? "The local government"} notes ${n?.club ? `${n.club}'s` : "the club's"} request for review` },
  // ---- COMMERCIAL ------------------------------------------------------
  { match: /^SPONSORSHIP_ACCEPTED$/, build: (n) => (n?.sponsor ? `${subjectClub(n)} agree a new partnership with ${n.sponsor}` : `${subjectClub(n)} agree a new sponsorship deal`) },
  { match: /^SPONSOR_ACTIVATION$/, build: (n) => `${subjectClub(n)} activate matchday branding as the new partnership begins` },
  { match: /^SPONSORSHIP_EXPIRED$/, build: (n) => (n?.sponsor ? `${subjectClub(n)} part ways with ${n.sponsor}` : `${subjectClub(n)} see a sponsorship deal expire`) },
  { match: /^FEDERATION_COMMERCIAL_RIGHTS_AWARDED$/, build: (n) => (n?.sponsor ? `The federation awards commercial rights to ${n.sponsor}` : "The federation awards a commercial rights package") },
  // ---- NATIONAL TEAM ---------------------------------------------------
  { match: /^NATIONAL_TEAM_CALLUP$/, build: (n) => `${n?.nation ?? "The national team"} call up ${subjectPlayer(n)} for ${n?.programme ?? "the national squad"}` },
  {
    match: /^NATIONAL_TEAM_DEBUT$/,
    build: (n) => `${subjectPlayer(n)} earns a first ${n?.programme ?? "international"} appearance`.replace(/^./, (c) => c.toUpperCase()),
  },
  { match: /^NATIONAL_TEAM_CAMP_COMPLETED$/, build: (n) => `${n?.programme ?? "The national squad"} completes its training camp` },
  { match: /^WOMENS_PROGRAMME_STARTED$/, build: () => "The Women & Girls programme takes its next step" },
  { match: /^(YOUTH_INTAKE_HELD|YOUTH_PLAYER_PROMOTED)$/, build: (n) => `${subjectClub(n)} move a youth prospect up the pathway` },
  // ---- COMPETITION -----------------------------------------------------
  { match: /^COMPETITION_CHAMPION_DECLARED$/, build: (n) => `${subjectClub(n)} crowned champions of ${namedCompetition(n)}` },
  { match: /^CLUB_PROMOTED$/, build: (n) => `${subjectClub(n)} secure promotion${n?.competition ? ` to ${n.competition}` : ""}` },
  { match: /^CLUB_RELEGATED$/, build: (n) => `${subjectClub(n)} relegated after ${n?.season ?? "the season"}` },
  { match: /^CLUB_QUALIFIED$/, build: (n) => `${subjectClub(n)} qualify for ${namedCompetition(n)}` },
  { match: /^PROMOTION_SUSPENDED$/, build: (n) => `Promotion is suspended for ${namedCompetition(n)}` },
  { match: /^RELEGATION_SUSPENDED$/, build: (n) => `Relegation is suspended for ${namedCompetition(n)}` },
  { match: /^COMPETITION_EXPANDED$/, build: (n) => `${namedCompetition(n)} expands for the new season`.replace(/^./, (c) => c.toUpperCase()) },
  { match: /^COMPETITION_SEASON_COMPLETED$/, build: (n) => `${namedCompetition(n)} reaches its conclusion`.replace(/^./, (c) => c.toUpperCase()) },
];

/** Last-resort phrasing for an event type with no family builder: humanized
 * words only, never the raw token, and never a fabricated subject. */
const neutralFallback = (eventType: string): string => {
  const words = eventType
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .join(" ");
  return words.length === 0 ? "A new development in this story" : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

/**
 * The headline a story surface should actually render. Deterministic, never
 * a raw enum, never a fabricated entity name.
 */
export const presentStoryHeadline = (input: StoryHeadlineInput): string => {
  if (isPresentableHeadline(input.title)) return input.title.trim();
  const type = input.eventType.toUpperCase();
  const family = FAMILIES.find((entry) => entry.match.test(type));
  return family ? family.build(input.names) : neutralFallback(type);
};

/**
 * Resolves the canonical names a headline may use, from the event's OWN
 * involved entities and data fields only — a handful of single-row lookups,
 * never a world scan. Anything that does not resolve is simply left out, so
 * the family builders degrade to neutral copy rather than inventing a name.
 */
export const resolveStoryHeadlineNames = (db: GameDatabase, event: HistoricalEvent): StoryHeadlineNames => {
  const names: StoryHeadlineNames = {};
  const one = (sql: string, id: string): string | undefined =>
    (db.prepare(sql).get(id) as { name?: string; full_name?: string } | undefined)?.name ??
    (db.prepare(sql).get(id) as { full_name?: string } | undefined)?.full_name;

  const clubs: string[] = [];
  for (const ref of event.involvedEntities) {
    if (ref.type === "club") {
      const name = one("SELECT name FROM clubs WHERE id=?", ref.id);
      if (name) clubs.push(name);
    } else if (ref.type === "person" && !names.player) {
      names.player = one("SELECT full_name AS name FROM persons WHERE id=?", ref.id);
    } else if (ref.type === "competition" && !names.competition) {
      names.competition = one("SELECT name FROM competitions WHERE id=?", ref.id);
    } else if (ref.type === "competitionSeason" && !names.season) {
      names.season = one("SELECT name FROM competition_seasons WHERE id=?", ref.id);
    } else if (ref.type === "governmentInstitution" && !names.institution) {
      names.institution = one("SELECT name FROM government_institutions WHERE id=?", ref.id);
    } else if (ref.type === "team" && !names.programme) {
      names.programme = one("SELECT name FROM teams WHERE id=?", ref.id);
    }
  }
  if (clubs[0]) names.club = clubs[0];
  if (clubs[1]) names.otherClub = clubs[1];

  const data = event.data;
  if (typeof data?.competitionId === "string" && !names.competition)
    names.competition = one("SELECT name FROM competitions WHERE id=?", data.competitionId);
  if (typeof data?.toCompetitionId === "string" && !names.competition)
    names.competition = one("SELECT name FROM competitions WHERE id=?", data.toCompetitionId);
  if (typeof data?.clubId === "string" && !names.club)
    names.club = one("SELECT name FROM clubs WHERE id=?", data.clubId);
  // `programme` is already a human label at the producer ("Senior Men").
  if (typeof data?.programme === "string") names.programme = data.programme;
  return names;
};

/** The headline for a real event, with canonical names resolved. */
export const storyHeadline = (db: GameDatabase, event: HistoricalEvent): string =>
  presentStoryHeadline({
    eventType: event.eventType,
    title: event.title,
    names: { ...resolveStoryHeadlineNames(db, event), nation: findHomeFootballContext(db)?.countryName },
  });
