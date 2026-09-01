# Roadmap completeness audit

Audit basis: HEAD `6d847a8` and the production source/tests in this checkout. Old chat summaries were not treated as evidence. “Complete” means a persisted, deterministic simulation path exists; a type, schema, diagnostic, or read model alone is not counted as complete.

## Classification

| Roadmap area                                  | Status          | Production evidence / exact gap                                                                                                                                                                                             |
| --------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match engine, fixtures, A/B/C progression     | COMPLETE        | Persisted fixtures/results, standings, promotion/relegation, and dynamic founder-club handling are exercised by season tests.                                                                                               |
| Tactical familiarity and preparation          | PARTIAL         | Preparation persists bounded familiarity, but there is no full in-match tactical instruction/workflow layer for changing shape, roles, or opposition plan during a match.                                                   |
| Momentum and set pieces                       | PARTIAL         | Momentum and routine assignment affect the existing engine; complete set-piece workflow (routine creation, defensive marking, delivery/target selection and match feedback) is not implemented.                             |
| Match analytics                               | COMPLETE        | Supported persisted event metrics aggregate into match and season snapshots; unsupported tracking/possession remains correctly deferred.                                                                                    |
| People/personality/relationships              | COMPLETE        | Canonical persisted profiles and typed relationships are used by players, managers, staff and agents.                                                                                                                       |
| Dressing-room hierarchy, promises, mentoring  | PARTIAL         | Hierarchy, trust, promise state and mentoring assignments exist; broad promise follow-through across transfers, board, media and career outcomes is not centrally evaluated.                                                |
| Transfers, loans, contracts, agents           | PARTIAL         | Advanced deal structures, competing offers and canonical player-agent representation work; agent career commands, personal fee settlement and complete client-career progression are still being expanded.                  |
| Recruitment uncertainty/scouting              | PARTIAL         | Progressive knowledge and staff/network precision exist; knowledge is not yet consistently consumed by every recruitment decision and every human/AI market path.                                                           |
| Supporter politics and media                  | PARTIAL         | Sentiment, protest thresholds and structured media/press/social reactions exist; the event ecosystem is not yet uniformly emitted by every real transfer, ownership, promise and federation event.                          |
| Player lifestyle/off-field relationships      | PARTIAL         | Event-driven lifestyle and relationship updates exist; there is no broad downstream integration into all contract, adaptation and training decisions.                                                                       |
| Dynamic injuries/medical/physical development | COMPLETE        | Risk, rehabilitation decisions, return states and bounded physical effects are persisted and tested.                                                                                                                        |
| Career arcs, legacy, club culture             | COMPLETE        | Phases, milestones, legacy labels, academy provenance and inertial culture are implemented from real state.                                                                                                                 |
| Career timeline                               | PARTIAL         | Timeline storage/filtering and agent events exist. Prior persisted career milestones/staff history were not automatically projected into the shared timeline; this audit pass closes that gap with an idempotent sync path. |
| Academy geography, schools, talent hotspots   | COMPLETE        | Nepal geography, grassroots/school participation and hotspot-driven intake are implemented; outside Nepal remains context-only.                                                                                             |
| Federation elections/campaigns/policies       | PARTIAL         | Campaigns, endorsements, promises and policy lifecycle exist; policy outcomes are not yet uniformly wired into every season-boundary development input.                                                                     |
| League restructuring                          | COMPLETE        | Proposals are boundary-gated and fixture/promotion math is dynamic and tested.                                                                                                                                              |
| Referee assignment/development/politics       | PARTIAL         | Deterministic appointments, workload, development and event summaries exist; federation appointment confidence/controversy is mainly a derived foundation, not a complete political lifecycle.                              |
| Infrastructure strategy/projects              | COMPLETE        | Prioritization, funding, lifecycle and bounded effects reuse project/facility systems.                                                                                                                                      |
| Hosting bids                                  | PARTIAL         | Bid lifecycle/evaluation/read models exist; hosting is not yet connected to a supported end-to-end event competition/hosting schedule.                                                                                      |
| National development                          | PARTIAL         | Explainable bands and policy/project inputs exist; season-boundary progression is incomplete across all dimensions.                                                                                                         |
| Football economy/sponsorship/attendance       | COMPLETE        | Club/federation finance separation, attendance, sponsorship and economic trends are persisted and tested.                                                                                                                   |
| Broadcast rights/distribution                 | COMPLETE        | Valuation, equal/merit/mixed distribution and exact-once settlement are implemented.                                                                                                                                        |
| Continental coefficients                      | PARTIAL         | Completed Nepal continental fixtures now feed persisted association/club contributions and the five-season window. Qualification/seeding has no existing coefficient consumer, so that connection remains unsupported.      |
| Manager jobs/interviews                       | PARTIAL         | Vacancies, applications, interviews, offers and deterministic AI appointments exist; withdrawal, negotiation, competing-candidate and cooldown behavior is not a complete lifecycle.                                        |
| Staff personalities/job market/backroom       | PARTIAL         | Staff use canonical profiles, vacancies, approaches and relationship summaries; personality is not yet applied to every course, departure and manager-cooperation decision.                                                 |
| Sporting Director/DoF/CEO/Secretary           | FOUNDATION_ONLY | Role assignments, authority maps, majority-control gate and fit ranking exist; commands are not yet wired through every transfer, scouting, contract, commercial and licensing mutation.                                    |
| Agent career                                  | FOUNDATION_ONLY | Human agent creation, client uniqueness, portfolio and reputation labels exist; income/fee settlement and complete client strategy workflow are not yet implemented.                                                        |
| National teams and women/youth structures     | PARTIAL         | National-team campaigns, compensation, women’s competitions and youth structures exist; full cross-system development progression and broader international competition depth remain limited.                               |

### Count

- COMPLETE: **8**
- PARTIAL: **17**
- FOUNDATION_ONLY: **3**
- MISSING: **0**
- BLOCKED: **0**

The roadmap currently has no technically blocked item. The `FOUNDATION_ONLY` labels are production gaps, not claims of completion.

## Cross-cutting checks

- Persistence: most implemented systems have repositories/migrations and idempotent keys. The audit found timeline projection to be the highest-value missing bridge because it affects Manager, Owner, President, executive, Agent and Player histories without adding another simulation engine.
- Progression: match/season systems are real; several newer policy/coefficient/read-model systems still need explicit season-boundary hooks.
- Roles: Manager and Owner/Chairman command paths are production-backed. President has governance paths. Sporting Director/DoF and CEO/Secretary currently have authority foundations but incomplete command integration. Agent now has a human creation/client path but not full financial career play.
- A/B/C: competition and founder paths use shared-root logic; no division-specific patch is warranted for this audit gap.
- External world: foreign clubs/leagues remain `CONTEXT_ONLY`; no full foreign executive, agent or media simulation is introduced.
- UI/release: Claude-owned presentation files and Apple signing are out of scope and unchanged.

## Implementation completed in this audit

The shared career timeline has `syncCareerTimeline(db, personId)`, which projects only already-persisted career milestones and staff-history events, uses stable IDs/insert-ignore semantics, supports existing-save backfill without invented history, and preserves timeline filters. Continental coefficient progression is now also wired into completed continental season processing with real persisted Nepal fixture results and idempotent season snapshots.

## Next highest-priority gap

Connect the resulting continental coefficient to qualification/seeding context if a supported competition format gains such a consumer. The next broader production gap is season-boundary evaluation of federation policy and national-development outcomes.
