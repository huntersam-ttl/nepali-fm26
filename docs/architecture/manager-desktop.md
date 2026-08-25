# Manager Desktop Gameplay

Manager mode is the first fully playable career role. Every screen reads from and writes to the
open SQLite career through `DesktopApplicationService`; React holds no game state.

## Screen / read-model map

| Screen         | Read model                                                         | Command                                                                                                         |
| -------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Home / Inbox   | `ManagerDashboard`, `CalendarEntry[]`                              | `getManagerDashboard`, `getCalendar`                                                                            |
| Squad          | `SquadList`                                                        | `getSquad`                                                                                                      |
| Player profile | `PlayerProfile`                                                    | `getPlayerProfile`                                                                                              |
| Tactics        | `TacticsView`                                                      | `getTactics`, `updateTactics`                                                                                   |
| Training       | `TrainingView`                                                     | `getTraining`, `updateTraining`                                                                                 |
| Fixtures       | `FixtureList`, `FixtureDetail`                                     | `getFixtures`, `getFixture`                                                                                     |
| Match result   | `QuickSimSummary`                                                  | `quickSimMatch`, `getMatchSummary`                                                                              |
| Competition    | `ManagerCompetitionView`                                           | `getCompetition`                                                                                                |
| Scouting       | `ScoutingDashboard`, `RecruitmentSearchPage`, `ScoutingReportView` | `getScoutingDashboard`, `searchRecruitment`, `createScoutingAssignment`, `getScoutingReport`, `toggleShortlist` |
| Transfers      | `TransferCentre`                                                   | `getTransferCentre`, `makeTransferOffer`, `respondTransferOffer`, `setTransferStatus`                           |
| Contracts      | `ContractList`                                                     | `getContracts`, `renewContract`                                                                                 |
| Staff          | `StaffList`                                                        | `getStaff`                                                                                                      |

Types live in `packages/shared-types/src/manager-contract.ts`, which is additive to
`desktop-contract.ts`. Implementations live in `packages/simulation/src/manager-desktop.ts`; the
service class holds only thin delegations. No raw database row ever reaches React.

## Reused engines

Manager mode exposes existing systems and adds no football logic of its own:

- Tactics, roles, styles, role fit and selection validation — `tactics.ts` (6 formations, 26 roles,
  9 styles) and `team-selection.ts`.
- Training and development — `player-development.ts` (`createDefaultTrainingPlan`,
  `simulateTrainingDay`).
- Scouting, knowledge and shortlists — `scouting.ts`.
- Transfers, contracts and loans — `transfer-market.ts`.
- Budgets — `club-economy.ts`.
- Matches — `manager-flow.ts` quick sim and the existing match engine.

## Permission boundaries

`assertManagerAuthority` runs at the top of every manager command. A manager may only act for the
club named on their active contract; passing another club's id returns `ROLE_NOT_AUTHORIZED`, as
does responding to an offer for a player they do not own. Club ownership, board finance, and
federation governance are outside `ManagerPermission` and stay unavailable to Manager mode
(ADR-021). The transfer budget is read from the club's board allocation and an offer above it is
refused — the manager spends an allowance, not the club's cash.

## Hidden information

Only `PlayerKnowledge` and `ScoutReport` cross the boundary for players outside the squad, so
estimates are banded and decay with time. `currentAbility` and `potentialAbility` are never sent to
the client, and even an own player's potential is shown as a band. Undiscovered players appear
without a name.

## Provenance

`Fact<T>` carries a `ProvenanceStatus` alongside each identity value. Missing facts render as
"Unknown"; simulated values render with a `sim` tag. Most imported Nepal players have no factual
date of birth, so ages read Unknown rather than being invented. Gameplay attributes are always
`SIMULATION_ONLY`.

## Continue

`advanceManagerCareer` steps one day at a time, running `simulateScoutingDay` and the daily training
model, and stops at the first meaningful event: next fixture, scout report, transfer response, or
contract expiry. It returns a `ContinueStopReason` that becomes the inbox entry. This is an
event-priority wrapper over existing schedulers, not a new world simulation.

## Session warm-up

Recruitment, transfer, economy and training records are created on demand the first time a career is
opened (`warmManagerSystems`), because the imported registry ships none of them. It costs a few
seconds and runs while the career is opening, so gameplay screens stay responsive afterwards. Each
underlying initialiser is idempotent, so older saves pick the systems up on load.

## Known data limits

- The registry ships no staff, so the Staff screen is an honest empty state; the game does not
  invent coaches.
- Club home grounds are not in the venue data, so fixture venues read Unknown.
- The match engine records season aggregates, not per-match player ratings, so the post-match
  ratings list is empty.
