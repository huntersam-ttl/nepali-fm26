# Long-save validation

## Canonical run

- Requested baseline: `772ead8`; actual checkout at launch: `772ead8` (later peer commits are present in the shared checkout).
- Command: `LONG_SAVE_RUN=1 LONG_SAVE_SEASONS=20 LONG_SAVE_CHECKPOINT=1 LONG_SAVE_SEED=long-save-post-freeze-2026 pnpm vitest run packages/testing/src/long-save-validation.test.ts --maxWorkers=1 --minWorkers=1`
- Harness: `packages/testing/src/long-save-validation.test.ts`.
- Run count: exactly one. No 50-season run was started.
- Start state: only peer-owned untracked path `?? nepali-fm26/`; no staged files.

## Result

The run was still CPU-active after 2:00:11 (PID 37002, approximately 60% CPU, 0.8% memory) and had not written the requested JSON report. The output directory remained empty. No correctness assertion, emergency-lineup signal, FK/integrity result, checkpoint, final date, or season-level metric was available at the observation boundary.

Classification: **FAIL_PERFORMANCE** (20-season validation did not complete within the two-hour observation window).

50-season readiness: **OPTIMISE_BEFORE_50**. The 20-season run must complete and emit checkpoints before any 50-season claim.

Feature freeze: maintained. No production gameplay changes, threshold changes, or harness changes were made. Release readiness: **not ready** pending a terminating 20-season validation.

Next pass: profile the long-save simulation/checkpoint path and establish a terminating 20-season run before retrying; do not run 50 seasons meanwhile.

## Bounded scaling diagnosis and one-fix pass

The checkpointed five-season diagnostic completed S1–S5, although the strict validation test failed on position shortages (S5: 3); duplicate IDs were zero and financial values were finite. Workload stayed flat at 851 matches per season while the database grew from 73.1MB to 192.4MB.

| Season | Total | Competitions | Economy/ownership/AI |
|---|---:|---:|---:|
| S1 | 175.8s | 87.2s | 35.4s |
| S2 | 266.7s | 128.2s | 94.0s |
| S3 | 496.6s | 212.8s | 242.2s |
| S4 | 575.3s | 196.3s | 338.6s |
| S5 | 823.6s | 251.6s | 528.5s |

Root cause: `closeClubFinancialSeason` iterated 573 clubs and loaded each club's entire historical `club_ledger_entries`, then filtered the current season in memory. The table grew with every season; the existing `(club_id, entry_date)` index was not used by the unbounded read. The single fix adds a season-prefix predicate to `ClubEconomyRepository.ledgerEntries` and uses it for annual close. Historical ledger rows remain stored.

After three seasons, under unavoidable contention from the prior process: S1 203.8s / economy 50.9s, S2 311.8s / 101.2s, S3 440.8s / 213.8s. Ratios improved to total S3/S1 2.16x (before 3.14x) and economy S3/S1 4.20x (before 6.84x). The same position-shortage assertion failed (7); no duplicate IDs were observed.

Instrumentation commit: `c132bc1`; optimization commit: `6d648dc`. Classification: SCALING_FIX_MATERIAL, with correctness readiness still blocked by squad shortages. Do not run 20 or 50 seasons until that correctness issue and remaining economy slope are addressed.
