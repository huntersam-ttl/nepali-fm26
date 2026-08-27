# Nepal Football Universe — Feature Completion Audit

## Audit Basis

- **HEAD:** `205f25c` (`fix: close domestic winner-required match resolution`), clean working tree.
  Auditing began at `f065738`; HEAD advanced twice during the pass (`6eb1784` added a first-pass
  audit, `205f25c` landed the domestic winner-required wiring). Every finding below was re-verified
  against `205f25c`, and the winner-required section was revised downward accordingly.
- **Date:** 2026-08-27.
- **Method:** direct inspection of the repository as the sole authority — module exports, call-site
  reachability from the running world loops (`career-world.ts`, `desktop-application.ts`), database
  schema (`packages/database/src/migrations.ts`, 59 versions), and the shipped world dataset
  (`data/nepal/2026-08/club-registry.json`) parsed for real coverage counts. Commit messages were
  **not** treated as evidence.
- **Key discriminator used throughout:** a module is only BUILT if it is both implemented _and_
  reachable from a real save. Several subsystems are fully implemented and unit-tested but have
  **zero production call sites** — they are graded PARTIAL and called out explicitly, because a
  player never experiences them.

### Limitations

- The master design document _"Nepal Football Universe — Complete Game Design & Step-by-Step Build
  Plan"_ is **not present in the repository** (`docs/game-design/README.md` is a 3-line placeholder)
  and was not supplied through project context. The audit is therefore structured against the
  feature areas enumerated in the audit request plus the implementation surface actually present.
  **Any design requirement that exists only in that document and has no corresponding code or naming
  in the repo cannot be verified here and is not represented below.**
- Grading covers gameplay reachability, not balance quality. No balancing judgement is made.
- Test suites were used as corroboration of intent, never as proof of BUILT status.

---

## Executive Summary

| Status                    | Count |
| ------------------------- | ----- |
| **BUILT**                 | 37    |
| **PARTIAL**               | 33    |
| **MISSING**               | 11    |
| **DELIBERATELY_LATER**    | 3     |
| **Total systems audited** | 84    |

The engine layer is in far better shape than the _wiring_ layer. The dominant failure mode across
this codebase is not missing logic — it is **implemented, tested subsystems that nothing calls**.
Twelve separate systems (media, licensing, macroeconomy, territorial structure, supporter culture,
federation elections, commercial rights, media rights, competition distribution, club creation,
referee development, insurance/camps) are complete services with test coverage and no production
entry point.

The second theme is **real-data coverage**: the world ships 573 real players concentrated in the top
tier, 2 real staff, and 0 real referees.

---

## Critical Pre-Feature-Freeze Gaps

These block feature freeze. Everything else is either shipped or safely deferrable.

1. **Multi-season career runs crash.** `UNIQUE constraint failed: training_history_events.id` is
   thrown from `developPlayers` (`packages/simulation/src/career-world.ts:1242`) during
   `simulateNepalCareer`. Re-run at `205f25c` during this pass: still fails, and it predates the
   supporter and workforce phases (also reproduced at `42e4fb5`). It fails 5 tests across
   `stage-six-career-world.test.ts` (2) and `stage-nine-youth-retirement.test.ts` (3). Long-save continuity
   cannot be validated end-to-end while this stands. **Not fixed in this audit — audit only.**
2. **Supporter world is unreachable.** `initializeSupporterCultureForSave` has no call site outside
   its own test file, so no save ever has supporter profiles. Attendance silently falls back to the
   legacy formula and the board-pressure hook contributes zero. An entire shipped phase is dark.
3. **Referees do not exist in matches.** No `refereeId` on any fixture or match, no assignment code
   anywhere, and the shipped dataset has 0 referee records. The match engine's `refereeStrictness`
   is an abstract constant, not an official.
4. **Universal interaction execution stops at transfers.** Only `TRANSFER_OFFER` / `TRANSFER_DEAL`
   reach an authoritative write; contracts, staff contracts, board requests, facility requests,
   federation grants, government and commercial sessions all terminate at
   `execution.status: "PENDING"` and never mutate their domain.
5. **Women's football has no competition and no players.** 10 women's teams exist with 0 squads, no
   `WOMENS_LEAGUE` competition in the dataset, and no women's national team in the international
   pipeline.
6. **Real B/C-division and staff coverage is effectively absent.** B Division: 2 of 14 clubs have
   players. C Division and Nepal Super League: 0 of 14 and 0 of 9. Club staff: 0.
7. **Chairman and federation-president careers are not playable.** The desktop command surface is
   manager-only; ownership and federation exist as services with no career loop.
8. **Macroeconomy never advances.** `advanceMacroEconomy` has no call site, so every macro reader
   falls back to a neutral 1.0 for the life of a save.

---

## System-by-System Audit

### Core world state and persistent entities

Status: **BUILT**

Implemented:

- Entity graph, repositories and indexed access: `packages/database/src/repositories.ts`,
  `packages/database/src/connection.ts`, `packages/simulation/src/world.ts`.
- 59 forward migrations with a pinned `CURRENT_DATABASE_VERSION`:
  `packages/database/src/migrations.ts`.

Missing: nothing blocking.

Dependencies: everything.

Feature-freeze blocker: **NO**

---

### Deterministic RNG

Status: **BUILT**

Implemented:

- Seeded LCG with snapshot/restore for mid-match resume: `packages/simulation/src/rng.ts`.
- Stable identity derivation (`createStableEntityId`) in `packages/shared-types/src/ids.ts`.
- Every generation path audited (youth, officials, matches, economy) derives its seed from save seed
  plus world state; no wall-clock randomness found in simulation code.

Missing: nothing.

Dependencies: all simulation.

Feature-freeze blocker: **NO**

---

### Calendar and time

Status: **BUILT**

Implemented: `packages/simulation/src/clock.ts`, `packages/simulation/src/season-engine.ts`,
season lifecycle states and rollover in `packages/simulation/src/career-world.ts`.

Missing: nothing blocking.

Dependencies: fixtures, economy cadence, workforce cadence.

Feature-freeze blocker: **NO**

---

### Save / load, autosaves, schema compatibility

Status: **BUILT**

Implemented:

- Save creation/load/version pinning: `packages/database/src/save-system.ts`.
- Rotating autosave slots with atomic writes: `packages/simulation/src/save-management.ts`
  (`listAutosaveSlots`, `autosaveDirectory`), surfaced as `getAutosaveStatus` / `loadAutosaveSlot`
  in `packages/simulation/src/desktop-application.ts`.
- Save-as / delete / reload continuation commands present on the application surface.

Missing: nothing blocking.

Dependencies: all persistent systems.

Feature-freeze blocker: **NO**

---

### History (event log and dynamic history)

Status: **PARTIAL**

Implemented:

- `HistoricalEvent` log written from 11 production sites (transfers, retirements, youth intake,
  commercial awards, competition outcomes) via `EventRepository.insertHistoricalEvent`.
- International history read model: `getNationalTeamHistory`
  (`packages/simulation/src/international-football.ts:827`).

Missing:

- No club history or national domestic history read model — nothing aggregates a club's honours,
  record attendances, or era narrative.
- No dynamic-history layer: events are stored but never promoted into milestones, records or
  narrative beyond the international module.

Dependencies: media, awards, legends, supporter world.

Feature-freeze blocker: **NO** (data is captured; presentation layer can follow)

---

### Character creation

Status: **BUILT**

Implemented: `CareerCharacter` with playing/coaching/education/business background
(`packages/shared-types/src/domain.ts:493`), `createCareer` and `listStartingClubs`
(`packages/simulation/src/desktop-application.ts:329,337`).

Missing: nothing blocking for the manager path.

Dependencies: career identity, manager career.

Feature-freeze blocker: **NO**

---

### Manager career

Status: **BUILT**

Implemented:

- Contracts, vacancies, applications, offers, sack and resign:
  `packages/simulation/src/manager-career.ts`, `packages/simulation/src/manager-career-world.ts`.
- Board confidence evaluation with expectation tertiles and minimum-tenure protection
  (`evaluateBoardConfidence`), wired into the world tick.
- Full desktop command surface: job centre, apply, accept/decline, resign, career history.

Missing: nothing blocking.

Dependencies: clubs, competitions, board, staff.

Feature-freeze blocker: **NO**

---

### Manager interviews

Status: **MISSING**

Implemented: nothing. Applications resolve immediately into offered/rejected — the code comment at
`packages/simulation/src/manager-career-world.ts:447` states this explicitly.

Missing: any interview stage, questions, tactical-vision answers, or interview-influenced hiring.

Dependencies: manager career, universal interactions (would be the natural host).

Feature-freeze blocker: **NO** (career loop functions without it) — but it is a named design feature
with zero implementation, so it must be an explicit scope decision rather than an oversight.

---

### Chairman / owner career

Status: **PARTIAL**

Implemented:

- Ownership stakes, valuation, acquisition enquiry/offer/counter/decide/withdraw:
  `packages/simulation/src/ownership.ts`, `packages/database/src/ownership-repository.ts`.
- Investor and personal-wealth modelling: `packages/simulation/src/investor.ts`.
- Chairman permission vocabulary and a scaffolding entry point: `chairmanPermissions` and
  `runChairmanDemo` (`packages/simulation/src/club-economy.ts:1116,1205`).

Missing:

- No playable chairman loop. The application command surface
  (`packages/simulation/src/desktop-application.ts`) exposes manager commands only — there is no
  budget-setting, hiring-the-manager, infrastructure-approval or strategic-decision command path for
  a human chairman.
- `runChairmanDemo` is a demo constructor, not a career mode.

Dependencies: club economy, board, infrastructure, universal interactions.

Feature-freeze blocker: **YES** if chairman is an intended launch career; NO if deferred.

---

### Federation-president career

Status: **PARTIAL**

Implemented:

- Election cycles, candidate generation, voting, manifestos, coalition confidence and leadership
  transition: `packages/simulation/src/federation-politics.ts`.
- Governance proposals with review/decide/implement lifecycle (same file).
- Deep federation service layer: `packages/simulation/src/federation-governance.ts` (2407 lines).

Missing:

- `advanceFederationElections` and `transitionFederationLeadership` have **no production call
  sites** — elections never actually run in a save.
- No playable federation command surface.

Dependencies: federation governance, government, national teams.

Feature-freeze blocker: **YES** if federation president is an intended launch career.

---

### Role transitions, authority and permissions

Status: **PARTIAL**

Implemented:

- Career opportunity gating by reputation dimension: `careerOpportunities`
  (`packages/simulation/src/career-identity.ts`).
- Role activation/retirement helpers (`activateCareerRole`, `retireCareerRole`, `retireCareer`).
- Per-role authority checks on interaction opening
  (`packages/simulation/src/universal-interaction-adapters.ts`, `authority` map).

Missing: no runtime path that actually switches the played role — the opportunity list is computed
but nothing consumes it to change the active career.

Dependencies: chairman career, federation career.

Feature-freeze blocker: **YES** if multi-role careers ship.

---

### Career reputation and history

Status: **BUILT**

Implemented: four reputation dimensions, milestones with idempotent ids, legacy counters, inactivity
decay — `packages/simulation/src/career-identity.ts`,
`packages/database/src/career-identity-repository.ts`.

Missing: nothing blocking.

Dependencies: career identity, awards.

Feature-freeze blocker: **NO**

---

### Core match engine

Status: **BUILT**

Implemented: `packages/simulation/src/match-engine.ts` (1329 lines) — possession, chance creation,
ratings, cards, injuries, substitutions, fatigue, environment modifiers.

Missing: nothing blocking.

Dependencies: tactics, team selection, fixtures.

Feature-freeze blocker: **NO**

---

### Quick sim, key events, text live

Status: **BUILT**

Implemented: `MatchViewMode` (`QUICK_SIM | KEY_EVENTS | TEXT_LIVE`) in
`packages/shared-types/src/domain.ts:3676`; session state machine in
`packages/simulation/src/match-session.ts`; matchday orchestration in
`packages/simulation/src/manager-matchday.ts`; UI in
`apps/desktop/src/manager/matchday/`.

Missing: nothing blocking.

Dependencies: match engine.

Feature-freeze blocker: **NO**

---

### Career default match-view wiring

Status: **PARTIAL**

Implemented: view mode is chosen per match — `startMatch` defaults to `TEXT_LIVE`
(`packages/simulation/src/desktop-application.ts:1265`) and the pre-match panel defaults the same
(`apps/desktop/src/manager/matchday/PreMatchPanel.tsx:37`).

Missing: there is **no persisted career-level default match view**. A search for
`defaultMatchView` / `matchViewPreference` / any save-scoped preference store returns nothing, so
the player re-picks their view every match and the choice never survives reload.

Dependencies: save/load, matchday.

Feature-freeze blocker: **NO** (convenience gap, small surface)

---

### Stoppage time, extra time, penalties, aggregates

Status: **BUILT**

Implemented, all in `packages/simulation/src/match-engine.ts`:

- Deterministic stoppage time from actual in-half stoppage events (`computeStoppageTime`, line 524).
- Extra time triggered on level aggregate (`needsExtraTime`, line 546).
- Penalty shootout with **per-kick records** (`PenaltyKick[]`), best-of-five then sudden death,
  cycling takers (`resolveShootout`, line 568). Resolved atomically rather than interactively —
  the per-kick detail exists as data, not as a per-kick UI step.
- Two-leg aggregate framing including first-leg goals (`effectiveAggregateScore`, line 539).

Missing: interactive per-kick shootout presentation only — data model already supports it.

Dependencies: competition rules.

Feature-freeze blocker: **NO**

---

### Domestic "match requires winner" wiring

Status: **PARTIAL**

_Revised at `205f25c`: the wiring gap this audit originally recorded was closed mid-pass by the
concurrent winner-required fix. Two of the three breaks are gone; one remains._

Implemented:

- The engine honours `requiresWinner` for extra time, shootout and `winnerTeamId`
  (`packages/simulation/src/match-engine.ts:501,547,553`), with configurable resolution —
  `WinnerResolution` (`EXTRA_TIME_THEN_PENALTIES` | `DIRECT_PENALTIES`) plus `allowExtraTime` /
  `allowPenalties` overrides.
- **The season simulator now passes it.** `career-world.ts:447` sets
  `requiresWinner: Boolean(input.ruleSet.matchesRequireWinner && (!fixture.tieId || fixture.leg === 2))`,
  correctly deferring resolution to the second leg of a two-leg tie, and supplies
  `aggregateFirstLeg` so aggregate scores frame properly.
- A hard guard rejects a silent non-resolution: a winner-required fixture that finishes without a
  winner throws (`career-world.ts:659`).
- The interactive and session paths apply the same rule
  (`packages/simulation/src/desktop-application.ts:2642`,
  `packages/simulation/src/match-session.ts:195`).
- `winnerResolution`, `allowExtraTime` and `allowPenalties` round-trip through
  `competition_rules.special_rules_json` (`packages/database/src/repositories.ts`).

Missing — one break remains:

- `matchesRequireWinner` itself is still **not persisted**: there is no `matches_require_winner`
  column in `packages/database/src/migrations.ts` (0 matches), and unlike its sibling resolution
  fields it is not carried in `special_rules_json`. It therefore cannot survive a save/reload.
- It is still **never set** by any competition rule data or rule-set constructor — no occurrence
  exists anywhere under `data/` or `packages/data-import/src/`.
- Net effect: the resolution machinery is now correct and reachable, but the flag that switches it
  on is always false in a real save, so no domestic fixture actually requires a winner yet.

Dependencies: competition rules, pyramid, cups.

Feature-freeze blocker: **NO** (downgraded from YES) — the hard wiring is closed; what remains is
persisting and populating one boolean.

---

### Fixture integration

Status: **BUILT**

Implemented: `packages/simulation/src/fixture-generation.ts`, fixture persistence and round
progression in `packages/simulation/src/career-world.ts`, standings in
`packages/simulation/src/standings.ts`.

Missing: nothing blocking.

Dependencies: competitions, pyramid.

Feature-freeze blocker: **NO**

---

### Referee integration into matches

Status: **MISSING**

Implemented: only an abstract environment scalar `refereeStrictness`
(`packages/simulation/src/match-engine.ts:46,57,1086`).

Missing:

- No `referee_id` column on `fixtures` or `matches`, and no `assignReferee` / `matchOfficial`
  symbol anywhere in the repository.
- No neutrality, workload or appointment logic connecting the officiating population (which the
  workforce layer now generates) to actual fixtures.
- VAR is never consulted by the engine (`varMatchContext` has no production call site).

Dependencies: referee supply (built), fixtures, federation referee development.

Feature-freeze blocker: **YES**

---

### Tactics, squad selection, training, player development

Status: **BUILT**

Implemented: `packages/simulation/src/tactics.ts`, `packages/simulation/src/team-selection.ts`,
`packages/simulation/src/player-development.ts`,
`packages/simulation/src/player-development-plans.ts`; full desktop commands (`getTactics`,
`updateTactics`, `getTraining`, `updateTraining`, `getPlayerDevelopment`,
`createPlayerDevelopmentPlan`) and screens under `apps/desktop/src/manager/screens/`.

Missing: nothing blocking.

Dependencies: match engine, medical.

Feature-freeze blocker: **NO**

---

### Scouting

Status: **BUILT**

Implemented: `packages/simulation/src/scouting.ts` (926 lines) with knowledge accumulation,
assignments, reports, shortlists and recruitment search; `simulateScoutingDay` runs inside the match
loop (`career-world.ts`); generated players enter the knowledge system on creation
(`seedOwnClubKnowledge` in `youth-intake.ts`).

Missing: nothing blocking.

Dependencies: player world, transfers.

Feature-freeze blocker: **NO**

---

### Transfers and contracts

Status: **BUILT**

Implemented: `packages/simulation/src/transfer-market.ts` (2550 lines) — offers, counters, loans,
transfer requests, personal terms, completion, plus `simulateTransferWindow` wired into the season
rollover. Contract renewal and expiry surfaced through desktop commands.

Missing: nothing blocking.

Dependencies: economy, scouting, AI.

Feature-freeze blocker: **NO**

---

### Staff market, contracts and licences

Status: **BUILT**

Implemented: `packages/simulation/src/staff-market.ts` (1599 lines) — vacancies, applications,
hiring, dismissal, renewals, poaching, responsibilities, workload, development plans, succession
planning, and the licence course pipeline (`enrolInLicenceCourse`, `evaluateLicenceCourses`) which
reuses the existing licence-rank model rather than a parallel certification scheme.

Missing: nothing blocking for the manager career.

Dependencies: club economy, workforce supply.

Feature-freeze blocker: **NO**

---

### Player concerns, promises and squad meetings

Status: **BUILT**

Implemented: `packages/simulation/src/squad-dynamics.ts` (1238 lines); desktop commands
`getSquadConcerns`, `respondToConcern`, `holdSquadMeeting`; dedicated suites
(`squad-dynamics-concerns` behaviour covered across `squad-dynamics*.test.ts`).

Missing: nothing blocking.

Dependencies: universal interactions, supporter world.

Feature-freeze blocker: **NO**

---

### Universal interaction sessions

Status: **BUILT**

Implemented: session lifecycle, stages, available-action validation and persistence —
`packages/simulation/src/universal-interactions.ts`,
`packages/database/src/universal-interactions-repository.ts`,
`packages/shared-types/src/universal-interactions.ts`. 18 registered adapter types with per-role
authority gating in `packages/simulation/src/universal-interaction-adapters.ts`.

Missing: nothing at the session layer.

Dependencies: all negotiation domains.

Feature-freeze blocker: **NO**

---

### Universal interaction authoritative execution

Status: **PARTIAL**

Implemented: full execute-and-verify path for transfers in `submitInteractionAction`
(`packages/simulation/src/universal-interaction-adapters.ts`) — accepts, calls
`completePermanentTransfer`, re-reads the offer to confirm `COMPLETED`, marks `execution.status:
"APPLIED"`, and rolls the session to `CANCELLED` with a `FAILED` execution on error. Idempotency key
per session prevents double application.

Missing:

- Every non-transfer linked domain returns early with `execution: { status: "PENDING" }` and
  performs **no domain write**. That covers `CONTRACT` / `CONTRACT_NEGOTIATION` (`player_contracts`),
  `STAFF_CONTRACT`, `PLAYER_PROMISE`, `PLAYER_CONCERN`, `BOARD_REQUEST`, `FACILITY_REQUEST`,
  `INFRASTRUCTURE_PROJECT`, `FEDERATION_GRANT`, `FEDERATION_FUNDING`, `FEDERATION_PROJECT`,
  `FEDERATION_CORRECTIVE_ACTION`, `COMMERCIAL_DEAL`, `GOVERNMENT_SUPPORT`, `JOB_SECURITY`.
- Accepting any of those sessions is therefore cosmetic — the agreed outcome never happens.

Dependencies: contracts, staff, board, infrastructure, federation, government, commercial.

Feature-freeze blocker: **YES**

---

### Club economy, budgets, wages

Status: **BUILT**

Implemented: `packages/simulation/src/club-economy.ts` (1676 lines) — accounts, budgets with
reserve floors, ledger with idempotency keys, payroll, matchday revenue, prize money
(`prizeAmount` → `PRIZE_MONEY`, line 1036), financial statements, valuation, affordability gates.
`processClubEconomyMonth` and `processEconomyForSeasonPeriod` run in the world loop.

Missing: nothing blocking.

Dependencies: macroeconomy, supporter attendance, commercial.

Feature-freeze blocker: **NO**

---

### Infrastructure and construction lifecycle

Status: **BUILT**

Implemented: project creation, monthly advancement and cancellation
(`createInfrastructureProject`, `advanceInfrastructureProjects`, `cancelInfrastructureProject` in
`packages/simulation/src/club-economy.ts:469,530,599`), with `advanceInfrastructureProjects`
invoked from the monthly economy tick (line 911). Facility profiles feed youth and staff quality.

Missing: nothing blocking.

Dependencies: club economy, youth intake.

Feature-freeze blocker: **NO**

---

### Sponsorship and commercial (club)

Status: **BUILT**

Implemented: sponsor offer generation, acceptance, expiry, merchandise, memberships, preseason
commercial camps — `packages/simulation/src/club-economy.ts`,
`packages/simulation/src/clubmart.ts`; exercised by the season economy period.

Missing: nothing blocking.

Dependencies: supporter reach (currently dark), reputation.

Feature-freeze blocker: **NO**

---

### Club creation and new clubs

Status: **PARTIAL**

Implemented: `packages/simulation/src/club-creation.ts` — `createSimulationClub`,
`admitSimulationClub`, `evaluateSimulationClubSurvival`, `considerSimulationClubAdmissions`,
`reviveSimulationClub`, with supporter-profile seeding and survival evaluation.

Missing: **no production call sites** — the only references outside the module are
`club-creation-phase-a/b.test.ts`. New clubs never appear, fail, or are admitted in a real save.

Dependencies: pyramid, licensing, workforce supply.

Feature-freeze blocker: **NO**

---

### Takeover / ownership lifecycle

Status: **PARTIAL**

Implemented: valuation and the full offer negotiation chain
(`packages/simulation/src/ownership.ts`), ownership stakes and models in club economy.

Missing: no lifecycle over time — owners never age, exit, die, or lose interest, and no AI initiates
takeovers in the world loop.

Dependencies: ownership succession, board.

Feature-freeze blocker: **NO**

---

### Ownership succession

Status: **MISSING**

Implemented: nothing. Searches for succession / inheritance / owner-exit logic across
`ownership.ts`, `club-economy.ts` and `investor.ts` return no matches.

Missing: over a 20–50 season save, `club_board_policies.chairman_person_id` points at a person who
ages indefinitely and is never replaced. There is no domestic-businessperson pool, no director
promotion, and no consortium succession.

Dependencies: workforce supply, ownership, board.

Feature-freeze blocker: **YES** for long-save validity.

---

### Board pressure

Status: **BUILT**

Implemented: `evaluateBoardConfidence` with expectation-vs-position deltas, minimum tenure before
sacking, and per-contract confidence baselines
(`packages/simulation/src/manager-career-world.ts:256`); runs in the world tick.

Missing: nothing blocking.

Dependencies: supporter world (contributes a small modifier), club economy.

Feature-freeze blocker: **NO**

---

### Federation governance and federation economy

Status: **BUILT**

Implemented: `packages/simulation/src/federation-governance.ts` (2407 lines) — federation accounts,
ledger, sponsorships, committees, development profile, budgets. `processFederationMonth` runs for
all 12 months of every simulated season via `processFederationForSeasonPeriod`
(`career-world.ts:305,388`), and the financial season is closed at season end.

Missing: nothing blocking.

Dependencies: government, compliance, competitions.

Feature-freeze blocker: **NO**

---

### Federation compliance, sanctions and reinstatement

Status: **BUILT**

Implemented: `packages/simulation/src/federation-compliance.ts` plus
`packages/database/src/federation-compliance-repository.ts` (307 lines). Sanctions demonstrably
bite — the monthly federation tick checks `activeSanctionsForFederation` and blocks recurring
funding inflow rather than recording a paper penalty
(`federation-governance.ts:998-999`). `runFederationComplianceAiForAllFederations` runs monthly.

Missing: nothing blocking.

Dependencies: federation governance, grants.

Feature-freeze blocker: **NO**

---

### Grants, restricted funds, government / NSC relationship

Status: **PARTIAL**

Implemented: grant and restricted-fund modelling inside federation governance;
`packages/simulation/src/government.ts` with `evaluateGovernmentFunding` (pure, tested),
`proposeGovernmentFunding`, `submitGovernmentFunding`, `reviewGovernmentFunding`;
`packages/database/src/government-repository.ts`.

Missing: the application lifecycle has **no production caller** — `proposeGovernmentFunding` has
zero call sites, so no government funding is ever requested or granted in a live save.

Dependencies: federation economy, infrastructure, territorial development.

Feature-freeze blocker: **NO**

---

### Federation elections

Status: **PARTIAL**

Implemented: full cycle in `packages/simulation/src/federation-politics.ts` — cycle creation,
deterministic candidate generation, election execution, manifesto tracking, coalition confidence.

Missing: `advanceFederationElections` has **no production call site**. Elections never occur; a
federation president holds office forever.

Dependencies: federation-president career, personnel succession.

Feature-freeze blocker: **YES** for long-save validity.

---

### Federation personnel succession

Status: **MISSING**

Implemented: `transitionFederationLeadership` exists in `federation-politics.ts`.

Missing: it has no caller, and there is no ageing/retirement path for federation officials,
committee members or technical staff. Required officials can only disappear, never be replaced.

Dependencies: federation elections, workforce supply.

Feature-freeze blocker: **YES** for long-save validity.

---

### Commercial rights and broadcasting (federation)

Status: **PARTIAL**

Implemented: rights packages, sponsor profiles, offers with sector-exclusivity conflict detection,
and an award path that posts a real federation ledger credit and a historical event —
`packages/simulation/src/commercial-rights.ts`, `packages/simulation/src/media-rights.ts`,
`packages/database/src/commercial-rights-repository.ts`.

Missing: `awardCommercialRights` and `postCompetitionMediaRights` have **no production call sites**.
Federation broadcast/commercial income in a live save comes only from the simpler sponsorship rows
in `processFederationMonth`; the rights engine never runs.

Dependencies: federation economy, competitions.

Feature-freeze blocker: **NO**

---

### Prize money and revenue sharing

Status: **PARTIAL**

Implemented (working path): position-based prize/distribution posting in
`packages/simulation/src/club-economy.ts:1036-1041`, reached through the season economy period.

Implemented (unreached path): the full policy engine —
`packages/simulation/src/competition-distribution.ts` with champion/runner-up/placement/
participation/equal-share/performance/audience components plus youth, women's and infrastructure
incentives, affordability checks and dual-ledger payments.

Missing: `applyCompetitionDistribution` has no production caller, so the incentive-based
distribution model — including its women's-football and youth incentives — never affects a save.

Dependencies: federation economy, club economy, competitions.

Feature-freeze blocker: **NO**

---

### Referee development (federation)

Status: **PARTIAL**

Implemented: development pathways, VAR programme lifecycle with readiness gating, and quality
progression — `packages/simulation/src/referee-development.ts`,
`packages/database/src/referee-development-repository.ts`. Federation governance creates referee
programmes with a `refereesAdvanced` counter (`federation-governance.ts:883-911`, `refereesAdvanced` at line 897).

Missing:

- `advanceRefereeDevelopment` and `progressRefereeProgramme` have **no production call sites**.
- The federation's `refereesAdvanced` is an abstract counter that does not touch any referee entity.
- The new officiating population (`workforce-supply.ts`) reads the federation's
  `referee_development` score but the two systems are otherwise disconnected.

Dependencies: referee supply (built), referee assignment (missing).

Feature-freeze blocker: **NO**

---

### Insurance, welfare and training camps

Status: **PARTIAL**

Implemented: `packages/simulation/src/insurance.ts`,
`packages/simulation/src/training-camps.ts`, `packages/simulation/src/national-team-compensation.ts`
with their repositories, all unit-tested.

Missing: no production call sites for camp creation or insurance policy lifecycle — these never
occur in a live save.

Dependencies: federation economy, national teams, medical.

Feature-freeze blocker: **NO**

---

### Nepal pyramid: A / B / C, promotion, relegation, memberships

Status: **BUILT**

Implemented: `packages/simulation/src/pyramid-progression.ts` — promotion/relegation/qualification
movements with suspension flags, membership propagation and historical events; persisted through
`persistPyramidProgression` and invoked in the season rollover (`career-world.ts`). Dataset carries
A/B/C plus Nepal Super League and the ANFA National League with 69 memberships.

Missing: nothing blocking.

Dependencies: competitions, licensing, squad viability.

Feature-freeze blocker: **NO**

---

### Club licensing

Status: **PARTIAL**

Implemented: full case lifecycle — `openClubLicenceCycle`, `assessClubLicence`,
`finaliseClubLicence`, `appealClubLicence`, `closeClubLicenceCycle`, and the eligibility gate
`clubMayEnterCompetition` (`packages/simulation/src/licensing.ts`), including a women's-league
programme requirement.

Missing: **no production call sites.** `clubMayEnterCompetition` is never consulted by pyramid
progression or fixture generation, so licensing never restricts entry to any competition.

Dependencies: pyramid, federation compliance, infrastructure.

Feature-freeze blocker: **NO**

---

### Lower-league finance and squad viability

Status: **BUILT**

Implemented:

- Division-scaled finance: `lowerLeagueFinanceMultiplier`
  (`packages/simulation/src/territorial-football.ts`).
- Squad repair with correct priority — restore contracted players, promote youth, sign free agents,
  and only then generate an emergency player — plus a goalkeeper floor:
  `packages/simulation/src/preseason-continuity.ts` (`repairPreseasonContinuity`, wired into the
  season rollover, 4 call sites).

Missing: nothing blocking.

Dependencies: workforce supply, transfers, youth.

Feature-freeze blocker: **NO**

---

### Territorial structure: 7 provinces, 77 districts

Status: **PARTIAL**

Implemented: full province/district definition and seeding with remoteness, participation, coach and
referee supply, ground availability, scouting visibility and governance compliance —
`initializeNepalTerritorialStructure` (`packages/simulation/src/territorial-football.ts`); district
development projects and delayed development effects (`updateDistrictDevelopment`,
`createDistrictDevelopmentProject`, `advanceDistrictDevelopmentProject`);
`packages/database/src/territorial-football-repository.ts`.

Missing: **no production call sites** — `initializeNepalTerritorialStructure` and
`updateDistrictDevelopment` are referenced only from `territorial-football-phase-a.test.ts`. No live
save has districts, so district development can never influence player production despite the
supply layer being ready to consume it.

Dependencies: player supply, scouting, grassroots, federation funding.

Feature-freeze blocker: **YES** — this is the declared source of long-term player production and it
is inert.

---

### District / provincial representative competitions

Status: **MISSING**

Implemented: representative team creation and deterministic squad selection from eligible, available,
_known_ players (`createTerritorialRepresentativeTeam`, `selectTerritorialRepresentativePlayers`).

Missing: no competition, no fixtures, no results, no calendar slot, and no caller for either
function. `TerritorialRepresentativeTeam.competitionId` is declared and never populated. There is no
territorial competition pathway and therefore no scouting-visibility pathway from it.

Dependencies: territorial structure, fixtures, scouting.

Feature-freeze blocker: **NO** (light Phase A integration was the stated intent)

---

### Real Nepal player database and provenance

Status: **PARTIAL**

Implemented: 573 real players with factual profiles, attributes, potentials, development states and a
340-row source register; provenance model (`DataProvenance`, `entity_provenance` table) and
`playerImportSummary` with duplicate tracking; import pipeline in `packages/data-import/src/`.

Missing — measured coverage from `data/nepal/2026-08/club-registry.json`:

| Competition                  | Clubs | Clubs with players | Players |
| ---------------------------- | ----- | ------------------ | ------- |
| ANFA National League         | 18    | 18                 | 573     |
| Martyr's Memorial A-Division | 14    | 12                 | 404     |
| Martyr's Memorial B-Division | 14    | **2**              | 51      |
| Martyr's Memorial C-Division | 14    | **0**              | 0       |
| Nepal Super League           | 9     | **0**              | 0       |

B-division coverage is token; C-division and NSL have none. Squads for those clubs exist only as
emergency-generated players from preseason repair.

Dependencies: pyramid viability, scouting, transfers.

Feature-freeze blocker: **YES** for a credible pyramid at launch.

---

### Women's player data

Status: **MISSING**

Implemented: nothing in the dataset — 10 women's teams, **0 women's players**, and `personRoles`
contains 573 PLAYER entries, all attached to men's teams.

Missing: any real or seeded women's squad in the shipped world.

Dependencies: women's competitions, women's supply (built).

Feature-freeze blocker: **YES**

---

### Youth intake, development, retirement, late developers

Status: **BUILT**

Implemented: `packages/simulation/src/youth-intake.ts` (1568 lines) — academy/district/grassroots/
diaspora origin pathways, development-environment-driven volume and quality, youth contracts,
promotion/release decisions, age-and-ability-weighted retirement with announcement lead time, and
retired-player-to-staff conversion. Runs annually in the season rollover
(`runAnnualYouthAndRetirementCycle`, `career-world.ts:272`). Development engine in
`packages/simulation/src/player-development.ts` supports late-developer trajectories via potential
ceiling, development rate and volatility.

Missing: nothing blocking.

Dependencies: territorial development (currently inert), facilities, academies.

Feature-freeze blocker: **NO**

---

### Free agents

Status: **BUILT**

Implemented: contract termination on retirement, free-agent identification and signing in
`preseason-continuity.ts` (`signFreeAgent`) and the transfer market; pool decays through retirement
and recruitment.

Missing: nothing blocking.

Dependencies: transfers, workforce supply.

Feature-freeze blocker: **NO**

---

### Diaspora and Nepalis abroad

Status: **PARTIAL**

Implemented: `DIASPORA_YOUTH` origin type with eligibility flags in generated player origins;
diaspora eligibility and recruitment records in
`packages/simulation/src/national-team-management.ts` (`diasporaEligibilityForNationalTeam`,
`advanceDiasporaRecruitment`).

Missing: no representation of Nepali players playing abroad — no foreign club attachment, no export
pathway, and no feedback from overseas success into reputation or scouting interest.

Dependencies: national teams, external football world, transfers.

Feature-freeze blocker: **NO**

---

### Foreign player supply into Nepal

Status: **PARTIAL**

Implemented: `packages/simulation/src/external-football-world.ts` (54 lines) with
`processExternalFootballWorldSeason` wired into the season loop; registration and eligibility
concepts exist in the transfer/federation layers.

Missing: no meaningful foreign player pool available to Nepal clubs, and no contextual gating by
wages, league reputation or agent networks.

Dependencies: transfers, macroeconomy, registration rules.

Feature-freeze blocker: **NO**

---

### Player regeneration and long-save supply

Status: **BUILT**

Implemented: `packages/simulation/src/workforce-supply.ts` (972 lines) — demand derived from active
clubs, women's teams and fixture volume; projected exits; bounded per-population corrections; season
idempotency ledger; wired into the season rollover after retirement and before preseason repair
(`career-world.ts`). Backed by `packages/database/src/workforce-supply-repository.ts` and a
12-season continuity test.

Missing: nothing blocking.

Dependencies: youth intake, retirement, preseason continuity.

Feature-freeze blocker: **NO**

---

### Real staff database

Status: **MISSING**

Implemented: 2 staff records in the entire shipped dataset — both national-team head coaches
(`NATIONAL_TEAM_HEAD_COACH`). `staffProfiles: 2`, `staffAppointments: 2`.

Missing: every club backroom role across all five competitions. Coverage tooling exists
(`packages/data-import/src/personnel-coverage-report.ts`) but a report is not data.

Dependencies: staff market (built), workforce supply (built).

Feature-freeze blocker: **YES** for credible club staffing at launch.

---

### Real referee database

Status: **MISSING**

Implemented: nothing — `referee_profiles` is empty in a freshly created save (0 rows).

Missing: all domestic officials. The workforce layer bootstraps _simulated_ officials, which is a
continuity mechanism, not real-data coverage.

Dependencies: referee assignment (missing), referee development.

Feature-freeze blocker: **YES** if real officials are a launch requirement; the simulated bootstrap
does keep long saves viable.

---

### Staff and referee regeneration / long-save supply

Status: **BUILT**

Implemented: staff free-agent replenishment through the existing generator (`generateAiStaff`,
exported from `staff-market.ts`), plus officiating generation, bounded career progression,
promotion, retirement and instructor transition in `workforce-supply.ts`
(`generateOfficial`, `advanceOfficialCareer`, `initializeWorkforceSupplyForSave`).

Missing: nothing blocking.

Dependencies: workforce demand model.

Feature-freeze blocker: **NO**

---

### VAR

Status: **PARTIAL**

Implemented: full programme lifecycle with feasibility gating, readiness assessment, scope
resolution and per-match availability — `assessVarReadiness`, `advanceVarProgramme`,
`varMatchContext` (`packages/simulation/src/referee-development.ts`).

Missing: `varMatchContext` has **no production call site**; the match engine never asks whether VAR
is available, so the programme has no effect on any match.

Dependencies: referee assignment, match engine.

Feature-freeze blocker: **NO**

---

### Women's clubs and competitions

Status: **PARTIAL**

Implemented: 10 women's senior teams in the dataset; women's programme creation, youth pathway and
competition registration with category validation (`packages/simulation/src/womens-youth.ts`);
`WOMENS_LEAGUE` is a first-class competition category with its own licensing requirement.

Missing:

- **No `WOMENS_LEAGUE` competition exists in the shipped world** — the five competitions are NSL, A,
  B, C and the ANFA National League, all men's.
- No women's squads (0 players), so the teams cannot field a side.

Dependencies: women's player data, women's supply (built).

Feature-freeze blocker: **YES**

---

### Women's national team

Status: **MISSING**

Implemented: a women's national-team head coach exists in the dataset.

Missing: the international pipeline resolves only `seniorMenNationalTeamId`
(`packages/simulation/src/international-football.ts:1731`, used at lines 411, 728, 903, 1174). No
women's international competition, squad selection or fixture path exists.

Dependencies: women's player data, international football.

Feature-freeze blocker: **YES** if women's international football ships.

---

### Youth national teams (U17 / U20 / U23)

Status: **MISSING**

Implemented: nothing. No age-group national team selection anywhere in the simulation package.

Missing: age-cohort eligibility derived from world date, youth NT squads, and youth international
fixtures. The regeneration layer now produces correct age cohorts, so the input exists — the
consumer does not.

Dependencies: international football, workforce supply (ready).

Feature-freeze blocker: **YES** if youth internationals ship.

---

### Girls development, schools, grassroots, academies

Status: **PARTIAL**

Implemented: `girlsParticipation` and `schoolParticipation` on every district unit;
`packages/simulation/src/grassroots.ts` and its repository; 8 academies in the dataset with
simulation profiles driving intake quality (`academy_simulation_profiles`).

Missing: girls'/school participation only moves through `updateDistrictDevelopment`, which is
unreachable in a live save, so none of it currently influences supply.

Dependencies: territorial structure (inert), youth intake.

Feature-freeze blocker: **NO**

---

### Macroeconomy

Status: **PARTIAL**

Implemented: bounded index progression with 50-year stability test —
`nextMacroEconomicState`, `advanceMacroEconomy`, `adjustForMacro`, `macroEconomyForCountry`
(`packages/simulation/src/macro-economy.ts`); persisted via
`packages/database/src/macro-economy-repository.ts`; consumed in three places in `club-economy.ts`
and in supporter attendance affordability.

Missing: **`advanceMacroEconomy` has no production call site.** No macro state is ever written, so
every reader falls back to a neutral 1.0 and inflation, wage drift and affordability never move in a
real save.

Dependencies: club economy, wages, supporter attendance, transfers.

Feature-freeze blocker: **YES** — a one-line wiring gap that silently disables an entire shipped
economic dimension.

---

### Personal wealth

Status: **BUILT**

Implemented: owner/investor wealth separated from club cash (`packages/simulation/src/investor.ts`,
ownership stakes in club economy), asserted by `stage-ten-club-economy.test.ts`.

Missing: nothing blocking.

Dependencies: ownership.

Feature-freeze blocker: **NO**

---

### Supporter base, attendance, atmosphere, mood, rivalries

Status: **PARTIAL**

Implemented: `packages/simulation/src/supporter-culture.ts` (1494 lines) — bounded supporter
profiles, separated base concepts, supporter-aware attendance demand with exposed factor breakdown,
atmosphere, mood/expectations/manager-approval/ownership-trust, unrest states, dynamic rivalry
intensity with sticky historic baselines, promotion/relegation/trophy/signing/sale effects, monthly
and seasonal cadence, national-team supporter state, and read models. Persistence in
`packages/database/src/supporter-culture-repository.ts`. Two integration points are wired:
`supporterAttendanceForFixture` inside `postMatchdayEconomy` and `supporterBoardPressureModifier`
inside `evaluateBoardConfidence`.

Missing — the system never activates:

- `initializeSupporterCultureForSave` has **no call site outside its own test file**, so no save
  ever has a supporter profile. Both wired integration points take their `undefined` fallback path:
  attendance reverts to the legacy formula and board pressure contributes exactly 0.
- `applyMatchSupporterOutcome`, `normalizeSupporterCultureMonth` and
  `evolveSupporterCultureSeason` are never called, so mood, rivalry intensity and supporter-base
  evolution never advance.
- `upsertAffinity` / `nextPlayerAffinity` are never called — no fan favourites are ever recorded.
- `createRivalry` / `upsertRivalry` are never called from gameplay — the rivalry table stays empty,
  so no derby ever exists.

Dependencies: club economy, board, media, commercial.

Feature-freeze blocker: **YES**

---

### Media and journalism

Status: **PARTIAL**

Implemented: outlets with scope/bias/style, historical-event-to-story conversion with importance
thresholds and idempotency, journalists, relationships and interviews —
`packages/simulation/src/media.ts`, `packages/database/src/media-repository.ts`,
`packages/database/src/media-phase-b-repository.ts`. Covered by `media-phase-a/b.test.ts`.

Missing: **zero production call sites.** `publishMediaForDate` is referenced only from its two test
files. No news is ever generated in a real save, and no manager ever sees a story or an interview.

Dependencies: history (built), supporter world (dark).

Feature-freeze blocker: **NO** (no gameplay depends on it) — but the feature is entirely invisible.

---

### Awards

Status: **BUILT**

Implemented: competition winners plus `TOP_SCORER`, `MOST_ASSISTS`, `BEST_GOALKEEPER` and
`PLAYER_OF_SEASON` computed from real season statistics and persisted per season
(`persistChampionAndAwards`, `packages/simulation/src/career-world.ts:1150`), reachable in every
simulated season.

Missing: nothing blocking at season level.

Dependencies: season engine, history.

Feature-freeze blocker: **NO**

---

### Legends and cult heroes

Status: **MISSING**

Implemented: only a derived helper — `supporterLegendTier` / `supporterAffinityBand`
(`packages/simulation/src/supporter-culture.ts:846`), designed as a hook for a legends module.

Missing: the legends module itself. There is no hall of fame, no club icon record, no legend
promotion from achievement history, and the hook's input (`SupporterPlayerAffinity`) is never
populated.

Dependencies: supporter world (dark), history, awards.

Feature-freeze blocker: **NO**

---

### Rivalries

Status: **PARTIAL**

Implemented: `ClubRivalry` model with bounded intensity, historic baselines that never decay away,
origin classification, meeting history and milestone recording; `nextRivalryIntensity` with
rise-on-meaningful-events and slow decay (`supporter-culture.ts`), persisted in `club_rivalries`.

Missing: no rivalry is ever created or updated from gameplay — no seeding from geography or shared
history, and no call from the match loop. The table is empty in every save.

Dependencies: supporter world, geography, history.

Feature-freeze blocker: **NO** (but derbies do not exist)

---

### AI squad planning, transfers and contracts

Status: **BUILT**

Implemented: `runClubAiSeasonPlanning` (`packages/simulation/src/ai-club-strategy.ts`) and
`simulateTransferWindow` (`packages/simulation/src/transfer-market.ts`), both invoked from the
season rollover; AI clubs use the same transfer, contract and youth-promotion machinery as the human
club.

Missing: nothing blocking.

Dependencies: transfers, economy, workforce supply.

Feature-freeze blocker: **NO**

---

### AI staff hiring

Status: **PARTIAL**

Implemented: `ensureAiStaffAssigned` and `evaluateAllStaffContracts` fill core backroom roles from
free agents first and only generate a person when nobody suitable exists, with affordability checks.

Missing: both are called **only** from the desktop `continueCareer` path
(`packages/simulation/src/desktop-application.ts:648-649`). The headless season simulator
(`career-world.ts`) never runs them, so multi-season background worlds and diagnostics evolve with
unstaffed AI clubs.

Dependencies: staff market, club economy.

Feature-freeze blocker: **NO**

---

### AI chairman

Status: **PARTIAL**

Implemented: `packages/simulation/src/ai-club-strategy.ts` (133 lines) producing club AI decisions
that consume supporter and economic context.

Missing: thin relative to the chairman domain — no AI ownership decisions, no manager hiring by AI
boards beyond vacancy filling, no strategic infrastructure or commercial choices.

Dependencies: board, club economy, ownership.

Feature-freeze blocker: **NO**

---

### AI federation and AI national team

Status: **BUILT**

Implemented: `runFederationComplianceAiForAllFederations` runs every simulated month; national-team
squad selection runs automatically inside `processInternationalForSeasonPeriod`
(`international-football.ts:862`) for every qualifying competition window.

Missing: nothing blocking (scope limited to senior men — see the national-team entries).

Dependencies: federation governance, international football.

Feature-freeze blocker: **NO**

---

### National teams (senior men) and international competition

Status: **BUILT**

Implemented: `packages/simulation/src/international-football.ts` (1871 lines) — SAFF, Asian Cup,
Asian Cup qualification and World Cup qualification on a real multi-year cycle, draws, fixtures,
match simulation, world ranking calculation, camps and international history. Deep management layer
in `packages/simulation/src/national-team-management.ts` — callups and responses, camp lifecycle,
campaign registration, squad registration and finalisation, selection policy recommendations,
international commitments, diaspora recruitment and international form.

Missing: `registerNationalTeamCampaign` and several management entry points have no production
caller; the automatic pipeline uses the simpler selection path.

Dependencies: player world, federation.

Feature-freeze blocker: **NO**

---

### Stadium, training, youth, medical and technical infrastructure

Status: **BUILT**

Implemented: facility profiles (training/youth/medical quality) with project-driven improvement in
`club-economy.ts`; medical centre and return-to-play decisions in
`packages/simulation/src/medical.ts` and `packages/simulation/src/medical-rehab.ts`; 45 venues with
capacity, surface and floodlight data in the dataset.

Missing: nothing blocking.

Dependencies: club economy, youth, medical.

Feature-freeze blocker: **NO**

---

### District infrastructure projects

Status: **PARTIAL**

Implemented: project model with multi-party contributions (district/province/municipality/
federation), milestones, conditions and reporting status
(`packages/simulation/src/territorial-football.ts`).

Missing: unreachable in a live save — same root cause as the territorial structure entry.

Dependencies: territorial structure, federation funding, government.

Feature-freeze blocker: **NO**

---

### Long-save continuity (10–15 season viability)

Status: **PARTIAL**

Implemented: deterministic, idempotent annual intake with a season ledger; player, staff, referee and
women's supply; sustainability report and structural invariants; a passing 12-season continuity test
over the real Nepal world (`packages/testing/src/workforce-supply-phase-a.test.ts`).

Missing: the end-to-end career path cannot complete multiple seasons because of the
`training_history_events.id` uniqueness crash in `developPlayers` (see Critical Gaps #1). The
continuity harness exercises the youth/retirement/supply lifecycle directly, not the full career
simulator, so full-stack long-save viability is **unproven**.

Dependencies: everything.

Feature-freeze blocker: **YES**

---

### Final 20/50-year balancing

Status: **DELIBERATELY_LATER**

Explicitly deferred; the supply and supporter phases both state bounded, focused tests instead of the
full campaign.

Feature-freeze blocker: **NO**

---

### Desktop runtime and SQLite

Status: **BUILT**

Implemented: application service (`packages/simulation/src/desktop-application.ts`, 2787 lines) with
~75 commands, a command-dispatch server (`packages/simulation/src/desktop-server.ts`), React manager
UI with 12 screens plus matchday under `apps/desktop/src/manager/`, and 5 Playwright e2e specs.

Missing: nothing blocking for the manager career.

Dependencies: all gameplay.

Feature-freeze blocker: **NO**

---

### Tauri shell and native packaging

Status: **PARTIAL**

Implemented: `apps/desktop/src-tauri/` with `Cargo.toml`, `build.rs`, a 115-line `main.rs`, and
`tauri.conf.json` that bundles the Nepal dataset as a resource.

Missing: no `bundle.targets`, no signing configuration, no updater, and **no CI workflow of any kind**
(`.github/workflows` does not exist). There is no reproducible path from source to a distributable
build.

Dependencies: desktop runtime.

Feature-freeze blocker: **NO** for feature freeze; **YES** for release.

---

### Performance

Status: **PARTIAL**

Implemented: indexed repositories, demand snapshots, annual/preseason reconciliation rather than
per-day scans, and bounded candidate pools in the supply layer.

Missing: no benchmark or profiling harness exists, so long-save performance is unmeasured. The
12-season continuity test takes ~37s, which is indicative but not a benchmark.

Dependencies: all simulation.

Feature-freeze blocker: **NO**

---

### Legal and data provenance

Status: **BUILT**

Implemented: `DataProvenance` with status vocabulary including `SIMULATION_ONLY`
(`packages/shared-types/src/domain.ts:3638`), the `entity_provenance` table with an entity index,
per-record source register (340 rows), and a consistent discipline of marking every generated person,
supporter profile, official and territorial unit `SIMULATION_ONLY`. Generated identities are never
marked `VERIFIED`.

Missing: no published attribution/licensing document for the shipped dataset in `docs/`.

Dependencies: data import, all generation.

Feature-freeze blocker: **NO**

---

### Mobile

Status: **DELIBERATELY_LATER**

Explicitly out of scope in every phase brief to date.

Feature-freeze blocker: **NO**

---

### Final release workflow

Status: **DELIBERATELY_LATER**

No CI, no release pipeline, no packaging targets. Consistent with a pre-freeze codebase; must become
a real workstream after freeze.

Feature-freeze blocker: **NO**

---

## Recommended Remaining Build Order

Dependency-aware, cheapest-unblocking-first. Steps 1–4 are mostly _wiring_ — high value per line.

1. **Fix the `training_history_events.id` collision** in `developPlayers`. Nothing else can be
   validated end-to-end over multiple seasons until career simulation stops crashing.
2. **Wire the dark systems into the world loop** (one call site each, no new design):
   `advanceMacroEconomy` → season/annual tick; `initializeSupporterCultureForSave` +
   `applyMatchSupporterOutcome` + `normalizeSupporterCultureMonth` + `evolveSupporterCultureSeason`;
   `initializeNepalTerritorialStructure` + `updateDistrictDevelopment`; `publishMediaForDate`;
   `advanceFederationElections`; `clubMayEnterCompetition` in pyramid entry;
   `ensureAiStaffAssigned` in the headless season loop. This alone converts eight PARTIAL systems
   toward BUILT.
3. **Finish `matchesRequireWinner`** (mostly closed by `205f25c`): persist the flag — either a
   dedicated column or, consistently with its sibling fields, inside
   `competition_rules.special_rules_json` — and populate it from the Nepal cup and play-off rule
   data. The resolution machinery, two-leg deferral and non-resolution guard are already in place.
4. **Referee assignment**: add an official reference to fixtures/matches and an assignment pass that
   respects workload and neutrality, consuming the officiating population that already exists. Then
   connect `varMatchContext` and `advanceRefereeDevelopment`.
5. **Universal interaction execution for the remaining domains**, starting with contracts and staff
   contracts (highest gameplay frequency), then board/facility, then federation/government/commercial.
6. **Seed rivalries and player affinity from gameplay** so supporter world produces derbies and fan
   favourites; then build the legends module on the existing `supporterLegendTier` hook.
7. **Women's football world**: add a `WOMENS_LEAGUE` competition and squads (generation is ready),
   then the women's national team in the international pipeline.
8. **Youth national teams** (U17/U20/U23) — cohorts already exist from regeneration.
9. **Ownership and federation personnel succession**, reusing the workforce demand pattern.
10. **Real-data coverage passes**: B/C-division players, club staff, referees.
11. **Chairman and federation-president career surfaces** (decide scope first — this is the largest
    remaining item and the only one that is genuinely new construction).
12. Manager interviews; club creation in the live loop; commercial-rights, media-rights and
    competition-distribution wiring; territorial representative competitions.
13. Release workstream: CI, bundle targets, signing, attribution document.

---

## Feature Freeze Readiness

**NOT READY.**

Reasons, in order of severity:

1. **The full career loop crashes.** `UNIQUE constraint failed: training_history_events.id` fails 5
   tests across two suites and prevents any multi-season career from completing. A feature freeze
   cannot be declared on a build whose primary loop does not run to completion.
2. **Eight shipped systems are unreachable from a real save.** Supporter world, macroeconomy,
   territorial structure, media, licensing, federation elections, commercial/media rights and
   competition distribution are all implemented and tested but have no production call sites.
   Freezing now would freeze features no player can reach — and the fix is wiring, not design, so it
   is cheap to do before the freeze and expensive to explain after it.
3. **Referees are never assigned to any match.** No official reference exists on fixtures or
   matches, and VAR is never consulted. (The sibling gap — domestic decisive matches unable to
   resolve a winner — was closed by `205f25c` mid-audit; only persisting and populating the
   `matchesRequireWinner` flag remains.)
4. **Non-transfer negotiations are cosmetic.** Thirteen of fourteen linked interaction domains accept
   an outcome and never apply it.
5. **Women's football cannot be played.** No women's competition, no women's squads, no women's
   national team.
6. **Two of three advertised careers are not playable.** Chairman and federation president exist as
   service layers with no command surface — this is a scope decision that must be made _before_
   freeze, not discovered after.
7. **Long-save validity is unproven at full stack.** The 12-season harness covers the supply
   lifecycle only; owner and federation succession are absent entirely.

What _is_ ready: the core world, determinism, persistence, match engine, the manager career loop end
to end, the Nepal pyramid, club and federation economy, transfers, contracts, staff market, scouting,
squad dynamics, youth and workforce regeneration, and the senior men's international programme. That
is a substantial, coherent spine — the remaining work is disproportionately wiring and coverage
rather than new engine construction.
