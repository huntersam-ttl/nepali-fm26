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
no new navigation section, no new screen *at that point* — Phase 1B below
supersedes this, adding the dedicated Club Store screen and its entry in
the existing Commercial nav group. The existing facility-planning
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

## Phase 1B — Owner Commercial dashboard, shirt split, season history

Phase 1B adds an **analytics layer over the existing `MERCHANDISE`
ledger**. It deliberately does not add a second revenue engine: every
rupee reported here was posted by the canonical monthly economy tick,
and replica-shirt counts are *derived* from that revenue rather than
recorded per sale.

- **`packages/simulation/src/club-retail.ts`** (new, pure, DB-free):
  `SHIRT_REVENUE_SHARE = 0.55`, `SHIRT_PRICE_PREMIUM = 1.6`,
  `KIT_SLOT_SHARES = { home .58, away .27, third .15 }`, and
  `shirtSalesFromRevenue`. Shirts are never 100% of merchandise, the
  unit price mirrors the canonical `180 + appeal * 35` used by
  `postMerchandiseRevenue`, and **Home absorbs the rounding remainder**
  so the three slots always sum to the reported total.
- **`getClubCommercialOverview`** command
  (`desktop-application.ts` → `desktop-server.ts` → `appBridge.ts`).
  Authorisation mirrors `getClubExecutiveOverview` (CHAIRMAN_OWNER, and
  must own the club). It groups `MERCHANDISE`/`CREDIT` ledger entries by
  the same 4-digit season key the kit history uses — which is what makes
  the two joinable with **zero new storage**.
- **Owner "Club Store" screen** (`RoleDetailScreen.tsx`, nav id
  `club-store` under the existing Commercial group): hero (badge, all
  three kits, revenue, units), retail-network metrics reading real
  `RETAIL_STORE` projects, season history joining each season row to
  *that season's* kit snapshot, recent postings, and the provenance
  line. The nav id is `club-store`, not `commercial`, because
  `SECTION_TITLES` is keyed by bare screen id and `PresidentScreen`
  already owns `commercial` — reusing it would have silently retitled
  the President's screen.
- **Known limitation, documented in code**: past-season unit counts are
  computed with the *current* `merchandiseAppeal`, because the game
  stores revenue per season but not the appeal it was earned at.

**Verification.** 7 new pure tests
(`club-retail-shirt-split.test.ts`) + the 3 existing Phase 1 tests =
10/10; `apps/desktop` unit suite 280/280; root typecheck unchanged at
the 17-error baseline (0 new); and the infrastructure/commercial
regression gate (`infrastructure-phase-a`, `ai-facility-variety`,
`commercial-phase-c`) 14/14. Live browser on an isolated dev server with
a fresh save: advanced the world past the month boundary so the real
tick posted, and the screen rendered that tick's actual output — NPR
51,712 merchandise, NPR 28,442 shirt revenue, 44 replica shirts split
25 Home / 12 Away / 7 Third, the real 2026-09-01 posting, and a
season-history row — matching the raw command JSON exactly, with zero
console errors.

**Refresh behaviour.** The screen fetches on mount keyed on `clubId`,
exactly like its sibling owner screens (none of which key on
`worldDate`; they read the date from their own payload). It therefore
does not live-update while the clock is advanced from another screen;
navigating away and back refetches. This matches existing app
behaviour and was not changed unilaterally.

## Phase 1C — verification, persistence and a multi-season soak

**Automated browser coverage** (`apps/desktop/e2e/club-store.spec.ts`).
A save's `randomSeed` is `desktop:<saveName>:<personId>` and the E2E
harness puts `Date.now()` in the save name, so hard-coded rupee figures
would be precision theatre that breaks on the next run. Every number is
instead asserted against the authoritative `getClubCommercialOverview`
payload for that same save — itself derived from the real `MERCHANDISE`
ledger — which makes this a ledger-to-pixel check rather than a
"renders something non-zero" smoke test. It covers the empty state,
advancing the real economy past a month boundary through
`continueCareer`, per-slot unit counts read from each kit tile, the
recent posting, retail status, save/reload, the fetch-on-mount refresh
contract, and the destination links.

*Proven non-tautological*: swapping the Home and Away unit bindings made
the spec fail on the Home tile ("expected 23, received Home11"), and
reverting restored green. A browser test that has never failed has not
been shown to detect anything.

**Accessibility.** axe reports 0 serious and 0 critical violations in
both the zero state and the traded state. Kits are `role="img"` with a
colour-independent description from `kitDescription()` ("Home kit —
plain, shirt with shorts and socks…"), so Home/Away/Third are never
distinguished by hue alone; revenue and store status are text; `Metrics`
renders its `dt`/`dd` pairs inside a real `<dl>`. Keyboard: the nav entry
is asserted focusable, and kit artwork carries no `tabindex`, so
decorative SVG never becomes a tab stop. The two destination affordances
are real `<button>` elements rather than click handlers bolted onto text,
so they take focus natively — though the spec asserts their presence and
activation, not focus specifically.

**Responsive.** Automated at 1024/1280/1440/1600: no page-level
horizontal overflow, and the hero is checked by bounding-box containment
rather than DOM visibility — the check style that caught the real
Owner-nav clipping bug during the identity phases. Phone widths stay out
of scope: the whole career shell clips below its 720px breakpoint, which
is pre-existing and not specific to this screen. PC-first remains the
target.

**Persistence and old saves** (`club-retail-persistence.test.ts`, 6
tests). These drive the real `DesktopApplicationService` end to end —
create a career, advance the canonical economy until the monthly tick
posts, save, then load through a *separate* service instance — rather
than testing repository serialization in isolation. Covered: honest
zeros for a club that has never traded; exact preservation of every
ledger-derived figure across save/load; totals equal to the real
`MERCHANDISE` ledger across several postings in one season, with
postings newest-first and capped; ascending season grouping joined to
each season's own kit snapshot; and a pre-feature save that has
merchandise trade but no `RETAIL_STORE` project, which loads without
migration failure and reports `retailStatus: "NONE"`.

**Create-a-Club.** A founded club starts with `merchandiseAppeal` 0.5
from the existing founding defaults, no `RETAIL_STORE` project, and no
merchandise ledger entries — no free store, no invented trading history.
No wizard step was added; the test only asserts what the existing
founder flow already produces.

**Historical appeal — fixed, with zero new storage.** Phase 1B derived
past-season units from the club's *present-day* appeal, so an old
season's shirt numbers silently changed whenever the club grew. The
audit found the fix already sitting in canonical storage:
`postMerchandiseRevenue` records every posting twice — money into the
ledger, and a `CommercialHistoryEvent` carrying the same `amount` plus
`audienceImpact`, the real units sold at the time. Since the canonical
price is `amount = units * round(180 + appeal * 35)`, dividing stored
amount by stored units recovers that posting's price and inverting the
formula recovers the appeal behind it. No snapshot column, no new table,
no duplicated finance history. Seasons with no history rows fall back to
the club's current appeal, which is the best figure such a save carries.
Proven by moving a club's appeal to 95 after a season traded and
asserting that season's units do not move.

**Multi-season soak** (`club-retail-soak.test.ts`, 5 seasons, ~12.5 min).
Runs the canonical whole-world `simulateNepalCareer` with the economy
enabled and audits every club, AI included. One simulation is shared
across all four assertions — a season of the full world costs minutes,
and running a separate world per test would triple the cost to re-observe
identical state. Results: every merchandise posting finite, non-NaN and
positive; `merchandiseAppeal` inside `[0, 100]` for every club; league
merchandise revenue does not explode between first and last season;
AI clubs build retail stores without spamming them (never more than one
per season per club, facility choice stays varied, retail well under the
majority of projects); and merchandise stays a minority of each club's
credit income alongside matchday, sponsorship and prize money.

**`RETAIL_CAPACITY_TIERS = DEFERRED`.** A completed `RETAIL_STORE`
already raises `merchandiseAppeal`, which the canonical revenue formula
already reads every month. The soak shows that lever staying capped and
merchandise staying proportionate, so the system does not lack a
capacity dial — it has one. Adding a second multiplier on top would
double-count the same store.

**`STAR_PLAYER_COMMERCIAL_EFFECT = DEFERRED_INSUFFICIENT_CANONICAL_POPULARITY_SIGNAL`**
(P2). The signal audit
found no player popularity, fame or marketability field anywhere in the
domain types. The only available proxies are `estimatedValue` and the
`STAR_SIGNING` supporter event, whose "reputation" is literally
`clampRange(transferFee / 100000, 0, 100)` — transfer fee under another
name. Shipping a new commercial mechanic on that alone, during a pass
whose stated priority was closing verification gaps, was not worth the
economic risk.

**`NAMED_PLAYER_SHIRT_SALES = DEFERRED_INSUFFICIENT_PLAYER_POPULARITY_MODEL`** —
unchanged, and for the same reason: inferring named-player sales from
transfer fee would be fabrication dressed as detail.

**Performance.** The dashboard is pure SVG: no WebGL, canvas, chart
library or animation loop anywhere in `ClubKit`/`ClubBadge` or the
Club Store path, and season rows are bounded by seasons actually played.
No separate render benchmark was taken.

**No match rendering.** The full branch diff plus every new file (90KB)
was audited for match renderer, live pitch, match camera, moving player,
ball renderer, 2D/3D match, replay and player-dot terms: zero matches.

## Still open

- **Supplier / sponsorship contracts** — Phase 2, explicitly out of
  scope here.
- **Star-player / major-signing commercial effect** — P2, pending a real
  player popularity model (see above).
- **Named-player shirt sales** — blocked on the same missing model.
- **Retail capacity tiers / online vs. physical vs. matchday retail** —
  deferred with justification above, not merely unbuilt.
- **3D store integration.**
- **Live refresh from world-date changes** — the dashboard fetches on
  mount keyed on `clubId`, exactly like its sibling owner screens. That
  is an app-wide data-architecture question, not a Club Store one, and
  was not changed unilaterally.
- **Phone-width support** — the whole career shell clips below ~720px;
  PC-first remains the target.

## Provenance

All merchandise/retail figures remain `SIMULATION_ONLY`, consistent with
every other commercial figure this codebase already produces
(`ClubCommercialProfile.status`, `CommercialHistoryEvent`). No real-world
merchandise sales benchmarks were used or exposed as verified in-game
facts.
