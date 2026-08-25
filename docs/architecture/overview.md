# Architecture Overview

## Goal

Stage 1 established the permanent technical foundation for a Nepal-first football world simulation game. Stage 2 adds the Nepal world import pipeline without hard-coding volatile real-world facts into application logic. The foundation supports long-running local saves, deterministic simulation, strict package boundaries, and future playable careers as manager, club owner/chairman, and federation chairman/president.

## Boundaries

- `apps/desktop` is a React/Tauri shell. It must not contain football simulation business logic, open save files, or hold authoritative game state.
- `packages/simulation` owns the headless world clock, deterministic random service, scheduled event execution, and future simulation services.
- `packages/database` owns SQLite connections, migrations, save metadata, repositories, and persistence.
- `packages/rules` owns football/business rules that should be shared by simulation and UI.
- `packages/shared-types` owns domain models, stable ID helpers, and the desktop application contract.
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

Allowed statuses are `VERIFIED`, `REPORTED`, `ESTIMATED`, `UNKNOWN`, and `SIMULATION_ONLY`.

Stage 2 dataset records use explicit fact wrappers for fields that may be unavailable or uncertain. `UNKNOWN` facts cannot carry a value. `VERIFIED`, `REPORTED`, and `ESTIMATED` facts must carry a value and remain distinguishable after import through entity provenance records. Real Nepal data belongs under `data/nepal/`, while automated tests use `data/fixtures/`.

The August 2026 Nepal registry is the first real-data staging dataset. It adds clubs, teams,
aliases, club/team hierarchy, women's branches, academy links, competition memberships, locations,
venues, venue relationships, basic travel context, and the researched 2026 National League player
workbook. Competition membership is stored outside club identity so NSL franchises, ANFA pyramid
clubs, National League entrants, and future divisional changes remain separate concepts.

Player import records reuse `Person` identity. `PlayerFactualProfile` keeps workbook identity,
position precision, source evidence, status, confidence, and factual coverage separate from generated
gameplay fields. Missing gameplay-critical fields such as exact position, height, foot, attributes,
potential, reputation, and hidden traits can be generated deterministically, but those generated
values must be stored as `SIMULATION_ONLY`.

The Nepal physical-world layer models province, district, city/municipality, neighbourhood, venue,
and airport records as import data. Venues carry field-level facts for type, capacity, surface,
altitude, ownership/operator text, status, and facilities. Relationships distinguish ownership,
operation, tenant use, temporary use, shared use, academy use, training use, and national-team use so
future chairman/federation infrastructure systems do not confuse a club using a ground with owning it.

Match simulation can receive venue/geography signals through `buildMatchEnvironmentFromVenue`, but
Stage 2 does not derive gameplay modifiers from those facts yet. Altitude, monsoon, heat, travel
fatigue, pitch deterioration, scheduling conflicts, and stadium projects should be implemented as
future systems that consume this data.

The football workforce layer extends the same import pipeline for staff, executives, federation
officials, national-team staff, referees, licences, staffing vacancies, and staff movement history.
It deliberately reuses `Person` for player-to-coach-to-official continuity. Missing roles are empty
or vacancy records, not fake people, and real August 2026 staff data remains outside application
logic until the research process supplies source-backed records.

The training and player-development layer is also dataset-backed. Training plans, individual
development plans, player development state, internal potential, playing-time snapshots, competition
development multipliers, staff simulation profiles, facility profiles, and sparse training history
events can be imported and persisted without hard-coding August 2026 claims. Internal potential,
player ratings, and staff training attributes are explicitly `SIMULATION_ONLY` game data, while
unavailable facility or competition values can remain `UNKNOWN`.

The youth and retirement layer keeps the world populated over long saves. Annual Nepal youth intake
events generate simulation-only `Person` records through club academies, ANFA/regional academies,
district football, grassroots pathways, departmental recruitment, free youth, and rare diaspora
eligibility hooks. Generated youth reuse existing attributes, potential, development, scouting,
contract, loan, registration, and transfer systems. Retirement ends the player role without deleting
the person, and a small seeded subset of retired players can continue as staff through the existing
workforce appointment model.

The club economy layer turns clubs into save-backed institutions without merging personal, club, and
future federation money. `ClubFinancialAccount` records club cash, restricted cash, receivables,
payables, debt, equity, season revenue/expenses, and financial health. Every club cash movement is
posted through `ClubLedgerEntry`, so balances remain auditable. Starting Nepal club economy values,
supporters, sponsorships, budgets, ownership models, facilities, assets, board policy, and valuations
are deterministic `SIMULATION_ONLY` gameplay data until research supplies source-backed figures.

Chairman/owner mode uses the same `Person` identity model as manager and staff careers.
`PersonalFinancialProfile` is separate from club accounts, and owner investment must be posted as an
explicit transaction before personal cash can become club cash. Departmental clubs such as Army,
Police, and APF use restricted ownership/economic models rather than private-company assumptions.
Infrastructure is project-based with planning/construction/completion states, capital costs, ongoing
costs, financing mixes, and eventual facility/asset effects; there is no generic instant `+1`
facility upgrade.

The federation governance layer makes ANFA a permanent playable institution without merging it with
club or personal authority. `FederationSimulationProfile` stores simulation-only governance,
development, commercial, infrastructure, and international ratings. `FederationFinancialAccount` and
`FederationLedgerEntry` keep federation money auditable and separate from club accounts and personal
wealth. Federation spending on clubs uses a posted federation debit plus a posted club grant credit;
federation funds never become a person's wallet.

Federation president mode reuses `Person`, `PersonRole`, staff appointments, and leadership tenure
records. The president can manage strategic budgets, competition policy, development strategy,
senior appointments, infrastructure, international strategy, and club support/licensing, but does not
control club tactics, club wage budgets, or personal finances. The seasonal federation cycle is:
financial close, strategy/budget review, competition-rule confirmation, club licensing, development
projects, national-team programme, season delivery, KPI review. AI federation processing uses the
same cycle when the player is not president.

The international football layer lets Nepal participate in a lightweight global national-team
ecosystem without building every domestic league or a complete FIFA database. Nepal's senior men's
team uses the real save-backed player pool, national-team callups, duty windows, cohesion, and the
existing match engine. External national teams use aggregate `InternationalTeamProfile` records with
country identity, confederation, region, simulation strength, reputation, development level, form, and
home-advantage values. These gameplay ratings are `SIMULATION_ONLY`; future researched data can
replace datasets without changing tournament logic.

International competitions are split into `InternationalCompetition`,
`InternationalCompetitionEdition`, edition-specific stages, participants, draw records, matches, and
qualification links. SAFF, Asian Cup qualification, the Asian Cup, AFC World Cup qualification, and a
lightweight world championship are represented by the same format engine rather than bespoke
tournament code. Draws are deterministic, use pots/seeding, and persist groups. External-vs-external
matches use a fast aggregate resolver, while Nepal matches use selected squads. Simulation world
rankings are internal gameplay rankings and must not be described as official FIFA rankings.

## Competition and Match Simulation

Stage 3 adds a headless competition layer. Competition rule sets are dataset-driven and define season type, points, tiebreakers, home/away structure, round spacing, and promotion/relegation/continental slots. The engine supports deterministic single and double round-robin fixture generation.

The Nepal pyramid layer keeps competition identity separate from season policy. Clubs move by creating
new `ClubMembership` records for the next competition season, while `CompetitionMovement` and
historical events preserve the promotion, relegation, qualification, suspension, or expansion decision
that caused the new membership. NSL is modeled as a `FRANCHISE_LEAGUE` with promotion and relegation
disabled; ANFA National League is modeled as a `SPECIAL_NATIONAL_LEAGUE` with qualification
membership rather than permanent tier identity.

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

The desktop app runs these flows against real SQLite career saves through `DesktopApplicationService`. React holds no game state and never opens the database.

Additional headless command:

- `pnpm tactics:balance`

## Training and Development

The player-development engine is deterministic, headless, and independent of React. It exposes:

- `simulateTrainingDay()`
- `simulateTrainingWeek()`
- `updatePlayerDevelopment()`

Development uses the existing 1-20 attribute groups rather than a single overall rating. Weekly
change is capped and derived from age phase, current ability, internal potential gap, plan load,
coaching, facilities, playing time, fitness, fatigue, recovery, morale, competition level, individual
focus, position/role training, and seeded variation. Position and role familiarity progress
gradually from numeric internal values to labels such as `UNFAMILIAR`, `BASIC`, `COMPETENT`,
`ACCOMPLISHED`, and `NATURAL`.

Training does not create injuries directly. It emits a `trainingInjuryRiskSignal` from load, fatigue,
recovery, and fitness so a future injury system can consume the signal. Training history is sparse
and records meaningful changes rather than every daily session.

Additional headless command:

- `pnpm development:simulate`

## Desktop Save Integration

`DesktopApplicationService` owns desktop careers end to end: it creates one SQLite save file per
career in the OS application data directory, imports the canonical Nepal world through
`importNepalWorld`, persists character/manager/tactic data, runs the real quick-sim and continue
flows, and rebuilds every read model from the saved database.

The UI reaches it through a managed Node sidecar that hosts the service on loopback. Tauri spawns
that sidecar and forwards a single `runtime_command`; Vite dev spawns the same sidecar and proxies
`/runtime/*`. Both paths run identical service code against identical save files, and there is no
mock fallback — an unreachable runtime surfaces as an error.

The desktop wire format lives in `packages/shared-types/src/desktop-contract.ts` and is imported by
both the service and the UI.

See `docs/architecture/desktop-save-integration.md`.
