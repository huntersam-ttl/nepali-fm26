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

## ADR-014: Manager commands own tactical simulation input

Stage 4 routes manager decisions through simulation/application services instead of React components. Tactical setups are domain records containing formation slots, role assignments, instructions, familiarity, bench, and set-piece choices. The match engine consumes those records as context and applies bounded modifiers with trade-offs, so no tactical preset is a universal best choice.

## ADR-015: Flexible tactical slots before free-form visual editing

Preset formations are not labels only. They are stored as tactical slots with coordinates and zones. Custom formations use the same structure and validate duplicate slot IDs and coordinate bounds. Stage 4 does not yet ship a full drag editor, but the data model supports it.

## ADR-016: Stage 4 desktop uses a testing-mode read model (superseded by ADR-019)

Stage 4 shipped a desktop testing-mode manager flow because the Tauri shell had no save-command bridge. That mode has been removed; see ADR-019.

## ADR-017: Desktop commands are the persistence boundary

Stage 4.1 introduces a desktop bridge contract between React and save-backed application services. React may cache presentation state but the save remains source of truth. Manager actions such as career creation, tactic saving, quick sim, and continue flow are command calls that reload read models from persistence.

## ADR-018: Native desktop SQLite must sit behind the command/service boundary (revised by ADR-019)

Headless tooling continues to use the `node:sqlite` adapter in `packages/database`. ADR-019 resolves
the open production question by keeping that adapter authoritative on desktop too, rather than
introducing a second Rust SQLite implementation.

## ADR-019: The desktop runtime is a managed Node sidecar, not a Rust port

The engine, database layer, and every football system are TypeScript. Reimplementing them in Rust to
satisfy Tauri would duplicate the entire simulation and create two sources of football truth, which
is the failure mode ADR-018 was written to avoid. Instead, `DesktopApplicationService` stays
authoritative and runs in a Node sidecar that Tauri supervises.

The sidecar listens on loopback only, on an OS-assigned port, behind a token generated per launch,
and it exposes no game logic of its own — every route is a direct service call. Rust holds one
passthrough command and models no game payloads, so the typed contract in
`packages/shared-types/src/desktop-contract.ts` remains the only definition of the wire format.

The cost is that a packaged desktop build must ship a Node runtime alongside the Tauri binary. That
is a packaging concern with known solutions, and it is cheaper than maintaining a parallel Rust
simulation. If the engine is ever ported to Rust, the command contract is the seam that lets the
transport change without touching the UI.

## ADR-020: No mock persistence in desktop runtime paths

The desktop app previously fell back to a localStorage adapter with fabricated squads and fixtures
whenever it was not running under Tauri. Because the fallback was silent and the flows looked
correct, it hid the fact that the shipped UI was not connected to the engine while six major world
systems were built. Development mode now runs the same sidecar and the same SQLite saves as
production, and an unreachable runtime produces a visible `RUNTIME_UNAVAILABLE` error instead of a
plausible-looking fake world. Browser storage may hold UI preferences only, never career state.

## ADR-019: Club registry identity is separate from competition state

The Nepal club registry stores club identity, aliases, branches, academies, venue relationships, and
competition memberships as separate import records. Canonical external IDs from the staging registry
are preserved, but league/division membership is season-specific data rather than a permanent property
of the club. This keeps NSL franchises distinct from ANFA pyramid clubs and prevents future promotion,
relegation, or restructuring work from changing stable club identities.

## ADR-020: Pyramid progression is data-driven season policy

Promotion, relegation, qualification, expansion, and suspended movement are resolved from
competition-season rules plus competition relationship records. Slot counts and exceptional flags live
in data, not simulation constants, so federation-mode policy changes can later alter league size,
format, and movement rules without changing club identity or rewriting the engine.

## ADR-021: Nepal venues and geography are import data, not simulation constants

Stage 2 models Nepal's physical football world through importable datasets: provinces, districts,
cities, neighbourhoods, airports, venues, venue relationships, climate profiles, and basic travel
contexts. Volatile claims such as stadium capacity, surface, ownership, operator, venue condition,
club usage, and academy/training links stay in data with field-level provenance.

Venue relationships distinguish owner, operator, tenant, temporary user, shared user, training user,
academy user, and national-team user. This keeps government, federation, departmental, club,
academy, and franchise relationships from collapsing into one ambiguous "home ground" field.

The match engine may receive neutral venue/geography signals, but Stage 2 does not convert those
signals into altitude, heat, monsoon, pitch, travel, scheduling, or home-advantage modifiers. Those
systems should be added later as data consumers.

## ADR-022: Football workforce appointments reuse Person identity

Staff, executives, federation officials, national-team staff, and referees are modeled through
appointments linked to the existing `Person` table. A retired player who becomes a coach, a coach who
becomes technical director, or an executive who joins a federation committee keeps one person ID.

Staffing requirements are separate vacancy records, so missing real-world staff data does not force
fictional people into the August 2026 database. Staff licences, referee profiles, market-readiness
fields, and staff history events are separate factual records with provenance and are not inferred
from job title.

Player-controlled managers and NPC managers should converge on this same appointment architecture
where practical. Stage 4's existing manager profile and manager contract tables remain supported, but
future career work should avoid creating a parallel NPC-only employment system.

## ADR-023: Player development is save-backed and formula-driven

Training and player development are permanent simulation systems, not UI state and not a seasonal
`+1` shortcut. Stage 2 stores training plans, individual development plans, player development state,
internal potential, playing-time snapshots, staff training-effect profiles, facility hooks, and sparse
training history in SQLite behind `packages/database`.

The formulas consume configurable inputs: age curve, current attributes, potential gap, plan quality,
coaching, facilities, minutes, match sharpness, fitness, fatigue, recovery, morale, competition
context, workload, position or role focus, and seeded variation. Rate limits prevent runaway monthly
growth and position familiarity advances gradually. Older players can regress, especially physically.

Potential and staff simulation attributes are game abstractions and must be marked
`SIMULATION_ONLY`. Missing real Nepal data remains `UNKNOWN` or absent in datasets rather than being
invented in application code.

## ADR-024: Real player workbooks compile into canonical datasets

The 2026 Nepal National League player workbook is a source artifact, not a runtime dependency. Stage
2 transforms workbook sheets into canonical JSON under `data/nepal/2026-08/`; save creation,
validation, balancing diagnostics, and SQLite import consume that JSON.

Imported players reuse `Person` identity and attach source-backed details through
`PlayerFactualProfile`. Broad factual positions remain broad when the workbook only supports that
precision. Exact gameplay positions, attributes, potential, height, preferred foot, reputation, and
hidden traits may be generated by deterministic seeded services, but they must remain
`SIMULATION_ONLY` and auditable separately from `VERIFIED` or `REPORTED` facts.

## ADR-025: The first Nepal career loop is save-backed orchestration

The first multi-season Nepal career simulation reuses existing fixture generation, match simulation,
standings, player stats, development, and pyramid progression systems. It does not create a second
simulator. The headless loop initializes runnable competition seasons, reuses existing fixtures,
plays only unplayed scheduled fixtures, persists results/events/stats, completes seasons once,
records champions and simple awards, applies configured movement rules where runnable, creates next
seasons, and rolls completed seasons forward.

Daily detail is intentionally coarse in this stage. The deterministic processing order is:
fixture availability check, AI squad availability filtering, match simulation, result/event
persistence, injury and red-card suspension persistence, player and career stat accumulation,
standing/team stat refresh, season completion, development from actual minutes, champion/award
records, movement generation, next-season membership creation, and save world-date update.

Transfers, youth intake, and retirement are still absent. To keep long stress saves playable, next
season membership and team-person assignments are retained unless an existing movement rule changes a
club's competition membership. This is a temporary continuity policy, not a transfer model.

## ADR-026: Recruitment uses club knowledge, not omniscient player state

Stage 2 scouting introduces `PlayerKnowledge` as a separate save-backed view of a player from an
observer's perspective. Real simulation state, imported facts, generated attributes, potential, and
hidden traits remain in their existing player records. Clubs, managers, scouts, federations, and
national teams must reason through knowledge records with source type, confidence, discovery status,
observation dates, and bounded estimates.

Own squads start with high knowledge, but potential and hidden traits still surface as bands or
summaries rather than exact internal numbers. Public and same-league familiarity can reveal identity,
club, broad position group, and coarse form signals. Match observation and scouting assignments improve
knowledge over time, while stale knowledge decays. Search and reports therefore return ranges,
recommendations, and assessments instead of leaking exact current ability, potential, or hidden trait
values.

Recruitment profiles, scout simulation profiles, assignments, reports, and shortlist entries are
persistent domain records behind `packages/database`. They are marked `SIMULATION_ONLY` where they
model Nepal-calibrated game capability rather than researched fact. Transfers are deliberately out of
scope for this decision; AI clubs should later consume the same knowledge layer instead of bypassing it.

## ADR-027: Transfers consume knowledge and contracts, not hidden player truth

The first transfer market layer adds save-backed player contracts, club financial profiles,
employment models, transfer windows, agents, offers, negotiation rounds, loans, registrations, and
movement history. Real contract facts can be imported later, but generated starting contracts,
salaries, budgets, agent traits, and transfer-window dates are stored with `SIMULATION_ONLY`
provenance when researched data is unavailable.

AI clubs must use squad-need reports and `PlayerKnowledge` estimates when searching and offering.
Transfer search continues through the scouting API, so estimated ability ranges, public position
groups, confidence, and source labels are visible, while exact hidden ability, potential, and traits
remain internal simulation state.

Permanent transfers end active team assignments, terminate or expire old contracts, create new
contracts, update current club state, and preserve the same `Person` identity and career history.
Loans keep the parent contract and create temporary movement history separately. Competition
registrations are distinct from contracts so Nepal Super League temporary participation can coexist
with ANFA pyramid club belonging without a permanent club identity transfer.

This stage deliberately uses conservative AI frequency and Nepal-calibrated short/seasonal contract
lengths. Youth intake and a full economy remain separate future systems; long stress saves may expose
depth pressure once contracts, injuries, and movement all interact.

## ADR-028: Generated youth are simulation-only people with durable origins

Youth intake creates new `Person` records, not factual player imports. Every generated youth player is
marked through `GeneratedPlayerOrigin` with `originDataType = SIMULATION_ONLY`, a stable generation
key, origin pathway, academy/club/location links where applicable, youth status, national eligibility,
and a generated archetype. These players may use realistic Nepali name structures, but they are game
world identities and must never be presented as researched real people.

The Nepal starter youth calendar uses a configurable simulation-only annual intake date until
research supplies a better development calendar. Academy quality, national development environment,
grassroots reach, facilities, recruitment, coaching, and talent identification are also
simulation-only calibration values. Future federation or chairman systems can change those values
without rewriting player generation logic.

Generated players reuse the existing player attributes, potential, development state, scouting,
contract, registration, loan, and transfer systems. Parent clubs receive stronger knowledge of their
own academy products, while external clubs must discover them through the normal knowledge layer.
Youth participation is abstracted through academy/reserve/local activity records rather than a fake
full youth league pyramid.

Retirement preserves `Person` identity, contracts, career stats, and movement history. A player role
can end, the person remains in the database, and a seeded subset of retirees may later receive a staff
role and staff appointment using the existing workforce architecture. Goalkeepers receive a slightly
later retirement curve, while age, ability, contract status, position, professionalism, leadership,
and seeded variation affect decisions.

## ADR-029: Club economy is ledger-first and separate from personal wealth

Club money, personal wealth, and future federation finances must remain separate. A chairman or owner
can invest personal funds into a club only through an explicit owner-investment transaction, which
debits the personal profile and credits the club ledger. Club cash never becomes personal wallet cash
without a future lawful distribution transaction.

The club economy layer posts every club cash movement through `ClubLedgerEntry` before account
balances change. Starting Nepal club finances, supporters, sponsorships, facilities, ownership stakes,
budgets, valuations, and board policies are deterministic `SIMULATION_ONLY` game data because real
club financial accounts are not reliably sourced. Departmental clubs use restricted ownership models
and institutional-funding assumptions so Army, Police, and APF do not behave like buyable private
companies. Facility investment is project-based and time-based rather than an instant generic upgrade.

## ADR-030: Federation mode is a separate institutional authority

Federation president mode controls the national football system through ANFA's federation entity,
not through club ownership or personal wealth. Federation finances use their own account and ledger.
Any club support must be represented as two auditable entries: a federation debit and a club credit.
No federation transaction may credit a personal financial profile.

Federation gameplay changes future policy rather than rewriting history. Competition reforms are
stored as proposals with effective seasons and are applied through existing competition rule sets and
pyramid progression data. Played historical seasons are skipped. Development projects, youth
investment, coach education, referee development, national-team activity, commercial work, and
relationships produce gradual simulation-world effects through persistent profiles, KPIs, and annual
financial statements rather than instant one-off boosts.

## ADR-031: International football is Nepal-first with aggregate external teams

International football should make Nepal participate in a believable AFC/SAFF/global ecosystem
without requiring complete world domestic leagues, full external squads, or a complete FIFA database.
Nepal senior men's matches use the save-backed national-team player pool, callups, duty windows,
cohesion, and the existing event-based match engine. External national teams are represented by
lightweight aggregate profiles that can evolve through development, reputation, form, and results.

International competitions are edition-specific. A SAFF edition, Asian Cup qualification cycle, Asian
Cup, AFC World Cup qualification cycle, or world championship may each define different stages,
tiebreakers, squad sizes, hosts, pots, and advancement rules without mutating historical editions.
Draws, groups, matches, rankings, and final placements are persisted so 50-year saves can inspect
national-team history.

The simulation world ranking is an internal gameplay ranking, not an official FIFA ranking. Future
researched tournament formats or ranking formulas should be stored as data/provenance and can replace
the current `SIMULATION_ONLY` simplified rules without changing the package boundary.

## ADR-021: Manager mode exposes existing engines behind targeted read models

Manager gameplay adds no football logic. Every screen maps to a read model in
`packages/shared-types/src/manager-contract.ts` and a command that delegates to the existing
tactics, training, scouting, transfer, economy, and match engines. React may render, collect input,
and validate form shape; it may not decide transfer acceptance, compute ability, simulate matches,
calculate standings, or process scouting knowledge.

Authority is checked in the service, not implied by navigation. `assertManagerAuthority` gates every
command against the club on the manager's active contract, and returns `ROLE_NOT_AUTHORIZED`
otherwise. Ownership, board finance, and federation governance sit outside `ManagerPermission` so
that adding Chairman and Federation roles later cannot accidentally inherit manager access, or the
reverse.

Hidden player truth stays hidden: only banded `PlayerKnowledge`/`ScoutReport` values leave the
service for players outside the squad. Identity facts travel as `Fact<T>` with a provenance status,
so unknown real-world data renders as "Unknown" instead of being fabricated.
