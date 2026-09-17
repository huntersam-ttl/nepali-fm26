# Football World Visual Identity — Phase 1 (partial)

## The goal

The game had too many names, numbers and dark rectangles and not enough
recognizable visual identity. This track's aim: players, managers, owners,
executives, and federation figures should read as visually distinct people,
not rows in a database — without building animated 3D humans or a rendered
match (that rule is permanent and unrelated to this work; see
`3D_PRESENTATION_AND_ANIMATION.md`).

## What shipped this pass: character portraits

### Deterministic identity (`apps/desktop/src/presentation/personVisualIdentity.ts`)

`buildPersonVisualIdentity(personId, age?)` is a pure function: the same
`personId` always produces the same `PersonVisualIdentity` (skin tone, hair
style/colour, facial hair, face shape, age band). There is no new database
column and no stored appearance record — the identity is fully
reconstructable from the person's own stable id, so it can never drift
across reloads, renders, or sessions. This mirrors the same "state → visual
descriptor" pattern `clubScenePresentation.ts` already uses for the 3D
layer (a stable FNV-1a-style hash of an id, `stableSeed`, reimplemented
locally here rather than importing across an unrelated module boundary).

**Fairness contract**: the function takes no nationality parameter at all.
Every simulation-generated person — regardless of nationality — draws from
the same shared, broad skin-tone and hair-colour palettes. This is a
deliberate type-level guarantee (enforced by a unit test asserting the
function's arity), not a convention that could quietly be violated later.

**Real people**: this project holds no licensed photographs of real
people. No code path here — or anywhere in this feature — claims to depict
a real individual's actual likeness; every portrait is explicitly a
stylised, generated representation.

### Age progression (Part C)

Real age (when the caller has it — some players are only loosely scouted,
where knowledge-gating leaves age unknown) bands into a conservative
five-stage presentation: `YOUTH < 18`, `YOUNG_ADULT < 24`, `PRIME < 32`,
`VETERAN < 40`, `OLDER 40+`. Each band carries a fixed `greyingAmount`
(0 → 0.85) that mixes the person's own stable hair colour toward grey —
the identity itself (seed, face shape, base hair style) never changes, so
the same generated person is still recognizably the same person decades
later, just visibly older. Unknown age reads as a neutral `PRIME` default
rather than a guess dressed up as fact.

### Renderer (`apps/desktop/src/presentation/PersonPortrait.tsx`)

One canonical SVG portrait component — `small`/`medium`/`large` — used
everywhere a portrait is needed, so no second portrait system gets built
by accident. Plain SVG/CSS: no WebGL, no Three.js, no per-frame animation
loop, consistent with this codebase's existing inline-SVG precedent
(`PlayerProfileScreen.tsx`'s own rating-ring and attribute-radar charts).
Attire colour is role-driven: player attire uses the club's real kit
colour when the caller supplies one (never fabricated — falls back to a
neutral default when no real club colour exists, since kit colours are not
yet modelled — see "Not shipped" below), managers/staff read the same club
accent, owners/executives read a fixed business-attire tone, and
federation presidents read a fixed institutional tone.

Accessibility: every portrait carries a real `role="img"` + `aria-label`.
The label is `"{name} portrait"` when a name is supplied, or a plain
`"Portrait"` when the caller passes no name (e.g. because the surrounding
heading already names the person) — never a redundant repeat of a name
already stated immediately above it.

### Profile integration (Part D)

Wired into `PlayerProfileScreen.tsx`'s `PlayerCard` header: the portrait
now renders inside the existing overall-rating ring, replacing the
previous text-initials silhouette. Manually verified against an isolated
dev server: two different players render two visibly different portraits;
a player whose age is unknown (knowledge-gated) falls back correctly to
the `PRIME` presentation rather than erroring; zero console errors.

Manager, staff, owner, and federation-president profile headers are
**not yet wired** — `PersonPortrait`/`buildPersonVisualIdentity` are ready
to use in each (the component takes a `role` prop for exactly this), but
integrating each surface was not attempted this pass.

### Performance

The renderer is plain SVG with a handful of static paths per portrait —
no WebGL context, no per-frame work, no measurable cost distinguishable
from any other inline SVG icon already in this codebase. No profiling
beyond that qualitative comparison was done this pass (a 50-portrait squad
list is not yet wired, so there is nothing to profile there yet).

## Phase 1B: club colours, badge, and kits (deterministic default)

`clubVisualIdentity.ts` adds the same deterministic-default treatment to
clubs: `buildClubColours(clubId)` (primary/secondary/accent, real hue
contrast — never three near-identical shades), `buildClubBadgeDesign(clubId,
clubName)` (a shape from 6 original outlines, a symbol from 6 generic
geometric marks, and real initials derived from the real club name), and
`buildClubVisualIdentity(clubId, clubName)` which also derives all three
kits (home = primary/secondary; away swaps and re-patterns them; third
leans on the accent colour with its own pattern — unit-tested to never
collapse into near-identical reskins). Every design is explicitly
`SIMULATION_ONLY`. As with portraits, there is no new database column: the
identity is fully reconstructable from the club's own real id and name, so
every club — including every legacy save — resolves a stable identity with
zero migration risk and zero chance of randomizing on reload.

`ClubBadge.tsx` (SVG, clip-path shapes, small/medium/large) and
`ClubKit.tsx` (SVG shirt/shorts/socks, a small pattern library, plus a
colour-independent `kitDescription()` string for accessibility) are the
two canonical renderers. Both are wired into the Club Profile header
(`RoleDetailScreen.tsx`'s `ClubProfileBody`): a badge beside the club name,
a home/away/third kit strip beneath it, and an explicit SIMULATION_ONLY
provenance line. Manually verified against an isolated dev server: the
badge and all three kits render with visibly distinct colours/patterns,
zero console errors.

## Phase 1C: real, persisted, owner-editable club colours

The deterministic default above is no longer the only source of truth.
`club_visual_identities` (migration 100, `packages/database`) stores a real
per-club colour override, read/written through `ClubVisualIdentityRepository`.
One resolver — `DesktopApplicationService.getClubVisualIdentity(clubId)` —
is the single place every surface asks "what does this club actually look
like": it returns the saved override (`isCustom: true`) when one exists, or
the same deterministic `SIMULATION_ONLY` fallback the client would compute
on its own (`isCustom: false`) when it doesn't, so no caller ever has to
special-case "not customised yet". `setClubColours(clubId, colours)` is
gated to the club's own real controlling `CHAIRMAN_OWNER` (checked against
their actual held role, not just "some owner exists") with real hex
validation before anything is written.

The deterministic fallback's colour algorithm is intentionally duplicated
server-side (`packages/simulation/src/club-visual-identity-colours.ts`)
rather than imported from the browser-only `apps/desktop` presentation
module, since a Vite/browser bundle and a better-sqlite3-based Node package
can't share code directly — the same independently-reimplemented-hash
pattern already used across this codebase's own scene builders. Both
copies must stay numerically identical; a shared pure-logic package would
be the cleaner long-term fix.

A real editor exists: **Club Identity**, a new Chairman/Owner workspace
screen (`RoleDetailScreen.tsx`'s `ClubIdentityEditor`, reachable from the
sidebar). Three native `<input type="color">` controls with real hex
values shown as text (never colour-only), a live preview built from the
same canonical `ClubBadge`/`ClubKit` renderers (editing a colour instantly
re-derives the badge and all three kits, since they're colour-derived from
the same palette), and a Save action. Club Profile now resolves the club's
real identity through `getClubVisualIdentity` instead of always showing
the generated default.

Verified live end-to-end against an isolated dev server: opened Club
Identity as Chairman/Owner, changed the primary colour, watched the badge
and home/away kit previews update immediately, saved, got "Club colours
saved.", zero console errors. Unit-tested (`club-visual-identity.test.ts`):
the fallback is stable across repeated calls; a saved colour persists
across a real `saveCareer()`/`loadCareer()` cycle; a Manager (not an
Owner) is rejected with `ROLE_NOT_AUTHORIZED` before colour validation
even runs.

## Phase 1D: editable badge shape/symbol/initials, and portrait club colours

The persisted identity is no longer colours-only. `club_visual_identities`'
`badge_design_json` column now stores a real `{shape, symbol, initials}`
override (`ClubVisualIdentityRepository.get()`/`upsertFull()`), and a new
command `setClubVisualIdentity(clubId, {colours..., badgeShape,
badgeSymbol, badgeInitials})` is the full-identity write — validated
against the real `BADGE_SHAPES`/`BADGE_SYMBOLS` enums and real hex syntax,
gated to the same `CHAIRMAN_OWNER`-of-this-club check as `setClubColours`
(kept for compatibility; both remain real, working commands).
`getClubVisualIdentity` now also resolves `badgeShape`/`badgeSymbol`/
`badgeInitials` when a real override exists, left `undefined` — never
fabricated — for a club that only ever saved a Phase 1C colour-only
override, or none at all.

The **Club Identity** editor gained real Shape and Symbol `<select>`
dropdowns and an Initials text field alongside the existing colour
pickers, plus a "Reset to default" action, all routed through
`setClubVisualIdentity`. Verified live: changed the badge shape from Round
to Diamond, watched the preview update immediately, saved, got "Club
identity saved.", zero console errors. Unit-tested
(`club-visual-identity.test.ts`, 6 tests): a full identity persists across
a real save/reload and resolves exactly; an invalid badge shape is
rejected before writing; a legacy Phase 1C colour-only row still resolves
correctly with badge fields `undefined` (no crash, no fabrication).

**Player portraits now wear the player's real club colour.** `PlayerCard`
resolves the player's club identity (`managerBridge.getClubVisualIdentity`)
and passes its real `primaryColour` into `PersonPortrait`'s existing
`clubPrimaryColour` prop — previously always a fixed generic default. An
unemployed player, or any resolution failure, still falls back to the
neutral default rather than fabricating a colour.

## Phase 1E: Create-a-Club identity, corrected premise

**A correction to every prior phase's documentation**: earlier passes
reported "no `.tsx` create-club flow exists — only a minimal
`foundClub(name, locationName)` backend command." That was wrong. A real,
player-facing Owner/Founder career-creation wizard already existed in
`apps/desktop/src/main.tsx` (the "New Career" flow's OWNER branch, driving
`bridge.createCareer({careerMode: "OWNER", founder: {...}, ...})` — the
same richer flow `packages/testing/src/founder-career.test.ts` exercises,
not the bare `foundClub` command). It just had never been extended with
visual identity. A more thorough re-audit this pass found it.

Step 3 of that wizard (Founder setup) now includes colour pickers, badge
shape/symbol selects, and an initials field, with a live `ClubBadge`
preview built from a temporary local design object (there is no club id
yet at this point in the wizard — the preview is real, but not yet the
persisted generator's output). The same preview repeats on the step 4
review screen. On submit, `createCareer` runs first, unchanged; only once
it succeeds and the new club id is known (`getChairmanDashboard`) is the
chosen identity persisted through the same canonical `setClubVisualIdentity`
command the Owner's Club Identity screen already uses. `createCareer` has
no identity fields of its own, so this cannot be one atomic transaction —
a failure here is logged rather than silently presented as full success,
though the club founding itself is never rolled back (by the time
identity-save runs, the club is already real).

Verified live end-to-end: founded "Nepal Community FC" with a custom
shield badge, star symbol, and navy primary colour chosen mid-wizard; the
Club Identity screen and kit strip immediately afterward showed exactly
those saved values (not the deterministic default). Zero console errors.

**Kit pattern/collar/sleeve are still deterministic-only** — independent
Home/Away/Third design editing does not exist in either the creation
wizard or the post-creation editor; only colours and badge design are
player-editable. `club_kit_history` exists as a table + repository methods
but nothing calls them yet: there is no season-start snapshot trigger and
no history UI. Portrait wiring beyond the player remains unbuilt.

## What did NOT ship

Following this task's own explicit fallback instruction — "if merchandise
becomes too large for one safe pass, ship portraits + badge + kit creator
first and report merchandise as the next phase" — these five passes
shipped a deterministic default identity for people and clubs, a real
persisted colour+badge editing layer (both in the post-creation editor
and now the creation wizard itself), and player-portrait club colours —
but not independent kit design editing, kit history, the rest of the
portrait wiring, or merchandise.

Not attempted, honestly listed rather than half-built:

- **Manager/staff/owner/president portrait integration** — the portrait
  renderer supports these roles; the profile screens haven't been wired.
- **List/card avatars** (squad list, staff list, shortlist, dressing-room
  concerns, inbox, press subject).
- **Independent Home/Away/Third kit design editing** (pattern, collar,
  sleeve, shorts/socks colour) — kits stay deterministically derived from
  the club's colours; badge shape/symbol/colours are editable (including
  at club-creation time now), kits are not.
- **Kit history activation** — the table and repository methods exist;
  nothing snapshots a season or shows history yet.
- **App-wide badge use** beyond the Club Profile header and the new
  identity editor's own preview (fixture cards, competition tables,
  transfer/signing presentation, etc.).
- **Real-club provenance beyond SIMULATION_ONLY** (VERIFIED/REPORTED/
  ESTIMATED tiers) — moot until real licensed branding data exists.
- **Merchandise/retail model, demand model, shirt sales, club store UI,
  3D store integration, star-signing demand bump.**
- **Browser E2E, visual-difference browser tests (beyond the unit-level
  distinctness tests), responsive matrix, and accessibility (axe) pass**
  for the club-identity surfaces.

## No-match-rendering compliance

This entire feature is DOM/SVG presentation and, for the deferred club/kit
work, would remain so. No animated match player, live pitch, ball
renderer, or match camera was introduced or is planned — matches remain
Quick Sim / Key Events / Text Live, per the permanent rule.

## Phase 1F — independent Home/Away/Third kit persistence

Item 2 of the prior phase's recommended next steps shipped this pass:
club kits are no longer colours-only derivatives — each of Home, Away,
and Third now has its own persisted base/secondary/trim/shorts/socks
colours and pattern, editable and saved independently. Saving one slot's
edits never touches another slot's saved (or still-deterministic) design,
verified both at the unit-test level (`packages/testing/src/club-visual-identity.test.ts`)
and live in the browser (see below).

**Shipped:**
- `ClubKitDesignOverride` (shared-types) / migration-100's existing
  `home_kit_json`/`away_kit_json`/`third_kit_json` columns are now
  actually written to, via `ClubVisualIdentityRepository.upsertFull`'s
  read-existing-then-merge-only-supplied-slots pattern.
- `setClubVisualIdentity` accepts optional `homeKit`/`awayKit`/`thirdKit`,
  validates each slot's colours (hex) and pattern (enum) independently,
  and the response always reflects the full merged state (not just what
  was passed in that call).
- `resolveClubVisualIdentity` (`apps/desktop/src/presentation/clubVisualIdentity.ts`) —
  the single canonical resolver every UI surface now calls instead of
  manually merging partial override state.
- `ClubKitEditor` (`apps/desktop/src/presentation/ClubKitEditor.tsx`) — one
  reusable component, Home/Away/Third tabs, wired into the Club Identity
  screen's `ClubIdentityEditor`.
- Collar, sleeve style, and shirt-number colour remain **not** exposed as
  editable fields, on purpose: the `ClubKit` SVG renderer doesn't visually
  differentiate them yet, and this task's own instruction was "fix the
  renderer before exposing a choice — no fake dropdowns that render
  identically regardless of selection."

**Live-verified** on an isolated dev server (fresh `/tmp` save dir,
`NEPAL_E2E_ROLE_FIXTURE=1`, port 1430): founded a Manager-mode Church
Boys United career, seeded the fixture, switched to Chairman/Owner,
opened Club Identity, switched the kit tab to Away, changed its pattern
to Halves and base colour to magenta — the Away preview (both the tab's
own preview and the top-of-page kit strip) updated live while Home's gold
Sash kit stayed untouched. Saved ("Club identity saved."), reloaded the
whole app from the main menu, continued the save, re-opened Club Identity:
Home was still the original deterministic gold Sash, Away was still the
saved magenta Halves, Third was still deterministic — confirming the
independent-slot persistence survives a real save/reload cycle. Zero
console errors throughout.

**A responsive-layout bug found during this verification (not fixed this
pass):** the Chairman/Owner sidebar nav (`apps/desktop/src/manager/ManagerCareer.tsx`,
`CHAIRMAN_NAV`) switches to a 3-column CSS grid below the 1080px
`max-width` breakpoint (`apps/desktop/src/styles.css:679`). At narrow
widths the third column's content — including the entire "Club" group and
its "Club Identity" link — is pushed outside the 248px-wide sidebar and
becomes unreachable by click, though it's still present in the DOM (found
via `find`, invisible in a screenshot). This reproduced in the Browser
pane's default ~721px-wide viewport; widening to 1440px made the nav
render correctly (2-column layout, "Club Identity" visible and clickable).
This is a real, unaddressed responsiveness defect in the Chairman/Owner
workspace nav, not specific to the kit editor — it would affect any
Chairman/Owner screen in the "Club" or "External relations" groups at
narrow widths. Flagged here rather than fixed, since fixing the nav's
breakpoint/column logic is outside this phase's kit-persistence scope.

**Not attempted this pass** (kept from the prior phase's gap list, still
open): Create-a-Club kit integration (the wizard has colours+badge but not
kits), kit history activation/UI, kit distinctness warnings, non-player
portrait wiring, list avatars, app-wide badge use beyond Club Profile,
and any automated Playwright/axe/responsive/performance verification —
every check in this phase, as in every prior one, was manual via the
Browser pane, not scripted.

## Phase 1G — fixed the Owner navigation P1

The narrow-width nav-clipping bug found while verifying Phase 1F is fixed.
Root cause: `apps/desktop/src/styles.css`'s `@media (max-width: 1080px)`
block switched `nav` to a 3-column CSS grid, on the assumption that
`.manager-shell` would also stack to a single full-width column at that
breakpoint (an adjacent rule in the same block does set
`grid-template-columns: 1fr` on `.manager-shell`). But a later,
unconditional `.manager-shell { grid-template-columns: 248px minmax(0, 1fr); }`
rule — added by a subsequent dark-theme pass, with no media guard — always
wins the cascade at equal specificity because it comes later in the file,
regardless of viewport width. So the sidebar never actually got wider than
248px, and the 3-column nav grid inside that fixed 248px column pushed
later groups (`Club`, `External relations`) off the visible edge: present
in the DOM (`find` could still locate `Club Identity`), invisible and
unclickable in a screenshot.

Fix: removed the `nav { grid-template-columns: repeat(3, 1fr); }` override
rather than resurrecting the never-actually-active full-width stacked
shell (touching that would risk unverified layout changes to every other
narrow-width screen, well outside this fix's scope). `nav`'s own
un-media-queried base rule (`display: grid; gap: 6px;`, no explicit
columns) already lays nav-group children out in a single implicit column
— i.e. vertically stacked — which is exactly what a permanently
248px-wide sidebar needs at any viewport width.

**Verified live**, Chairman/Owner role, at 721 / 900 / 1024 / 1080 / 1280 /
1600px: at every width, all nav groups — `Owner office`, `Ownership`,
`Staff`, `Development`, `Commercial`, `Club` (`Club Identity`), `External
relations` (`Bank`) — stayed visible and clickable, `Club Identity`
opened correctly, no horizontal overflow (`document.documentElement.scrollWidth`
never exceeded `clientWidth`), zero console errors. Re-checked Manager-role
nav (same CSS, different data) at 721px for regression — unaffected,
still correct. `apps/desktop` presentation+manager vitest suite: 268/268
unchanged. Root typecheck: unchanged at the 17-error baseline.

**Not attempted this pass:** an automated regression test asserting this
at each breakpoint (Playwright or a jsdom/CSS-matching unit test) — the
verification above was manual via the Browser pane only, same as every
prior phase's checks. A future pass should add one so this can't silently
regress again.

## Phase 1H — automated the nav regression

`apps/desktop/e2e/nav-responsive.spec.ts` now covers the Phase 1G fix.
Building it surfaced that the bug was purely *visual* clipping, not DOM
invisibility: the affected button kept a real, non-zero bounding box, so
a plain Playwright `toBeVisible()` assertion (checked first) passed even
with the 3-column override deliberately reintroduced. The test only
actually catches the regression once it asserts the button's bounding
box falls entirely inside the sidebar element's own box
(`assertWithinSidebar`) — confirmed by temporarily reverting the CSS fix
and watching this test fail (`right edge (376.3) within sidebar right
edge (248)`), then restoring the fix and confirming it passes again.

Covers Chairman/Owner nav (`Club Identity`, `Bank`) at 721 / 900 / 1024 /
1080 / 1280 / 1440 / 1600px, plus a Manager-role smoke check (`Media`) at
721 / 900 / 1080px to confirm the same CSS change didn't regress that
role's nav. Runs against its own isolated dev-server instance
(`NEPAL_NAV_E2E_BASE_URL` env var, set only for this file), with
`NEPAL_E2E_ROLE_FIXTURE=1` and a disposable save directory, rather than
depending on the shared ambient dev server other specs' `reuseExistingServer`
config may already be pointed at (which is not guaranteed to have that
fixture flag set).

**Not attempted this pass:** everything else this task's four-item order
asked for — Create-a-Club Home/Away/Third kit customization, kit-history
activation/UI, and non-player (manager/staff/owner/president) portrait
wiring are all still open, exactly as listed in "What did NOT ship"
above.

## Phase 1I — Create-a-Club kits

The real Owner/Founder wizard (`apps/desktop/src/main.tsx`) now includes
Home/Away/Third kit editing, reusing the existing `ClubKitEditor` — no
second kit-editing UI was built. `founderHomeKit`/`founderAwayKit`/
`founderThirdKit` start `null` (not yet edited); while `null`, a slot is
derived live from the deterministic fallback identity using the wizard's
current colours (`buildClubVisualIdentity`, seeded from the club name
since no real club id exists until after creation), so changing colours
before touching a kit correctly refreshes its default. The moment a slot
is edited in `ClubKitEditor`, its fields are captured in that slot's own
state and stop re-deriving — a later colour change can no longer discard
a kit the player already designed.

**Live-verified:** edited Away's pattern (Halves→Sash) and base colour
(magenta), then changed the club's primary colour — Home re-derived to
the new colour exactly, Away kept the manual edit exactly. The review
step (step 4) shows all three `ClubKit` SVG previews plus
`kitDescription()`'s colour-independent text ("Home kit — a centre
stripe, shirt with shorts and socks in the club's real colours."). After
creating the club, `Club Identity` showed exactly the reviewed
badge/colours/kits — teal Home, magenta Away, green Third — immediately,
and again after a full save/reload cycle. Zero console errors throughout.

**Failure handling:** `createCareer` and `setClubVisualIdentity` remain
two non-atomic writes (unchanged limitation from Phase 1E). A failed
identity write no longer only `console.error`s: the created career is
held (`pendingCareer`/`pendingClubId` state) and a visible banner offers
"Retry saving identity" or "Continue without saving branding" instead of
silently dropping the player into an un-branded career with no visible
error. **Not live-verified** — forcing the identity write to fail
deterministically wasn't attempted this pass; the code mirrors the
already-verified success path and typechecks cleanly, but this specific
branch has only been read-reviewed, not exercised.

**A pre-existing, unrelated bug found while verifying this:**
`apps/desktop/e2e/support/owner-harness.ts`'s `openOwnerRoute()` asserts
a heading "Ownership and investors" for the Investors route, but the
real screen renders heading "Investors" (the heading text drifted from
the assertion at some point, unrelated to this phase). Confirmed
reproducing at the pre-Phase-1I baseline (`e223d32`), so not something
this phase introduced. Left unfixed (out of scope) and flagged as a
separate task rather than patched inline, per "preserve unrelated peer
work." One genuinely related flake *was* fixed: `createFounderOwner`'s
Dashboard wait used the default 15s timeout, which world generation
plus the (now slightly heavier) identity write could exceed — extended
to 120s to match its sibling wait in `createExistingClubOwner`.

**Not attempted this pass:** kit-distinctness warnings (Create-a-Club or
Owner Club Identity), kit-history activation/UI, and non-player portrait
wiring — all still open.

## Phase 1J — activated kit history

Investigated the "canonical season lifecycle" this task's own Phase 1
asked to find before wiring anything, and the honest finding is: **there
isn't one that runs during live play.** The only season-transition code
in this codebase, `createNextSeasons` (`packages/simulation/src/career-world.ts`),
runs exclusively inside the offline `career-world`/`career-cli.ts`
generator that pre-builds the starting world's history before any player
save even exists — nothing in `desktop-application.ts` or any live
command ever calls it. Attaching a kit-history snapshot there would only
ever record pre-game history, never anything a player experiences.

Given that, this activates history via this task's own documented
fallback: **the season's first real identity read during play**
(`getClubVisualIdentity`). `snapshotSeasonIfAbsent` was already
`INSERT OR IGNORE` unique on `club_id + season_key` since Phase 1C
(built, never called) — safe to call on every read, since only the
season's first call ever inserts anything. Added
`deterministicClubKits` to `club-visual-identity-colours.ts` (a
server-side port of the client's private `kitDesignFor`, same seed/salts)
so a club with no custom kit saved still gets its real structured
fallback design recorded, not a placeholder. `seasonKey` reuses this
codebase's existing plain-4-digit-year convention
(`date.slice(0, 4)`, already used in `federation-governance.ts`,
`ai-club-strategy.ts`, `club-economy.ts`) rather than inventing a
slash-year format nowhere else in the codebase uses.

New read command `getClubKitHistory` returns a club's history
oldest-first. New "Kit history" section on Club Profile (below the
current identity strip) shows each season's three `ClubKit` previews
with `kitDescription()`'s colour-independent text — reusing the existing
renderer, not a new visual system — and is simply omitted for a club
with no history yet rather than showing an empty panel.

**Verified:** a new unit test
(`packages/testing/src/club-visual-identity.test.ts`) confirms
activation on first read, no duplicate row on repeated reads within a
season, and — critically — that editing the club's *current* kit
afterward does not mutate the already-recorded season snapshot, across
a real save/reload. Live-verified in the browser (Chairman/Owner →
Competition → a club link → Club Profile): "Kit history" rendered
season "2026" with all three real previews and matching text, zero
console errors.

**Not verified:** whether two genuinely different seasons stay
independent of each other (the fuller multi-season immutability
requirement). There is no way to advance a save's world date across a
season boundary through the public API to exercise this in a test,
precisely because — per the finding above — season rollover isn't a
live player-facing mechanic in this codebase today. The underlying
guarantee (`UNIQUE(club_id, season_key)` + `INSERT OR IGNORE`) is
structural and pre-existing, not newly built this phase, but remains
unexercised by any multi-season test.

**Not attempted this pass:** non-player portrait wiring (manager/staff/
owner/president/executive), the Create-a-Club identity-failure path's
live/E2E verification, automated Create-a-Club kit E2E, kit-distinctness
warnings, and list avatars — all still open.

## Phase 1K — Manager/Owner/President portraits, and role continuity

Wired `PersonPortrait` into the single shared topbar
(`apps/desktop/src/manager/ManagerCareer.tsx`'s `<header className="topbar">`)
that already renders identically for all three roles, rather than
patching three separate dashboards — the highest-value single
integration point available, per this task's own "prefer one
canonical destination" instruction.

`CareerHeader` (`packages/shared-types/src/desktop-contract.ts`) gained
optional `personId`/`personAge`, populated in both of
`desktop-application.ts`'s header builders
(`careerHeaderFromContext`/`unemployedCareerHeader`) from the same real
person record that already backs `characterName`; age reuses the
existing `ageOn(dateOfBirth, worldDate)` pattern (e.g. `squadReadModel`),
not a new one.

**The continuity guarantee is structural, not incidental:**
`buildPersonVisualIdentity(personId, age)` never takes `role` as an
input — only a new `portraitRoleFor` mapping decides attire (Manager /
Owner / President / Executive), never the face. So the same career
person renders the identical face across every role switch, by
construction. Verified two ways: a new integration test
(`packages/testing/src/career-header-portrait-continuity.test.ts`)
asserts `personId`/`personAge` survive Manager → Chairman/Owner →
Federation President → Manager unchanged (via the real
`switchActiveCareerRole` command); and live in the browser, the same
portrait rendered next to "Maya" across all three roles with zero
console errors.

**Also re-ran, unchanged and still green:** the kit-history unit suite
(9/9) and the nav-responsive Playwright regression (2/2) — this
phase's own instruction not to reopen either without a real defect,
and none was found.

**Not attempted this pass:** Staff/NPC-executive portrait wiring
(coach/scout/physio/CEO/etc.), list avatars (squad/dressing-room/staff/
transfer), player-portrait secondary club colour, automated Playwright
portrait coverage, the Create-a-Club identity-failure path's live/E2E
verification, and kit-distinctness warnings — all still open.

## Recommended next phase

1. ~~Wire `PersonPortrait` into manager/staff/owner/president profile
   headers~~ — Manager/Owner/President done in Phase 1K via the shared
   topbar; staff and NPC executives still need their own integration
   point (no single shared "staff card" component was confirmed to
   exist — investigate before wiring).
2. ~~Extend `ClubKitDesign` persistence to independent pattern/collar/sleeve
   editing~~ — kit colours + pattern now persist independently per slot
   (Phase 1F); collar/sleeve/number-colour still need renderer support
   before they can be exposed.
3. ~~Activate `club_kit_history`~~ — activated in Phase 1J via
   snapshot-on-first-identity-read-of-season (see above; there is no live
   season-rollover event to hook it to instead). A multi-season browser/
   integration proof is still owed once/if a live season-transition
   mechanic exists to test it against.
4. ~~Fix the Chairman/Owner sidebar nav's sub-1080px 3-column layout~~ —
   fixed in Phase 1G; automated in Phase 1H.
5. ~~Extend the Create-a-Club wizard with the same `ClubKitEditor`~~ —
   done in Phase 1I.
6. ~~Add squad-list avatars~~ — done in Phase 1L, alongside Dressing Room.
7. Live/E2E-verify the Create-a-Club identity-failure banner (Retry /
   Continue without saving) — currently only code-reviewed.
8. Merchandise/retail last, once club colours and kits exist to hang
   demand and shirt-sales tracking off of.

## Phase 1L — squad/dressing-room avatars, player secondary colour

Two additive `PersonPortrait` props, not a second avatar component:
`clubSecondaryColour` (a small collar/trim `<path>`, PLAYER attire only,
only when supplied — never the full `ClubKit` renderer) and `decorative`
(sets `aria-hidden` and drops `role="img"`/`aria-label` entirely, for a
list row whose adjacent text already names the person, instead of a
screen reader announcing the same name twice).

Wired `clubSecondaryColour` into `PlayerProfileScreen`'s large portrait,
which already resolves the player's real club identity once per profile
— no new fetch. Wired `decorative` small portraits into the Squad
screen's main table (built from `player.personId`/`player.age.value`,
already on each row — zero new bridge calls per player) and into
Dressing Room's one shared player-reference component (`Link`, used by
concerns, demands, promises, and hierarchy lists alike), so a single
change covers every one of those lists rather than patching each
separately. Neither list surface has a club id in scope without a new
per-screen fetch, so list avatars use the role's neutral default attire;
only the profile-page portrait currently shows real club colours.

New `apps/desktop/src/presentation/PersonPortrait.test.tsx` (4 tests):
named vs. fallback accessible labelling, `decorative` → `aria-hidden`
with no `role`/`aria-label`, and the secondary-colour trim rendering
only for `PLAYER` attire and only when a colour is actually supplied.

**Live-verified:** Squad list — visually distinct small avatars per row,
names still primary, row clicks still open the right profile. Dressing
Room — hierarchy/relationship lists show avatars with no redundant
announcement (a link's accessible name stayed exactly "Arik Bista", not
"Arik Bista portrait, Arik Bista"). Player Profile — the real club
secondary colour now renders as a collar detail on the large portrait.
Zero console errors throughout. Re-confirmed still green: kit-history
unit suite (9/9) and nav-responsive Playwright regression (2/2). Full
`apps/desktop` suite: 272/272 (268 prior + 4 new).

**Not attempted this pass:** staff-list portraits (no shared staff
card/row component was confirmed to exist — needs its own inventory
before wiring), executive portraits, transfer/scouting avatars, and any
automated Playwright coverage for these new avatars specifically.

## Phase 1M — staff and NPC-executive portraits

Inventory found the shared surface: `StaffScreen.tsx`'s one canonical
staff table (`market.staff`, each row a real `StaffRowWithContract`
with `personId`). Wired a decorative small `PersonPortrait` into its
name column — one integration point covering assistant manager,
coaches, scouts, physios, and every `DIRECTOR`-category NPC executive
(Sporting Director, Director of Football, CEO, General Secretary,
Technical Director) at once, same pattern as Phase 1L's Squad/Dressing
Room wiring. `staffPortraitRole(member)` maps `category === "DIRECTOR"`
to the `EXECUTIVE` portrait role and everything else to `STAFF` — attire
only; the face is always `personId`-derived, and nothing here touches
career-role authorization, the role picker, or contract semantics
(re-confirmed by re-running `role-boundary.spec.ts`, unaffected). No
age travels with `StaffRow`, so these portraits fall back to a neutral
age band, same limitation already accepted for Dressing Room's `Link`.
No new bridge calls — built entirely from `member.personId` already on
each row.

New `StaffScreen.a11y.test.tsx` (2 tests): both portrait-role branches
render with real fixtures, each portrait is `aria-hidden` with no
`role`/`aria-label` (no redundant "Name portrait, Name" announcement),
and zero serious/critical axe violations. **A pre-existing, unrelated
axe violation was found and explicitly disabled rather than silently
fixed:** the screen's own metrics header ("Staff count/Open
vacancies/...") uses bare `<dt>`/`<dd>` pairs with no wrapping `<dl>` —
confirmed pre-existing, unrelated to the portrait work this test
actually covers, and flagged as a separate task rather than patched
inline, per "preserve unrelated work."

**Re-ran and confirmed still green:** `role-boundary.spec.ts` (2/2 —
executive roles remain unreachable via the role picker; stale saves
reconcile without ever rendering an executive dashboard),
`nav-responsive.spec.ts` (2/2), and the kit-history unit suite (9/9).
Full `apps/desktop` suite: 274/274 (272 prior + 2 new).

**Live-verified:** the wired Staff screen renders with zero console
errors. Could not visually confirm *populated* staff rows specifically
— a freshly created career has no hired staff yet, and the screen
correctly showed its real "No staff records exist for this club." empty
state (a manual hire attempt in the browser didn't succeed within this
pass's time budget). Row rendering itself is proven instead by the new
unit test's real `StaffRowWithContract` fixtures, which exercise both
portrait-role branches exactly as production data would.

**Not attempted this pass:** transfer/scouting avatars, automated
Playwright portrait coverage (Player A/B, role continuity, Squad,
Dressing Room, or Staff), a dedicated 20/50-portrait performance
harness, Create-a-Club failure-path verification, and kit-distinctness
warnings — all still open.

## Phase 1N — automated portrait determinism and role continuity

Every phase from 1K onward re-verified the same two claims by hand in
the browser (a player's portrait is deterministic/distinct; the same
career person keeps the same face across role switches). This
automates both, so future phases don't need to keep manually
re-checking them.

`PersonPortrait` gained a `data-face-signature` attribute —
`identity.seed`, already a hash of `personId` computed inside
`buildPersonVisualIdentity`, never the raw id itself, so nothing
sensitive reaches the DOM. Comparing this instead of screenshots means
legitimate attire/context differences across roles (tracksuit vs.
business attire vs. institutional tone) can never produce a false
failure the way a full pixel diff would.

New `apps/desktop/e2e/portrait-continuity.spec.ts` (2 tests): Player
A/B — two Squad rows resolve to two different Player Profile faces; a
player's own Squad-row signature exactly matches their Profile-page
signature; the same player's face survives a real save/reload
unchanged. Role continuity — one human career person's topbar portrait
signature stays identical across Owner → President → Manager → Owner.

**Verified these aren't tautological**, the same way the Phase 1G nav
fix's regression test was: temporarily seeded the topbar portrait from
`${personId}:${activeRole}` instead of `personId` alone, re-ran, watched
the continuity test fail exactly as expected
("President → Manager must keep the same face", two different
signatures), reverted, confirmed both tests green again (twice).

Re-ran and confirmed still green: `role-boundary.spec.ts` (2/2),
`nav-responsive.spec.ts` (2/2), kit-history unit suite (9/9). New
`PersonPortrait.test.tsx` case covers the signature contract at the
unit level too (same person/different role → same signature; different
person → different signature; never the raw id).

**Not attempted this pass:** Squad/Dressing Room/Staff-surface-specific
Playwright coverage (multiple avatars rendering, no overflow, etc.),
20/50-portrait performance harness, explicit N+1 bridge-call
instrumentation, recruitment avatars, Create-a-Club failure-path E2E,
and kit distinctness.

## Phase 1O — Squad and Dressing Room avatar E2E

Extended `portrait-continuity.spec.ts` (reusing its `faceSignature()`
helper and isolated-server harness, not a second E2E identity system)
with two more tests:

- **Squad**: more than 5 avatars render; the first portrait is
  `aria-hidden` with no `tabindex` (decorative, not a separate
  keyboard target); two adjacent rows' face signatures differ; the
  table causes no page-level horizontal overflow; zero serious/critical
  axe violations (same axe-core injection pattern already used by
  `role-boundary.spec.ts`); and a row's own face signature exactly
  matches that same player's Player Profile signature once opened —
  proving the list avatar and the profile portrait are the same
  rendering path, not two independently-seeded faces.
- **Dressing Room**: the shared player-reference link's portrait is
  `aria-hidden` with no `tabindex`; the link's accessible name is
  exactly the player's name (no "Name portrait, Name" doubling); no
  horizontal overflow; zero serious/critical axe violations; and the
  row's face signature matches that player's Profile signature after
  clicking through.

All 4 tests in the file pass together (1.7 min). Re-ran and confirmed
still green: `nav-responsive.spec.ts` (2/2), `role-boundary.spec.ts`
(2/2), kit-history unit suite (9/9).

**Deliberately skipped this pass:** a Staff-surface avatar test. A
separate session is working on `StaffScreen`'s pre-existing, unrelated
`dlitem` a11y bug (see Phase 1M), and no commit for it had landed in
this branch's history as of this phase — adding an axe assertion
against that screen risked either colliding with that work or
reporting a false failure on an issue already flagged and owned
elsewhere. Revisit once that fix lands (or is confirmed abandoned).

**Not attempted this pass:** Staff/executive avatar E2E (see above),
20/50-portrait performance harness, explicit N+1 bridge-call
instrumentation, recruitment avatars, Create-a-Club failure-path E2E,
and kit distinctness.

## Phase 1P — explicit N+1 proof and list-scale performance

Checked at startup: the peer session's `StaffScreen` `dlitem` fix had
still not landed, so `StaffScreen.tsx`'s markup was left untouched
again this phase — but a new unit test (below) does render the
existing component, since that doesn't edit its markup at all.

**N+1 proof** (`apps/desktop/src/manager/screens/portraitDataAccess.test.tsx`,
3 tests): mocks `managerBridge` for Squad, Dressing Room, and Staff
with a `Proxy` exposing *only* the one page-level method(s) each
screen legitimately calls — any other property access throws
immediately. Renders 20 rows per screen and asserts the mocked
method(s) were each called exactly once. This is a real regression
guard, not an architectural claim: if a future change added a per-row
identity/person lookup, the render would crash rather than this test
silently continuing to pass.

**Performance proof** (`apps/desktop/src/presentation/PersonPortrait.performance.test.tsx`,
2 tests): renders 20 and 50 distinct `PersonPortrait`s and asserts all
signatures are genuinely distinct, zero `<canvas>` elements exist, and
50-portrait render time doesn't blow up disproportionately relative to
20 (median-of-3 timing; measured ~11–17ms at 20 and ~29–51ms at 50
across runs — roughly linear, well under the deliberately generous 6x
ceiling used to absorb jsdom/CI noise without asserting a fragile
absolute millisecond threshold).

Re-ran and confirmed still green: the full `portrait-continuity.spec.ts`
(4/4), `nav-responsive.spec.ts` (2/2), `role-boundary.spec.ts` (2/2),
and the kit-history unit suite (9/9). Full `apps/desktop` suite:
280/280 (275 prior + 5 new).

**Not attempted this pass:** Staff/executive avatar E2E (still
peer-blocked), the full 1024/1280/1440/1600 responsive matrix,
Create-a-Club failure-path E2E, kit distinctness, and recruitment
avatars.
