# Architecture Decisions

## ADR-001: Monorepo with pnpm workspaces

The project uses a pnpm workspace because the game has clear package boundaries and should grow without merging UI, simulation, database, rules, and import code. pnpm also keeps workspace linking predictable.

## ADR-002: Simulation engine independent of React and Tauri

The simulation package depends on shared domain types and database interfaces, not on the desktop app. This keeps `simulateDay`, `simulateWeek`, `simulateSeason`, and long headless runs possible from the command line.

## ADR-003: SQLite as the local save database

Saves use SQLite with migrations. This supports durable local play, decades of history, and future save upgrades without cloud infrastructure or giant JSON blobs.

## ADR-004: Person identity plus roles

Human identity is represented by `Person`. Player, manager, staff, agent, chairman, and federation official are roles tied to the same person. This prevents broken history when a person changes career path.

## ADR-005: Separate financial identities

Personal, club, and federation money are separate `FinanceAccount` owner types. Rules enforce owner expectations so gameplay cannot accidentally treat them as one wallet.

## ADR-006: Stable IDs for researched/imported entities

The shared types package provides random UUIDs for newly simulated entities and deterministic UUID-like IDs for imported or known entities. This helps repeated imports target the same records.

## ADR-007: No graphical football match engine

The permanent match direction is quick sim, key events, and text live. No 2D or 3D match rendering is included in the foundation.

## ADR-008: Node built-in SQLite module

The database package uses Node's built-in SQLite module to keep dependency count low and avoid native package setup during Stage 1. If the module stabilizes differently, this can be isolated inside `packages/database`.

## ADR-009: Dataset-driven Nepal world creation

Stage 2 creates Nepal saves from importable datasets rather than hard-coded application constants. This lets the August 2026 starting database be updated by the research process without rewriting simulation code.

## ADR-010: Explicit uncertainty for imported facts

Import records separate `VERIFIED`, `REPORTED`, `ESTIMATED`, `UNKNOWN`, and `SIMULATION_ONLY` facts. Unknown fields are not represented as silent nulls in the input dataset; they must explicitly state `UNKNOWN` so the game never treats missing data as verified fact.

## ADR-011: Database adapter replaceability

`node:sqlite` remains acceptable for Stage 2 because it is fully hidden behind `packages/database`. Future production Tauri or mobile builds may need a different adapter, so Stage 2 code must continue depending on repository and service boundaries rather than the Node adapter.

## ADR-012: Event-based match engine

Stage 3 uses a minute-based event engine rather than selecting a final score and backfilling fake events. This keeps quick sim, key events, and text live presentation modes aligned around the same source event stream.

## ADR-013: Derived standings with persisted snapshots

Standings and season statistics are calculated from match results and then persisted as snapshots. This gives reliable reconstruction from fixtures/results while keeping save inspection fast.
