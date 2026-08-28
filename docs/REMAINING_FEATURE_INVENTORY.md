# Nepal Football Universe — Remaining Feature Inventory

## Snapshot

Audit date: 2026-08-28. Repository: `/Users/cc/nepali-fm26`. Trial closure pass based on
HEAD `c63a412`; the pre-existing untracked `nepali-fm26/` entry remains untouched.

The inventory has 92 normalized entries: the 84 row-level entries in the previous feature
audit, plus the eight explicit high-risk overlays requested for this pass. Statuses are:

| Status | Count |
| --- | ---: |
| COMPLETE | 56 |
| BUILT_NOT_PROVEN | 1 |
| PARTIAL | 26 |
| MISSING | 5 |
| LATER | 4 |
| **Total** | **92** |

The previous executive table reported `BUILT 50 / PARTIAL 24 / MISSING 7 / LATER 3`,
but its 84 detailed headings actually counted `54 / 21 / 6 / 3`. This report uses the
detailed rows, corrects `District infrastructure projects` to COMPLETE because
`advanceTerritorialDevelopment` is now called by both the day clock and career rollover,
reclassifies the now-imported but role-limited real staff dataset as PARTIAL, and moves
long-save viability to BUILT_NOT_PROVEN because the 12-season structural test exists but
the requested long-save performance gates were not run. Those three corrections produce
`54 / 21 / 5 / 1 / 3` before adding the eight high-risk overlays.

Classification rule: COMPLETE requires an implemented path, production reachability, and
focused evidence. BUILT_NOT_PROVEN means the path is real and tested but a material proof
gate remains. PARTIAL means a consumer, cadence, or behavior is absent. MISSING means no
usable implementation exists. LATER is reserved for explicitly deferred or out-of-initial-
scope work.

## Complete Systems

The following 55 systems are COMPLETE:

- Core world state and persistent entities; deterministic RNG; calendar and time; save/load, autosaves, and schema compatibility.
- History and dynamic history; character creation; manager career; manager interviews; career reputation and history.
- Core match engine; quick sim, key events, and text live; stoppage time, extra time, penalties, and aggregates; domestic match-requires-winner wiring; fixture integration; referee integration.
- Tactics, squad selection, training, and player development; scouting; transfers and contracts; staff market, contracts, and licences; player concerns, promises, and squad meetings.
- Universal interaction sessions; universal interaction authoritative execution; club economy, budgets, and wages; infrastructure and construction lifecycle; club sponsorship and commercial; international trials.
- Ownership succession; board pressure; federation governance and economy; federation compliance, sanctions, and reinstatement; federation elections; federation personnel succession; federation commercial rights and broadcasting.
- Nepal A/B/C pyramid, promotion, relegation, and memberships; club licensing; lower-league finance and squad viability; territorial structure; district/provincial representative competitions; district infrastructure projects.
- Youth intake, development, retirement, and late developers; free agents; foreign player supply into Nepal; player regeneration and long-save supply; staff/referee regeneration and long-save supply.
- Women's clubs and competitions; macroeconomy; personal wealth; supporter base, attendance, atmosphere, and mood; awards. The separate rivalry system remains PARTIAL.
- AI squad planning, transfers, and contracts; AI federation and senior-men national-team automation; senior-men national teams and international competition.
- Stadium, training, youth, medical, and technical infrastructure; desktop runtime and SQLite; legal and data provenance.

## Built but Not Proven

### Long-save continuity (10–15 season viability)

The annual youth/retirement and workforce reconciliation path is live and a 12-season
structural test passes. A 20/50-year save, balance run, and current long-save performance
gate were intentionally not started. This is proof debt, not a new implementation request.

## Partial Systems

Legacy partials:

- Chairman/owner career; federation-president career; role transitions, authority, and permissions.
- Career default match-view wiring; club creation and new clubs; takeover/ownership lifecycle.
- Grants, restricted funds, and government/NSC relationship; prize money and revenue sharing.
- Referee development; insurance, welfare, and training camps; diaspora and Nepalis abroad.
- Real Nepal player database and provenance; real staff database; girls development, schools, grassroots, and academies.
- VAR; media and journalism; rivalries; AI staff hiring; AI chairman.
- Tauri shell/native packaging; performance.

High-risk overlays:

1. **Foreign staff movement — COMPLETE.** Existing staff identities now move through the
   normal vacancy/application/decision/contract path in both directions. CONTEXT_ONLY clubs
   have bounded external vacancy processing, staff employment history, contract closure,
   retirement/replacement, imported-staff visibility, and Nepal refill after an outgoing move;
   they remain non-playable and do not receive a full foreign payroll simulation.
2. **Global generated-player lifecycle — PARTIAL.** Foreign seasonal replenishment is live,
   deterministic, and idempotent, but only shortage top-ups are modeled. External context
   players are written as `ACTIVE`; development/decline, retirement, free-agent transition,
   and future-star replacement are not connected to the global context record.
3. **Continental/global competition context — PARTIAL.** Nepal's senior international path
   covers SAFF, AFC Asian Cup, and World Cup qualification. External leagues store seeded
   champion, qualifier, relegation, and reputation outcomes, but external continental/global
   club competitions and their seasonal reputation effects are not simulated.
4. **International partnerships — PARTIAL / persisted-only.** The type vocabulary exists for
   `SCOUTING`, `TECHNICAL`, `YOUTH_DEVELOPMENT`, `ACADEMY`, `STAFF_EXCHANGE`, `TRAINING`,
   `LOAN_PLAYER_PATHWAY`, `LOAN`, `PREFERRED_TRANSFER`, `COMMERCIAL`, and `FRIENDLY_TOUR`.
   Proposal/activation and bounded benefit calculation are tested, but no production cadence
   consumes them. SCOUTING, TECHNICAL, YOUTH_DEVELOPMENT, ACADEMY, TRAINING,
   LOAN_PLAYER_PATHWAY, LOAN, and COMMERCIAL are persisted-only benefit paths; STAFF_EXCHANGE,
   PREFERRED_TRANSFER, and FRIENDLY_TOUR currently have no behavior beyond storage.
5. **Multi-club ownership/network effects — PARTIAL / persisted-only.** Ownership records,
   conflict detection, and related-party/pathway evaluators are unit-tested. No production
   caller applies network effects to loans, recruitment, finance, or governance restrictions.
6. **Sell-on clauses — PARTIAL / persisted-only.** `sellOnPercentage` is negotiated and
   persisted on transfer offers. There is no durable clause attached to a completed transfer,
   no later resale trigger, and no exact-once sell-on ledger payout.

### Remaining-candidate coverage matrix

| Candidate | Unit | Integration | Production flow | Reload |
| --- | --- | --- | --- | --- |
| Trials | invitation, response, knowledge, expiry, offer handoff | 4 focused lifecycle tests | scouting cadence, seasonal AI, and external-interest paths | active and completed reload |
| Foreign staff movement | vacancy, decision, contract, retirement helpers | two-way CONTEXT_ONLY moves and replacement | desktop and seasonal context cadence | contracts/history/replacements reload |
| Global generated lifecycle | youth/workforce generation | foreign idempotency/replenishment | seasonal shortage top-up | bootstrap/replenishment idempotency |
| External competition context | external profile helpers | global-context season persistence | career seasonal cadence | context rows reload |
| Partnerships | pathway/evaluation helpers | one SCOUTING activation | no production consumer | no partnership reload proof |
| Multi-club | conflict/pathway helpers | none | none | repository only |
| Sell-on | offer persistence | no resale flow | no consumer | offer reload only |
| Loan development attribution | none | none | none | none |

## Missing Systems

- Women's player data in the shipped factual dataset; women's national team; U17/U20/U23
  national teams; legends and cult heroes; real referee database.

The real staff entry remains role-limited: the canonical seed has 149 verified `HEAD_COACH`
rows. Suitable club-linked entries now become factual staff appointments and participate in the
same bounded hiring pipeline as generated staff; federation-only roles remain outside this club
mobility pass. The referee entry remains MISSING. Generated supply is the active continuity mechanism.
Women's and age-group national football remain gameplay gaps.

## Later / Explicitly Deferred

- Loan-development/minutes attribution: no initial-scope contract in the repository; current
  loan scope is contract, wages, recall, expiry, return, and option-to-buy.
- Final 20/50-year balancing; mobile; final release workflow.

## Performance Notes

The instrumented stage-eight three-season test is classified **REAL_SIMULATION_COST**:
it runs the actual career world twice for three seasons and remained CPU-active. It is not
classified TEST_HARNESS_ONLY. Targeted counters showed bounded bootstrap activity (two world
bootstraps, zero canonical-seed initializations, two transfer bootstraps), so there is no
evidence that repeated bootstrap is the primary cause. No database N+1 diagnosis is claimed
for the unfinished full-suite tail. The controlled broad run completed 15/17 tests before
being stopped and is **SLOW_BUT_PROGRESSING**, not a suite PASS.

No long save, balance run, UI/UX pass, or optimization was performed.

## Final Feature Passes Before Freeze

- **P0 — scope and core closure:** the international-trials and two-way foreign-staff scope gates
  are closed: foreign-player → Nepal and Nepal-player → context-only foreign evaluation are
  supported, and club staff can move through shared employment records. Next resolve the women's
  and age-group international scope, including only the required data, selection,
  fixtures/results, eligibility, persistence, and progression surfaces.
- **P1 — connected-world depth:** connect global player development/decline/retirement and
  external competition context; add production consumers for partnership types and multi-club
  effects; implement sell-on resale settlement if retained in scope. Wire the remaining
  production gaps for AI staff, government/distribution, referee development/VAR, camps,
  media/rivalries, club creation/takeovers, and diaspora as their scope is confirmed.
- **P2 — proof and release:** add a repeatable performance benchmark, then run the bounded
  20-year gate before any 50-year run; complete factual-data enrichment, packaging/CI, UI
  conveniences, legends, balance, legal attribution, and release QA.

Only the focused current gates are evidence-supported: root typecheck and build pass;
canonical/global/context/corridor coverage is green; the permanent-transfer/integrity gate
is green; loan lifecycle and bounded AI recall regressions are green. No future roadmap pass
is being marked green automatically.

## Feature Freeze Decision

**NO — not ready for a true feature freeze.** The core manager spine is production-reachable,
but global lifecycle/competition context/partnership/network/sell-on systems are meaningful
PARTIALs, women's and age-group international systems remain MISSING, and long-save performance is BUILT_NOT_PROVEN. Freeze
can be reconsidered after the P0 scope decisions and proof tasks are closed. The current
uncommitted repository work remains untouched.
