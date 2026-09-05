# Unsigned Release Candidate — Status

**HEAD:** `01f3d19c84131ddf738d559b0bbd7954a8a82a6a`
**Date:** 2026-09-05
**Signing/notarization:** OUT OF SCOPE for this document and this release candidate. No Apple Developer ID key or notarytool credentials were used or referenced. This is an unsigned build only.

## Build command

```
pnpm --filter @nepal-football-sim/desktop package:unsigned
```

(equivalently, from `apps/desktop/`: `pnpm package:unsigned`)

This resolves to `tauri build --bundles app`. **Do not run bare `pnpm exec tauri build`** — on the installed Tauri CLI version (2.11.4) it silently completes without producing a bundle, with no error. The `package:unsigned` script exists specifically so this can't happen by accident.

The command runs, in order: `pnpm build` (Vite production build of the frontend) → `pnpm prepare:runtime` (deploys the simulation package + its dependency closure via `pnpm deploy`, vendors the Node runtime and its native library dependencies — see below — into `src-tauri/runtime`) → the Rust release compile → macOS `.app` bundling.

## Verified this pass (HEAD `01f3d19`)

The artifact validated below was built from `a98cd19` plus this freeze's own changes (`.gitignore`, `apps/desktop/package.json`, three test files) — none of which touch anything that affects the built app bundle (frontend, simulation runtime, prepare-runtime.mjs, or Tauri config were all already at `a98cd19`). The verified bundle is bit-for-bit equivalent to what building fresh from `01f3d19` produces.

| Gate | Result | Evidence |
| --- | --- | --- |
| Unsigned app bundle | PASS | `Nepal Football Simulation.app` built via `package:unsigned`, no errors. |
| Packaged resources | PASS | Bundle inspected directly: `runtime/app` (sidecar code + `node_modules`), `runtime/node` + `runtime/lib/` (19 vendored dylibs), `data/nepal/2026-08/club-registry.json`, `data/DATASET_MANIFEST.json`, `docs/DATASET_ATTRIBUTION_AND_LICENSING.md`, `icon.icns` all present under `Contents/Resources`. `grep -rl "/Users/"` across the shipped `data/`, `docs/`, and `Info.plist` returned nothing. |
| Package attribution | PASS | `getDatasetAttribution()`'s `datasetVersion` (`football_world_import_v16_reconciled_final`) matches `data/DATASET_MANIFEST.json`'s global-seed entry exactly. Its `licensingNotice` states redistribution permissions "remain UNKNOWN or UNRESOLVED" — consistent with the manifest, never claims a permission that hasn't been granted. A minimal About & Data Attribution panel (career-select screen) surfaces this same data to the user. |
| Sidecar startup | PASS | Launched via `open -n` on the actual built `.app` (not dev mode): the sidecar (`runtime/node runtime/app/dist/desktop-server-cli.js`) starts as a child of the main process and binds a `localhost` port with token-gated HTTP auth (verified via a direct unauthenticated `curl` returning `Invalid runtime token`, and via the app's own successful WebView load). |
| Sidecar shutdown | PASS | Quit via AppleScript (`tell application ... to quit`, the real user quit path — not a forced kill): both the main process and the sidecar child exited with zero orphans and no crash report, verified via `ps`/`pgrep` immediately after and via `~/Library/Logs/DiagnosticReports`. |
| Save compatibility | PASS | Exercised against a **copy** of a real user save (`nepal-manager-career-mthyjwx3.sqlite`, never the original — original file's mtime confirmed unchanged after the check) in an isolated scratch directory: `listSaves` → `loadCareer` → representative read-only commands (`getManagerDashboard`, `getDatasetAttribution`; `getFixtures`/`getCompetition` correctly returned `ROLE_NOT_AUTHORIZED` for this save's Owner-only active role, which is correct authority-gating, not a failure) → `closeCareer` → reopen with a fresh service instance → `loadCareer` again → same reads. Migration to schema version 91 was a no-op (the save was already current). No corruption, no migration error, no data loss. |
| Typecheck / builds | PASS | Root `pnpm build` (shared-types, database, data-import, rules, desktop Vite build, simulation, testing) — all clean. `git diff --check` — clean, no whitespace errors. |

### Prior, not re-run this pass

These were validated earlier in this release cycle and are not re-verified by this freeze audit (re-running a ~70-minute twenty-season simulation is out of scope for a repository-freeze pass):

- **Twenty-season validation:** PASS — see `docs/RELEASE_READINESS.md` / `docs/PERFORMANCE_PROFILE.md` (4,184.53s simulated, zero correctness/integrity failures, successful checkpoint reloads).
- **Performance gate:** PASS — same evidence; RSS plateaued ~581–596 MB after a bounded capacity step.
- **Data integrity:** PASS — same evidence; no migration, startup crash, missing-seed, IPC, or save-directory defect reproduced.

## Focused regression suite (this pass)

77 tests across 14 files, all passing: entity profiles, national-team squad read model, staff market / eligibility, player-action copy, Owner↔Manager meetings, squad dynamics, commercial rights (federation + national-team), Manager gameplay, facility planning, and government support/relations/funding-settlement.

### Stale tests fixed this pass (were failing for reasons unrelated to any gameplay defect)

1. `manager-gameplay.test.ts` — asserted the default starting competition was named "ANFA National League"; the real dataset has that as a *separate* `SPECIAL_NATIONAL_LEAGUE`-category competition from the one the default club actually plays in (Martyr's Memorial A-Division League). Assertion corrected to check for a real, non-placeholder competition name rather than one specific stale string.
2. `manager-gameplay.test.ts` — asserted at least one squad player has `age.status === "UNKNOWN"`. Verified against a real save that the simulation now backfills a `SIMULATION_ONLY` DOB estimate for every player without a factual one (21 of 25 players in a fresh Nepal save) rather than leaving age unknown — a deliberate, honestly-labeled behavior, not a regression. Assertion corrected to check for `"SIMULATION_ONLY"`.
3. `staff-market.test.ts` — a contract-lapse assertion queried a `"SCOUT"` vacancy left over from before an earlier commit this session changed that test's retired-player fixture to hire as `TECHNICAL_DIRECTOR` instead. It was silently checking the wrong role and only "passed" by coincidence depending on unrelated state carried over from other files in the same test run. Fixed to query the correct role.

None of these were gameplay/backend defects; no production code changed for any of them.

## Native packaged-window click-through

**NOT VERIFIED.** No native macOS GUI automation tool is available in this environment, and the standing rule against full-screen desktop capture (from an earlier incident where a screenshot inadvertently captured a private browser tab) rules out that path. All packaged-app verification above uses process/log inspection and direct HTTP calls to the running sidecar. The exact same frontend code and backend command paths were exercised interactively through the dev-mode browser (which runs an equivalent, non-packaged sidecar) — including the new Club Profile links, the Facilities → Government Support panel (correctly showing the honest "no government institution can be resolved yet" blocked state for a fresh save), and the About & Data Attribution panel — but this is not the same as clicking through the actual packaged `.app` window.

## Known non-blocking item

A stray nested git repository (`nepali-fm26/`, ~164MB, its own `.git` history, dated Aug 27–29) exists in the worktree root. It was not removed: it doesn't cleanly fit any of the "accidental scratch" categories (script, save, screenshot, log, benchmark DB, package artifact), and deleting a second repository's own history is not a call to make unilaterally. Flagged for the user to review and remove if appropriate.

## Freeze rule

As of this document: no new features, no visual redesign, no new simulation systems. Only release-blocking fixes until otherwise instructed.
