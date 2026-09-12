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

## Status

Foundation and the first vertical slice (Club Environment on Club Profile) are
implemented. Everything in the matrix above is still to do, and each should be
built on this foundation rather than beside it.
