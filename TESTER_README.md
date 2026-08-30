# Nepal Football Simulation 0.1.0-test.5

Early macOS tester build for the Nepal Football Universe manager loop.

## Run

1. Open `Nepal-Football-Simulation-0.1.0-test.5-macos.zip`, then move `Nepal Football Simulation.app` somewhere convenient.
2. Open it. Because this build is unsigned, macOS may require right-clicking the app, choosing **Open**, and confirming **Open**. Do not disable Gatekeeper globally.
3. The build ID is `0.1.0-test.5`. Create or load a career, then focus feedback on the clearer Manager versus Owner/Chairman setup, A/B/C Division selection, monthly wages, squad sizes, free-agent recruitment, player-profile provenance, and the earned ANFA candidacy panel. Verify candidacy, election win/loss, Chairman / Owner and Federation President dashboards, finance visibility, role switching, and save/reopen persistence when using a multi-role fixture.

## First session (20–30 minutes)

1. Launch the app and create a Manager career.
2. Choose an A, B, or C Division club; check Dashboard, Squad, and a player profile.
3. Change the formation, check Staff, and offer a player contract.
4. Continue to the next fixture, use Quick Sim, review the result/inbox, and Continue again.
5. Save, close the app, reopen it, and Load Career. Optionally repeat with an Owner / Chairman career and inspect the Chairman dashboard.

Saves are stored at:
`~/Library/Application Support/com.local.nepal-football-simulation/saves/`

When a bug depends on a progressed career, attach the affected save when practical; do not attach unrelated personal files.

## Report a problem

Classify it as **BLOCKER** (cannot start/load/progress/save), **BUG** (wrong or broken behavior), **UX** (confusing or hard to find), **BALANCE** (works but feels wrong), or **FEATURE_REQUEST** (new functionality). Include build ID, macOS version/model, what you did, expected result, actual result, whether it repeats, a screenshot/video when useful, and the save file when possible.

Chairman / Owner and Federation President dashboards now expose existing finance, ownership, governance, project, sponsorship, manager, and national-team read models. Long-save performance is still under optimisation; please test normal sessions rather than promising 20/50-year performance.

For developer diagnostics, capture the launching Terminal output if starting the app from `Contents/MacOS/nepal-football-sim`; the managed runtime reports SQLite/startup errors there. There is no persistent telemetry or automatic upload; runtime diagnostics are console-only unless you save that output yourself.
