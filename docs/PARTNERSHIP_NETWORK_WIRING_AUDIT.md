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

`METADATA_ONLY_BY_SCOPE`

The current design and inventory define the `TECHNICAL` partnership vocabulary,
proposal/activation, and bounded benefit metadata, but do not specify a
production staff-market, coaching-knowledge, or development-environment
consumer. Existing staff mobility already has normal vacancy, eligibility,
finance, contract, and CONTEXT_ONLY flows, but no partnership hook. No effect
is added in this slice to avoid inventing automatic staff access or a
development modifier. A future slice should first confirm the intended
consumer and directionality, then wire one bounded effect through that existing
system.

### MULTI-CLUB

`PARTIAL`

### SELL-ON

Separate; unchanged.
