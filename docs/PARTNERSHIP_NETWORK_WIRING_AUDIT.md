# Partnership / Network Wiring Audit

Overall partnership status: `PARTIAL`.

### SCOUTING

`PRODUCTION_ACTIVE`

Production consumer: `packages/simulation/src/scouting.ts` →
`accessibleRecruitmentRegions` → `searchRegionalCandidatesForClub`.

Active `SCOUTING` partnerships are resolved once per regional search through
`ClubNetworkRepository.activeScoutingPartnerships`. The partner club's country
is mapped through the canonical recruitment-region mapping. The effect is
derived from partnership state, adds only the partner region, and supplies a
bounded MINIMAL discovery signal for partner-club players. Existing knowledge,
position, affordability, availability, registration, and candidate caps remain
authoritative. Expiry processing remains a later slice; clearly inactive or
ended records are ignored by the consumer.

### NETWORKS

`PARTIAL`

### TECHNICAL

`PRODUCTION_ACTIVE` — international staff placements / study visits

The production consumer is the staff seasonal planning/completion cadence:
active `TECHNICAL` partnerships permit at most two eligible employed technical
staff placements per home club/year. A placement is temporary and persisted;
completion applies one bounded coaching-technical improvement and partner-
country knowledge, then records staff history. Employment and contracts remain
with the home club, and the partner remains `CONTEXT_ONLY`. Technical does not
provide automatic staff-hiring access.

### MULTI-CLUB

`PARTIAL`

### SELL-ON

Separate; unchanged.
