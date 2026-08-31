# Economy determinism validation

The stage-ten same-seed economy diagnostic failure was reproduced with only:

```sh
pnpm -s vitest run packages/testing/src/stage-ten-club-economy.test.ts -t 'is deterministic for same-seed'
```

The first divergence was sponsor value and derived revenue (Sanepa Football
Club was an early example). The two temporary saves used different bootstrap
seeds (`deterministic-economy-a` and `deterministic-economy-b`) while the
diagnostic itself used the same seed. Save creation consumes seeded randomness
for starting commercial/supporter state, so the comparison was between two
different worlds. This was a test fixture bug, not an economy simulation bug.

The regression now creates isolated databases with the same bootstrap seed and
retains the semantic report comparison. A fast one-month regression also
compares representative A-, B-, and C-Division finance outputs. No production
code or balance values changed. The two-season diagnostic remains an explicit
slow validation; the one-month test is the quick regression guard.
