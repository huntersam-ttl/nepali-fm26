# Nepal Football Simulation 0.1.0

Early macOS tester build for the Nepal Football Universe manager loop.

## Run

1. Unzip the distribution and move `Nepal Football Simulation.app` somewhere convenient.
2. Open it. Because this build is unsigned, macOS may require right-clicking the app, choosing **Open**, and confirming **Open**. Do not disable Gatekeeper globally.
3. Create or load a career, then focus feedback on the normal manager loop: dashboard, squad/player, fixtures/competition, one advance or Quick Sim, and save/reopen.

Saves are stored at:
`~/Library/Application Support/com.local.nepal-football-simulation/saves/`

## Report a problem

Classify it as **BLOCKER** (cannot start/load/progress/save), **BUG** (wrong or broken behavior), **UX** (confusing or hard to find), **BALANCE** (works but feels wrong), or **FEATURE_REQUEST** (new functionality). Include what you did, expected result, actual result, a screenshot, the save file when possible, and build version `0.1.0`.

Chairman/Federation surfaces are not exposed in this tester build. Long-save performance is still under optimisation; please test normal sessions rather than promising 20/50-year performance.

For developer diagnostics, capture the launching Terminal output if starting the app from `Contents/MacOS/nepal-football-sim`; the managed runtime reports SQLite/startup errors there.
