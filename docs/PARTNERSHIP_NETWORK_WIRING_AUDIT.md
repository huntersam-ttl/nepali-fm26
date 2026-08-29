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

### YOUTH_DEVELOPMENT

`PRODUCTION_ACTIVE`

The annual youth planning cadence can create at most two temporary
`FOREIGN_YOUTH_DEVELOPMENT` programmes per home club/year for eligible youth
players. Completion records a bounded development/exposure activity and a
small development-momentum effect, while the player remains registered with
the home club. Loan and transfer semantics are unchanged.

### ACADEMY

`PRODUCTION_ACTIVE`

Active academy partnerships contribute a derived, capped `regionalReach`
context to the existing annual academy intake calculation. The context is
recomputed from active partnership state, does not accumulate, and does not
guarantee elite or high-potential players.

### LOAN

`PRODUCTION_ACTIVE`

Production consumer: `packages/simulation/src/transfer-market.ts` →
`findLoanCandidateForClub` / `simulateTransferWindow`.

Active directional `LOAN` partnerships rank otherwise eligible candidates
whose parent club is the stored `to_club_id`. Position, affordability,
registration, player-contract, parent-club, consent, and candidate-cap gates
remain authoritative. The canonical `startLoan` path still owns terms,
finance, assignment, recall, and purchase options; partnerships do not create
automatic loans or bypass those rules.

### MULTI-CLUB

`PARTIAL`

### SELL-ON

Separate; unchanged.
