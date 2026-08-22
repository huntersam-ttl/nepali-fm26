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
women's branches, academy links, aliases, competition memberships, locations, venues, venue
relationships, and basic location-to-location travel context.

It intentionally does not import players, staff, ratings, finances, budgets, squad values, Football
Manager IDs, or proprietary game ratings.

The supplied registry did not provide direct source URLs for every field in this task, so factual
records are generally marked `REPORTED` with `MEDIUM` confidence. Unknown venue capacity, surface,
pitch quality, altitude, coordinates, founded year, travel distance, and similar unavailable facts
remain explicit `UNKNOWN` facts with no placeholder value.

The venue/geography layer includes all seven provinces, selected districts/cities needed by current
clubs and venues, selected neighbourhoods for precise venue placement where source-backed, an airport
record for future travel hooks, venue owner/operator/user relationships, and climate-risk placeholders.
It does not import all 77 districts yet.

Venue relationships distinguish operator, national-team use, academy use, training use, temporary
use, and ownership. Departmental or NSL relationships must not imply private club ownership unless a
source specifically supports it.

The competition section includes semantic competition categories, 2026 competition seasons, and
starter pyramid links for A-Division, B-Division, C-Division, Nepal Super League, and ANFA National
League. Promotion/relegation slot counts and fixture-rule details are marked `SIMULATION_ONLY` until
the research process imports verified ANFA competition regulations.

Current venue/geography enrichments use official or media sources where available, including the
National Sports Council profile for Dasharath Stadium, ANFA's Satdobato academy profile, an APF
development timeline for Halchowk institutional context, and Kathmandu Post reporting on 2026 venue
usage/surface context. A small number of venue/academy association records remain low-confidence
reported staging data pending replacement by the research process.
