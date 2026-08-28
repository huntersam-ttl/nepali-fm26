# Global Football Workbook Import

## Workbook Contract

`football_world_import_v16.xlsx` is read as untrusted input. The canonical sheets are
`PLAYERS`, `CLUBS`, `STAFF`, `LEAGUES`, `COMPETITIONS`, `FEDERATIONS`,
`PLAYER_CLUB_HISTORY`, `NEPAL_FOREIGN_PLAYERS`, and `SOURCES`. `DUPLICATE_REVIEW` and
`COVERAGE_SUMMARY` are informational. Headers are exact; only cell whitespace, safe country
aliases, dates, booleans, and explicit position aliases are normalized.

## Validation and Normalization

Stable IDs and prefixes are required (`PLY-*`, `CLB-*`, `STF-*`, `SRC-*`, and equivalent entity
prefixes). Dates, references, source integrity, provenance (`VERIFIED`, `REPORTED`, `UNKNOWN`),
confidence (`HIGH`, `MEDIUM`, `LOW`), positions, and booleans are checked. No URLs are fetched.

## Deduplication and Nepal Precedence

Identity candidates use stable ID plus identity evidence (name, DOB, nationality, club/history),
never name alone. Results are classified as exact, strong, possible, or new. Existing verified
Nepal facts win over reported/unknown conflicts; conflicting verified facts are review items.
Nepal clubs are mapped by canonical identity and are never copied as a second club.

## Dry Run and Apply

```sh
pnpm --filter @nepal-football-sim/data-import build
pnpm --filter @nepal-football-sim/data-import exec node dist/global-football-import-cli.js validate-world-import football_world_import_v16.xlsx
pnpm --filter @nepal-football-sim/data-import exec node dist/global-football-import-cli.js dry-run-world-import football_world_import_v16.xlsx
```

Both commands write machine-readable JSON and human-readable Markdown under the chosen output
directory. `DRY_RUN` creates a deterministic canonical plan and never mutates a database. APPLY is
an explicit API call to `applyGlobalFootballImport(report, store)`; it refuses fatal or row errors,
requires a validated plan, and delegates dependency-safe persistence to the application store.

## Idempotency and Provenance

Stable external IDs are the identity boundary. A store must upsert by those IDs and record action,
dataset version (`football_world_import_v16`), canonical ID, provenance, and review findings.
Generated gameplay values remain `SIMULATION_ONLY`; factual UNKNOWN/REPORTED values are never
promoted to VERIFIED.

## Dataset Versioning and Existing Saves

Import enriches a starting world. It must be selected before creating a career and must not inject
new factual identities into an in-progress save automatically. The workbook is never imported at
game startup, and external clubs remain `CONTEXT_ONLY`.

## Canonical Seed and Runtime Data Policy

The workbook is an **import input**, not a runtime dependency. It lives outside the repository, so a
fresh checkout could never build the global world from it — the dataset previously existed only
inside whichever database an operator had run APPLY against.

The runtime source is now a committed artifact:

- **Source of truth for research/import:** the approved reconciled workbook (XLSX), outside the repo.
- **Source of truth for runtime/new saves:** `data/global/football-world-v16.seed.json`.
- **Regeneration:** `pnpm --filter @nepal-football-sim/data-import global:seed <xlsx>` runs the same
  validated dry-run the importer already performs and writes the normalized plan. It refuses to write
  when the workbook produces fatal or error findings, and the same approved workbook produces an
  equivalent artifact each time.

Consequences:

- No XLSX is parsed at game runtime, and nothing reads `/tmp` or developer-local files.
- The seed records its own path, so runtime can never reach back to the workbook.
- The dataset version (`football_world_import_v16_reconciled_final`) is stored per world in
  `global_dataset_imports`, and application is idempotent by that version.
- A new save receives the dataset automatically during initialization; no separate import command.
- **Existing careers are not rewritten.** The seed is applied only at save creation, so an
  in-progress world keeps the dataset it started with.
- `createNepalSave` accepts `globalSeedPath: null` to build a Nepal-only world for fixtures and
  focused tests.
