# 3D Presentation & Animation System

A permanent, cross-cutting roadmap track. This is not a sprint that finishes —
every major non-match feature from here on adopts this layer incrementally.

## The one hard rule

**No match rendering, in 2D or 3D. Ever.**

Football matches stay exactly as they are:

- Quick Sim
- Key Events
- Text Live

all driven by the existing canonical match engine. This layer never draws
players on a pitch, never animates play, and never replaces or re-skins the
match engine's output. Everything below concerns the rest of the game.

## What the layer is for

The game should feel like a living football world rather than React forms over
a database: clubs occupy real places, stadiums and training grounds exist,
investment visibly changes the world, and career milestones feel like moments.

## The principle that keeps it honest

> Every scene must answer: **what game state is this visualizing?**

A scene is a *view of canonical state*, never decoration. If a scene shows a
large modern campus, the club's recorded facility quality, capacity and
reputation must actually justify it. A semi-pro club with no facility data
renders as a small ground on open land, because that is what the data says.

Concretely, in the shipped Club Environment:

| Scene element | Real state it reads |
| --- | --- |
| Stadium size/finish band | `ClubStadiumSummary.capacity`, `floodlights`, `coveredStands` |
| Number of stands | recorded capacity (~1 per 8,000 seats, max 4) |
| Building footprint/height | `ClubFacilitySnapshot.*Quality` (0–20) |
| Practice pitch count | training/youth facility band |
| Scaffolding + crane | a real `CONSTRUCTION` infrastructure project on that block |
| Plot marker | a real planned/approved/financing project |
| Site build-up, light warmth | `ClubReputationSummary.footballReputation` |
| Layout jitter, accent hue | stable hash of the club id (deterministic) |
| Terrain silhouette | `ClubProfile.locationLabel` classified against real Nepal districts |
| Stand arrangement (typology) | real stand count + stadium tier + the club's stable seed |
| Floodlight provision | recorded `floodlights` flag + stadium tier (NONE/BASIC/PROFESSIONAL/ELITE) |
| Stadium construction | a real `CONSTRUCTION`/planned project on the stadium block itself |

A big but unlit, uncovered ground is deliberately **not** allowed to present as
an elite modern arena, however large its capacity.

### Stadium typology and materials

Tier (quality/scale) and **typology** (physical arrangement) are deliberately
separate — `stadiumTypologyFor(standCount, tier, seed)` in
`clubScenePresentation.ts` — so two clubs at the same tier are not pixel-
identical: `OPEN_GROUND` / `SINGLE_MAIN_STAND` (1 stand), `MAIN_AND_TERRACE`
(opposite long sides) / `MAIN_AND_END` (main + one end, chosen by seed
parity) for 2 stands, `THREE_SIDED` for 3, and `FOUR_STAND_BOWL` /
`ENCLOSED_BOWL` (elite/large-capacity only, with corner infill panels
closing the bowl) for 4. `clubSceneBuilder.ts`'s `STAND_SELECTION` map picks
*which* of the four fixed stand placements a typology actually builds on.

Stands carry a stepped seating rake, support columns under the deck, and
roof struts, rather than flat box faces. A small material library
(`buildMaterialLibrary`) gives concrete, painted concrete, steel, dark
steel, roof metal, glass, asphalt, seating and fence distinct roughness/
metalness/colour so steel no longer reads like concrete and a roof no
longer reads like a seating deck. Two club-accent flags mark the stadium
corners (flutter-animated on Full motion only) — identity, not a crest
claim. The pitch itself carries a subtle mowing-stripe pattern and static
goal frames — environment furniture, never match state (see the permanent
match-rendering boundary below).

Floodlights are a real provision band now (`FloodlightTier`), not a binary
flag: pole height and lamp size scale from `NONE` through `BASIC` /
`PROFESSIONAL` / `ELITE`, tied to the stadium tier.

The stadium block previously had **no** construction visualization at all —
only the campus facility buildings did. It now shows the same honesty rule:
a real `CONSTRUCTION` project on the stadium shows temporary perimeter
fencing; a merely planned one shows a ring marker; neither appears once the
project record is gone.

### Training, academy, HQ and medical composition

The four facility buildings (training, academy, medical, offices) used to
share one generic shape — a box, an accent band, and an optional practice
pitch — differing only in scale. Each kind now *composes* differently from
real facility-quality state, in `clubSceneBuilder.ts`'s facility-building
loop:

- **Training** grows a practice pitch fastest (1/2/2/3/4 pitches across
  Basic→Elite), with a portable training goal per pitch (smaller than the
  stadium's real goal, so it never reads as a match venue) and pitch-side
  floodlight poles from Modest up. A gym/performance annex appears from
  Professional up; an indoor-hall silhouette only at Elite.
- **Academy** grows more modestly (1/1/2/2/3 pitches) — a real youth
  programme needs fewer full pitches than the first team — with the same
  annex/hall progression, so the same tier still reads as visibly different
  training vs. academy geometry, never a duplicate with a different label.
- **Offices** (the Admin/HQ camera target) gain an entrance canopy from
  Professional up and a small forecourt plaza at Elite — an institutional
  arrival ladder, not the same office block scaled.
- **Medical** gains a recovery annex only once genuinely Advanced/Elite;
  below that it stays a single clean block, since fabricating a distinct
  "developing" medical shape the facility-quality data doesn't support
  would be decoration, not state.

A per-kind material language accompanies this: offices move from painted
concrete through steel to glass as the tier rises; academy stays lighter/
institutional (painted concrete throughout); medical stays a clean render
block, glass only at Elite; training stays utilitarian concrete/steel
throughout — steel and concrete are never interchangeable palette choices.

Site development also now differs by tier: a plain perimeter fence at low
tiers, a paved forecourt path from Professional up. A club-accent flag
marks any developed building's entrance from Professional up (the stadium
already had this; it now extends across the campus) — flutter-animated on
Full motion only, static otherwise, gated off entirely at Low quality.

### Geographic identity

`siteGeographyForLocation` classifies the club's real recorded district into
`KATHMANDU_VALLEY`, `TERAI`, `HILL`, or `UNKNOWN` — a real classification of
well-known Nepali geography (which districts sit in the Kathmandu valley or
the Terai plains), never a fabricated location. `HILL` is the default for any
other recorded district, which is geographically correct for most of the
country.

Geography composes the actual site now, not only a distant backdrop:

| | Terrain | Density/boundary | Access road | Vegetation | Fog depth |
| --- | --- | --- | --- | --- | --- |
| **Kathmandu Valley** | flat valley floor | walled compound boundary, dense near-surrounding low/mid-rise massing (22 blocks, pulled in close) | tight paved urban lane | sparser (0.6×), individual urban trees | closest (haze from 38) |
| **Hill** | raised, terraced plinth with stepped retaining-wall rings | sparser surrounding buildings | curving two-segment hillside road, never a straight cut | denser clustered cover (1.3×, larger canopy) | mid-range (from 55) |
| **Terai** | flat, with a broad open field-edge ring | no added massing — open reads as open | wide straight approach | more widely spread, smaller-canopy field planting (1.15×) | furthest, clearest (from 75) |
| **Unknown** | flat, unchanged | none added | plain neutral lane | unchanged | original neutral depth (from 60) |

All of this is quality-gated behind `quality.ambientProps` (so LOW quality
keeps the world identity recognisable without paying for it) and is
independent of club development scale — a small and a large club in the
same district keep the same terrain/boundary/road treatment while their
buildings still grow separately (verified by a dedicated determinism test).
Fixed camera-preset positions and building plots are untouched by any of
this, so existing stadium/facility geometry and camera framing are
unaffected. `UNKNOWN` (no location on record) keeps flat open ground with no
added terrain — the honest presentation of a district this campus has no
real geography evidence for, never a guess.

The accessible text summary states the actual composition
("Kathmandu Valley — compact urban site, walled compound, dense near
surroundings"; "Terai — open lowland site, broad flat surroundings, wide
field edge"; "Hill district — terraced campus, raised site, hillside
surroundings"), not a generic label.

One subtlety worth recording: which real district a given club lands in is
itself *world-generation* state (`estimatedClubLocality`, seeded by club id
but only used as a fallback when no real `location_id` is recorded) —
not a fixed fact a test can hardcode by club name. E2E coverage reads
whatever geography a club actually gets that save rather than asserting a
specific club-to-district mapping.

### Camera presets

`ClubSceneHandle.focus(preset)` moves the camera to one of five named,
deterministic viewpoints: `OVERVIEW`, `STADIUM`, `TRAINING`, `ACADEMY`,
`ADMIN` (the offices block — there is no distinct admin building). Rendered as
five real DOM buttons (`role="group"`, `aria-pressed` per button) beside the
canvas. On **Full** motion the camera eases toward the target over several
frames; on **Reduced**/**Off** it jumps instantly, because a multi-frame tween
is exactly the discomfort Reduced motion exists to remove. Overview's ambient
drift only plays while Overview is the active preset, so focusing a building
holds the camera still there rather than drifting away from what the player
asked to see.

## Architecture

```
apps/desktop/src/presentation/
  clubScenePresentation.ts        pure state -> ClubSceneProfile  (renderer-agnostic, unit-tested)
  federationScenePresentation.ts  pure state -> FederationSceneProfile (same pattern, President career)
  meetingScenePresentation.ts     pure state -> MeetingSceneProfile (same pattern, off-pitch decision rooms)
  scenePreferences.ts             quality tiers, motion level, WebGL capability     (unit-tested)
  SceneCanvas.tsx                 reusable host: lazy load, resize, pause, dispose, error boundary
  clubSceneBuilder.ts             ClubSceneProfile -> three.js scene
  federationSceneBuilder.ts       FederationSceneProfile -> three.js scene
  meetingSceneBuilder.ts          MeetingSceneProfile -> three.js scene (boardroom/negotiation/press)
  ClubEnvironmentScene.tsx        the Club Profile hero + accessible text readout + 2D fallback
  FederationEnvironmentScene.tsx  the President Dashboard hero, same guarantees
  MeetingEnvironmentScene.tsx     the reusable decision-room hero, same guarantees
  PresentationSettingsPanel.tsx   graphics/animation preferences
```

Only `clubSceneBuilder.ts`, `federationSceneBuilder.ts` and `meetingSceneBuilder.ts`
import `three` — enforced by `noMatchRendering.test.ts`'s import allowlist, so a
fourth 3D surface cannot appear without a deliberate update to that test and
this doc — so three.js ships as a lazily-loaded chunk that costs nothing until
a scene is actually shown.

The split matters: the **derivation layer is pure TypeScript and has no
renderer dependency**, so scene correctness is unit-testable without a GPU,
and the renderer stays swappable.

### Library choice

`three` core only — no React Three Fiber, no drei. The first scenes are
procedural geometry derived from game state rather than artist-authored GLTF
assets, so the core library is sufficient, and a second React reconciler is a
cost with no current benefit. Revisit if scenes become complex enough to want a
component tree.

### Clickability

The permanent rule: **destination exists → clickable; no destination →
plain.** `ClubEnvironmentScene` is opened from `OrganizationProfilePanel`
(`onOpenReference`), a single shared panel reachable from *any* role viewing
*any* club — the player's own, an opponent's, or a foreign club. That shared,
multi-context reach is exactly why a generic "open Training" click has no
single safe target: the same panel serves a Manager looking at a rival club,
an Owner looking at their own, and a President looking at either.

| Visual entity | Canonical destination | Clickable | Reason |
| --- | --- | --- | --- |
| Stadium/Training/Academy/Medical/Offices, with a real active project | Infrastructure project detail (`OrganizationProfilePanel`, via the project's own `EntityReference`) | **Yes** | A real, visible destination exists and is reused, never duplicated |
| Any of the above, with no active project | — | **No** | No single destination is safe from every viewing context this panel is opened in (see above) |
| Executive appointments (Sporting Director/DoF/CEO/General Secretary) | Chairman/Owner → Staff → Executive Management (`getClubExecutiveOverview`) | **Yes, but only from the Owner's own club-facing nav**, not from this shared 3D scene | Correct destination only exists when the viewer *is* the Owner of *this* club — not derivable inside a panel any role/any club can open |
| Federation HQ | Governance screen (`onNavigate("governance")`) | **Yes** | `FederationEnvironmentScene` is only ever the President's own dashboard for their own federation — unlike the club scene, there is no other-viewer/other-federation ambiguity, so a direct `onNavigate` route is safe |
| National Football Centre | National Development screen (`onNavigate("national-development")`) | **Yes** | same reasoning |
| Referee-development marker, women's-development marker, trees | — | **No** | Environmental/identity props, never routed — no destination exists for them |

## Federation Environment (President career)

Mirrors the club scene's architecture and every guarantee (deterministic,
state-driven, text-parity, 2D fallback, quality/motion-aware) for the
Federation President's own world — `federationScenePresentation.ts` /
`federationSceneBuilder.ts` / `FederationEnvironmentScene.tsx`.

**State source**: the same `FederationPresidentDashboard` the President
Dashboard already reads — no new backend query. `FederationSimulationProfile`
carries real 0-100 development scores (a genuinely different scale from a
club's 0-20 facility quality, so federation tiers use their own bands:
`federationTierForScore`). HQ reads from institutional strength
(`governanceStability`/`commercialStrength`/`infrastructureLevel` averaged);
the National Football Centre reads from football-development strength
(`youthDevelopment`/`coachEducation`/`infrastructureLevel`) — two genuinely
different real inputs, so a federation strong in governance but weak in
youth development gets a large HQ next to a modest national centre, never
the reverse implied by one number.

**Buildings**: `HQ` and `NATIONAL_CENTRE` only (two real blocks, not five —
deliberately smaller in scope than the club campus, matched to what real
federation state actually supports). The national centre's practice-pitch
count scales 0-4 from its own tier. A small referee-development marker
appears only once `refereeDevelopment >= 20`; a women's-development marker
appears only from a real `WOMENS_DEVELOPMENT` `FederationProject` (any
status) — never inferred from unrelated scores.

**Construction**: real `FederationProject` records map to HQ (`GRASSROOTS_
PROGRAMME`/`DIGITAL_BROADCAST`/`CLUB_SUPPORT_PROGRAMME`) or the national
centre (`NATIONAL_TRAINING_CENTRE`/`REGIONAL_CENTRE`/`ACADEMY_EXPANSION`/
`WOMENS_DEVELOPMENT`/`COACH_EDUCATION`/`REFEREE_PROGRAMME`), with the same
scaffold-for-`CONSTRUCTION`/`IMPLEMENTATION`, ring-marker-for-planned
lifecycle the club campus uses.

**Geography**: honestly `UNKNOWN` — no canonical federation HQ district
exists in current simulation state, so this never hardcodes "Kathmandu" as
a fact. Reuses the club geography engine's types rather than duplicating it;
will pick up a real district automatically if federation location data is
ever added.

**Cameras**: three named presets — `OVERVIEW`, `HQ`, `NATIONAL_CENTRE` — a
deliberately smaller set than the club's five, matched to the two real
buildings that exist. Same eased-on-Full/instant-on-Reduced behavior.

**Integration**: mounted in the President Dashboard
(`RoleLandingScreen.tsx`'s `FederationDashboardView`), reusing `SceneCanvas`
directly rather than duplicating its lazy-load/resize/dispose/error-boundary
logic. Switching career role away from President and back re-shows the
federation scene; 3D OFF leaves the full President dashboard functional
through DOM controls alone.

## Meeting Environment (off-pitch decision rooms)

One reusable interior scene for every off-pitch decision moment — a
boardroom, a negotiation room, a press room — instead of a bespoke renderer
per workflow. `MeetingContext = "BOARDROOM" | "NEGOTIATION" | "PRESS"`.

**Real-state-only contract**: `buildMeetingSceneProfile` never guesses an
`environmentTier` or `MeetingImportance` — both are always caller-supplied
real state. A caller with no real signal passes a conservative default
(`"MODEST"`/`"ROUTINE"`) rather than this module inventing one. Reuses the
club scene's own `FacilityVisualTier` bands for consistency; `meetingTierForScore100`
converts a 0-100 real score (board confidence, a reputation figure) for
callers whose only signal isn't a club's own 0-20 facility scale.

**Layout differs by context, not just by label**: `BOARDROOM`/`NEGOTIATION`
share a table-and-chairs layout (chair count scales 2-12 with tier);
`PRESS` gets a podium facing rows of seating — a genuinely different real
arrangement, verified by a unit test asserting the two produce different
object counts at the same tier. Room footprint, wall material (painted
concrete → glass at Advanced/Elite) and chair count all scale with the
real `environmentTier`.

**No modelled people**: identity (who is in the room) stays entirely in the
DOM (`MeetingParticipants`, existing profile links) — this scene only ever
furnishes the room itself. See the permanent no-animated-human-scope-creep
boundary below.

**Cameras**: two presets, `ROOM` and `TABLE` — deliberately smaller than
the club/federation scenes' sets, matched to what a single-room interior
actually needs. Same eased-on-Full/instant-on-Reduced behavior.

**Shipped integration**: the Owner↔Manager boardroom meeting
(`RoleDetailScreen.tsx`'s `OwnerManagerMeeting`) — `environmentTier` from
real board confidence, `importance` from real board pressure
(`HIGH`→`MAJOR`, `MEDIUM`→`IMPORTANT`, else `ROUTINE`). The scene is purely
additive beside the existing canonical topic/stance/commitment controls,
which are unchanged. Transfer negotiation, contract negotiation, signing,
investor/ownership meetings, staff appointments and press are **not** wired
to live UI this pass — the reusable architecture supports all three
contexts, but only the boardroom got a real integration; see Known P2 in
the phase report for the honest remainder.

## Non-negotiables for every scene

1. **Never required.** Every destination reachable by clicking a 3D object must
   also be a real, labelled DOM control. 3D navigation is additive.
2. **Text parity.** Everything a scene depicts must also be stated in the DOM.
   The canvas is never the sole information surface.
3. **Fallback.** No WebGL, a lost context, a thrown scene, or the player turning
   3D off must all land on a polished 2D view, not a blank rectangle.
4. **Reduced motion.** Honour `prefers-reduced-motion`; the system preference
   may only ever lower motion, never raise it above the player's own choice.
5. **Quality tiers.** LOW/MEDIUM/HIGH must genuinely change GPU cost
   (pixel ratio, shadows, geometry, ambient props), not just the label.
6. **Determinism.** Same club and same state means the same layout on every
   launch. Seed from stable entity ids; never `Math.random()` at scene build.
7. **Cleanup.** Unmount must cancel the animation loop, dispose geometry and
   materials, dispose the renderer and release the GL context.
8. **Pause when unseen.** Stop drawing when the scene is offscreen or the
   window is hidden.
9. **Lazy.** Scenes and their assets load by route, never at app startup.
10. **Licensing.** No club crest, kit, stadium likeness, player likeness or
    trophy design is assumed licensed. Generated visuals are SIMULATION_ONLY and
    must say so. The shipped club accent colour is a stable hash-derived hue and
    is explicitly labelled as *not* the club's real kit colours.
11. **Save separation.** Presentation preferences describe the machine, not the
    world. They live in browser storage, never in a career save, so an old save
    renders correctly anywhere.
12. **Information density wins.** A management game needs dense data. 3D is a
    hero/context band beside structured data, never a replacement for it.
13. **No animated-human scope creep.** No realistic faces, body rigs, lip
    sync, mocap, or walking/seated-negotiation animations. Person identity
    (who is in the room) stays in the DOM; a 3D scene furnishes the
    environment only. This is a permanent boundary, not a Phase 6-only
    rule — revisit only with a deliberate, scoped decision, never as an
    incidental add-on to an environment task.

## Future-system integration matrix

Each future roadmap item should include "3D presentation integration where
meaningful". Expected work per system:

| Roadmap system | Presentation work |
| --- | --- |
| Story Universe 2.0 | press-room backdrop for the existing press interactions; event transitions |
| Global Football Market | animated transfer map, market activity visualization |
| Global Scouting | world knowledge map, scouting fog, region highlighting |
| Global Transfers / Agents | transfer completion sequence (club → player → club), international route |
| Stadiums | full stadium scene: stands, roof, floodlights, hospitality |
| Academies | academy campus, youth pitches, intake reveal (no loot-box aesthetic) |
| Women's football | the *same* scene architecture and quality — never a lesser visual tier |
| Supporters | crowd density, banners, atmosphere driven by supporter state |
| Multi-club ownership | group/world portfolio visualization |
| Federation completion | HQ/national centre shipped (see Federation Environment above); a national stadium scene is still to do |
| National teams | national-team hub, tournament branding, qualification moments |
| Career/economy/reputation | milestone sequences, trophy room, boardroom |
| Weather/travel | scene atmosphere by time of day and climate, where the model holds it |
| Awards/competitions | original trophy/podium presentation, bracket and title moments |

## UI motion (the non-3D interface)

The same preference governs ordinary UI motion, because a player who asks for
less motion means it everywhere, not only in the 3D band.

- `motion.ts` holds the tokens — three durations, three easings — so screens
  cannot drift into their own inconsistent motion. It is CSS-only on purpose:
  entrances, tab changes and value updates are all things CSS transitions
  express directly, and an animation runtime would mean a second animation
  system plus real bundle cost for effects the platform already does well.
- `MotionPrimitives.tsx` holds the components screens opt into.
- **Full** plays everything. **Reduced** shortens functional transitions and
  skips decorative entrances outright — a shorter entrance is still an
  entrance, and an entrance carries no information. **Off** removes motion
  entirely. A system `prefers-reduced-motion` request is honoured on top.
- Wired at choke points rather than per screen: `Panel` (every panel in the
  game is built from it) and the single shared `InboxPanel`. New arrivals are
  marked by `useNewlyArrived`, which reports nothing on first mount — on open
  every item is "new", and animating the whole list is noise, not information.
- Any change a player is meant to notice is also stated as text. Colour and
  movement are never the only signal.

## How this layer is verified

Scene correctness is unit-tested without a GPU: three's scene and camera maths
run fine in Node, so the animation contract, the state-driven geometry and
disposal are all asserted directly rather than eyeballed in a screenshot.

Two things are worth recording for whoever verifies this next:

- **Screenshot diffing does not prove animation here.** An occluded window
  stops updating its backing store, so repeated `screencapture` calls return
  byte-identical images and a diff of them means nothing either way.
- **`requestAnimationFrame` is suspended for a non-foreground window.** A
  WKWebView harness measured `rafFps: 0` with `occlusionState` reporting the
  window as occluded, even after `makeKeyAndOrderFront` plus
  `activate(ignoringOtherApps:)`. Frame-rate and on-screen motion checks
  therefore need a genuinely foreground window and cannot be automated in a
  background session. This is a property of the platform, not of the code.

What a headless harness *can* prove, and does: WebGL availability, that the
real three chunk dynamic-imports and renders, that the drawing buffer tracks
the element size at every window width, and that repeatedly opening and
closing a scene releases its GPU context (25 open/close cycles produced 25
distinct canvases, every context live, every one torn down — without working
disposal a driver refuses new contexts well before 25).

## Packaged Tauri native runtime — manual acceptance gate

Everything this layer's automated suite can prove, it proves: the full
architecture, Club Environment, state-driven visuals, determinism, a real
visible first frame, live resize, DPR handling, LOW/MEDIUM/HIGH quality,
3D OFF, reduced motion, WebGL-unavailable fallback, render-error fallback,
lazy-chunk loading, route churn, disposal, entity clickability, keyboard
access, automated accessibility (axe), and responsive layout — all verified
in a real, visible Chromium browser window against the same compiled
frontend bundle the packaged app embeds, plus an unsigned Tauri build that
genuinely compiles, bundles, launches, and shuts down cleanly.

What automation in this environment cannot do is drive the *packaged* app's
native WKWebView window once it's running: creating a career, clicking
through to Club Profile, resizing the actual native window, and changing
settings inside that specific window all require macOS Accessibility (TCC)
permission or keystroke-injection rights that this execution context does
not hold and cannot grant itself. This was tested directly, not assumed —
`osascript`'s own error messages name the restriction:

```
$ osascript -e 'tell application "System Events" to tell process "nepal-football-sim" to get position of window 1'
osascript is not allowed assistive access. (-1719)

$ osascript -e 'tell application "System Events" to keystroke "test"'
osascript is not allowed to send keystrokes. (1002)
```

`cliclick` is not installed, the app registers no deep-link URL scheme to
jump past the click, `safaridriver` only automates Safari itself (not an
arbitrary third-party WKWebView host), and the release build is not
`isInspectable` (no `devtools` Cargo feature compiled in — enabling it would
still need the same blocked click/menu path to actually reach Safari's Web
Inspector). This is a property of the execution sandbox, not of the app: a
human sitting at the actual machine has none of these restrictions.

**This is why the checklist below exists** — it is the same acceptance
automation would perform, written for a person to run once per release
candidate. It is short by design (10–15 minutes) and requires no special
tooling beyond the unsigned build itself.

### 3D Packaged Tauri Manual Acceptance

Run this against a freshly built unsigned package (`pnpm run
package:unsigned` from `apps/desktop`) before signing off a release
candidate that touches presentation, scene, or settings code.

**A. Launch**
1. `open ".../src-tauri/target/release/bundle/macos/Nepal Football Simulation.app"`.
2. Confirm the window opens with no crash dialog.

**B. Start or continue a career**
3. New Career (or Continue an existing one).

**C. Reach Club Profile**
4. From the Competition table (or any club reference), open your own club's
   profile.

**D. First frame**
5. Confirm: a visible 3D stadium/campus scene appears immediately — no blank
   canvas, no missing chunk, no visual corruption (stretched geometry,
   missing textures/colour, console-visible errors if DevTools happen to be
   reachable on your build).

**E. Resize**
6. Narrow the window significantly, then widen it past its original size,
   then make it noticeably shorter/taller. Maximize (green-button zoom),
   then restore.
7. At each step confirm: the scene fills its panel with no stretch and no
   blank/black frame, before and after maximize/restore.

**F. Presentation settings** (now reachable from the sidebar's
"Presentation" button without leaving the career — see below)
8. Set quality to **HIGH**; revisit Club Profile if it does not update the
   already-open panel. Confirm the scene still renders, no crash.
9. Set quality to **LOW**. Confirm the scene still renders (a LOW-quality
   scene should look visibly simpler — no shadows, sparser scenery — if you
   compare against HIGH).
10. Set motion to **REDUCED**. Confirm the camera stops drifting; small
    on-site motion (e.g. a construction crane, if one is present) may
    continue.
11. Turn **3D OFF**. Confirm the 2D fallback view appears with the same club
    facts, no blank panel.
12. Turn 3D back **ON**. Confirm the scene returns.

**G. Settings persistence**
13. Quit the app (Cmd+Q or the app menu — not Force Quit) and relaunch.
14. Confirm the quality/motion/3D-on-off settings from step 8–12 are still
    in effect (footer text and/or the Presentation panel's own selection).

**H. WebGL-unavailable fallback**
15. No supported in-app flag exists to force this in a signed/unsigned
    release build. Mark this step **browser/unit-verified, not manually
    injectable** — do not attempt to disable your GPU driver or similar to
    force it; that is not a representative release check.

**I. Route churn**
16. Club Profile → Squad → Competition (or Dashboard) → Club Profile.
    Repeat 5 times, ideally opening a different club's profile at least
    once along the way.

**J. Verify after churn**
17. No crash. No blank scene on any return to Club Profile. No obviously
    runaway memory growth (Activity Monitor's Real Memory column, sampled
    before/after, staying in the same order of magnitude is enough — some
    growth from WebKit's own caching is normal). No console/user-facing
    error banner.

**K. Record**
18. macOS version (`sw_vers`), machine/GPU (Apple menu → About This Mac),
    the exact `.app` artifact path and its build date, PASS/FAIL per
    section, and a screenshot of the first-frame Club Profile view at
    minimum. Attach failure screenshots for anything marked FAIL.

#### Result template

```
PACKAGED_3D_FIRST_FRAME:
PACKAGED_RESIZE:
PACKAGED_SETTINGS:
PACKAGED_SETTINGS_PERSISTENCE:
PACKAGED_REDUCED_MOTION:
PACKAGED_3D_OFF:
PACKAGED_ROUTE_CHURN:
PACKAGED_FALLBACK: BROWSER_UNIT_VERIFIED_NOT_MANUALLY_INJECTABLE
PACKAGED_CRASH_FREE:

OVERALL: PASS / FAIL

BLOCKERS:
NOTES:

macOS version:
Machine/GPU:
Artifact path/build date:
```

### Release gate policy

The 3D presentation foundation is **engineering-complete**: every gate an
automated agent or CI runner can verify has been verified, on both a real
browser and a real (if execution-sandboxed) packaged build. It is **not**
release-accepted until a human has run the checklist above against an
unsigned release-candidate build and recorded a `PASS`. Track these as two
separate, explicit statuses rather than one combined "done":

- `3D_PRESENTATION_ENGINEERING_COMPLETE` — true today.
- `3D_PACKAGED_NATIVE_ACCEPTANCE_PENDING` — stays true until a completed,
  `PASS`-recorded run of the checklist above exists for a given release
  candidate. Re-run it whenever presentation/scene/settings code changes
  meaningfully, not just once ever.

Do not declare a combined `3D_PRESENTATION_FOUNDATION_COMPLETE` status
anywhere (docs, release notes, roadmap tracking) until that human run has
actually happened.

## Status

Foundation and the first vertical slice (Club Environment on Club Profile)
are implemented, along with the UI motion foundation above, quality/motion/
3D-off settings (now reachable both before and during an active career),
and the packaged-build manual acceptance gate documented above.

Phase 1 of the living-world upgrade added geographic identity (classification
only) and five named camera presets. Phase 2 added: stadium typology separate
from tier (real stand-arrangement variety, not just scale), a small coherent
material library, stepped seating/support columns/roof struts, floodlight
provision bands, stadium construction visualization (previously the one
campus block with none at all), club-accent corner flags, and a real-browser
screenshot test proving a top-division club's stadium renders substantially
differently from a bottom-division club's.

Phase 3 closed the training/academy/HQ/medical composition gap left open by
Phase 2: each of the four facility buildings now composes differently from
real facility-quality state (distinct pitch-count progressions, gym/indoor-
hall annexes, an HQ entrance canopy and plaza, a medical recovery annex),
with a per-kind material language and a campus-wide flag/fence-vs-forecourt
site-development treatment, and a real-browser test proving Overview/
Training/Academy/Admin all render substantially differently between a
bottom- and top-division club.

Phase 4 deepened geography from a distant silhouette into real site
composition — terrain (Hill's terraced plinth), boundary (Kathmandu's
compound wall), access roads, vegetation density/type, and atmospheric fog
depth, all described above — verified deterministic, independent of club
scale, and by two real-browser tests (three real clubs' Overview scenes
pairwise different; a small and large club's scenes differ while the DOM
always states one of the four real geography bands).

Phase 5 (this pass) gave the Federation President career its own physical
world — the Federation Environment described above — built on the same
architecture and guarantees as the club scene, driven by the same real
`FederationPresidentDashboard` state the President Dashboard already reads,
with real HQ/national-centre construction lifecycle, real referee- and
women's-development markers, and a real-browser test proving the scene
renders, camera presets and click-through to Governance/National
Development work, and a role switch away from and back to President
correctly re-shows the federation context.

Phase 6 (this pass) added the Meeting Environment described above — one
reusable off-pitch decision-room scene (boardroom/negotiation/press)
instead of a bespoke renderer per workflow, driven only by caller-supplied
real state (never a guessed tier or importance), with a shipped real
integration into the Owner↔Manager boardroom meeting and a real-browser
test proving the scene renders alongside the unchanged canonical meeting
controls, camera presets work, and the real "Start meeting" action still
functions end-to-end. Draw calls/triangles are an order of magnitude below
the club/federation scenes, as intended for a small interior.

Not yet built, deliberately deferred rather than rushed: weather-state
atmosphere (no such simulation state exists yet to read honestly), time-of-
day/floodlight-glow lighting profiles (no canonical time-of-day state
exists either), residential/education representation for an elite academy
(no simulation state to ground it honestly), a national-stadium scene and
federation geography beyond `UNKNOWN` (no canonical federation-HQ district
exists in current state), a browser test proving HQ/national-centre
visually differ between a weak and strong federation (covered at unit
level only), and — the largest remaining gap — wiring the Meeting
Environment's NEGOTIATION and PRESS contexts into their real UI (transfer
negotiation, contract negotiation, signing, investor/ownership meetings,
staff appointments, structured press) — only BOARDROOM shipped a live
integration this pass. Everything else in the matrix is still to do, and
each should be built on this foundation rather than beside it.
