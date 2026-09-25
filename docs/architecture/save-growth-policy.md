# Save growth policy

A long career save must keep every piece of football history and stay fast. This
document records what a save keeps forever, what it compacts, what is transient,
and why. It is storage and performance policy only: nothing here changes a match,
a table, a transfer, a development result or a federation decision. That is
verified, not assumed: the same seeded 5-season save played on the code before and
after this policy produces identical match results, standings, player stats,
ratings, ledgers, media stories, injuries and player knowledge.

Everything below was measured on a real desktop save (Continue + Quick Sim + the
staged season transition, no shortcuts). Before the policy a save grew about 50 MB
a season at seasons 4-5 and season play degraded to 620 s by season 5.

## Kept forever

- Results, fixtures, standings, player season stats, player match ratings.
- Career history, appointments, timeline events, trophies, competition history.
- Transfers, contracts, registrations, injuries, disciplinary records.
- Club and federation ledgers (no duplicate or zero-value rows exist; never truncated),
  historical events, media stories and story threads.
- National-team, campaign and federation records.
- Every job application and its outcome (`manager_job_applications`).
- Goals, assists, cards, substitutions, injuries, penalties, period markers and
  tactical changes of **every** match, forever.
- `player_knowledge`: one row per (observer, player) under a UNIQUE key, updated in
  place. It is current state, not history, and it is the intended many-to-many set
  (63 observing clubs by the players they know). No duplicates exist, and only 555 of
  ~30,000 rows belong to retired players, so there is nothing safe to prune.
- Every match the human's club took part in keeps its complete event log, as do
  matches of clubs the human has managed, owned or held any role at, and any match
  played through a live session.

## Compacted (once per season, in the "Tidying older match detail" transition stage)

**1. Verbose events of old background matches.** A match qualifies when its
competition season is rolled over *and a later season of the same competition is
also rolled over* (the latest finished season always keeps full detail), neither
team belongs to a club the human is tied to, and it had no live session.

| Compacted event types | Kept instead |
| --- | --- |
| FOUL, SHOT, SHOT_ON_TARGET, SAVE, FREE_KICK, CORNER | one `match_team_summaries` row per team: goals, shots, shots on target, xG, corners, fouls, yellow/red cards, free kicks, saves |

`match_event_compactions` records each compacted match (events before/removed,
policy). Every reader that derived team statistics by counting events
(`matchAnalytics`, the post-match read model, the post-match report) uses the stored
totals for a compacted match and returns exactly the same numbers; xG is stored
bit-identical (summed in the reader's order). An old background match's timeline
lists its key events. These six types were 74% of event rows and are only ever
consumed as per-team counts. Note: `federation-strategy.refereeGovernanceSummary`
counts events by lower-case type names that never match the stored upper-case
types, so it currently reads zero either way; if that is ever fixed it must read
`match_team_summaries` for compacted matches.

**2. Resolved manager-interview records of background candidates.** The AI hiring
loop re-interviews open vacancies daily, producing ~5,700 interview records and
memories a season (~10 MB). Resolved interviews older than a year are removed with
their memories unless the candidate is the human, the club is one the human is tied
to, or the candidate still holds an offer or accepted job for that vacancy. Nothing
reads an old one (the only lookup is "did this person already interview for this
vacancy on this date") and the decision remains in `manager_job_applications`.

Both steps are idempotent.

## Transient / derivable, deliberately left alone

- Completed `match_sessions.state_json` (~96 KB per human match, ~0.65-2.4 MB a
  season) duplicates the event log and lineup state, but is reloaded by several
  desktop paths and read for possession. Not compacted; the next candidate.
- The automatic primary-key indexes on TEXT ids (~16% of the file) cannot be removed
  without rebuilding tables.
- `import_records` (7 MB) is the one-off world import.

## Indexes (migration 102)

Only measured scans got an index: `match_events(match_id)`,
`team_person_assignments(team_id)`, `manager_job_applications(manager_profile_id,
created_on DESC)` and `(manager_profile_id, vacancy_id)`, `media_stories(source_entity_id)`,
`player_potentials(player_id)`, and an index over two virtual columns on
`universal_interactions` (type, linked record).

**Rule: an index may not change the order in which a query returns rows.** Several
gameplay loops iterate unordered result sets, so a reordered tie would change
outcomes. On real data a plain `(profile, created_on)` index reversed ties for every
profile (this broke a real save with "You already have an offer for this job"), and
a three-column `team_person_assignments` index reordered 87 of 513 rosters. The
shipped forms (a DESC index; single-column indexes, which keep rowid order within a
key) reproduce the previous order exactly. `idx_player_knowledge_observer` looks
redundant but is kept for the same reason.

## Query changes

- The job-application "already offered?" check uses an existence query instead of
  loading the candidate's whole application history (21.9 s of a 102 s season 5).
- Interview lookups read only rows of one type and vacancy instead of every
  interaction ever stored; `active()` filters in SQL.

## SQLite settings

`journal_mode=WAL`, `synchronous=NORMAL` (11A), `foreign_keys=ON`; new:
`cache_size=-65536` (64 MB; the default 2 MB is far smaller than a multi-season
save) and `temp_store=MEMORY`. Both are memory only with no durability effect;
measured ~8% off season play and ~30% off the season transition. `mmap_size` was not
measured and is left alone. No VACUUM/ANALYZE is run: after compaction the freelist
holds ~9% of the file and is reused by the next season; the file does not need to
shrink.

## Schema version

`CURRENT_DATABASE_VERSION` is now derived from the newest migration (it was a stale
constant, 91, while migrations had reached 101). Opening a save stamps
`saves.database_version` with it.

## Measurements (same seeded save, before -> after)

| | S1 | S2 | S3 | S4 | S5 |
| --- | --- | --- | --- | --- | --- |
| season play (s) | 36 -> 27 | 69 -> 39 | 81 -> 45 | 277 -> 57 | 620 -> 65 |
| transition (s) | 15 -> 9 | 18 -> 13 | 22 -> 12 | 22 -> 15 | 27 -> 17 |
| file (MB, after transition) | 80.5 -> 83.9 | 122.7 -> 129.9 | 163.6 -> 159.1 | 212.9 -> 195.9 | 262.7 -> 235.0 |

Net growth per season at seasons 4-5: ~50 MB -> ~37 MB. Remaining growth is
dominated by kept event detail, `player_knowledge`, the current year's interviews and
ledgers, all bounded or intended history. To reduce it further, compact completed
`match_sessions` state.

## Known gameplay issue (not changed here)

Every AI hiring interview in the measured saves was REJECTED and every vacancy
stayed OPEN, so the AI manager-vacancy loop re-interviews candidates daily and never
appoints. This is the largest remaining per-tick cost and is outside a storage
change; it should be looked at as a gameplay fix.
