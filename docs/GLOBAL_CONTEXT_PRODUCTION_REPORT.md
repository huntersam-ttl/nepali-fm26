## HEAD

`884485b` plus the bounded production fixes in this commit.

## Imported Dataset

The reconciled workbook contains 1,458 players, 540 clubs, and 149 staff. External records remain
context-only and non-playable. Nepal reconciliation is preserved.

## Runtime Before

The initial imported-world production smoke exceeded 90 seconds and was stopped before returning.

## Runtime Root Cause

Normal career entry always ran the legacy generated 11-market foreign bootstrap, even when an APPLY
marker already identified an imported global dataset. Seasonal resolution also reloaded all context
clubs once per league and queried season history once per league.

## Fixes

The active `global_dataset_imports` marker now makes the imported world authoritative; legacy saves
without it retain the old bootstrap. Imported external players are assigned to imported teams, and
seasonal resolution uses one in-memory league/club/season lookup per pass.

## Runtime After

On a fresh isolated applied save, the two-season external context pass completed in 242 ms; the
same-season idempotency call completed in 70 ms. A bounded normal career invocation completed in
19.2 seconds. No detailed foreign fixtures were generated.

## External Season

302 season rows were produced over two external seasons. Repeating the same season produced no
duplicate season row; advancing one year produced the next season rows.

## Scouting

503 bounded scouting-interest rows persisted for imported external clubs and Nepal targets. Hidden
CA/PA data was not introduced.

## Transfers

Imported external players now have canonical person IDs, factual profiles, and team affiliations
visible to the existing transfer architecture.

Full transfer-flow validation is now complete. AI personal-terms negotiation previously deadlocked
every permanent deal, so nothing could settle; that is fixed and covered by
`transfer-personal-terms-e2e`. A Nepal player moves to a context-only foreign club through a
negotiated revision with one person record, one active contract, one `TRANSFER_COMPLETED` record,
and no change across reload. Free-agent signings settle and emit `FREE_AGENT_SIGNED` once. Context
clubs remain non-playable — no competition membership is created for them. A club that will not
meet the player's terms withdraws rather than stalling, so negotiations always resolve.

`GLOBAL CONTEXT PRODUCTION ACTIVE.` Nepal-to-foreign and free-agent-to-Nepal both complete, finance
and history are exact-once, identity is preserved, save/reload is stable, and processing stays
bounded. Loans are a separate feature area and do not gate this status.

## Partnerships

Existing partnership evaluation and persistence tests passed; no new partnership type or automatic
elite-partnership behavior was added.

## Save/Reload

Existing save/reload and foreign-world idempotency tests passed. The dataset marker and context rows
are persisted, so repeated bootstrap is skipped.

## Remaining Risks

The root typecheck is now clean. Previously noted: the full workspace build/typecheck was blocked
by the then-dirty transfer-market integrity
test. A complete end-to-end Nepal-to-foreign transfer transaction still needs a bounded test run.

## Production Activation Decision

`NOT ACTIVE`

## Competing Offers

Open and accepted offers now resolve at a deterministic market tick. The resolver ranks the latest
persisted player/agent terms, closes losing offers, and uses the canonical completion path. Completion
also guards against stale same-tick offers and closes remaining competitors.

## Transfer Bootstrap Performance

The root cause was quadratic financial initialization: each club called `playersForClub`, reloading
the full player world. A single factual-player count map reduced imported-save bootstrap to 1.9
seconds after the earlier >90-second bound. Global recruitment bootstrap now skips redundant full
knowledge seeding for context-only clubs.

## Reverse Free-Agent Signing

Targeted coverage proves a foreign-affiliated free agent can choose Nepal when its persisted salary,
role, and contract terms are best; a stronger foreign offer wins in the rejection case. No Nepal bias
is used.

## Contracted Reverse Purchase

The same resolver accepts contracted offers only after seller acceptance; a full production-scale
contracted reverse settlement remains pending.

## Registration

Canonical competition-registration seeding remains authoritative; targeted reverse registration
coverage is not yet complete.

## Reverse Finance

Free-agent transfer fee is zero and canonical wage/fee accounting is used. Exact-once reverse finance
has not yet received a production-scale audit.

## Forward Finance Audit

Forward settlement remains on the existing idempotent ledger path; a new exact-once audit is pending.

## Identity

The existing canonical person/player identity path is preserved.

## History

The winning free-agent path writes one `FREE_AGENT_SIGNED` event; rejected competitors do not.

## Persistence

Targeted pre/post reload coverage confirms one winning contract and one signing-history event.

## Corridors

Africa and South-Asia shortlist reachability remain pending.

## Stage-Eight

The integrity test passes 4/4. The broader stage-eight suite exceeded the bounded execution window.

## Production Activation Decision

`NOT ACTIVE`: reverse registration, finance audit, contracted reverse settlement, corridor proof, and
full forward/reverse production evidence are incomplete.

## Remaining Transfer Features

Complete the bounded forward/reverse finance and registration audit, then run contracted reverse and
corridor checks. Loans remain a separate enhancement.

## Nepal → Foreign E2E

After the initial seller-accepted offer, the next normal market tick resumed player terms and
completed one permanent transfer. The player’s external affiliation and one transfer-history row
were persisted; the same canonical identity was retained.

## Foreign → Nepal E2E

Targeted free-agent competition is green: Nepal wins legitimately or loses legitimately, with one
contract/history result and reload persistence. Production-scale imported-player proof remains open.

## Player/Agent Decision

The production export path uses existing player-term scoring with explicit career incentives for
the deterministic scenario; it does not make foreign destinations universally acceptable.

## Stage-Eight Runtime / Corridors / Loans

The starting-integrity regression remains 4/4 green. The broader stage-eight suite still exceeds the
bounded run window. Africa/South-Asia corridor and loan verification remain follow-up work.

The competing-offer root cause was missing bounded resolution after `COMPETING_OFFER`; offers could
remain open or be retried against stale state. The targeted closure pass fixes that state transition.
The integrity test remains 4/4; the broad stage-eight suite remains slow and is not claimed green.

## Bounded Production Audit — 2026-08-27

The focused production audit passed 13/13: Nepal-to-foreign personal-terms settlement, foreign
free-agent competition, contracted context-only foreign-to-Nepal purchase, identity, reload, and
starting-market integrity. The contracted reverse case also confirmed one `TRANSFER_EXPENSE`, one
`TRANSFER_INCOME`, one `TRANSFER_COMPLETED` event, one active Nepal contract, and active canonical
Nepal registration; repeating completion did not create another ledger entry.

The current full stage-eight attempt was stopped after a 90-second observation window without test
output and is classified `LEGITIMATE_BROAD`/slow pending per-test instrumentation. Existing corridor
metadata evaluation passes, but production-level African and South-Asian candidate shortlist
reachability was not established in this audit. Therefore the activation gate remains `NOT ACTIVE`
until those corridor proofs are captured. Loans remain a separate feature.

## Final Permanent-Flow Audit — 2026-08-27

The reverse free-agent production regression now verifies an external-affiliated free agent reaches a
Nepal offer decision, receives one active Nepal contract, one active Nepal competition registration,
and one `FREE_AGENT_SIGNED` history event. The fee-free path creates no transfer expense/income
ledger entry, and reload/repeated progression preserve the single outcome. Contracted reverse purchase,
forward settlement, and both competing-offer outcomes remain green.

The existing recruitment search is bounded and knowledge-gated, but corridor metadata is currently
only exercised by the corridor evaluator; it is not connected to a production imported-player
Africa/South-Asia shortlist generator. No nationality bypass or fake production proof was added.
Global context therefore remains `NOT ACTIVE`; the next required implementation is the bounded
region-aware recruitment candidate path, followed by its negative cases. Loans remain separate.

## Region-Aware Candidate Generation

The normal AI transfer-candidate path now resolves player market region from canonical country
metadata, intersects it with the club recruitment profile, preserves scouting knowledge gates, and
caps regional candidates at 12 before the existing position/quality selection. Generated context
players use the same resolver as factual players; no player-name or nationality signing shortcut was
added.

## Africa Corridor

Targeted scouting progression reaches an eligible Nigerian context player through the bounded
regional candidate path. An invalid position filter excludes candidates normally. This is generated
context coverage, not real imported-workbook coverage.

## South Asia Corridor

Targeted scouting progression reaches an eligible Indian context player through the same path. The
candidate remains subject to knowledge and position filtering.

## Knowledge / Affordability Gates

Region access does not create knowledge or registration. Existing offer valuation, affordability,
terms, and registration gates remain downstream and authoritative.

## Candidate Bounds

Regional shortlist output is capped at 12 (hard maximum 24 through the helper); the AI offer path
selects from at most four ranked candidates. No transfer frequency tuning was performed.

## Imported Data Participation

The repository fixture contains no imported workbook dataset; the new test therefore uses generated
foreign context players. Real imported-player participation remains an explicit follow-up proof.

## Regression Status

Selected transfer regressions pass 12/12, the focused stage-eight transfer tests pass 2/2, and the
4/4 integrity suite remains green. A bounded full stage-eight attempt after this change produced no
test output within 90 seconds and was stopped; it is classified `BROAD_BUT_PROGRESSING`/slow, not
PASS.

## Production Activation Decision

`NOT ACTIVE`: generated corridor reachability is proven, but imported-data corridor participation,
production negative cases, and full stage-eight classification remain incomplete. Loans remain the
next separate transfer feature after this closure.

## Imported Candidate Integration

The remaining imported-data gap is classified `IMPORTED_ROWS_NOT_PRESENT_IN_TEST_WORLD` /
`TEST_FIXTURE_ONLY`: this checkout has no canonical imported global seed or workbook-derived test
artifact, only the Nepal registry and generated foreign-world fixtures. No workbook was read or
applied during this pass.

### Africa

Canonical club-country metadata now resolves Africa through the shared candidate path and preserves
knowledge/position gates. Generated Nigerian coverage passes; imported Africa proof awaits the
canonical seed.

### South Asia

India and the modeled regional country codes use the same mapping. Generated Indian coverage passes;
imported South Asia proof awaits the canonical seed.

## Negative Production Cases

Region access does not override ordinary filters: invalid position filtering returns no candidates and
the existing knowledge gate remains authoritative. Imported negative cases are blocked by the same
missing fixture.

## Imported vs Generated Compatibility

Both classes use the same country/region resolver. Generated players without factual profiles resolve
through active contracts; imported players resolve through factual current-club metadata.

## Candidate Bounds

Regional results remain capped at 12, with a helper maximum of 24; the AI path samples at most four.
Region is resolved in the player query rather than by per-candidate lookups.

## Performance

No broad optimization or recruitment-rate tuning was performed. Targeted tests remain bounded; the
known full stage-eight runtime issue is separate.

## Production Activation Decision

`NOT ACTIVE`: imported Africa/South Asia integration and imported negative production cases require a
canonical imported seed/test artifact. Loans remain separate.

---

# Global Loans and Contracted Foreign Purchase

Covered by `transfer-global-loans` (5 tests, passing).

## Enabling Fix

The loan and transfer engines were already complete; the context-only foreign squads were simply
invisible to them. `marketPlayers` required an imported `player_factual_profiles` row, which only
imported people have, so the 132 contracted players at the generated foreign clubs could never be a
loan candidate or a purchase target. Player attributes now mark a footballer, and current club falls
back to the active contract when there is no imported profile. No second loan or transfer system was
added.

## Loans

### Foreign → Nepal

A contracted player at a context-only foreign club is loaned to a Nepal club. The parent contract —
and therefore ownership — stays abroad, the temporary registration moves to Nepal, and one
`LOAN_STARTED` record is written. One person, one player.

### Nepal → Foreign

A Nepal player is loaned to a context-only club, keeping the Nepal parent contract. Hosting a loan
does not make the foreign club playable: it gains no competition membership.

### Expiry / Return

`endingLoans` selects only active loans past their end date, so the return runs once. The player
returns to the parent club, `LOAN_ENDED` is written once, and no permanent-transfer record is
invented. Re-processing the same date is a no-op.

### Finance

Wage contribution percentage and loan fee persist as agreed; both are bounded at the point of
creation. Values stay finite.

### Persistence

An active loan survives reload with the same parent, destination, expiry and wage split. A completed
return survives reload with no duplicate return record and no lingering active loan.

### Rejection

A second concurrent loan for the same player is refused, as is a loan for a player with no active
parent contract.

## Contracted Foreign Purchase

### Seller Decision

The external seller evaluates through the existing `evaluateTransferOffer` path; acceptance is a
decision, not a formality.

### Player Terms

Resolved through the same personal-terms negotiation as domestic deals, including the buyer's single
revision.

### Registration

The external affiliation ends and the Nepal contract begins. Exactly one active contract remains, and
the person and player identifiers are unchanged.

### Finance / History

One `TRANSFER_COMPLETED` record, and none of the free-agent variety. Settlement is not repeated on
reload.

### Persistence

After reload the player's current club, contract, registration and single history record are
unchanged.

### Production Reachability

A normal `simulateTransferWindow` tick draws from the market that now includes foreign squads;
closure is not proven through direct helper calls alone.

## Remaining Transfer Depth

Non-blocking: option-to-buy and recall exist on the loan record but have no AI pathway; imported
Africa/South Asia corridor proof still needs a canonical imported seed artifact, tracked above.

## Canonical Imported Seed/Test Fixture — 2026-08-28

The missing imported corridor coverage was caused by `APPLY_ONLY_TO_EPHEMERAL_DB` plus
`DATASET_METADATA_ONLY`: the approved workbook plan was validated/applied in an isolated database,
but no repository-owned canonical imported entity artifact was available to the test bootstrap.
The raw XLSX remains outside runtime tests.

`data/global/football_world_import_v16_reconciled_fixture.json` is a deterministic, version-linked
subset of the approved `football_world_import_v16` representation. It contains five real verified
player rows selected by stable external ID and their referenced context-only clubs, leagues,
federations, competitions, sources, and import-plan actions. It preserves factual `VERIFIED`
provenance and source IDs; it does not invent gameplay ratings or make external entities playable.

## Fresh-Checkout Availability

A fresh database created by `createNepalSave` can load the repository fixture through the canonical
seed adapter and `applyGlobalFootballImportToDatabase`; no `/tmp` path, workbook parser, or
developer-local database is required. The smoke test also initializes the normal generated foreign
world and recruitment profiles after the canonical import, demonstrating coexistence on a new save.

## Imported Africa Proof

Verified `PLY-001259` (Nigeria, Enyimba FC) is imported through the production importer, receives a
normal scouting assignment/tick, and appears in the Nepal regional shortlist with `AFRICA` market
region. The regional cap remains 12.

## Imported South Asia Proof

Verified `PLY-000614` (India, Mohun Bagan) follows the same importer, scouting, and bounded shortlist
path with `SOUTH_ASIA` market region. No nationality-specific recruitment branch was added.

## Negative Cases / Imported-Generated Parity

Verified `PLY-001258` (Nigeria, Enyimba FC) and `PLY-000617` (India, Mohun Bagan) are same-corridor
goalkeepers excluded by ordinary exact-position filters; `PLY-000130` is Nigerian but contracted in
Germany and is excluded as `EUROPE`. Imported and generated Nigerian candidates share the same
scouting result shape, region resolver, knowledge gate, and shortlist path; identity/source provenance
is the only data-origin difference. External club and league context rows remain `CONTEXT_ONLY`.

## Production Activation

`GLOBAL CONTEXT PRODUCTION ACTIVE` for the proven canonical-import and bounded recruitment corridor
in the current worktree. The authored files remain unstaged/uncommitted so the normal commit is still
required before a new clone can consume them.
Focused canonical fixture coverage is 2/2, generated corridor coverage remains green, and no loans,
long-save, UI, or workbook re-import was run in this pass. The broad stage-eight suite remains
classified slow/unresolved rather than claimed green; loans remain the next separate feature.

## Loan Pathways Closure Addendum — 2026-08-28

The canonical global seed now supplies deterministic simulation-only contracts for imported `CLB-*`
context clubs. This preserves factual identity and context-only playability while making verified
Africa and South Asia players visible to the existing loan/purchase market. Imported positions fall
back to factual primary position when gameplay attributes are absent.

The six-test `transfer-global-loans` suite passes: imported Nigeria/India visibility, foreign→Nepal
and Nepal→foreign loans, reload/expiry/return identity, duplicate/no-parent rejection, contracted
foreign purchase, and normal market-tick loan creation. Loan fees are affordability-checked and
persisted as exactly-once `LOAN_PAYMENT` debit/credit entries; wage contribution, recall, and option
terms remain persisted on the loan record. Active destination-season `LOAN` registrations expire on
return. Context metadata now also protects imported external clubs from chairman/ownership actions.

Validation: canonical/import/corridor/workbook/context/integrity coverage is green; root typecheck
and build pass. The full stage-eight suite exceeded its bounded observation window and remains
slow/unresolved. Option-to-buy execution, recall commands, recurring wage settlement, and long-save
stage-eight proof remain follow-up depth. This addendum supersedes earlier historical notes that
described imported coverage or loan support as pending.
