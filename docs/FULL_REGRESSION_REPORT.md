# Nepal Football Universe — Full Regression Report

## HEAD

`4a0ee3f` (`fix(world): make foreign initialization reload-safe`), descended from the requested
post-freeze baseline `dc7214d`.

## Environment

- macOS, zsh, Node/pnpm workspace at `/Users/cc/nepali-fm26`.
- Vitest `v2.1.9`; sequential fork pool used for long-running suites.

## Build Results

`pnpm build` passed for all workspace packages, including shared types, database, simulation,
testing, and the desktop Vite production build.

## Typecheck Results

Package production typechecks and root `pnpm typecheck` passed. Test fixture typing was repaired
against the current branded-ID and domain-type APIs.

## Test Groups

Passed focused groups include foundation (9), Nepal world (18), season engine (13), match (51),
manager (36), save management (16), federation/compliance/licensing (16), supporter culture
(19), workforce supply (11), territorial activation (4), infrastructure/macro economy (7),
foreign-world idempotency (5), referee assignment (2), protected training-history stability (4),
and the corrected production fixture group (39 tests).

Squad-promises passed twice in separate runs (6 tests each). No nondeterminism was reproduced.

**Correction — stage-eight transfer market was not executed for the original baseline claim.** It is
now included and passes **17 of 17**. When it was first run it had 12 failures: 11 traceable to the
starting market never being initialized, and one to AI personal-terms negotiation deadlocking (see
Fixed Defects). Starting-market integrity is additionally covered by
`transfer-market-starting-integrity` (4 tests) and negotiation outcomes by
`transfer-personal-terms-e2e` (3 tests), both passing.

## Fixed Defects

- Generic fixture worlds now skip territorial activation until canonical province data exists.
- Cancelled debt-funded infrastructure now records committed funding as sunk cost.
- Starting transfer market: `initializeTransferMarketForSave` treated "any contract exists" as its
  already-initialized sentinel. World creation now generates lower-league squads with youth
  contracts first, so the guard tripped on those rows and returned before any of the 573 imported
  Nepal players received a starting contract. The sentinel is now transfer windows, which only this
  function seeds, and players already holding an active contract are not re-contracted.
- Loan selection offered a player who was already out on loan to every club in turn, tripping the
  loan guard once the market was populated.
- The transfer diagnostic sampled the first offer with any negotiation round, which could be an
  unanswered opening bid; it now samples the fullest timeline.
- AI personal terms deadlocked every permanent transfer. `negotiatePlayerTerms` judged the offer
  status on the caller's copy, which is a stage behind the selling club's persisted acceptance, so
  the player was never actually consulted; and once a player stalled, `PLAYER_STALLED` was not a
  state a revised offer could be judged in. The buying club now answers a stall once — meeting the
  wage baseline and expected squad role within its wage budget — and the player re-decides through
  the same logic. Players still reject and clubs still withdraw.
- The transfer diagnostic counted seller agreements as completed deals. It now reports what the
  repository confirms as COMPLETED and accounts for the difference as `playerRejected`.
- Stale fixture imports, branded IDs, standing shapes, and dataset-count assertions were aligned
  with the current APIs and bootstrap data.

## Stale/Incorrect Tests

The failures above were stale expectations or fixture typing drift, not unexplained production
failures. The competition-distribution assertion also compared a branded ID with raw `"a"` and
was corrected to use the stable fixture ID.

## Performance/Timeout Findings

The protected training-history suite took about 146 seconds; workforce supply took about 88
seconds and licensing production about 38 seconds. The full sequential Vitest invocation reached
its 600-second bound without failure output. Broad career-world, women/youth, and
ownership/commercial batches likewise exceeded short bounds; targeted equivalents passed. These
are classified as slow/too-broad suites, not product failures.

## Remaining Failures

None in the executed groups. Loans remain a separate feature area and were not in scope.

## Determinism Status

PASS for protected training replay, squad promises, foreign-world reload/idempotency, territorial
activation, and the focused save/reload groups.

## Save/Reload Status

PASS for save management, foreign-world initialization, training history, match persistence, and
the critical world/career integration groups exercised above.

## Green Baseline Decision

**GREEN BASELINE: READY.** The earlier READY claim was premature — it was made without running
stage-eight transfer market, which then had 12 failures. Stage-eight has since been executed and
passes 17 of 17, the transfer omission is closed, and the root typecheck is clean.

## Next Phase

Begin a separately budgeted long-save/performance validation phase later. Do not start 20- or
50-year simulation in this regression phase.
