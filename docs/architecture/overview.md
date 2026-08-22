# Architecture Overview

## Goal

Stage 1 establishes the permanent technical foundation for a Nepal-first football world simulation game. It is not a gameplay demo. The foundation supports long-running local saves, deterministic simulation, strict package boundaries, and future playable careers as manager, club owner/chairman, and federation chairman/president.

## Boundaries

- `apps/desktop` is a React/Tauri shell. It must not contain football simulation business logic.
- `packages/simulation` owns the headless world clock, deterministic random service, scheduled event execution, and future simulation services.
- `packages/database` owns SQLite connections, migrations, save metadata, repositories, and persistence.
- `packages/rules` owns football/business rules that should be shared by simulation and UI.
- `packages/shared-types` owns domain models and stable ID helpers.
- `packages/data-import` owns validation for researched datasets and provenance metadata.
- `packages/testing` owns cross-package integration tests and testing-only fixtures.

## Domain Model

The model starts with countries, locations, federations, clubs, teams, people, roles, competitions, fixtures, matches, contracts, transfers, loans, finance accounts, relationships, promises, scheduled events, and historical events.

`Person` is the common human identity. Player, manager, staff, agent, chairman, and federation official are modeled as roles attached to the same person. This preserves career continuity when a player retires into coaching, chairmanship, or federation work.

## Simulation Flow

The simulation package exposes a day-based clock:

- `advanceDay()`
- `advanceDays(n)`
- `simulateUntil(date)`

The clock persists the save world date through the database package. Scheduled events are processed when their due date is reached, and Stage 1 records them as historical events. Future systems can subscribe to or expand these events into news, finances, relationships, and statistics.

## Database Strategy

SQLite is the local save database. The database package owns schema migrations through `schema_migrations` and stores entities in relational tables rather than a single world JSON blob. JSON columns are used only for structured secondary data such as involved entity refs, event payloads, and import provenance.

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

Research/import data will be validated through Zod schemas with provenance:

- source URL
- source name
- last verified date
- confidence
- status

Allowed statuses are `VERIFIED`, `REPORTED`, `ESTIMATED`, `UNKNOWN`, and `SIMULATION_ONLY`. Stage 1 intentionally includes no real Nepal dataset.
