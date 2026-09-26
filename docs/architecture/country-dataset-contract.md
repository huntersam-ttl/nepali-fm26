# Home football context and the country dataset contract

Nepal is the first full playable country. The engine no longer assumes it is the only
one: a save is played in one **home country**, recorded once in the save, and country
sensitive code asks for that instead of looking up Nepal, ANFA, NPR or a division name.

## Home football context

Stored in `home_football_contexts` (one row per save) and read through
`packages/simulation/src/home-context.ts`. Nothing else decides who the home country is.

| Field | Meaning |
| --- | --- |
| `packId` | Stable id of the country pack the save was made from (`nepal-v1`). Never a display name. |
| `countryId`, `federationId` | Ids of the home country and its national federation. |
| `currency`, `locale` | Money label and number/date formatting (`NPR`, `en-IN` for Nepal). |
| `federationAbbreviation` | Short federation name used as licence issuer (`ANFA`). |
| `seasonRules` | `seasonStart`, `seasonEnd`, `youthIntake` as MM-DD. |
| `nationalTeams` | The home national-team structure (team type, level, gender, label, strength multiplier). |
| `tierLabels` | Display labels for pyramid tiers, top first. |

Resolvers: `homeFootballContext`, `homeCountryId`, `isHomeCountry`, `homeFederation`,
`isHomeFederation`, `homeCurrency`, `homeLocale`, `homeSeasonRules` (+ `seasonStartDate`,
`seasonEndDate`, `seasonEndInYear`, `seasonPeriodMonthsFor`), `homeNationalTeams`,
`homeNamePool`, `homeIsoCodes`. Raw SQL uses the `home_football_country` view
(`(SELECT country_id FROM home_football_country LIMIT 1)`). The context is cached per
database connection.

**Old saves.** Migration 103 infers the context once from the canonical country (by ISO
code) and its federation, so no save has to be recreated. A hand-built database that never
had a context gets the same inference on first use. The ISO forms `NPL`/`NP` therefore
appear in exactly two places: the Nepal pack and that legacy inference.

## Country pack

A pack (`country-pack.ts`; Nepal's is `country-packs/nepal.ts`) is the configuration that
goes with a country dataset. It is registered with `registerCountryPack`. A save stores a copy
of the parts it needs (`config_json`), so it stays playable if the pack later changes.

| Pack field | Meaning |
| --- | --- |
| `isoCodes`, `currency`, `locale`, `federationAbbreviation`, `seasonRules`, `tierLabels`, `namePool` | Identity, money label, calendar, display labels, people names. |
| `nationalTeams` | National-team structure (team type, level, gender, label, strength multiplier); `nationalTeamCodePrefix`, `internationalProfile` for the registry. |
| `geography` (optional) | Administrative areas of any depth and kind that a new save must have, the territorial units, and club-address hubs (`country-packs/nepal-geography.ts`). The `locations` table stays the source of truth. |
| `commercial` (optional) | Lenders, the club sponsor pool and the federation's sponsors (`country-packs/nepal-commercial.ts`). Identities only: reputations, tiers, rates and contracts are the economy's. |
| `media` (optional) | Media outlets and the journalists dealt to them (`country-packs/nepal-media.ts`). |
| `initialiseTerritory`, `ensureTerritorialStructure` (optional) | Hooks that build territorial units and seed the pack's places. |

An absent optional field means the country has none of it: nothing is inherited from Nepal.
A country with no media outlets publishes no stories and cannot hold a press interview.
Country codes: `countries.iso_code` keeps the code a row was created with; every other code
is an alias (`country_codes`), resolved through `CountryCodeRepository`.

## Country dataset contract

`packages/data-import` defines the dataset shape (`countryWorldDatasetSchema`; the
`Nepal…` names are the same contract). A country needs:

- **Identity**: `meta.datasetId`, one country per ISO code, one national federation.
- **Geography**: `locations` (with parents/kinds), `venues`, `locationTravelContexts`.
- **Football**: `competitions` (with `category`), `competitionSeasons`, `competitionRules`,
  `competitionRelationships` (PROMOTION/RELEGATION/QUALIFICATION), `clubs`, `teams`,
  `clubMemberships`, `academies`.
- **People**: `persons`, `personRoles`, `teamPersonAssignments`, `playerAttributes`,
  `playerFactualProfiles`, `staff*`, `refereeProfiles`, and the pack's name pool.
- **National teams**: national `teams` (club-less) for each structure entry in the pack.
- **History and provenance**: `provenance` on every record; `staffHistoryEvents`, etc.

Rules the engine relies on: pyramid order comes from the PROMOTION/RELEGATION
relationships (the `competition_tiers` view), never from names; a competition is "home"
by its member clubs' country; behaviour that used to key on a competition name keys on its
`category` (e.g. `SPECIAL_NATIONAL_LEAGUE` for the national cup-league prize pool).

## Domestic versus global

- **Domestic (home country only)**: the club pyramid and its promotion/relegation, the home
  federation and its governance, local finance rules, local geography and territory,
  national-team structure, staff/official/youth generation, name pool.
- **Global / shared**: transfers and the player market, the world's countries and their
  context clubs, international opponents and their profiles, confederations and
  international competitions, the foreign football world.

Some loops still mean "the home country" while iterating "the world" (marked in the audit);
those are the ones to check first for country #2.

## Adding country #2

1. Author the dataset and validate it with `countryWorldDatasetSchema`.
2. Add a pack (`isoCodes`, currency, locale, federation abbreviation, season rules,
   national teams, tier labels, a name pool) and register it.
3. Create saves with `createCountrySave({ packId, ... })` (Nepal: `createNepalSave`).
4. Give competitions a `category` and the pyramid its relationships.
5. Only add a country selector when the second dataset exists.

## What is still Nepal-specific (deliberately or deferred)

- **Product and UI**: the name, imagery, copy and sponsor/place names are Nepal's by design.
- **Data still in code**: the registry of international nations (`international-football.ts`)
  and the AFC/SAFF competition definitions (`international-competition-config.ts`, data but
  AFC-only), the foreign-market country lists (`foreign-football-world.ts`), agent network
  tiers and neighbour markets (`transfer-market`), the youth `nepalDevelopmentProfile`,
  Nepali supplier names (`clubmart.ts`), the Nepal club-id prefixes in the default
  recruitment profile, and the test-only world in `world.ts`.
- **Money scale**: wages, fees and budgets are calibrated in Nepali-rupee magnitudes. The
  currency *label* is configurable; a second currency also needs a price-level factor.
- **Closed vocabularies that are deliberate**: `FootballConfederation`,
  `FootballRegion` and `ExternalFootballRegion` are finite football taxonomies.
  `NationalTeamType`, `TeamLevel`, `CampDestination` and `InternationalCompetitionKey` accept
  dataset-defined values; the simulation says which it plays.
- **Still Nepal-worded**: user-facing messages in the founder flow, the stored club reach
  value `SOUTH_ASIA` and agent tiers named for South Asia.
- **Fixed on the way**: generated referees, assistants, AI managers and AI staff took the
  first country by id or name (all 513 generated officials were Australian nationals). They
  are now home-country nationals, which also lets the federation's referee-development
  programmes run (three more `REFEREE_DEVELOPMENT` ledger entries over three seasons).
