# Match Engine

There is exactly one match simulation. Quick Sim, and later Key Events and Text Live, all drive the
same deterministic state machine over the same timeline. Viewing mode changes presentation and
pacing only — never the football.

## Resumable state machine

`simulateMatch` used to be a single atomic function that ran ninety minutes and returned a result.
It is now a thin convenience wrapper:

```
createMatchState(input)  ->  LiveMatchState
stepMatch(state)         ->  one period transition or one minute
runMatchToCompletion(s)  ->  steps until FULL_TIME
toMatchResult(state)     ->  the same MatchResult shape as before
simulateMatch(input)     =  toMatchResult(runMatchToCompletion(createMatchState(input)))
```

`stepMatch` is bounded: it performs at most one minute of simulation, so a caller can stop, persist,
and continue later. Periods run `NOT_STARTED → FIRST_HALF → HALF_TIME → SECOND_HALF → FULL_TIME`.
Extra time and penalties are not implemented yet; the enum is the place to add them.

## Deterministic resume

`SeededRandom` is a single-word LCG, so its entire progression is one uint32. `LiveMatchState`
carries that word in `rngState`, and `stepMatch` restores the generator from it and writes it back
after each step. A match resumed from a checkpoint therefore produces exactly the future it would
have produced had it never been interrupted — this is verified from five different interruption
points, including across a database close and reopen.

The order of random draws inside a minute defines the match. It must not be reordered without
regenerating the engine regression baseline.

## Match sessions

`match_sessions` holds one row per fixture with the serialised state, the RNG word, the clock, and
the score. The engine never persists on its own: callers checkpoint through `saveMatchSession`, so
revealing a match minute by minute does not cause a write per minute.

`startMatchSession` resumes an existing session rather than creating a new one, so leaving a match
and returning cannot reroll a result. A fixture that already has a result raises
`MatchAlreadyPlayedError`, surfaced to the UI as `MATCH_ALREADY_PLAYED`.

## Finalization

`finalizeMatch` commits a completed match to the world in one transaction: attendance and gate
revenue, the match row, the ordered timeline, standings, team and player season stats, per-match
ratings, availability, injuries, suspensions, inbox items, the fixture status, and the session's
completion. If any step throws, the whole thing rolls back.

## Idempotency

Re-finalising is a named no-op, not an error:

- `finalizeMatch` returns `ALREADY_FINALIZED` when the session is complete or the fixture is played.
- `insertMatch` and `insertMatchEvent` use `ON CONFLICT DO NOTHING`; match and event ids are stable.
- Ledger entries already derive stable ids from an idempotency key.
- Season stats, standings, ratings and suspensions are upserts keyed by their natural key.

A repeated Quick Sim on a played fixture writes nothing and returns `MATCH_ALREADY_PLAYED`.

## Timeline

Events carry a monotonic `sequence` and are returned sorted by minute, then stoppage time, then
sequence, so a timeline reads in the order it happened. Every event is stamped with an importance —
`MINOR`, `NOTABLE`, `MAJOR`, `CRITICAL` — which is what Key Events will filter on. A clear-cut
chance is promoted above an ordinary shot.

## Ratings

The engine already calculated `PlayerMatchState.rating`; there is no second algorithm. That value is
now persisted per match in `player_match_ratings`, alongside minutes, goals, assists, cards,
substitution minutes and the supported match stats. Season aggregates stay in `player_season_stats`.

## Possession

Possession blends the engine's existing midfield-and-style weighting with how often each side
actually had the ball, tracked as control ticks during the match. It totals 100, varies by match,
and is deterministic per seed. It is a readout, not an input: it does not influence the result.

## Attendance

`postMatchdayEconomy` already modelled attendance and gate revenue from supporter profiles, ticket
price and venue capacity; it was simply never called from the manager path. It is now wired into
finalization and returns the attendance it used, which is stored on the match row so the figure
shown and the figure billed are the same number.

## Intentional behaviour changes

The refactor was verified against a golden master of the previous engine across five seeds. Four
were byte-identical. The differences are deliberate:

1. **Dismissed players leave the pitch.** Previously a sent-off player stayed in the selection pool
   and could still be picked for events. They are now removed and never auto-replaced, so the team
   plays a man short. This shifts later random picks in matches containing a red card.
2. **Second yellow is a dismissal.** Previously two yellows left a player on the pitch. A second
   booking now sends them off, counted once in the team's red-card total.
3. **Substitutions are real.** Previously a substitution emitted an event but the player never came
   on. The replacement now takes the vacated tactical slot and plays.
4. **Minutes are attributed honestly.** Everyone used to be credited with 90 minutes. A substitute
   is now credited from the minute they came on, and a withdrawn or dismissed player up to the
   minute they left.
5. **Event and injury ids are stable.** Derived from the match id and a sequence rather than random,
   so a timeline is reproducible. Ids are opaque and affect no outcome.
6. **Possession** is blended with observed control, as above.
