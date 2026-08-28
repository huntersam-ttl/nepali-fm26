# Nepal Football Universe — Remaining Feature Inventory

## Snapshot

Audit date: 2026-08-28. Repository: `/Users/cc/nepali-fm26`. Women/youth international
closure pass based on HEAD `d12afb9`; the pre-existing untracked `nepali-fm26/` entry
remains untouched.

The inventory has 92 normalized entries: the 84 row-level entries in the previous feature
audit, plus the eight explicit high-risk overlays requested for this pass. Statuses are:

| Status | Count |
| --- | ---: |
| COMPLETE | 60 |
| BUILT_NOT_PROVEN | 1 |
| PARTIAL | 24 |
| MISSING | 3 |
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

The following systems are COMPLETE:

- Core world state and persistent entities; deterministic RNG; calendar and time; save/load, autosaves, and schema compatibility.
- History and dynamic history; character creation; manager career; manager interviews; career reputation and history.
- Core match engine; quick sim, key events, and text live; stoppage time, extra time, penalties, and aggregates; domestic match-requires-winner wiring; fixture integration; referee integration.
- Tactics, squad selection, training, and player development; scouting; transfers and contracts; staff market, contracts, and licences; player concerns, promises, and squad meetings.
- Universal interaction sessions; universal interaction authoritative execution; club economy, budgets, and wages; infrastructure and construction lifecycle; club sponsorship and commercial; international trials.
- Ownership succession; board pressure; federation governance and economy; federation compliance, sanctions, and reinstatement; federation elections; federation personnel succession; federation commercial rights and broadcasting.
- Nepal A/B/C pyramid, promotion, relegation, and memberships; club licensing; lower-league finance and squad viability; territorial structure; district/provincial representative competitions; district infrastructure projects.
- Youth intake, development, retirement, and late developers; free agents; foreign player supply into Nepal; player regeneration and long-save supply; staff/referee regeneration and long-save supply.
- Global generated-player lifecycle: context-only external players now persist through deterministic development, peak/decline, affiliation/free-agent reconciliation, retirement, replenishment, and reload-safe future-star emergence without simulating proprietary foreign leagues.
- External/global competition context: persisted domestic qualifiers now resolve into deterministic, history-backed continental context with bounded club/player reputation effects.
- Women's clubs and competitions; macroeconomy; personal wealth; supporter base, attendance, atmosphere, and mood; awards. The separate rivalry system remains PARTIAL.
- AI squad planning, transfers, and contracts; AI federation and national-team automation; senior-men, senior-women, and U17/U20/U23 national teams and international competition.
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
2. **Global club tournaments — LATER.** Continental context is lightweight and seasonal;
   no detailed intercontinental club tournament is currently planned.
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
| Women / youth internationals | category-aware selection, age/availability/eligibility filters, shared fixture/result records | women and U17 end-to-end, sanctions, age-out, senior pathway | bounded seasonal SAFF/AFC calendar | squads, results, caps, history, and repeated progression |
| Foreign staff movement | vacancy, decision, contract, retirement helpers | two-way CONTEXT_ONLY moves and replacement | desktop and seasonal context cadence | contracts/history/replacements reload |
| Global generated lifecycle | canonical attributes, potential, development, retirement, and context records | focused lifecycle/reload/determinism coverage | seasonal context lifecycle plus bounded replenishment | identity, retirement, development, and replenishment reload-safe |
| External competition context | external profile helpers | global-context season persistence | career seasonal cadence | context rows reload |
| Partnerships | pathway/evaluation helpers | one SCOUTING activation | no production consumer | no partnership reload proof |
| Multi-club | conflict/pathway helpers | none | none | repository only |
| Sell-on | offer persistence | no resale flow | no consumer | offer reload only |
| Loan development attribution | none | none | none | none |

## Missing Systems

- Women's player data in the shipped factual dataset; legends and cult heroes; real referee database.

The real staff entry remains role-limited: the canonical seed has 149 verified `HEAD_COACH`
rows. Suitable club-linked entries now become factual staff appointments and participate in the
same bounded hiring pipeline as generated staff; federation-only roles remain outside this club
mobility pass. The referee entry remains MISSING. Generated supply is the active continuity mechanism.
Women's factual player-data coverage remains separate from the now-complete women’s international
production path.

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

- **P0 — scope and core closure:** empty. International trials, two-way foreign staff movement,
  and women/youth international football are production-reachable with focused proof. This does
  not imply a feature freeze.
- **P1 — connected-world depth:** extend external competition context; add production consumers for partnership types and multi-club
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
but external competition context/partnership/network/sell-on systems are meaningful
PARTIALs and long-save performance is BUILT_NOT_PROVEN. Freeze can be reconsidered only after
the remaining P1 production passes and proof tasks are closed. The current uncommitted
repository work remains untouched.
