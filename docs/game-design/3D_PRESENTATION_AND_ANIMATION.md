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

A big but unlit, uncovered ground is deliberately **not** allowed to present as
an elite modern arena, however large its capacity.

## Architecture

```
apps/desktop/src/presentation/
  clubScenePresentation.ts   pure state -> ClubSceneProfile  (renderer-agnostic, unit-tested)
  scenePreferences.ts        quality tiers, motion level, WebGL capability     (unit-tested)
  SceneCanvas.tsx            reusable host: lazy load, resize, pause, dispose, error boundary
  clubSceneBuilder.ts        ClubSceneProfile -> three.js scene  (the only module importing three)
  ClubEnvironmentScene.tsx   the Club Profile hero + accessible text readout + 2D fallback
  PresentationSettingsPanel.tsx  graphics/animation preferences
```

The split matters: the **derivation layer is pure TypeScript and has no
renderer dependency**, so scene correctness is unit-testable without a GPU, and
the renderer stays swappable. Only `clubSceneBuilder.ts` imports `three`, so
three.js ships as a lazily-loaded chunk that costs nothing until a scene is
actually shown.

### Library choice

`three` core only — no React Three Fiber, no drei. The first scenes are
procedural geometry derived from game state rather than artist-authored GLTF
assets, so the core library is sufficient, and a second React reconciler is a
cost with no current benefit. Revisit if scenes become complex enough to want a
component tree.

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
| Federation completion | federation HQ, national training centre, national stadium |
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
and the packaged-build manual acceptance gate documented above. Everything
in the matrix is still to do, and each should be built on this foundation
rather than beside it.
