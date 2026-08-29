# Partnership / Network Wiring Audit

Overall partnership status: `COMPLETE` for the bounded P1 partnership type and lifecycle scope.

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

`COMPLETE` for bounded P1 network signals.

Scouting reach, partner-country knowledge, regional recruitment context,
multi-club related-club lookup, and bounded transfer/loan pathways all feed
existing production consumers. No social graph or perfect player knowledge is
created; active-state and candidate caps remain authoritative.

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

### PREFERRED_TRANSFER

`PRODUCTION_ACTIVE`

Production consumer: `packages/simulation/src/transfer-market.ts` →
`findPermanentTransferCandidatesForClub` / `simulateTransferWindow`.

The stored direction is borrower/buyer `from_club_id` → preferred source
`to_club_id`. Active records add a bounded, derived MINIMAL candidate source
and deterministic ranking preference; fees, wages, seller decisions, player
terms, registration, affordability, competing offers, and history remain
canonical. Preferred transfer does not create scouting or loan state, discounts,
automatic moves, or foreign-club playability.

### COMMERCIAL

`PRODUCTION_ACTIVE`

Production consumer: `packages/simulation/src/club-economy.ts` →
`processClubEconomyMonth` / `commercialPartnershipIncome`.

The stored direction is beneficiary `from_club_id` → commercial partner
`to_club_id`. Active records contribute a modest monthly opportunity settlement
using partner quality and relationship strength. The effect is limited to four
active partnerships, capped at 8% of derived commercial value, and produces one
canonical `COMMERCIAL_PARTNERSHIP_INCOME` credit per club/date. Ledger
idempotency makes replays and reloads exact-once; the partner receives no
reciprocal credit and no shared wallet, sponsor contract, or automatic deal is
created. External partners remain `CONTEXT_ONLY`; multi-club ownership and
friendly-tour paths are not consulted or mutated.

### FRIENDLY_TOUR

`PRODUCTION_ACTIVE`

Production consumer: `packages/simulation/src/club-economy.ts` →
`planPreseasonCommercialTour` → existing `runPreseasonCommercialCamp`.

The stored direction is Nepal/receiving `from_club_id` → preferred external
opponent or market `to_club_id`. The planner resolves active records once,
limits candidates to four, ranks relationship strength and partner quality,
and derives the partner country as destination context. It does not create a
fixture or guarantee a tour: the existing camp, cost, revenue, exposure, and
history machinery remains authoritative. The planning preference is distinct
from monthly `COMMERCIAL_PARTNERSHIP_INCOME`, creates no scouting knowledge,
and leaves external partners `CONTEXT_ONLY`. There is currently no club
friendly scheduler or club-fixture simulator; the planner is the narrow
reusable seam for future scheduling cadence.

### MULTI-CLUB

## Multi-Club Production

- Scouting network: `PRODUCTION_ACTIVE` — related clubs expose a bounded
  region/player discovery signal through the existing scouting path.
- Player pathways: `PRODUCTION_ACTIVE` — related clubs receive deterministic,
  bounded candidate preference for permanent transfers and loans.
- Related-party transfers: `PRODUCTION_ACTIVE` — existing market-value review
  runs at offer evaluation; abusive packages are rejected.
- Related-party loans: `PRODUCTION_ACTIVE` — preference only; canonical loan
  terms, consent, registration, finance, recall, and options remain required.
- Finance separation: `PRODUCTION_ACTIVE` — canonical per-club ledgers remain
  authoritative; no ownership wallet exists.
- Governance: `PRODUCTION_ACTIVE` — same-competition related-club transfers
  are rejected and the existing conflict model remains available for flags.
- Staff exchanges: `COMPLETE via TECHNICAL placements` — temporary international
  placements preserve home employment, apply bounded development/knowledge, and
  persist exact-once completion.
- Academy collaboration: `PARTIAL for ownership-specific effects` — partnership
  ACADEMY behavior is production-active; ownership does not create duplicate
  programmes or an additional academy source.

Foreign related clubs remain `CONTEXT_ONLY`. Ownership relations are derived
and do not create persisted partnership records.

### SELL-ON

Separate; unchanged.

## Partnership Lifecycle

Lifecycle status is persisted on the partnership record and uses one canonical
active predicate: `status = ACTIVE`, `start_date <= simulation date`, and
`end_date IS NULL OR end_date >= simulation date`. The end date is inclusive;
the relationship expires on the following simulation date.

`processPartnershipLifecycle` runs from the daily simulation clock and uses an
indexed, finite-end-date query. ACTIVE and SUSPENDED records due before the
current date transition to `EXPIRED`; processing is idempotent, does not create
duplicate events, and never deletes history. SUSPENDED remains benefit-inactive
and is distinct from expiry; open-ended ACTIVE records remain active, and
future-dated ACTIVE records become usable automatically at their start date.
All eight production partnership queries share the repository predicate, so
scouting, technical, youth, academy, loan, preferred-transfer, commercial, and
friendly-tour consumers stop deriving new benefits after expiry. Existing loans,
placements, programmes, camps, ledgers, and learned scouting history are not
retroactively cancelled. Renewal negotiation remains outside this slice.
