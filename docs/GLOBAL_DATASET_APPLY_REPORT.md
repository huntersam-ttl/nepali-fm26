# Global Dataset Apply Report

## Dataset and validation

The explicit APPLY source was `/tmp/football_world_import_v16_reconciled_final.xlsx`. The source
workbook in Downloads was not modified. VALIDATE returned 0 fatal, 0 error, and 20 warnings;
DRY_RUN returned the same deterministic plan twice (3,669 actions). Two tournament-affiliation
rows remain in `artifacts/import/v16-manual-review-final.csv` and were skipped from league import.

## Isolated APPLY

The transaction completed on an isolated Nepal save with dataset version
`football_world_import_v16_reconciled_final`:

| Entity | Inserted | Mapped | Other |
| --- | ---: | ---: | ---: |
| Federations | 62 | 1 | — |
| Leagues | 169 | 0 | — |
| Competitions | 30 | 3 | — |
| Clubs | 538 | 2 | 2 manual-review rows |
| Players | 1,456 | 2 | — |
| Staff | 149 | 0 | — |

The import also persisted 1,224 player-club history rows, 21 Nepal foreign-player links, and 12
source records. No conflicts or no-op anomalies were observed. A second APPLY was idempotent:
all insert counts were zero, with 63/169/33/540/1,458/149 mapped federation/league/competition/
club/player/staff totals and no conflicts.

## Integration and safety

Imported external clubs and players receive context-only records; external leagues remain
non-playable. Duplicate canonical player IDs were zero and imported clubs without context were
zero in the completed apply. Save close/reopen preserved the dataset metadata and import audit
records. Scouting and partnership wiring was implemented, but the bounded production career
progression smoke did not return within 90 seconds and was stopped; it is not reported as passed.
The supplementary foreign-world helper run was therefore not used to claim full production
activation.

## Verification status

Package builds for database, data-import, and simulation passed. Full workspace typecheck remains
blocked by the unrelated dirty `transfer-market` change and its untracked integrity test. No
unrelated files were modified, staged, reset, stashed, or cleaned.

**Decision: APPLY COMPLETE; PRODUCTION ACTIVATION PENDING bounded progression performance fix.**
