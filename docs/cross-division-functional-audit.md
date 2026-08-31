# A/B/C Cross-Division Functional Audit

The audit uses the same fresh deterministic Manager Career path for one club in each playable Nepal division. It deliberately excludes ANFA National League membership when selecting the career competition and verifies the selected league's own schedule.

| System | A | B | C |
| --- | --- | --- | --- |
| New Game | PASS | PASS | PASS |
| Squad bootstrap (18+) | PASS | PASS | PASS |
| Fixture generation | PASS | PASS | PASS |
| Double round robin | PASS | PASS | PASS |
| Venue relationship | PASS | PASS | PASS |
| Manager start path | PASS | PASS | PASS |

Assertions: each selected league has `N × (N − 1)` fixtures, the selected team has `2 × (N − 1)` scheduled fixtures, an active venue relationship, and at least 18 active player assignments.

Shared fixes made during this audit:

- Playable-season selection now prioritizes A/B/C Division over an earlier ANFA membership.
- Every playable Nepal league club receives an existing canonical ground relationship or a clearly simulation-only fallback ground.

Remaining systems such as detailed tactics, staff hiring, promotion transitions, and matchday UI retain their existing focused coverage and use the same shared domain path across divisions.
