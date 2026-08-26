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

## Interactive match control

The engine is driven through a typed command surface on `DesktopApplicationService`:

| Command                | Effect                                                            |
| ---------------------- | ----------------------------------------------------------------- |
| `startMatch`           | Creates or resumes a session for the manager's next fixture       |
| `getLiveMatch`         | Live read model, optionally only commentary after a cursor        |
| `advanceMatch`         | Advances by minutes, to the next important event, or to half time |
| `continueFromHalfTime` | Resumes the second half                                           |
| `makeSubstitution`     | Manager substitution with full validation                         |
| `updateLiveTactics`    | Mid-match tactical change                                         |
| `quickSimCurrentMatch` | Finishes a part-played match from where it stands                 |
| `resumeMatch`          | Reopens an interrupted session                                    |
| `getPostMatchReport`   | Report built entirely from persisted state                        |

Every command resolves the manager context first, so authority is checked in the service. A manager
may only control matches involving the team named on their contract; anything else is
`ROLE_NOT_AUTHORIZED` or `FIXTURE_MISSING`. React never receives the serialised engine state.

## Advancing and event cursors

`advanceMatch` takes a target — minutes, next event at or above an importance, half time, or full
time — and always stops early when the match needs the manager: a serious injury, a dismissal, half
time, or full time. Those are the only pause reasons; ordinary events never interrupt.

The live view carries a `cursor` (the highest event sequence included). Passing it back as `since`
returns only what is new, so a Text Live view does not refetch the whole timeline each tick.

## Commentary

Commentary is deterministic and generated locally. A template family is chosen per event type and
context (a goal with an assist reads differently from one without; a clear-cut chance differs from a
speculative shot), and the specific line is picked by hashing the event id — **not** by drawing from
the match RNG. Wording therefore can never influence the football, and the same match always reads
the same way. The score shown is the score as it stood at that moment.

## Substitution validation

Checked in the service, never trusted from the client: the match must be in a playable state, the
outgoing player must be on the pitch, the incoming player must be on this bench and not already
used, a dismissed player cannot be replaced, and the competition allowance must not be exceeded.
Each failure has its own code (`PLAYER_NOT_ON_PITCH`, `PLAYER_NOT_ON_BENCH`,
`SUBSTITUTION_LIMIT_REACHED`, `INVALID_SUBSTITUTION`).

The allowance comes from `specialRules.substitutionLimit` on the competition rule set and falls back
to three. The Nepal rule sets carry no researched figure yet, so that fallback is SIMULATION_ONLY.

## Live tactical changes

A partial command is merged onto the team's current setup, then the tactical modifiers and team
strength are recomputed from it. Only future minutes are affected; nothing already simulated is
revisited. A `TACTICAL_CHANGE` event stores just the fields that moved, not a copy of the whole
tactic.

## AI reactions

AI substitutions still occur in the same windows and cost the same single random draw, so the RNG
stream stays aligned, but the choice is now a deterministic score over condition, rating,
disciplinary risk and the scoreline — using only what a manager could see, never hidden ability.

AI tactical reactions are deterministic and consume no randomness at all: a side chasing a game late
goes more attacking, one protecting a lead turns cautious, and a side reduced to ten defends. They
are recorded as `TACTICAL_CHANGE` events attributed to the AI.

## Half time and resume

At half time the match holds with `pauseReason: HALF_TIME`. Substitutions and tactical changes made
there are persisted before the second half begins and take effect from minute 46.

Every user decision is a checkpoint, so an interrupted match resumes with the same minute, score,
lineup, tactical state, substitutions used and RNG progression — and therefore the same future
result as an uninterrupted run.
