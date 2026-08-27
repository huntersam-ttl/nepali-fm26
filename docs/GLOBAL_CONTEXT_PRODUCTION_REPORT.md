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
visible to the existing transfer architecture. Full transfer-flow production validation remains
pending because the focused transfer test exceeded the bounded test window.

## Partnerships

Existing partnership evaluation and persistence tests passed; no new partnership type or automatic
elite-partnership behavior was added.

## Save/Reload

Existing save/reload and foreign-world idempotency tests passed. The dataset marker and context rows
are persisted, so repeated bootstrap is skipped.

## Remaining Risks

The full workspace build/typecheck remains blocked by the unrelated dirty transfer-market integrity
test. A complete end-to-end Nepal-to-foreign transfer transaction still needs a bounded test run.

## Production Activation Decision

`NOT ACTIVE`

## Transfer Integration

The preserved transfer-market change and starting-state integrity regression are now committed.
The market can consume imported canonical players through the existing player, contract, offer,
registration, finance, and history model; global scouting signals are bounded to three offer
candidates per window. The normal transfer tick produced three permanent external offers plus a
foreign-player-to-Nepal affiliation. The deterministic Nepal-to-foreign run stopped at player terms
without a completed transfer, so no activation claim is made.

## Transfer Bootstrap Performance

The root cause was quadratic financial initialization: each club called `playersForClub`, reloading
the full player world. A single factual-player count map reduced imported-save bootstrap to 1.9
seconds after the earlier >90-second bound. Global recruitment bootstrap now skips redundant full
knowledge seeding for context-only clubs.

## Nepal → Foreign

Three permanent offers were created through normal transfer-tick progression. Player-term acceptance
and completed settlement remain the outstanding deterministic scenario.

## Foreign → Nepal

Normal free-agent selection now prioritizes foreign context candidates for Nepal squad needs; a
foreign-player-to-Nepal affiliation was observed in the production-scale tick.

## Registration / Finance / Identity / Persistence

Existing registration, exact-once settlement, canonical identity, and persistence logic remains
authoritative. End-to-end completed-transfer reload is pending.

## Stage-Eight

The integrity test passes 4/4. The broader stage-eight suite exceeded the bounded execution window.

## Remaining Transfer Features

Complete deterministic player-term acceptance for one Nepal-to-foreign offer, then run bidirectional
finance/history/reload validation. Loans remain a separate enhancement.

## Nepal → Foreign E2E

After the initial seller-accepted offer, the next normal market tick resumed player terms and
completed one permanent transfer. The player’s external affiliation and one transfer-history row
were persisted; the same canonical identity was retained.

## Foreign → Nepal E2E

The bounded Nepal free-agent selection can choose an imported foreign candidate, but a complete
contract, registration, finance, history, and reload proof is still outstanding.

## Player/Agent Decision

The production export path uses existing player-term scoring with explicit career incentives for
the deterministic scenario; it does not make foreign destinations universally acceptable.

## Stage-Eight Runtime / Corridors / Loans

The starting-integrity regression remains 4/4 green. The broader stage-eight suite still exceeds the
bounded run window. Africa/South-Asia corridor and loan verification remain follow-up work.
