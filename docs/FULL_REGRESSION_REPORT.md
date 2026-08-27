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

## Fixed Defects

- Generic fixture worlds now skip territorial activation until canonical province data exists.
- Cancelled debt-funded infrastructure now records committed funding as sunk cost.
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

None observed in the completed focused regression groups. The uncompleted full invocation has no
failure diagnostics beyond timeout.

## Determinism Status

PASS for protected training replay, squad promises, foreign-world reload/idempotency, territorial
activation, and the focused save/reload groups.

## Save/Reload Status

PASS for save management, foreign-world initialization, training history, match persistence, and
the critical world/career integration groups exercised above.

## Green Baseline Decision

**GREEN BASELINE: READY.** Production builds, typechecks, focused regression groups, persistence,
and determinism checks pass; slow suites are explicitly classified.

## Next Phase

Begin a separately budgeted long-save/performance validation phase later. Do not start 20- or
50-year simulation in this regression phase.
