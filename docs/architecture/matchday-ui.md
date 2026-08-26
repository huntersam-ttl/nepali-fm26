# Matchday UI

The matchday experience is a thin presentation layer over the Step 4A–4C engine. React renders,
collects choices, and paces the reveal; it never simulates, scores, or calculates anything.

## Flow

```
Fixtures → Pre-match → (choose view) → Live match → Half time → Full time → Report → Career
```

`MatchdayScreen` owns the three stages for one fixture. It is mounted from the Fixtures screen and
replaces the workspace while a match is open.

## View modes

| Mode       | Behaviour                                                                     |
| ---------- | ----------------------------------------------------------------------------- |
| Quick Sim  | Chosen before kick-off, runs the whole match and opens the report immediately |
| Key Events | Advances to the next MAJOR/CRITICAL event, skipping quiet play                |
| Text Live  | Advances minute by minute with commentary                                     |

All three drive the same persisted session through the same commands. The mode changes only how
much is revealed and how fast — never the football.

## Command cadence and serialisation

`useMatchController` owns every command for a fixture and enforces two rules:

- **Single flight.** A `useRef` guard means a second command started while one is running is
  dropped, so rapid double-clicks cannot double-process a match.
- **No busy loops.** Playback is a chain of `setTimeout` ticks; the next tick is only armed after
  the previous command resolves, so commands cannot pile up against a slow runtime.

Speed changes the pacing _and_ the step size, so 8x takes bigger match-time steps rather than firing
ninety round-trips:

| Speed | Delay  | Match minutes per tick |
| ----- | ------ | ---------------------- |
| 1x    | 1400ms | 1                      |
| 2x    | 700ms  | 1                      |
| 4x    | 400ms  | 3                      |
| 8x    | 250ms  | 6                      |

Playback stops automatically on any backend pause reason (`HALF_TIME`, `INJURY_DECISION`,
`RED_CARD`, `FULL_TIME`) and on any command error, so the player can read what happened.

## Event cursor

The controller keeps the accumulated commentary and passes the last `cursor` back as `since`, so an
advance returns only new lines. The feed is never refetched wholesale during playback. Actions that
change the lineup (substitution, tactical change) request a full refresh, since they alter more than
the tail of the feed.

## Finalisation

A match commits when it reaches full time, regardless of how it got there. `advanceMatch`,
`continueFromHalfTime` and `getLiveMatch` all finalise a completed match, not just Quick Sim — an
earlier build only finalised through Quick Sim, so a Text Live match played to ninety minutes never
committed its result. That path is now covered by a regression test.

## Resume

Match sessions are persisted, so leaving the screen — or reloading the app — does not lose a match.
The career home shows a **Resume match** banner whenever an unfinished session exists, and the
matchday screen restores the clock, score, feed, lineups, tactics and substitutions from the
persisted state. A completed match is never offered for resume, and a fixture with a result cannot
be started again.

## Layout

Scoreboard on top; commentary in the centre; stats and the managed squad on the right; controls
pinned at the bottom. Substitutions and tactics open as drawers so the match stays visible. The feed
auto-follows the newest line unless the reader scrolls up, in which case a **Follow live** control
appears rather than yanking them back down.

Visual weight tracks event importance: goals are highlighted, dismissals and injuries are warnings,
half time and full time are dividers, and routine play is quiet. There is no animated pitch — a
deliberate choice, not a gap.

## Accessibility

Semantic buttons and labelled inputs throughout; the commentary feed is a focusable `role="log"`
with `aria-live` while playing; view-mode selection is a radio group; speed buttons expose
`aria-pressed`. Shortcuts: **Space** play/pause, **N** next event, **S** substitutions,
**T** tactics, **Escape** close drawer — all ignored while typing in a field.

## Post-match report

Built entirely from persisted state: overview with scorers and player of the match, stats, a
filterable timeline (all/goals/chances/cards/subs/injuries/tactics), ratings for both sides with the
top rating highlighted, a tactical summary including AI changes and substitution times, and matchday
finances read from the club ledger. Nothing is recalculated in React.

## Known gaps

- Match view preference is per session; there is no persisted career default yet. Adding one would
  touch shared career settings, which another agent is actively working in, so it was deferred.
- Venue, referee and weather are shown as Unknown because the Nepal registry does not yet carry
  them; the UI says so rather than inventing values.
