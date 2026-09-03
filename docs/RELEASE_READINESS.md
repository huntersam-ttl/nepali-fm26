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
| Performance                   | FAIL_PERFORMANCE | Five-season validation completed in 839.95s (178.89s/145.10s/159.93s/177.32s/178.71s), with bounded S4/S5 scaling, procurement at 0.70–1.46s/season, sponsorship at 6.23–8.98s/season, correctness passing, and RSS plateauing around 611–614 MB. The 20-season performance gate remains unproven; the next 20-season validation is now justified.                                                                                       |
| Dataset attribution/licensing | FAIL             | A complete published attribution/licensing document is still missing.                                                                                                                                                                                                                                                                                                                                                                    |
| Apple signing/notarization    | SIGNING_BLOCKED  | Matching Developer ID private key and notarytool credentials are not installed. No signing attempt was made.                                                                                                                                                                                                                                                                                                                             |

## Runtime QA notes

- The packaged bundle includes the expected runtime/data resources and the configured save-directory creation path is exercised by the Tauri startup code.
- The browser smoke suite has two stale case-sensitive selectors using `/New Career/` while the live accessible label is `New career`. This is test-harness maintenance, not a packaged-runtime failure; peer-owned test files were not modified.
- The matchday browser spec was not rerun after that selector diagnosis because the user requested no broad benchmark or unrelated test cleanup. Existing focused matchday coverage remains separate.
- No migration, startup crash, missing-seed, IPC, save-directory, or release-build module defect was reproduced.

## Verdict

**RELEASE_READY = NO.** Packaging/runtime smoke passes, but performance, dataset attribution/licensing, and Apple signing/notarization remain open release gates.
