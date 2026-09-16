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

**Badge shape/symbol and kit pattern are still deterministic-only** — only
the three colours are player-editable this pass. `club_kit_history` exists
as a table + repository methods (`snapshotSeasonIfAbsent`, `kitHistory`)
but nothing calls them yet: there is no season-start trigger and no
history UI.

## What did NOT ship

Following this task's own explicit fallback instruction — "if merchandise
becomes too large for one safe pass, ship portraits + badge + kit creator
first and report merchandise as the next phase" — these three passes
shipped a deterministic default identity for people and clubs plus a real,
persisted, owner-editable colour layer for clubs — but not the full
editable system (badge/kit design editors, Create-a-Club integration, kit
history) or merchandise.

Not attempted, honestly listed rather than half-built:

- **Manager/staff/owner/president profile integration** — the portrait
  renderer supports these roles; the profile screens haven't been wired.
- **List/card avatars** (squad list, staff list, shortlist, dressing-room
  concerns, inbox, press subject).
- **Badge shape/symbol editor and kit pattern editor** — only colours are
  editable; shape/symbol/pattern stay deterministically tied to the club id.
- **Create-a-Club visual-identity integration** — no `.tsx` create-club
  flow exists to attach a creator to yet (only a minimal
  `foundClub(name, locationName)` backend command).
- **Kit history activation** — the table and repository methods exist;
  nothing snapshots a season or shows history yet.
- **Player portrait wearing real club kit colours** — `PersonPortrait`'s
  player attire still uses a fixed default, not the club's real colours.
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
2. Design `ClubVisualIdentity` (colours) reusing/exporting the existing
   `clubScenePresentation.ts` hash pattern rather than a third
   reimplementation, then a badge model + SVG renderer.
3. Only after a real Create-a-Club UI exists (none does today), build the
   badge/kit creator into it.
4. Merchandise/retail last, once club colours and kits exist to hang
   demand and shirt-sales tracking off of.
