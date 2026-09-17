# Club Commercial / Retail System — Phase 1

## Architecture audit (before writing any code)

Before building anything, the existing finance/commercial/infrastructure
architecture was audited to avoid duplicating canonical systems. The
headline finding: **most of what this task asked for already existed and
was already running live**, so Phase 1 is a small, real extension of
that machinery rather than a new subsystem.

- **Finance ledger**: `ClubLedgerEntry` (`packages/shared-types/src/domain.ts`)
  — `id, clubId, date, category: ClubLedgerCategory, direction, amount,
  currency, description, relatedEntityId?, status`. `MERCHANDISE` is
  already a first-class `ClubLedgerCategory` value — there is no new
  `MERCHANDISE_REVENUE` category in this feature, by design. All writes
  go through the single canonical `postClubTransaction(db, {...})`
  (`packages/simulation/src/club-economy.ts`).
- **Merchandise revenue**: `postMerchandiseRevenue(db, { clubId, date, seed })`
  already exists, already computes units sold from
  `ClubSupporterProfile` (core/casual/diaspora supporters) ×
  `ClubCommercialProfile.merchandiseAppeal`, adjusted by league standing,
  and already posts to the `MERCHANDISE` ledger category every month via
  `processClubEconomyMonth` — the canonical monthly economy tick. This
  function was not written for this feature; it pre-dates it.
- **Infrastructure/facility projects**: `InfrastructureProject`
  (`domain.ts`) already has a complete propose → cost → financing →
  construction → completion lifecycle
  (`createInfrastructureProject`/`createInfrastructureProjectCommand`/
  `advanceInfrastructureProjects`, all in `club-economy.ts`), used for
  training grounds, academies, stadiums, medical rooms, etc. **Retail
  upgrades reuse this exact lifecycle** rather than a parallel one.
- **Supporters/reputation**: two real, separate systems exist —
  `ClubSupporterProfile` (economy-side, what `postMerchandiseRevenue`
  reads) and the richer `SupporterCultureProfile`
  (`packages/simulation/src/supporter-culture.ts`, `commercialEngagement`
  dimension). Phase 1 only touches the economy-side profile, matching
  what the revenue function already reads.
- **"ClubMart"** (`packages/simulation/src/clubmart.ts`) looked like it
  might already be a retail/merchandise system by name — it is not. It's
  the club's **inbound procurement** arm (buying kit/training
  wear/medical supplies/equipment from suppliers), the mirror image of
  selling merchandise to fans. Not touched, not duplicated.
- **AI clubs**: `runClubAiSeasonPlanning` → `chooseInfrastructureProjectType`
  (`packages/simulation/src/ai-club-strategy.ts`) already picks between
  real project types (training ground/academy/medical room/stadium)
  based on genuine facility gaps and affordability, once per season.

## What Phase 1 actually adds

**`RETAIL_STORE`** — a new `InfrastructureProjectType` value, flowing
through the existing facility-project pipeline with no new state
machine:

- `projectBaseCost`: NPR 900,000 base (before macro-economy adjustment),
  in the same range as other mid-tier facility types.
- `projectComponents`: `["shop_floor", "till_and_fulfilment"]`.
- `assetTypeForProject`: `BUILDING` (same category as `OFFICE`).
- `projectStoryPhrase`: "club store investment".
- `projectPrerequisites`/`projectCapacity`: fall through to the existing
  defaults (no prerequisite; capacity 1) — a club store doesn't gate on
  another facility existing first, and "capacity" in the physical sense
  (seats, academy places) doesn't apply to it.

**Completion effect**: when `advanceInfrastructureProjects` completes a
`RETAIL_STORE` project, it raises
`ClubCommercialProfile.merchandiseAppeal` by a bounded **+6**, capped at
**100** — additive and capped, the same "no runaway economics"
discipline already used for the sibling facility-quality bumps
(`trainingFacilityQuality + 1.2`, etc.) immediately next to it in the
same function. Verified structurally: forcing `merchandiseAppeal` to 97
before completing a second store confirms the cap actually holds rather
than just being unlikely to be hit in normal play.

Because `postMerchandiseRevenue` already reads `merchandiseAppeal` every
month, a completed club store produces a real, measured increase in
actual monthly merchandise revenue with zero changes to the revenue
function itself — proven directly in
`packages/testing/src/club-retail-phase-a.test.ts` by running the real
revenue-posting function before and after a store completes on
otherwise-identical world state.

**AI participation**: `chooseInfrastructureProjectType` gained a
`RETAIL_STORE` branch, gated on real commercial priority
(`priorities.commercial >= 0.5`) and a genuinely low
`merchandiseAppeal` (`< 40`) — the same "real need, not a coin flip"
pattern every other branch in that function already uses. AI clubs grow
retail infrastructure through the identical decision pipeline as every
other facility type, not a human-only special case.

**UI**: "Club store" was added to the Owner Facilities screen's existing
project-type picker (`apps/desktop/src/manager/RoleDetailScreen.tsx`) —
no new navigation section, no new screen. The existing facility-planning
flow (choose type → review real cost/duration/funding → confirm → see
the live project card) handles it identically to every other project
type. Live-verified in the browser: selected "Club store", the planner
correctly showed "The club has no dedicated club store on record yet,"
a real capital cost (NPR 714,277 for this club), expected completion
date, and funding split; confirming created a real "Retail Store"
project card in `Planning` status. Zero console errors.

## Tests

- `packages/testing/src/club-retail-phase-a.test.ts` (3 tests): project
  lifecycle completes and records a `BUILDING` asset like any other
  facility project; completion raises `merchandiseAppeal` by a bounded
  amount and the 100 cap holds even when forced near it; a completed
  store measurably increases the club's real monthly merchandise
  revenue (via the actual `postMerchandiseRevenue` function, not a
  mock).
- `packages/testing/src/ai-facility-variety.test.ts` (+2 tests, existing
  5 unaffected): an AI club with real commercial priority and low appeal
  chooses `RETAIL_STORE`; one with already-high appeal does not.
- Full pre-existing regression suite re-run and unaffected:
  `infrastructure-phase-a.test.ts`, `infrastructure-phase-c.test.ts`,
  `chairman-infrastructure-command.test.ts`,
  `ai-facility-development.test.ts`, `commercial-phase-c.test.ts` — all
  16 tests still pass.
- Full `apps/desktop` unit suite: 280/280 unaffected.
- Root typecheck: unchanged at the historical 17-error baseline; 0 new
  regressions.

## Explicitly not attempted this pass

This phase deliberately shipped the smallest real, non-duplicative,
fully-tested slice — a working lever (build a store) connected to a
real, measured outcome (more merchandise revenue) — rather than a wide,
half-verified surface. Still open, in roughly the order a future phase
should tackle them:

- **Home/Away/Third-specific shirt-sales tracking** and a
  general-merchandise-vs-shirts split. `postMerchandiseRevenue`
  currently posts one abstract merchandise figure; splitting it by kit
  slot (and connecting that split to the persisted `ClubKitDesign`/kit
  history from the visual-identity foundation) is real, separable work.
- **Star-player / major-signing demand boosts**. The audit found the
  existing proxy for "how big a signing this is" is transfer fee
  (`applySupporterTransferOutcome` in `supporter-culture.ts` already
  uses `transferFee` this way for `STAR_SIGNING` supporter events) — a
  bounded, decaying merchandise-appeal or unit-volume boost keyed off
  the same `TRANSFER_COMPLETED` event would be the natural hook, not a
  new "celebrity score."
- **Named-player shirt sales** ("Top sellers this season: 1. Player
  A…") — the audit found no existing player popularity/fame signal
  precise enough to support this honestly. Classified as
  `NAMED_PLAYER_SHIRT_SALES = DEFERRED_INSUFFICIENT_POPULARITY_SIGNAL`,
  per this task's own instruction not to fake it.
- **Retail capacity levels / online vs. physical vs. matchday retail**
  as separate dials — Phase 1 has one lever (a single `RETAIL_STORE`
  project raises one appeal stat). Splitting this into physical/online/
  matchday tiers is a real design decision for a later phase, not
  assumed here.
- **Owner Commercial / Club Store dashboard UI** — the business-hero
  page (badge, current kits, sales breakdown, retail network, recent
  drivers) described in the brief was not built. Phase 1 only exposes
  the upgrade lever through the existing Facilities screen; a dedicated
  Commercial page reusing `ClubBadge`/`ClubKit` is real, separable UI
  work.
- **Kit-history commercial connection** (season-by-season sales next to
  that season's actual kit snapshot) — depends on the shirt-sales split
  above existing first.
- **Season history / reporting**, **3D store integration**, and
  **supplier/sponsorship contracts** — all explicitly deferred to a
  later phase by this task's own instructions (`CLUB_RETAIL_AND_MERCHANDISE_PHASE_1_COMPLETE`
  is not claimed; supplier/sponsor contracts are named as Phase 2).

## Provenance

All merchandise/retail figures remain `SIMULATION_ONLY`, consistent with
every other commercial figure this codebase already produces
(`ClubCommercialProfile.status`, `CommercialHistoryEvent`). No real-world
merchandise sales benchmarks were used or exposed as verified in-game
facts.
