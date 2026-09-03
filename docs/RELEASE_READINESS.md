# Release readiness

## Verification baseline and current pass

Packaging/runtime verification was performed at HEAD `bb1a9a1`; the current performance pass
started at HEAD `21efb3c` and adds the bounded optimization documented in
`docs/PERFORMANCE_PROFILE.md`.

| Gate                          | Status           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gameplay roadmap              | PASS             | 28 roadmap rows complete; continental coefficient consumer intentionally deferred because no supported club draw/seeding path exists.                                                                                                                                                                                                                                                                                                    |
| Typecheck and builds          | PASS             | Root typecheck, database build, simulation build, and desktop Vite production build pass.                                                                                                                                                                                                                                                                                                                                                |
| Packaging/runtime smoke       | PASS             | Non-signing Tauri universal app, DMG, and ZIP built in a private temporary directory. Bundle inspection confirmed the universal app executable and Node sidecar, canonical Nepal seed, and macOS 11.0 metadata. The packaged app launched and exited cleanly. Clean desktop role smoke passed, including Manager → Owner → President switching, save/reload, budget/finance/facilities/sponsorship actions, and President reads/actions. |
| Performance                   | FAIL_PERFORMANCE | Targeted procurement and sponsorship profiling removed two all-history reconstruction paths. The latest instrumented three-season validation completed in 474.31s (160.34s/148.76s/165.22s), with correctness passing; a clean 20-season performance gate remains unproven.                                                                                                                                                              |
| Dataset attribution/licensing | FAIL             | A complete published attribution/licensing document is still missing.                                                                                                                                                                                                                                                                                                                                                                    |
| Apple signing/notarization    | SIGNING_BLOCKED  | Matching Developer ID private key and notarytool credentials are not installed. No signing attempt was made.                                                                                                                                                                                                                                                                                                                             |

## Runtime QA notes

- The packaged bundle includes the expected runtime/data resources and the configured save-directory creation path is exercised by the Tauri startup code.
- The browser smoke suite has two stale case-sensitive selectors using `/New Career/` while the live accessible label is `New career`. This is test-harness maintenance, not a packaged-runtime failure; peer-owned test files were not modified.
- The matchday browser spec was not rerun after that selector diagnosis because the user requested no broad benchmark or unrelated test cleanup. Existing focused matchday coverage remains separate.
- No migration, startup crash, missing-seed, IPC, save-directory, or release-build module defect was reproduced.

## Verdict

**RELEASE_READY = NO.** Packaging/runtime smoke passes, but performance, dataset attribution/licensing, and Apple signing/notarization remain open release gates.
