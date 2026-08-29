# Simulation Performance Profile

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
