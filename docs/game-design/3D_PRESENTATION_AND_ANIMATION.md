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

## Status

Foundation and the first vertical slice (Club Environment on Club Profile) are
implemented, along with the UI motion foundation above. Everything in the
matrix is still to do, and each should be built on this foundation rather than
beside it.
