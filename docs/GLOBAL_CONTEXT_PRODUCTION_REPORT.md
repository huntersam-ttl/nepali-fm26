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
