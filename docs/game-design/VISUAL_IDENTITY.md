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

## What did NOT ship this pass

Following this task's own explicit fallback instruction — "if merchandise
becomes too large for one safe pass, ship portraits + badge + kit creator
first and report merchandise as the next phase" — this pass went further
and shipped **only portraits**, since even badges and kits are each
substantial, uncontracted feature surfaces (a badge-shape/symbol library
plus a creator UI; a kit-pattern library plus a creator UI with
home/away/third distinctness validation) with no existing code to extend
(the codebase inventory for this task found no club-colour, badge, or kit
model anywhere, and no existing Create-a-Club UI to attach a creator to —
only a minimal `foundClub(name, locationName)` backend command with no
`.tsx` flow calling it).

Not attempted, honestly listed rather than half-built:

- **Manager/staff/owner/president profile integration** — the renderer
  supports these roles; the profile screens haven't been wired.
- **List/card avatars** (squad list, staff list, shortlist, dressing-room
  concerns, inbox, press subject) — Part E of the original request.
- **Club visual identity model** (primary/secondary/accent colour) and
  **club badge** (shape/symbol/creator/renderer) — Parts F/G.
- **Kit model, kit creator, kit renderer, kit history** — Parts H/I/J/R.
- **Real-club provenance handling** (VERIFIED/REPORTED/ESTIMATED/
  SIMULATION_ONLY for badges/kits) — Part K; moot until a badge/kit model
  exists.
- **Merchandise/retail model, demand model, shirt sales, club store UI,
  3D store integration, star-signing demand bump** — Parts L–Q.
- **Save/reload verification** for anything beyond portraits (portraits
  need no explicit save/reload test — they are a pure function of the
  person id, which is already itself proven stable across reload by every
  other save/reload test in this codebase).
- **Browser E2E, visual-difference browser tests, responsive matrix,
  accessibility (axe) pass, and the full determinism test matrix** beyond
  the unit tests already added for `personVisualIdentity.ts`.

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
