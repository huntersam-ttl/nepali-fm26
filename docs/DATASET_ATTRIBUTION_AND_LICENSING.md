# Dataset Attribution and Licensing Record

Status: **AUDIT RECORD — LICENSING EVIDENCE INCOMPLETE**  
Audit date: 2026-09-03  
Runtime seed: `football_world_import_v16_reconciled_final`

This is a conservative release record, not a license grant. Where the repository contains no
license or redistribution permission, the status remains `UNRESOLVED` or `UNKNOWN`.

## Release decision

| Area                                  | Status            | Interpretation                                                                                                                                                                |
| ------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dataset inventory and provenance      | PASS              | Production inputs and transformations are identified below.                                                                                                                   |
| Attribution record                    | PASS              | Known source names and URLs are recorded without upgrading confidence.                                                                                                        |
| Licensing / redistribution permission | FAIL / UNRESOLVED | No source license grants or redistribution permissions were found in this repository. Legal review or source-specific permission remains required before public distribution. |
| Package attribution surface           | REQUIRED          | Include this record, or a release-approved equivalent, in About/Credits or release documentation.                                                                             |

## Production datasets

| Dataset                        | Path / lineage                                                            | Content and provenance                                                                                                                                                                              | License status                                                                  |
| ------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Global runtime seed v16        | `data/global/football-world-v16.seed.json`                                | Federations, competitions, leagues, clubs, players, staff, player-club history, and Nepal foreign-player context. Source IDs, confidence, provenance, and review metadata are retained per record.  | `UNRESOLVED`: source URLs exist, but redistribution permission is not recorded. |
| Global import workbook lineage | `football_world_import_v16.xlsx` (approved input outside this repository) | Validated by `packages/data-import`; stable IDs, source register, provenance, confidence, and duplicate review are required. The workbook is not read at runtime.                                   | `UNKNOWN`: ownership and redistribution terms are not documented here.          |
| Nepal club registry            | `data/nepal/2026-08/club-registry.json`                                   | Nepal clubs, teams, women branches, academies, competitions, venues, locations, relationships, and staging metadata. Generally `REPORTED`, `MEDIUM` confidence; unavailable facts remain `UNKNOWN`. | `UNRESOLVED`: supplied-registry terms are not documented here.                  |

The global seed inventory is 63 federations, 33 competitions, 169 leagues, 540 clubs, 1,458
players, 149 staff records, 1,224 player-club history records, and 21 Nepal foreign-player
records. These are inventory counts, not a claim that every record is independently verified.

## Source register and attribution

The seed names these publishers. URLs are research/attribution references only and do not imply
permission to redistribute source content, logos, marks, or database extracts.

| Source         | URL                           | Recorded type / quality | License status |
| -------------- | ----------------------------- | ----------------------- | -------------- |
| FIFA           | https://www.fifa.com          | Federation / primary    | `UNKNOWN`      |
| AFC            | https://www.the-afc.com       | Confederation / primary | `UNKNOWN`      |
| ANFA           | https://the-anfa.com          | Federation / primary    | `UNKNOWN`      |
| GoalNepal      | https://goalnepal.com         | News / secondary        | `UNKNOWN`      |
| Transfermarkt  | https://www.transfermarkt.com | Database / secondary    | `UNKNOWN`      |
| The FA         | https://www.thefa.com         | Federation / primary    | `UNKNOWN`      |
| RFEF           | https://rfef.es               | Federation / primary    | `UNKNOWN`      |
| AIFF           | https://www.the-aiff.com      | Federation / primary    | `UNKNOWN`      |
| HamroKhelkud   | https://hamrokhelkud.com      | News / secondary        | `UNKNOWN`      |
| Kathmandu Post | https://kathmandupost.com     | News / secondary        | `UNKNOWN`      |
| Soccerway      | https://soccerway.com         | Database / secondary    | `UNKNOWN`      |
| UEFA           | https://www.uefa.com          | Confederation / primary | `UNKNOWN`      |

The Nepal registry additionally documents selected National Sports Council, ANFA, APF, and
Kathmandu Post venue/geography references. No source-specific license terms were found here.

## Provenance and simulation boundaries

The canonical vocabulary is `VERIFIED`, `REPORTED`, `ESTIMATED`, `UNKNOWN`, and `SIMULATION_ONLY`.
`VERIFIED` describes the accepted evidence process, not copyright permission. `REPORTED` and
`UNKNOWN` are never silently promoted. `SIMULATION_ONLY` marks generated gameplay state.

- Imported identities retain stable internal IDs and source metadata.
- Future fixtures, results, contracts, transfers, finances, development, elections, sponsorships,
  and other post-start events are dynamic simulation / alternate history.
- Sponsor offer values, terms, bonuses, and negotiation outcomes are `SIMULATION_ONLY`.
- Generated players, local businesses, projects, supporter states, and other generated entities
  are `SIMULATION_ONLY` unless explicitly source-backed.
- `data/fixtures/` is testing-only and must not be presented as researched factual data.

Nepal is the fully playable production scope. Non-Nepal clubs, competitions, players, and
federations are `CONTEXT_ONLY` unless an explicitly supported interaction consumes them. The game
does not run detailed foreign youth, league, scouting, or finance simulation. Stable internal IDs
are the identity boundary; no logo, photograph, font, or other branded-asset license inventory was
found in this repository.

## Release actions and unresolved items

Before public redistribution, obtain and record source-specific permission or an applicable
license for the imported factual datasets, then update this document and the manifest with exact
terms and required attribution. Unresolved items are:

- the external approved `football_world_import_v16.xlsx` workbook and contributors;
- FIFA, AFC, ANFA, The FA, RFEF, AIFF, and UEFA source material;
- GoalNepal, HamroKhelkud, Kathmandu Post, Transfermarkt, and Soccerway source material;
- the supplied Nepal registry and venue/geography references;
- any separately packaged logos, photographs, fonts, or branded assets.

This record closes the missing-documentation gap by making uncertainty visible; it does not resolve
the underlying legal permissions. The existing About/Credits surface or release bundle should link
or include this record. No desktop UI or `appBridge.ts` change is made by this audit.
