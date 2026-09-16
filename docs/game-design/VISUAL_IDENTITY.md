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

## Recommended next phase

1. Wire `PersonPortrait` into manager/staff/owner/president profile headers
   and the squad/staff list rows (cheap, same renderer, no new model work).
2. Extend `ClubKitDesign` persistence to independent pattern/collar/sleeve
   editing (currently colours + badge only), and build one shared
   `ClubKitEditor` with Home/Away/Third tabs, reusing `ClubKit` for preview.
3. Activate `club_kit_history`: snapshot on season rollover (or first
   identity resolution of a new season, whichever proves architecturally
   safer), and add a compact history section to Club Profile.
4. Merchandise/retail last, once club colours and kits exist to hang
   demand and shirt-sales tracking off of.
