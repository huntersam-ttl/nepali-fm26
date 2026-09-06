import { createStableEntityId, type EntityId, type HistoricalEvent } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "@nepal-football-sim/database";

const clubName = (db: GameDatabase, clubId: EntityId): string =>
  (db.prepare("SELECT name FROM clubs WHERE id=?").get(clubId) as { name?: string } | undefined)?.name ?? "The club";

const personName = (db: GameDatabase, personId: EntityId): string =>
  (db.prepare("SELECT full_name FROM persons WHERE id=?").get(personId) as { full_name?: string } | undefined)
    ?.full_name ?? "The player";

const reactionId = (sourceId: EntityId, suffix: string): EntityId =>
  createStableEntityId("history", `REACTION:${sourceId}:${suffix}`);

const findRef = (event: HistoricalEvent, type: string) =>
  event.involvedEntities.find((ref) => ref.type === type);

/**
 * Canonical, deterministic follow-up stories for a just-published event —
 * derived purely from that event's own real data (club/player ids, fee,
 * percentage), never a random or contradictory flavor line. Each has a
 * stable id keyed off the source event, so publishing the same date twice
 * never produces a duplicate reaction.
 */
export const deriveFollowUpEvents = (db: GameDatabase, source: HistoricalEvent): HistoricalEvent[] => {
  const type = source.eventType.toUpperCase();
  const club = findRef(source, "club");
  const player = findRef(source, "person");
  const events: HistoricalEvent[] = [];

  if (/TRANSFER_COMPLETED|FREE_AGENT_SIGNED/.test(type) && club && player) {
    const club_ = clubName(db, club.id);
    const player_ = personName(db, player.id);
    events.push({
      id: reactionId(source.id, "supporter-welcome"),
      occurredOn: source.occurredOn,
      eventType: "SUPPORTER_REACTION",
      involvedEntities: [club, player],
      title: `${club_} supporters welcome the arrival of ${player_}.`,
      importance: "medium",
      scope: "club",
      data: { sourceEventId: source.id },
    });
  }

  if (/LOAN_STARTED/.test(type) && club && player) {
    const club_ = clubName(db, club.id);
    const player_ = personName(db, player.id);
    events.push({
      id: reactionId(source.id, "loan-expectation"),
      occurredOn: source.occurredOn,
      eventType: "SUPPORTER_REACTION",
      involvedEntities: [club, player],
      title: `${player_} says the loan spell at ${club_} is a chance to play regular first-team football.`,
      importance: "medium",
      scope: "club",
      data: { sourceEventId: source.id },
    });
  }

  if (/CLUB_OWNERSHIP_TRANSFERRED|OWNERSHIP_CAPITAL_INJECTION_COMPLETED|OWNERSHIP_CONTROLLING_STAKE_AGREED|OWNERSHIP_DEAL_COMPLETED/.test(type) && club) {
    const club_ = clubName(db, club.id);
    events.push({
      id: reactionId(source.id, "supporter-ownership"),
      occurredOn: source.occurredOn,
      eventType: "SUPPORTER_REACTION",
      involvedEntities: [club],
      title: `${club_} supporters react to the change at the top of the club.`,
      importance: "medium",
      scope: "club",
      data: { sourceEventId: source.id },
    });
    events.push({
      id: reactionId(source.id, "investor-priorities"),
      occurredOn: source.occurredOn,
      eventType: "INVESTOR_PRIORITIES_ANNOUNCED",
      involvedEntities: [club],
      title: `The new investment at ${club_} comes with an outline of what the owner wants to prioritize.`,
      importance: "medium",
      scope: "club",
      data: { sourceEventId: source.id },
    });
  }

  if (/FACILITY_PROJECT_COMPLETED/.test(type) && club) {
    const club_ = clubName(db, club.id);
    events.push({
      id: reactionId(source.id, "facility-opening"),
      occurredOn: source.occurredOn,
      eventType: "SUPPORTER_REACTION",
      involvedEntities: [club],
      title: `${club_} officially opens the newly completed facility to a positive reception.`,
      importance: "medium",
      scope: "club",
      data: { sourceEventId: source.id },
    });
  }

  if (/SPONSORSHIP_ACCEPTED/.test(type) && club) {
    const club_ = clubName(db, club.id);
    events.push({
      id: reactionId(source.id, "sponsor-activation"),
      occurredOn: source.occurredOn,
      eventType: "SPONSOR_ACTIVATION",
      involvedEntities: [club],
      title: `${club_} activates matchday branding as the new partnership begins.`,
      importance: "medium",
      scope: "club",
      data: { sourceEventId: source.id },
    });
  }

  if (/GOVERNMENT_SUPPORT_REQUESTED/.test(type) && club) {
    const club_ = clubName(db, club.id);
    events.push({
      id: reactionId(source.id, "government-response"),
      occurredOn: source.occurredOn,
      eventType: "GOVERNMENT_RESPONSE",
      involvedEntities: [club],
      title: `The local government notes ${club_}'s funding request for review.`,
      importance: "medium",
      scope: "club",
      data: { sourceEventId: source.id },
    });
  }

  if (/FEDERATION_POLICY_COMPLETED|FEDERATION_COMMERCIAL_RIGHTS_AWARDED|REFEREE_DEVELOPMENT_COMPLETED|WOMENS_PROGRAMME_STARTED/.test(type)) {
    events.push({
      id: reactionId(source.id, "federation-milestone"),
      occurredOn: source.occurredOn,
      eventType: "FEDERATION_MILESTONE_REACTION",
      involvedEntities: source.involvedEntities,
      title: `Clubs around Nepal take note of the federation's latest programme milestone.`,
      importance: "medium",
      scope: "federation",
      data: { sourceEventId: source.id },
    });
  }

  return events;
};
