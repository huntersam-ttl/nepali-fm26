# International System

Nepal uses a single national-team, fixture, result, and match-engine path. External teams are
lightweight international profiles; only Nepal has detailed selectable players.

## Women International

Nepal Senior Women is a canonical national team using the existing women-player pool. The
imported women’s head-coach appointment is attached to that team when present; shared national
team staff fills any remaining roles.

## Youth International

Nepal U17, U20, and U23 reuse canonical club and generated-player identities. A player’s caps,
goals, duties, and history are stored against the specific age-group team, so they remain
distinct from senior records.

## Eligibility

Selection is bounded to Nepal nationality or a reviewed second nationality, preserves existing
ineligibility/documentation/cap-tie decisions, and excludes active injuries, unavailable players,
and international retirees. Youth selection uses DOB at the call-up date and excludes senior-men
call-ups for the same federation.

## Selection

The shared selector is gender- and age-aware, scores ability, fitness, and form, and makes a
position-balanced squad rather than selecting only the highest scores.

## Fixtures

Friendlies, camps, duties, call-ups, appearances, and match results use the existing national
team records. Women and youth matches call the same match engine as senior men.

## Competitions

The bounded seasonal calendar supplies SAFF Women, AFC Women’s Asian Cup qualification, and
SAFF U23/U20/U17 context. Opponents are lightweight profiles, while group progression and
elimination use the shared competition framework.

## History

Played fixtures create category-specific appearances and goals; completed editions create one
idempotent historical event. Replaying an already completed edition does not duplicate results,
caps, or history.

## Persistence

Team profiles, staff links, call-ups, duties, fixtures, results, appearances, standings, and
edition state are all save-backed and reload-safe.

## Sanction Compatibility

A federation sanction with `NATIONAL_TEAM_PARTICIPATION_BLOCKED` prevents selection, cancels
friendlies, and excludes Nepal from affected women/youth competition participants, just as it
does for the senior team.
