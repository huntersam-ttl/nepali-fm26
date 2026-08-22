# Architecture Overview

## Goal

Stage 1 established the permanent technical foundation for a Nepal-first football world simulation game. Stage 2 adds the Nepal world import pipeline without hard-coding volatile real-world facts into application logic. The foundation supports long-running local saves, deterministic simulation, strict package boundaries, and future playable careers as manager, club owner/chairman, and federation chairman/president.

## Boundaries

- `apps/desktop` is a React/Tauri shell. It must not contain football simulation business logic.
- `packages/simulation` owns the headless world clock, deterministic random service, scheduled event execution, and future simulation services.
- `packages/database` owns SQLite connections, migrations, save metadata, repositories, and persistence.
- `packages/rules` owns football/business rules that should be shared by simulation and UI.
- `packages/shared-types` owns domain models and stable ID helpers.
- `packages/data-import` owns validation for researched datasets and provenance metadata.
- `packages/testing` owns cross-package integration tests and testing-only fixtures.

## Domain Model

The model starts with countries, locations, venues, federations, clubs, teams, people, roles, team-person assignments, competitions, fixtures, matches, contracts, transfers, loans, finance accounts, relationships, promises, scheduled events, and historical events.

`Person` is the common human identity. Player, manager, staff, agent, chairman, and federation official are modeled as roles attached to the same person. This preserves career continuity when a player retires into coaching, chairmanship, or federation work.

## Simulation Flow

The simulation package exposes a day-based clock:

- `advanceDay()`
- `advanceDays(n)`
- `simulateUntil(date)`

The clock persists the save world date through the database package. Scheduled events are processed when their due date is reached, and Stage 1 records them as historical events. Future systems can subscribe to or expand these events into news, finances, relationships, and statistics.

## Database Strategy

SQLite is the local save database. The database package owns schema migrations through `schema_migrations` and stores entities in relational tables rather than a single world JSON blob. JSON columns are used only for structured secondary data such as involved entity refs, event payloads, and import provenance.

Stage 2 keeps the Stage 1 `node:sqlite` adapter inside `packages/database`. Production Tauri or mobile adapters may differ later, so UI, simulation, domain, rules, and import packages must not import or expose `node:sqlite` directly.

## Save Strategy

Each save stores:

- save id
- name
- world date
- database version
- game version
- random seed
- created time
- last saved time
- player character reference

The save system supports creating a new save, loading an existing save, and updating the world date during simulation.

## Randomness Strategy

All simulation randomness goes through `SeededRandom`. The simulation package must not use scattered `Math.random()` calls. Deterministic RNG allows a save and seed to reproduce simulation bugs where practical.

## Event System

Scheduled events are persisted in SQLite with due dates, event types, payloads, and processing state. Historical events record alternate football history with date, type, involved entities, title, data, importance, and scope.

Stage 1 processes scheduled events into historical events only. Later systems can expand the same event mechanism into transfers, media, relationships, notifications, finances, injuries, construction, elections, and fixture handling.

## Data Import Strategy

Research/import data is validated through Zod schemas with provenance:

- source URL
- source name
- last verified date
- confidence
- status

Allowed statuses are `VERIFIED`, `REPORTED`, `ESTIMATED`, `UNKNOWN`, and `SIMULATION_ONLY`. Stage 1 intentionally includes no real Nepal dataset.

Stage 2 dataset records use explicit fact wrappers for fields that may be unavailable or uncertain. `UNKNOWN` facts cannot carry a value. `VERIFIED`, `REPORTED`, and `ESTIMATED` facts must carry a value and remain distinguishable after import through entity provenance records. Real Nepal data belongs under `data/nepal/`, while automated tests use `data/fixtures/`.

## Competition and Match Simulation

Stage 3 adds a headless competition layer. Competition rule sets are dataset-driven and define season type, points, tiebreakers, home/away structure, round spacing, and promotion/relegation/continental slots. The engine supports deterministic single and double round-robin fixture generation.

Matches are event-based, not graphical. The minute engine produces shots, shots on target, goals, assists, saves, corners, fouls, cards, injuries, half-time/full-time events, xG, team stats, and player match states. Scores emerge from generated chances/events.

Headless commands:

- `pnpm match:simulate`
- `pnpm season:simulate`
- `pnpm years:simulate -- --years 10`
- `pnpm match:balance`

## Manager Career and Tactics

Stage 4 adds the first playable manager-career loop while preserving the non-graphical match direction. The UI presents manager commands and read models; React components do not calculate match probabilities and do not talk to SQLite directly.

The Stage 4 flow is:

UI
↓
manager commands
↓
simulation domain
↓
tactical context
↓
match engine
↓
events/result
↓
persistence
↓
UI read model

Manager careers extend the existing `Person` identity model through `CareerCharacter`, `ManagerProfile`, and `ManagerContract`. Tactical setups are saved as structured formations, slot assignments, role choices, team instructions, familiarity values, bench selections, and set-piece assignments. The match engine accepts tactical setup context for each team and applies modest trade-offs to control, chance creation, xG, defense, transition defense, fatigue, possession, and discipline.

The desktop app currently uses a testing-mode manager flow read model. Production save-backed desktop commands should bridge to the database package through Tauri/application services rather than importing SQLite into React.

Additional headless command:

- `pnpm tactics:balance`
