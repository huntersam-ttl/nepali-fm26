# Nepal August 2026 Dataset Slot

This folder is reserved for the researched Nepal football starting database targeting August 2026.

Do not add unsourced factual records here. Real records should be imported as structured datasets using
the Stage 2 schema and must carry provenance plus one of these statuses:

- `VERIFIED`
- `REPORTED`
- `ESTIMATED`
- `UNKNOWN`
- `SIMULATION_ONLY`

Testing-only data belongs in `data/fixtures/`.

## Club Registry Import

`club-registry.json` is the first real Nepal data staging import. It imports club identities, teams,
women's branches, academy links, aliases, competition memberships, locations, and venues.

It intentionally does not import players, staff, ratings, finances, budgets, squad values, Football
Manager IDs, or proprietary game ratings.

The supplied registry did not provide direct source URLs for every field in this task, so factual
records are generally marked `REPORTED` with `MEDIUM` confidence. Unknown venue capacity, pitch type,
founded year, and similar unavailable facts remain explicit `UNKNOWN` values.

Candidate venue relationships are supported by the schema, but this first registry file leaves them
empty where the supplied task text did not provide a specific club/team-to-venue mapping.

The competition section includes semantic competition categories, 2026 competition seasons, and
starter pyramid links for A-Division, B-Division, C-Division, Nepal Super League, and ANFA National
League. Promotion/relegation slot counts and fixture-rule details are marked `SIMULATION_ONLY` until
the research process imports verified ANFA competition regulations.
