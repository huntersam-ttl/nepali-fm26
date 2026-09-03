# Simulation Performance Profile

## Season-1 long-save revalidation after migration 85

## Season-3+ scaling pass after bounded AI discovery cache

On 2026-09-02, the canonical three-season workload was profiled with the same seed and
checkpoint/reload settings. The dominant growth was annual AI planning, specifically repeated
all-player/statistics reconstruction inside regional trial discovery for each Nepal club. A
bounded per-database/per-world-date player pool is now reused only by the unfiltered AI trial
discovery consumer; public filtered recruitment searches retain their uncached canonical snapshot
semantics. The cache invalidates when the person population changes, so generated players are not
hidden and no state crosses saves or dates.

| Measure                 |  Before |   After |       Change |
| ----------------------- | ------: | ------: | -----------: |
| Season 1                | 221.70s | 161.91s | 27.0% faster |
| Season 2                | 262.42s | 233.78s | 10.9% faster |
| Season 3                | 503.34s | 401.54s | 20.2% faster |
| Cumulative              | 987.46s | 797.22s | 19.3% faster |
| Economy/ownership/AI S1 |  58.01s |  40.68s | 29.9% faster |
| Economy/ownership/AI S2 | 119.33s |  93.09s | 22.0% faster |
| Economy/ownership/AI S3 | 272.82s | 137.03s | 49.8% faster |

All **2,571 / 2,571 matches** completed. Structural shortages and emergency lineups remained
zero; duplicate IDs/finalizations were zero; finances were finite; and all checkpoint reloads
passed. Save size remained approximately **82.25 → 116.42 → 151.29 MB** and observed RSS was
approximately **461.0 → 470.1 → 565.8 MB** in this run. The 20-season gate remains unproven, so
this is a material scaling improvement but not a release-gate pass.

## Final Season-1 revalidation after structural-shortage correction

On 2026-09-02, the canonical full-production Season-1 harness was rerun once from the current
build using seed `long-save-post-freeze-2026`. It completed all **851 / 851 matches** in
**184.30s elapsed** (the harness reported 196.21s including Vitest overhead), with an 82.24 MB
database and 575.1 MB observed RSS. The structural squad gate passed: **0 position shortages**
and **0 emergency lineups**. Duplicate IDs were zero and financial values were finite.

The harness initially failed only because its assertion required a `COMPLETED` season state after
the canonical rollover had already moved all five completed competitions to `ROLLED_OVER`. The
assertion is now lifecycle-correct and accepts either terminal state; this does not weaken the
completion check. Migration errors, crashes, duplicate finalizations, broken contracts, and
non-finite finances were not observed. The temporary benchmark database was removed by the test
harness after capture, so direct post-run SQL inspection was limited to its persisted snapshot.

| Measure                 |                     Result |
| ----------------------- | -------------------------: |
| Matches / fixtures      |     851 / 872 (851 played) |
| Wall time               |            184.30s elapsed |
| Previous 239.54s result |               23.1% faster |
| Original 465.3s result  |               60.4% faster |
| Save size               |                   82.24 MB |
| Peak RSS                |                   575.1 MB |
| Structural shortages    |                          0 |
| Emergency lineups       |                          0 |
| Duplicate IDs           |                          0 |
| Financial values        |                     finite |
| Season terminal state   | 5 rolled over, 0 suspended |

The Season-1 performance result is materially improved and passes the single-season runtime gate.
The multi-season long-save release gate remains **FAIL / UNPROVEN** because no new multi-season
run was started in this pass.

On 2026-09-02, one fresh canonical full-production Season-1 run was executed with
`LONG_SAVE_SEED=long-save-post-freeze-2026`, checkpoint/reload enabled, and migration 85 applied.
The run completed all 851 matches without a crash or stall in **239.54s elapsed** (the Vitest
harness reported 254.04s including setup/transform overhead), compared with the previous **465.3s**
baseline: **48.5% faster**. The database was 82.15 MB and peak observed RSS was 578.5 MB.

| Measure            |                 Result |
| ------------------ | ---------------------: |
| Matches / fixtures | 851 / 872 (851 played) |
| Wall time          |        239.54s elapsed |
| Previous baseline  |                 465.3s |
| Improvement        |                  48.5% |
| Save size          |               82.15 MB |
| Peak RSS           |               578.5 MB |
| Migration          |             85 applied |
| Duplicate IDs      |                      0 |
| Financial values   |                 finite |
| Emergency lineups  |                      0 |
| Position shortages |                      2 |

The harness completed its save-close/reopen checkpoint and reported valid match completion, but the
strict correctness assertion failed on two position-shortage cases (the prior baseline recorded
one). No gameplay change was made to the peer-owned squad-health work; therefore the performance
gate is materially improved but remains **FAIL_PERFORMANCE** pending resolution of that correctness
gate and a release decision on the remaining long-save criteria. No second benchmark was started.

## Current bounded profiling pass

At the release-readiness pass beginning from HEAD `21efb3c`, a disposable canonical save was
profiled through one A-Division competition (182 fixtures) with optional economy, youth,
federation, international, and transfer phases disabled. This isolates the competition/match
loop and is not a long-save gate.

The V8 CPU profile identified repeated `upsertPlayerKnowledge` preparation and lookup work in
match observations as the leading application hotspot. The narrow fix lazily caches those two
SQLite statements per match-loop repository, preserving existing knowledge values and observation
ordering while avoiding repeated statement compilation. Cold scouting helpers do not pay the cache
cost until used.

| Measurement        |        Before |         After |
| ------------------ | ------------: | ------------: |
| Wall time          |       102.95s |       100.83s |
| Competition phase  |        33.46s |        27.45s |
| Fixtures / matches |     182 / 182 |     182 / 182 |
| Save size / RSS    | Not collected | Not collected |

The initial eager-cache experiment regressed to 119.37s and was discarded; only the lazy version
was retained. Focused season/scouting regressions passed 19/19. This is a modest targeted
improvement, not evidence to change the long-save status: the release gate remains
**FAIL_PERFORMANCE** until the documented multi-season validation completes.

## Baseline

Measured on an idle machine (no competing test runs), Nepal-only world
(`globalSeedPath: null`), three-season career with transfers enabled.

| Phase                             | Time         |
| --------------------------------- | ------------ |
| `createNepalSave`                 | 3.5s         |
| `initializeTransferMarketForSave` | 7.1s         |
| Season 1                          | 116.3s       |
| Season 2                          | 160.2s       |
| Season 3                          | 253.6s       |
| **One career**                    | **~9.0 min** |

Population grows 1,093 → 2,417 people across the three seasons.

## Post-Freeze One-Season Baseline

Measured after feature freeze on HEAD `845581b` (freeze-approved commits are ancestors), on a
MacBookPro16,1 with Intel Core i7-9750H, Node `v22.17.1`, pnpm `9.15.4`, using the canonical
production command `pnpm --filter @nepal-football-sim/simulation career:simulate -- --seasons 1
--seed post-freeze-baseline-2026 --save-path <temporary sqlite>`. The run used normal save creation
and the full Nepal/FULL production rollover with external CONTEXT_ONLY processing; it completed at
`2027-07-31` with five runnable competitions, 789 fixtures/matches, and four intentionally skipped
competitions. The measured wall time was **179.04s total** (the command includes the package build;
save creation was not separately instrumented in this run).

The current code has no phase timer output. The latest comparable instrumented breakdown remains the
earlier 202.8s run: competitions 100.2s (49.4%), economy 34.9s (17.2%), federation 26.9s (13.2%),
international 10.2s (5.0%), and external world 2.8s (1.4%). The top measured hotspot is competition
processing, an **EXPECTED_HEAVY** phase; no measured phase crossed the prior 20% rewrite threshold
outside that known aggregate. No broad SQL tuning was performed.

## Competition Query/Batching Optimisation

The first post-freeze attribution found two `PlayerRepository.attributesForTeam` reads per fixture
inside `simulateCompetitionSeason`: approximately 1,578 roster queries/mappings for the 789-match
baseline. Team assignments and attributes are static during one competition season, so the bounded
fix caches them by team for that function call. Injury, suspension, player condition, standings,
finance, contract, and match-result state remain dynamic and are intentionally not cached. The
representative attribution changes the static read upper bound from 1,578 fixture-endpoint calls to
one load per participating team per competition-season scope (202 observed played-endpoint team
references in the resulting database); it does not alter match inputs or rules.

The full after-run used the identical seed/configuration and completed successfully in **155.60s**
total, versus **179.04s** before: 23.44s / **13.1% faster** overall. Final date, 789 fixtures,
789 matches, five runnable competitions, four skipped competitions, zero emergency lineups, and zero
position shortages matched the before-run aggregate. The after-run’s internal competition timer was
not separately emitted, so no unsupported competition-phase seconds are claimed; the comparable
instrumented competition figure remains 100.2s. Focused season/progression/integrity regressions
and recursive typecheck/build passed. Classification remains **SLOW_BUT_COMPLETES**; this is a
**MATERIAL** total improvement, but 20-season readiness remains **OPTIMISE_AGAIN** because the
competition phase is still the largest measured cost. The next and only selected hotspot is deeper
competition query attribution/batching, with no second optimisation included here.

## Second Competition Attribution and Optimisation

The second attribution found fixture-existence probing in `simulateCompetitionSeason`: each fixture
was queried once before simulation and again during completion detection. For 789 matches this was
approximately 1,578 identical `matches` existence queries. The bounded fix loads existing match
fixture IDs once per competition-season and updates a local set after each persisted result. The set
is discarded at function return; availability, standings, finance, contracts, and match results
remain live and no competition semantics changed.

Focused attribution moves from approximately **1,578 queries to five season-scoped loads** for the
five runnable competitions. The identical canonical one-season benchmark completed in **118.33s**
total, versus 155.60s after the first optimization and 179.04s before either optimization: **37.27s
/ 23.9% faster** than 155.60s and **60.71s / 33.9% faster** than 179.04s. It reached `2027-07-31`
with 789 fixtures/matches, five runnable and four skipped competitions, zero emergency lineups, and
zero position shortages. The internal competition phase was not separately timed, so no unsupported
after-phase seconds are claimed. Classification remains **SLOW_BUT_COMPLETES** and the optimization
is **MATERIAL**.

Current linear planning floors are approximately **39.4 minutes for 20 seasons** and **98.6 minutes
for 50 seasons**; allowing for population growth, likely planning ranges are roughly **60–100 minutes**
and **150–250 minutes**. Validation readiness is **READY_FOR_20_SEASON_VALIDATION**. The next pass
should run the prepared 20-season checklist; no further competition optimization is selected unless
that run exposes a new measured pathology.

Against the stronger pre-freeze 303.0s total (creation 6.5s plus season 296.5s), this run is
**IMPROVED** by 123.96s / 40.9%. The older 202.8s figure remains historical and is not treated as
directly equivalent. Linear planning floors from 179.04s are approximately 59.7 minutes for 20
seasons and 149.2 minutes for 50; population growth makes practical ranges roughly 90–150 minutes
and 225–375 minutes respectively. Classification: **SLOW_BUT_COMPLETES**. Validation readiness:
**OPTIMISE_FIRST**; target exactly one next pass at competition-phase query/batching attribution.

## 20-Season Validation Checklist (next pass)

Run only after the competition hotspot pass: fresh canonical save, 20 seasons, checkpoint/reload
every five seasons, and record wall time/RSS/database size. Assert FK integrity; duplicate IDs;
orphan contracts/appointments; ledger finiteness; A/B sizes, movement, licensing, champions,
qualification, and no duplicate fixtures; exact-once youth/girls/diaspora intake and caps; age-health,
retirements, staff conversion, solvency, grants/government/distributions, insurance/welfare; transfer,
loan, foreign-staff volumes and inflation; elections, succession, programmes, and AI ownership;
external lifecycle without foreign detailed simulation; and database/row/history growth. Do not start
the 50-season run until the 20-season gate is clean.

## Correction to the Previous Profile

An earlier profile reported `createNepalSave` 87.8s, transfer init 164.3s and season 1 at 1,266s,
and concluded that season 1 carried a 4–6x one-time cost. **That was measurement error.** It was
taken while 29–84 competing vitest processes from a concurrent agent saturated the machine. Every
one of those figures is an artifact:

| Phase                             | Under contention | Idle   | Factor |
| --------------------------------- | ---------------- | ------ | ------ |
| `createNepalSave`                 | 87.8s            | 3.5s   | 25x    |
| `initializeTransferMarketForSave` | 164.3s           | 7.1s   | 23x    |
| Season 1                          | 1,266.1s         | 116.3s | 11x    |

**There is no season-one anomaly.** Season 1 (116s) is the _cheapest_ of the three; cost rises with
population, as expected. Any optimization aimed at first-season backlog work would have been effort
spent on a problem that does not exist.

## Season Phase Profile

CPU profile of a bounded season (40 fixtures, 36.3s of work). Hot self-time, excluding runtime
internals:

| Self time | Function                | Source                  |
| --------- | ----------------------- | ----------------------- |
| 5.6s      | `upsertPlayerKnowledge` | `repositories.js`       |
| 3.6s      | scouting day pass       | `scouting.js`           |
| 3.6s      | referee assignment      | `referee-assignment.js` |
| 2.3s      | `insertMatchEvent`      | `repositories.js`       |
| 2.0s      | `attributesForTeam`     | `repositories.js`       |

Scouting knowledge writes are the largest single item at roughly 15% of season work, driven by
`simulateScoutingDay` running once per fixture across growing squads. Nothing reaches the 20%
threshold that would justify a targeted rewrite, and no N+1 or full-table-scan pattern dominates.

## Fixes

`marketPlayer` resolved one player by constructing the entire market — every row queried, its JSON
parsed and mapped, all but one discarded — inside per-player and per-club loops. The query now
filters to the requested player (`88b691e`). Transfer-market initialization improved measurably;
under contention it moved 164s → 113s.

No other change is committed from this pass. Nothing else met the evidence bar, and speculative
optimization was explicitly out of scope.

## Stage-Eight Status

`keeps three-season transfer careers playable and deterministic` **passes in 19m 22s** on an idle
machine. It is not a hang and not a product defect. Classification is **SLOW_BUT_COMPLETES**, not
`TIMEOUT_PRODUCT` — the earlier timeouts were the 10-minute command budget and machine contention,
not the simulation failing to terminate.

The runtime is inherent to what the test does: it runs two complete three-season careers, ~9 minutes
each, purely to assert that the same seed produces the same history. The dominant cost is simulating
six seasons of a world that doubles in population, not any single hot path.

**The full suite passes: 17/17 in 18m 31s on an idle machine.** Stage-eight has never actually been
broken — every previous "timeout" was a command budget shorter than the suite, or contention.

## Remaining Bottlenecks

## Seeded Career Root-Cause Pass

The matched canonical-seed comparison found a real scope defect in the seasonal AI phase. The
control save contained 1,095 people and 57 clubs; the seeded save contained 2,700 people and 573
clubs. Core competition-only careers remained close (36.9s control versus 43.0s seeded for 153
matches). Economy initialization was 3.2s versus 9.7s, and one monthly economy tick was 0.3s versus
1.5s.

The first disproportionate phase was `runClubAiSeasonPlanning`: before the fix, the seeded run
remained beyond 30s while the control completed in 11.3s. Its SQL selected every club with an
economy account, including context-only imported clubs, then invoked regional candidate and trial
scans per club. This was `ENTITY_SCOPE_WIDENING` plus `GLOBAL_SCAN_BEFORE_CAP`, not a canonical seed
problem. The query now excludes `external_club_context.simulation_depth = 'CONTEXT_ONLY'`. After the
fix, isolated AI timing was 8.3s control versus 18.6s seeded, and a focused regression proved zero
AI decision history for context-only clubs.

A full one-season seeded career reached federation AI after 220.6s but then hit an existing foreign-
key failure inserting `national_team_appearances`; it did not complete. Classification remains
**PERFORMANCE_BLOCKER** pending that federation-path correction and a clean one-season run. No
long-save validation was started.

## Determinism and Federation Closure Pass

The prior federation determinism test was not comparing identical saves: its two fixtures used
different `randomSeed` values. Reusing the same initial save seed makes the two-season diagnostic
outputs identical. Federation compliance iteration now has stable ID ordering. The measured
performance hotspot was `runFederationAiSeasonPlanning` being called once per federation inside
the monthly federation loop, repeating a federation-wide scan quadratically. It now runs once per
month.

The canonical seeded one-season run completed in 202.8s (down from 267.5s), with initialization
12.4s, competitions 100.2s, economy 34.9s, federation 26.9s, international 10.2s, and external
world 2.8s. It produced five reports and 182 fixtures; `PRAGMA foreign_key_check` was clean. The
run had 3,552 people and 573 clubs after lifecycle generation. This is **SLOW_BUT_COMPLETES** for
the bounded pass, but long-save validation remains impractical: a linear projection is ~67.6
minutes for 20 seasons and ~169 minutes for 50 seasons, before growth overhead.

## Measurement Guidance

Timings taken while another agent is running suites are not usable — the observed distortion was
11–25x. Confirm the machine is idle before recording any performance figure.

## Federation National-Team Resolution Pass

The seeded career previously aborted on 2026-12-05 with `FOREIGN KEY constraint failed` in
`insertNationalTeamAppearance`. The cause was not performance. `seniorMenNationalTeam` selected a
federation's senior men's team without requiring `club_id IS NULL`, so an imported confederation
row such as AFC resolved a club-backed team (`Al Ahli Senior Men`) as its national team. That team
had no country-eligible players, `selectNationalTeamSquad` returned zero call-ups, and `selectTeam`
filled the XI with transient replacement players whose IDs (`<teamId>:replacement:<n>`) are
deliberately absent from `persons`. The appearance writer then persisted them into a person-keyed
column.

Two invariants now hold. A federation national team must satisfy `club_id IS NULL`, matching the
predicate `nationalTeamIdForType` already used. Transient replacement players may play a match but
must never reach person-keyed history; both national-team appearance writers filter to canonical
persons before insert. `updateCohesion` was already safe because it is fed from call-ups.

The canonical seeded one-season run now completes: save creation 6.5s, season 296.5s, total 303.0s,
reaching world date 2027-07-31 with 3,588 people, 1,593 players and 573 clubs. It recorded 165
national-team appearances, zero orphaned or synthetic appearance rows, zero club-backed national
fixtures, and a clean `PRAGMA foreign_key_check`. Per-phase timings were not separately
instrumented in this run; the earlier 202.8s breakdown predates several later feature commits, so
the two totals are not directly comparable. Classification remains **SLOW_BUT_COMPLETES**.

## Post-Freeze Hotspot Attribution (CPU profile, HEAD `845581b`)

The baseline above notes that the code emits no phase timings. A V8 CPU profile supplies them
without instrumenting production: self time is attributed per function, so the ranking holds even
though this particular run's wall clock does not. That run measured 282.1s (creation 4.3s, season
277.8s) while another agent's test suites occupied the machine at load 8–11, so its **absolute
time is not a baseline** — 179.04s from the idle run stands. Ranking below is self time inside the
simulating process, 283.5s sampled.

| Source                          | Self time | Share |
| ------------------------------- | --------: | ----: |
| `repositories.js` (all writers) |    101.8s | 35.9% |
| `referee-assignment.js`         |     65.8s | 23.2% |
| `scouting.js`                   |     44.1s | 15.6% |
| `workforce-supply.js`           |      9.5s |  3.3% |
| `preseason-continuity.js`       |      7.9s |  2.8% |
| `transfer-market.js`            |      6.8s |  2.4% |

The repository total is downstream of those callers rather than a phase of its own: `postLedgerEntry`
16.5s, `upsertPlayerKnowledge` 13.7s (scouting's writer), `insertMatchEvent` 13.4s, `attributesForTeam`
9.4s.

Referee assignment is the single largest owned hotspot and is not expected work for choosing match
officials. The mechanism first recorded here — a full workforce bootstrap repeated per fixture — was
wrong, and the profile said so: `initializeWorkforceSupplyForSave` claims a per-season intake and
returns immediately on every later call, and the self time sat in `referee-assignment.js` rather than
in `workforce-supply.js`.

The real cost is in `candidatesFor`. It runs once per official role, so five times per fixture, and
for every active official it compiled two statements: one for the referee profile and one for the
team-conflict check. Across a season that is statement compilation on the order of five times the
official count times the fixture count.

Scouting is second at 44.1s plus its 13.7s of knowledge writes; it has not been attributed to a
specific pattern yet.

### Referee candidate selection

The season assigns officials to 851 fixtures against 203 active officials. At five roles per fixture
and two compiled statements per official, that is roughly 1.7 million statement compilations; the
profile lookup is now a single query per role and the conflict check is compiled once and reused,
leaving about 8.5 thousand, with one conflict `get` per candidate that survives the cheap tests.
The conflict test also moved last, because it is the only remaining test that touches the database.
The predicate is a conjunction, so order changes cost rather than membership, and the profile query
filters on `primary_role` exactly as the discarded per-row check did.

Semantics are unchanged on a full season: 851 assignments, none failed, 203 active officials, 35
distinct referees, 872 fixtures, world date 2027-07-31, and a clean `PRAGMA foreign_key_check` —
the same population and date as the runs above. The focused referee suite, which asserts persistence,
determinism, neutrality and workload awareness, passes.

No trustworthy after-timing was obtainable: every attempt ran against another agent's suites at load
8-17. The contended figures were 277.8s before and 258.9s after, at worse contention for the second,
which is suggestive and is not evidence. The architectural reduction is counted rather than timed,
and an idle re-run is still owed against the 118.33s reference.

### Long-save scaling diagnosis (2026-08-30)

The first checkpointed five-season run measured 175.8s, 266.7s, 496.6s, 575.3s, and 823.6s for seasons 1–5. Matches remained 851 per season, while database size grew 73.1MB to 192.4MB. Economy/ownership/AI grew from 35.4s to 528.5s and overtook competitions by S4.

The proven growth mechanism was `closeClubFinancialSeason` loading every historical ledger row for each of 573 clubs before filtering the current season in memory. The bounded `(club_id, entry_date)` query fix materially reduced the comparable three-season slope: economy/ownership/AI S3/S1 fell from 6.84x to 4.20x. These runs were contended and are not absolute idle baselines.

### Late-season scaling follow-up (2026-09-03)

The next candidate hotspot was referee assignment: the candidate filter performed one
team-conflict SQLite lookup per candidate official. A fixture-scoped replacement was tested,
but the controlled three-season run did not reproduce a gain and was reverted. No gameplay or
database semantics were retained from that experiment.

The comparable post-`76710af` run completed with 851/851, 1,702/1,744, and 2,571/2,634
matches/fixtures at the season checkpoints. Cumulative time was 986.64s (220.14s, 282.26s,
484.24s per season), versus the accepted 797.22s reference (161.91s, 233.78s, 401.54s).
The run remained correct: structural shortages 0, emergency lineups 0, duplicate IDs/finalization
0, finite finances, and save/reload validation passed. Checkpoint database sizes were 82.23MB,
116.40MB, and 151.26MB; RSS was 428.7MB, 459.0MB, and 552.1MB.

The result is not accepted as a performance regression baseline because the phase variance was
dominated by economy/ownership/AI (60.88s, 166.03s, 350.52s), not the candidate-filter change.
The next useful measurement is an isolated economy/AI phase comparison using matched S1-sized and
S3-sized database histories. The 20-season run remains unready.

The unrelated imported-recruitment fixture assertion remains failing at
`canonical-imported-global-recruitment.test.ts:108` (`africaForwards` does not contain the
expected imported forward). The public filtered search path was verified unchanged and the
region-aware recruitment and AI-scope regressions pass; the assertion is classified as a stale
fixture/expectation issue, with no weakened assertion.

### Economy/AI scaling isolation and procurement fix (2026-09-03)

Temporary phase instrumentation isolated the late-season growth to the AI procurement branch, not
trial discovery, contracts, loans, or ownership continuity. Procurement time was 16.05s / 93.52s /
272.17s in the instrumented S1/S2/S3 profile. The branch called `supplierReliability` once per
supplier for each club request; each call reconstructed all procurement orders and offers in
memory and performed a nested JavaScript lookup. The trial player-pool cache recorded 69 hits and
1 miss in each annual AI run, so `76710af` cache invalidation was not the cause.

The fix adds `ProcurementRepository.supplierReliability`, preserving the same delivered/failed
order semantics with a targeted aggregate query, plus migration-managed indexes on supplier offers
and order status. It does not change supplier values, ordering, or decision rules. Procurement
timings fell to 0.68s / 1.04s / 1.13s, and the complete economy/ownership/AI phase fell to
37.25s / 36.80s / 48.45s in the matched instrumented validation. The three-season run completed
492.09s cumulative (181.88s / 146.65s / 163.57s per-season elapsed checkpoints), with 2,571/2,634
matches/fixtures, zero structural shortages, zero emergency lineups, zero duplicate IDs, finite
finances, and reload validation passing. The instrumented run is not used as an idle wall-clock
baseline, but the isolated phase reduction is clear and reproducible.

The next profile target, if needed, is the remaining S3 competition phase; a 20-season run is not
yet justified until a clean non-instrumented comparison and longer stability gate are recorded.

### Club-finance scaling isolation (2026-09-03)

Finance instrumentation split the monthly cadence across wages, facilities, projects, sponsorship,
commercial partnerships, merchandise, loan wages, and infrastructure advancement. The dominant
growth was sponsorship processing: 6.23s / 7.58s / 18.00s across S1/S2/S3. `acceptSponsorOffer`
loaded the entire sponsorship history once per club before checking the selected offer, creating a
growing all-history scan during AI's annual sponsorship refresh. Merchandise was the next largest
but remained approximately linear (12.33s / 15.59s / 15.71s).

The fix adds a primary-key `sponsorship(id)` repository lookup and keeps the existing club-scoped
exclusivity check, ledger idempotency key, historical event, and contract state transitions intact.
Club-finance phase timings changed from 31.11s / 32.48s / 43.90s to 30.67s / 37.07s / 41.41s in
matched instrumented runs; sponsorship changed to 5.22s / 6.94s / 9.01s. The post-fix run took
160.34s / 148.76s / 165.22s per season, 474.31s cumulative, with 2,571/2,634 matches/fixtures,
zero structural shortages, zero emergency lineups, zero duplicate IDs, finite finances, and
reload validation passing. The exact per-season wall time is instrumentation-sensitive; the
sponsorship reduction is the accepted result.

The finance path still processes 573 club accounts per month. No evidence justified changing
ledger semantics or deleting history. A 20-season run remains unready pending a clean benchmark and
longer stability gate.

### Five-season scaling validation (2026-09-03)

The canonical five-season workload was run once from the post-sponsorship optimization state with
seed `long-save-post-freeze-2026`, checkpoint/reload enabled, and no gameplay changes. All five
seasons completed through the production progression path. Per-season elapsed times were **178.89s,
145.10s, 159.93s, 177.32s, and 178.71s**, for **839.95s cumulative**. The economy/ownership/AI
phase was **34.95s, 36.57s, 41.86s, 46.98s, and 41.67s**; the observed S4 increase did not
continue into S5. AI procurement remained bounded at **0.70s, 0.96s, 1.20s, 1.46s, and 1.44s**.
Sponsorship processing across the twelve monthly finance passes was **6.23s, 6.99s, 8.98s,
8.10s, and 8.97s** per season, with no renewed historical-table growth pattern.

| Season | Elapsed | Economy/AI | Procurement | Sponsorship |      RSS |  Database |
| ------ | ------: | ---------: | ----------: | ----------: | -------: | --------: |
| 1      | 178.89s |     34.95s |       0.70s |       6.23s | 519.9 MB |  82.28 MB |
| 2      | 145.10s |     36.57s |       0.96s |       6.99s | 612.9 MB | 116.49 MB |
| 3      | 159.93s |     41.86s |       1.20s |       8.98s | 611.4 MB | 151.38 MB |
| 4      | 177.32s |     46.98s |       1.46s |       8.10s | 612.8 MB | 185.56 MB |
| 5      | 178.71s |     41.67s |       1.44s |       8.97s | 613.7 MB | 221.37 MB |

All **4,309 / 4,309 matches** completed, with zero structural shortages, zero emergency lineups,
zero duplicate IDs in the harness checks, finite finances, valid rollovers, and successful reload
checkpoints. The benchmark DB is removed by the harness after capture, so direct `dbstat` table
attribution was unavailable; persisted snapshot counts show expected linear growth in fixtures
(872 → 4,414), matches (851 → 4,309), persons (3,555 → 4,459), and player knowledge
(21,094 at the final checkpoint). No duplicate or redundant snapshot accumulation was reported.
RSS rose during the first reload boundary and then plateaued at approximately **611–614 MB**;
this is bounded over the five-season run, though heap/native attribution was not collected.

The five-season scaling gate **PASSED**: S4/S5 showed no renewed superlinear runtime, procurement
and sponsorship remained bounded, memory plateaued, and correctness/data integrity stayed green.
The expensive 20-season run is now **READY_FOR_20_SEASON_VALIDATION**, but has not been run and
therefore does not itself constitute a 20-season release-performance pass.

### Twenty-season long-save validation (2026-09-03)

The canonical production benchmark was run once from `24b1776` with seed
`long-save-post-freeze-2026`, one-season checkpoint/reload boundaries, and the final database
retained for inspection. All **20 seasons** completed through `2046-07-31` in **4,184.53s** of
simulation elapsed time (**4,199.27s** including Vitest overhead). Per-season elapsed times were:

`172.74 / 137.66 / 154.82 / 166.65 / 187.45 / 186.14 / 216.47 / 211.92 / 231.56 / 224.72 /
221.89 / 216.47 / 217.19 / 208.26 / 214.60 / 221.79 / 251.75 / 252.06 / 248.48 / 241.92s`.

Median season runtime was **216.47s**, maximum **252.06s**, and Season 20 was **69.18s / 40.1%**
slower than Season 1. The economy/ownership/AI phase remained bounded at
**34.85 / 34.56 / 38.86 / 40.94 / 42.68 / 40.38 / 56.73 / 45.02 / 49.31 / 45.37 / 44.78 /
43.86 / 39.69 / 38.24 / 42.00 / 40.70 / 45.73 / 42.87 / 43.77 / 42.63s**. The 20-season
harness did not emit separate sponsorship or AI-procurement timers; those submetrics remain
covered by the five-season instrumentation above and were not inferred here.

| Checkpoint | Runtime |      RSS |  Database | Matches | Persons | Structural shortages |
| ---------- | ------: | -------: | --------: | ------: | ------: | -------------------: |
| 1          | 172.74s | 520.8 MB |  82.27 MB |     851 |   3,555 |                    0 |
| 5          | 187.45s | 511.9 MB | 221.37 MB |   4,309 |   4,469 |                    0 |
| 10         | 224.72s | 514.0 MB | 402.50 MB |   8,770 |   5,495 |                    0 |
| 15         | 214.60s | 594.8 MB | 587.55 MB |  13,310 |   6,604 |                    0 |
| 20         | 241.92s | 595.6 MB | 776.31 MB |  17,934 |   7,714 |                    0 |

Every checkpoint had zero emergency lineups, zero duplicate IDs, finite finances, no suspended
competition states, and successful save/reload. All 100 competition seasons rolled over. The final
SQLite integrity check returned `ok`, migrations reached version 91, and no active/retired player
contradictions were observed. Generated-player history recorded **1,676** `YOUTH_PLAYER_GENERATED`
events; no retirement-state rows were present in this save, so retirements are reported as **0
persisted retirement states**, not inferred from population changes.

Database growth was approximately linear: **82.27 → 776.31 MB**. Final `dbstat` leaders were
`match_events` (321.0 MB), `club_ledger_entries` (98.4 MB), `federation_ledger_entries` (30.6 MB),
`player_knowledge` (29.5 MB), `commercial_history_events` (19.5 MB), and `historical_events`
(12.4 MB). Row growth was led by match events (**1,090,321**), club ledger entries (**484,771**),
commercial history (**137,520**), federation ledger entries (**129,531**), and historical events
(**34,175**); these are expected persisted histories, with no duplicate-ID accumulation reported.

RSS remained near **508–514 MB** through Season 10 and then rose to **581–596 MB** before
plateauing through Season 20. This is a bounded capacity step rather than continuous per-season
growth in this run. The long-save correctness, data-integrity, save/reload, memory-growth, and
performance gates **PASSED**. The final database is retained in the temporary benchmark directory
for audit inspection and is not part of the repository.
