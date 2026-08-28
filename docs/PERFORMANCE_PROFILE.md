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

None that meet a P0/P1 bar. The open question is test design rather than engine performance: proving
determinism by simulating twelve seasons is expensive, and a shorter deterministic assertion would
recover most of the runtime. That is a decision about test intent, not an optimization.

## Measurement Guidance

Timings taken while another agent is running suites are not usable — the observed distortion was
11–25x. Confirm the machine is idle before recording any performance figure.
