# Data Model

## Geography and Governance

- `Country`: national container, starting with Nepal in future data.
- `Location`: city, district, province, stadium, or unknown place within a country.
- `Venue`: stadium or ground record linked to a country and optionally to a location.
- `Federation`: national football governing body linked to a country.

## Clubs and Teams

- `Club`: football club with country, optional location, founded year, and ownership type.
- `ClubOwnershipType`: supports `PRIVATE`, `CORPORATE`, `COMMUNITY`, `MEMBER_OWNED`, `DEPARTMENTAL`, `MUNICIPALITY_BACKED`, `INSTITUTIONAL`, and `UNKNOWN`.
- `Team`: senior, reserve, academy, or age-level side linked to a club or federation.
- `TeamPersonAssignment`: links imported players, managers, or staff to a team without turning squad management into gameplay yet.

## People and Careers

- `Person`: common human identity for all football careers.
- `PersonRole`: role history for `PLAYER`, `MANAGER`, `STAFF`, `AGENT`, `CHAIRMAN`, and `FEDERATION_OFFICIAL`.
- `CareerCharacter`: player-created character metadata, including name support through `Person`, selected starting age, background, education, playing experience, coaching licences, business background, and starting reputation profile.

## Competitions and Matches

- `Competition`: domestic, local, continental, or international competition.
- `CompetitionSeason`: dated edition of a competition.
- `Fixture`: scheduled match between teams.
- `Match`: result record for a played fixture.
- `MatchEvent`: future quick-sim, key-event, or text-live event record.

## Contracts and Movement

- `Contract`: shared employment agreement for a person and employer entity.
- `PlayerContract` and `StaffContract`: typed contract specializations.
- `Transfer`: permanent movement between clubs.
- `Loan`: temporary movement between clubs.

## Money

- `FinanceAccount`: separate owner account for `PERSON`, `CLUB`, or `FEDERATION`.
- `FinancialTransaction`: account movement with date, amount, currency, category, optional description, and optional related entity.

## Social, Promise, and History

- `Relationship`: typed relationship between two entity refs.
- `Promise`: commitment from one entity to another, with due date and status.
- `ScheduledEvent`: persisted future simulation event.
- `HistoricalEvent`: alternate football history record with involved entities, importance, and scope.

## Imports

Import records validate payloads with provenance. Provenance records source, verification date, confidence, and whether the data is verified, reported, estimated, unknown, or simulation-only.

Stage 2 Nepal datasets wrap uncertain fields as facts:

- `value`: present only when the source supports a value.
- `status`: one of `VERIFIED`, `REPORTED`, `ESTIMATED`, `UNKNOWN`, or `SIMULATION_ONLY`.
- `provenance`: optional field-level source metadata when it differs from the record source.

The SQLite save stores relational entities plus `entity_provenance` rows so imported facts remain auditable after reload.
