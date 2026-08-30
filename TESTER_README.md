# Nepal Football Simulation 0.1.0-test.2

Early macOS tester build for the Nepal Football Universe manager loop.

## Run

1. Unzip the distribution and move `Nepal Football Simulation.app` somewhere convenient.
2. Open it. Because this build is unsigned, macOS may require right-clicking the app, choosing **Open**, and confirming **Open**. Do not disable Gatekeeper globally.
3. Create or load a career, then focus feedback on the manager loop plus the role-aware shell. Verify Chairman / Owner and Federation President dashboards, finance visibility, role switching, and save/reopen persistence when using a multi-role fixture.

Saves are stored at:
`~/Library/Application Support/com.local.nepal-football-simulation/saves/`

## Report a problem

Classify it as **BLOCKER** (cannot start/load/progress/save), **BUG** (wrong or broken behavior), **UX** (confusing or hard to find), **BALANCE** (works but feels wrong), or **FEATURE_REQUEST** (new functionality). Include build ID, macOS version/model, what you did, expected result, actual result, whether it repeats, a screenshot/video when useful, and the save file when possible.

Chairman / Owner and Federation President dashboards now expose existing finance, ownership, governance, project, sponsorship, manager, and national-team read models. Long-save performance is still under optimisation; please test normal sessions rather than promising 20/50-year performance.

For developer diagnostics, capture the launching Terminal output if starting the app from `Contents/MacOS/nepal-football-sim`; the managed runtime reports SQLite/startup errors there.
