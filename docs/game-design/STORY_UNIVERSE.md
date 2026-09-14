# Story Universe

A permanent, cross-cutting roadmap track, the same shape as 3D Presentation.
This document is the foundation audit and design record — it names what
already exists, closes one real structural gap found while auditing it, and
sets the principles everything narrative builds on from here.

## The core finding

**A Story Universe already exists — it was never named that.** `HistoricalEvent`
(`packages/shared-types/src/domain.ts`, table `historical_events`) is the one
canonical fact table. Everything that looks like a "Story" system —
`MediaStory`, story threads, Story Detail, role-scoped Inbox delivery — is a
*derived, read-time projection* over that one table, never a second source of
truth. 42 call sites across roughly 25 files in `packages/simulation/src`
already publish into it: match results, transfers, ownership changes,
federation governance, press, infrastructure, club economy, commercial
rights, insurance, youth development, women's football, supporter politics,
government relations, and more. Press is one producer among many, not the
whole system.

This foundation work is therefore consolidation and hardening, not a
from-scratch build — matching the permanent principle below that Stories
describe canonical state changes, they do not invent a second engine to
produce them.

## Core principles (permanent)

A. **Real state first.** A Story exists because something real already
   happened in the simulation — a match finished, a transfer completed, a
   project changed status. Never the other way round.

B. **Materiality threshold.** Not every state change is a Story. Each
   producer gates on its own real materiality signal (a genuine dismissal, a
   heavy scoreline, a completed deal, an assertive press stance) — never
   "log everything and let the feed sort it out."

C. **Exact-once.** The same real fact publishes exactly one Story, however
   many times it's evaluated, re-simulated, or reloaded from.

D. **Entity references, never raw ids.** Every entity a Story names is a
   real, resolved `EntityReference` with a genuine destination, or plain
   text if none exists — never a bare UUID, never a fabricated link.

E. **Role-aware visibility.** Delivery is scoped per role/club/federation
   through the existing routing layer — never a second copy of the same
   Story row per role.

F. **Persistent history.** A published Story is a real SQL row. It survives
   reload unchanged — no regeneration, no drift.

G. **Deterministic generation.** Same canonical state, same seed → the same
   Stories, in the same order. No `Math.random()` deciding whether a Story
   exists.

H. **No fabricated VERIFIED facts.** A Story may summarize canonical stored
   data or deterministic simulation state. It never invents an exact sponsor
   figure, an attendance count, a quotation, or a ranking that isn't
   actually stored.

I. **SIMULATION_ONLY content stays plausible and internally marked as such** —
   consistent with every other simulation-derived surface in this codebase
   (club colours, valuation estimates, etc.).

J. **No duplicate narrative systems.** One canonical fact table, one
   dedupe mechanism, one entity-reference resolver, one role-routing layer.
   A new event category is a new producer writing into the same table, never
   a parallel one.

## The data model (existing, unchanged — no schema gap found)

```ts
// packages/shared-types/src/domain.ts
type HistoricalEvent = {
  id: EntityId;
  occurredOn: ISODate;
  eventType: string;          // free-form SNAKE_CASE — see taxonomy below
  involvedEntities: EntityRef[];
  title: string;
  data?: Record<string, unknown>;
  importance: "low" | "medium" | "high" | "historic";
  scope: "person" | "club" | "federation" | "country" | "world";
};
```

`MediaStory` is a separate, genuinely derived row (`sourceEntityId` points
back at the originating `HistoricalEvent.id`) used specifically by the
press/media surfaces (outlet, headline, reputation effect) — an additional
*view* of certain historical events for that one presentation context, not
a competing fact table.

Every audited field this doc's principles depend on already exists:
source identity (`id`, stably derived per producer — see below), category
(`eventType`), timestamp (`occurredOn`), title, entity refs
(`involvedEntities`), provenance (implicit via `data`/producer, explicit via
`MediaStory.provenanceStatus` for press), and materiality (`importance`).
**No schema migration was needed or made.**

## Category taxonomy (reconciled, not invented)

`eventType` is intentionally free-form (a closed enum would need updating
for every future producer). The categories below are the ones real
producers already emit, grouped by the audit's own producer list. New
producers should extend an existing category's naming convention rather
than inventing a new umbrella term for something one of these already
covers:

| Category | Representative `eventType` values | Producer(s) |
| --- | --- | --- |
| MATCH | `MATCH_COMPLETED`, `COMPETITION_SEASON_COMPLETED` | `football-history.ts`, `season-engine.ts` |
| TRANSFER | `TRANSFER_*` (public-facing subset only — see `transfer-market.ts`) | `transfer-market.ts` |
| PRESS | `MANAGER_PRESS_*`, `OWNER_PRESS_STATEMENT`, `PRESIDENT_PRESS_STATEMENT`, `SPORTING_DIRECTOR_PRESS_STATEMENT` | `press-interviews.ts` |
| CLUB / OWNER | `CLUB_OWNERSHIP_TRANSFERRED`, `CLUB_OWNERSHIP_SUCCESSION_STARTED`, `OWNERSHIP_SHARE_SALE` | `ownership.ts` |
| FEDERATION | `NATIONAL_TEAM_CALLUP`, federation project/reform events | `federation-governance.ts`, `federation-policy.ts`, `federation-politics.ts` |
| INFRASTRUCTURE | project start/milestone/completion events | `infrastructure-story.ts`, `club-economy.ts` |
| DEVELOPMENT | `WOMENS_PROGRAMME_STARTED`, `YOUTH_PLAYER_PROMOTED`, `YOUTH_PROGRAMME_REVIVED`/`SUSPENDED` | `womens-youth.ts`, `youth-partnerships.ts` |
| FINANCE / COMMERCIAL | commercial-rights award/activation events | `commercial-rights.ts`, `media-rights.ts` |

Categories from the task's own suggested list that have **no current real
producer** (AWARD, RECORD, RIVALRY, DISCIPLINE, CAREER as a distinct
category, NATIONAL_TEAM beyond call-ups) are intentionally **not** added
here — inventing an empty category before a producer exists would violate
principle A. `story-threads.ts`'s thread grouping and
`football-history.ts`'s `FootballHistoryRepository` (biggest-win-margin,
etc.) are the closest existing primitives a future RECORD/RIVALRY producer
would extend, not replace.

## Materiality model (existing, reused — no new model introduced)

`HistoricalEvent.importance: "low" | "medium" | "high" | "historic"` is
already the shared materiality signal every producer sets, and
`storyImportanceBand()` (`packages/simulation/src/story-entities.ts`) maps
it to a presentation band used by role Inbox delivery:

| `importance` | Band | Used for |
| --- | --- | --- |
| `low` | ROUTINE | feed prominence only |
| `medium` | IMPORTANT | feed prominence, Inbox delivery |
| `high` | MAJOR | feed prominence, Inbox delivery |
| `historic` | BREAKING | feed prominence, Inbox delivery, retention priority |

This already satisfies the task's own "avoid 20-level scoring complexity"
guidance — a four-band model, derived from a field every producer already
sets, not a new parallel score.

## Source identity / exact-once (the one real gap found, now closed)

The dedupe pattern is `createStableEntityId(namespace, businessKey)` +
existence check before insert — but the audit found the existence check
itself was **inconsistent**: most producers guard with a direct SQL
`SELECT 1 FROM historical_events WHERE id = ?`; `press-interviews.ts` used
an in-memory `.some(...)` scan of the *entire* table (correct, but O(n) on
every check); and four producers (`ownership.ts`, `womens-youth.ts`,
`youth-partnerships.ts`, `commercial-rights.ts`, 6 call sites total)
inserted with **no existence check at all**, relying entirely on their own
business key genuinely never recurring. Since `insertHistoricalEvent` is a
plain `INSERT` with no `ON CONFLICT`, a producer whose upstream guarantee
ever weakened (a retried command, a replayed event handler) would have
**crashed**, not silently duplicated.

This is now closed with one shared primitive:

```ts
// packages/simulation/src/historical-events.ts
export const publishHistoricalEvent = (db: GameDatabase, event: HistoricalEvent): void => {
  const existing = db.prepare("SELECT 1 FROM historical_events WHERE id = ?").get(event.id);
  if (existing) return;
  new EventRepository(db).insertHistoricalEvent(event);
};
```

All six previously-unguarded call sites now use it (see the
`fix(stories)` commit). Producers that already had a correct, efficient
SQL pre-check (`football-history.ts`, `season-engine.ts`,
`federation-governance.ts`, etc.) were left as-is — not broken, just not
yet migrated to the shared helper; that migration is optional future
cleanup, not a correctness gap.

Canonical source-id pattern per family (unchanged, already correct):
- match: `MATCH:${matchId}`
- transfer: `TRANSFER_PUBLIC:${offerId}`
- press: `press-conference:${interviewId}:${questionId}`
- ownership: `OWNERSHIP_*:${offerId}` or `OWNERSHIP_SUCCESSION_STARTED:${clubId}:${date}`
- federation: `NATIONAL_TEAM_CALLUP:${teamId}:${personId}`
- infrastructure: project id + state-transition tag

## Entity references (existing, reused)

`resolveStoryEntityReference(db, ref, role)`
(`packages/simulation/src/story-entities.ts`) maps a raw `EntityRef` through
`buildEntityReference` into a real, role-appropriate `EntityReference`;
unmapped reference types are dropped rather than faked. `story-detail-facts.test.ts`
already asserts no raw enum/uuid/duplicate label ever reaches a Story's
presented facts.

## Role relevance / visibility (existing, reused)

`routeHistoricalEvent()` (`packages/simulation/src/media.ts`) plus
`EventRoutingRepository` (`packages/database/src/event-routing-repository.ts`)
classify an event by `eventType`/`scope` and write one delivery row per
active Manager/Owner/President whose scope matches — the existing
mechanism already satisfies "relevance metadata on one canonical row," not
"duplicate the row per role."

## Story feed / detail UI (existing, reused)

- `story-threads.ts` derives thread grouping on every read — deliberately
  no second thread table.
- `story-detail.ts` / `StoryDetailPanel` (`apps/desktop/src/manager/RoleDetailScreen.tsx`)
  is the real, existing Story Detail destination.
- `MediaScreen.tsx` renders the press/media feed and opens `StoryDetailPanel`.

No new feed or detail surface was built this round — the existing ones
already satisfy the foundation requirement.

## AI parity (existing, already proven)

No `AiStory`, no second history table, no AI-specific insert path exists
anywhere in the codebase. `press-story-materiality.test.ts`'s AI section
explicitly proves an AI-completed interview publishes through the identical
`publishMaterialPressEvent` path as every human role.

## What this round actually changed

1. **`packages/simulation/src/historical-events.ts`** — the shared
   `publishHistoricalEvent` primitive described above.
2. **Six call sites retrofitted** (`ownership.ts` ×4, `womens-youth.ts` ×3,
   `youth-partnerships.ts` ×1, `commercial-rights.ts` ×1) to use it instead
   of a bare, unguarded `insertHistoricalEvent`.
3. **`packages/testing/src/story-universe-exact-once.test.ts`** — a
   consolidated exact-once proof spanning the shared primitive itself, a
   real match producer, a real ownership producer, and press (as the
   representative for the transfer/federation-shaped producers, which
   already have their own extensive dedicated coverage) — including a
   save/reload check.
4. **`packages/testing/src/story-universe-soak.test.ts`** — a one-season
   natural-world-progression soak instrumented for category/materiality
   distribution, duplicate ids, dead entity references, and raw-UUID
   leakage across every category the world actually produces in a season,
   not just press.

## What this round did not change (and why)

- **No schema migration.** The existing `HistoricalEvent`/`MediaStory`
  shape already carries every field the principles above need.
- **No new UI.** Feed, thread derivation, and Story Detail already exist
  and already pass their own dedicated accessibility/hygiene tests.
- **No new category invented without a producer.** See the taxonomy table.
- **Federation/academy/national-centre 3D scenes and pre-match 3D
  presentation** are 3D-track items, not Story Universe ones — tracked in
  `3D_PRESENTATION_AND_ANIMATION.md`, not duplicated here.

## Status

Foundation-complete in the sense that matters: the canonical model, the
category taxonomy, the materiality model, the entity-reference resolver,
the role-routing layer, and the Story Detail/feed UI all already existed
and are now additionally proven exact-once end-to-end with a consolidated
test and a real soak; the one genuine structural gap found (inconsistent
dedupe guarding) is closed. Richer narrative chains, records/milestones,
rivalries, career arcs, and awards/history are future extensions on top of
this foundation, not part of it — see the roadmap notes in
`3D_PRESENTATION_AND_ANIMATION.md`'s future-system matrix for how each of
those should eventually connect into this same one fact table.
