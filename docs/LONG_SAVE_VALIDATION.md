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
