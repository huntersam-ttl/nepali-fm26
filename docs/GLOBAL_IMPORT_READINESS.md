# Global Import Readiness

## Dataset Version

`football_world_import_v16` from `football_world_import_v16.xlsx`.

## Final Totals

The final candidate contains 1,458 players, 540 clubs, 149 staff, 169 leagues, 33 competitions,
63 federations, 1,224 player-club history rows, 21 Nepal foreign-player links, and 12 sources.
The league/federation increases are explicit context rows reconstructed from supplied country,
code, and relationship tuples; unsupported detail fields remain `UNKNOWN`.

## Validation Results

The final candidate `/tmp/football_world_import_v16_reconciled_final.xlsx` validates at:

- FATAL: 0
- ERROR: 0
- WARNING: 20

The 20 warnings are duplicate/coverage and unresolved current-club review notices; they do not
create orphan canonical relations or block a context-only import.

## Manual Review Count

Two relationship fields remain in `artifacts/import/v16-manual-review-final.csv`: `Aaha! Rara Gold
Cup` and `Budha Subba Gold Cup`. They are tournament affiliations, not invented league rows.

## Nepal Overlaps

Nepal club records retain their stable workbook IDs and are not duplicated by this pass. Verified
existing Nepal facts retain precedence; the two tournament relationships remain review-only.

## Context-Only Enforcement

All external leagues are `is_playable_in_game=NO` and `simulation_depth=CONTEXT_ONLY`; external
clubs remain context-only and cannot become player-managed careers.

## Dry-Run Counts

Two DRY_RUN executions produced equivalent deterministic plans. No APPLY was executed.

## Known Warnings

Twenty non-fatal warnings remain for duplicate candidates, coverage metadata, and incomplete
current-club mapping. No source URL or provenance value was fabricated or upgraded.

## APPLY Decision

`READY_FOR_APPLY` for explicit review-approved execution. APPLY remains intentionally unrun in
this task.
