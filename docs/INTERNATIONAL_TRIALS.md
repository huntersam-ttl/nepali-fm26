# International Trials

## Scope

Trials are short, cross-border evaluation relationships: invitation → explicit player response
→ temporary active evaluation → retained scouting knowledge → completion/expiry → optional normal
transfer or free-agent offer. The supported directions are foreign player → Nepal club and Nepal
player → foreign context-only club. Domestic Nepal club-to-club trials are out of scope.

## Eligibility

The player and host club must exist, their countries must differ, dates must be ordered and no
trial may exceed 28 days. A contracted player requires explicit parent-club permission; the
autonomous AI path evaluates only players without an active contract. Duplicate active
player/host trials are rejected. The existing playerId is the canonical person/player identity.

## AI Flow

Seasonal club planning evaluates at most two uncertain regional scouting/shortlist candidates per
club. External clubs use the existing bounded foreign-scouting-interest signal. These paths make
an explicit player-side decision through the trial evaluator; invitations are not blanket
auto-accepts and no negotiation engine is added.

## Knowledge Effect

Acceptance records a `TRIAL` player-knowledge observation through the existing scouting model,
raising bounded knowledge/confidence while keeping raw hidden attributes private.

## Expiry

The played-match scouting cadence processes indexed due trials. Pending invitations expire and
accepted trials complete idempotently; the host relationship is removed while retained knowledge,
permanent affiliation, and any parent contract remain unchanged.

## Persistence

Migration 64 stores the invitation, canonical player, host, dates, permission snapshot, response,
state, source, reason, and completion date in `international_trials`. No employment contract,
registration, fee, or transfer-history event is written by the trial lifecycle.

## Production Proof

`packages/testing/src/international-trials.test.ts` covers scouting-driven foreign recruitment,
context-only foreign evaluation, rejection/permission/date/duplicate guards, active and completed
reload, idempotent expiry, knowledge gain, imported Africa/South Asia reachability, and normal
offer handoff without auto-signing.
