# Nepal Football Universe — Long-Save Validation

## HEAD

`47ce9da` (`fix(regression): establish post-freeze green baseline`). No gameplay or UI changes
were made in this phase.

## Test Configuration

- Deterministic seed: `long-save-post-freeze-2026`.
- Starting dataset: `data/nepal/2026-08/club-registry.json`.
- Starting world date: the dataset save date (`2026-08-01`).
- Authoritative path: `createNepalSave` plus `simulateNepalCareer`, with normal economy,
  federation, international, foreign-world, youth, territorial, workforce, history, and
  competition processing enabled.
- Harness: `packages/testing/src/long-save-validation.test.ts`.

## Runtime

The full-world path is CPU-bound. A five-calendar-season progression required approximately
24.8 minutes in the bounded attempts; peak observed RSS was approximately 497 MB.

## 20-Season Results

The 20-season run was attempted repeatedly with a 30-minute hard bound. No crash or database
constraint error occurred, but the corrected run did not complete its final assertions within the
bound. The 20-season gate is therefore **BLOCKED: PERFORMANCE**.

## 50-Season Results

Not started. The required 20-season gate did not pass, so proceeding would violate the phase gate.

## Structural Invariants

In the completed partial run: duplicate IDs were zero for persons, clubs, fixtures, matches, and
training-history events; financial values were finite; and emergency lineups were zero. The same
partial run recorded 22 position-shortage cases, which requires follow-up before a structural pass.

## Population / Workforce

Partial five-season snapshot: 2,411 persons, 1,537 player attributes, 260 staff profiles, and
606 referee profiles. Workforce deadlock was not observed before the time bound.

## Competition Continuity

Partial snapshot: 4,554 fixtures, 4,449 matches, 25 competition winners, and no suspended season
states. Full 20/50-season continuity remains unproven.

## Economy

No NaN/Infinity financial values were observed. Long-run cash/debt stability was not proven before
the runtime bound.

## Clubs / Ownership

No duplicate club IDs or orphaning diagnostic was observed in the partial snapshot. Ownership-era
continuity over 20/50 seasons remains unproven.

## Federation

Four leadership tenures existed in the partial snapshot. Long-run succession/compliance continuity
remains unproven.

## Women / Youth

Women’s and youth paths were included in the authoritative run. Long-run replenishment remains
unproven; no separate balance change was made.

## Territorial

Territorial processing was enabled. Long-run project, district, province, and representative-
competition continuity remains unproven.

## International / Foreign World

International and foreign-world processing was enabled. The partial run created 28 countries and
preserved the foreign-world path; 20/50-season regeneration remains unproven.

## History / Records

The partial snapshot contained 100 season awards and 1,532 training-history events, with no
duplicate training-history IDs.

## Save Size / Database Growth

The partial five-season database reached approximately 130 MB. Growth is substantial and requires
profiling before multi-decade validation can be considered viable.

## Performance Findings

The dominant cost is the full production career loop plus persistent match/history/economy work.
The 20-season attempt repeatedly exceeded 30 minutes without failure output. This is a clear
performance blocker for the next long-save gate, not a justification to shorten the run.

## Determinism

Existing focused deterministic and save/reload tests pass. A new 5–10-season paired comparison was
not run because the single authoritative long-save attempt already exceeded the bounded runtime.

## Product Defects Found

No crash, constraint violation, duplicate-ID corruption, or non-finite finance was found. The 22
position-shortage cases are an unresolved squad-supply structural finding, and the 20-season
runtime is an unresolved performance blocker.

## Balance Observations

None promoted to balance conclusions. Population size, country count, and database growth are
recorded as structural/performance observations only; no tuning was performed.

## Long-Save Gate Decision

**20-SEASON STRUCTURAL GATE: BLOCKED.** The required run did not complete within the bound, and
position-shortage cases require investigation.

**50-SEASON STRUCTURAL GATE: NOT RUN.** It is gated on a clean 20-season result.

## Recommended Next Phase

Profile and reduce the authoritative long-save bottleneck, then investigate the position-shortage
cases. Rerun the 20-season gate with the same seed and configuration; only after it passes should a
50-season world-regeneration run begin. Do not start balancing, UI work, or global-data import yet.
