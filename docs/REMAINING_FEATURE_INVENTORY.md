# Nepal Football Universe — Remaining Feature Inventory

## Snapshot

Audit date: 2026-08-29. Repository: `/Users/cc/nepali-fm26`. Final reconciliation based on
HEAD `6f5cc74`; the pre-existing untracked `nepali-fm26/` entry
remains untouched.

The inventory has 92 normalized entries: the 84 row-level entries in the previous feature
audit, plus the eight explicit high-risk overlays requested for this pass. Statuses are:

| Status | Count |
| --- | ---: |
| COMPLETE | 69 |
| BUILT_NOT_PROVEN | 1 |
| PARTIAL | 15 |
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
- Women's clubs and competitions; macroeconomy; personal wealth; supporter base, attendance, atmosphere, and mood; awards. Stored rivalry-to-match production context is now wired; broader rivalry seeding and evolution remains PARTIAL.
- AI squad planning, transfers, and contracts; AI federation and national-team automation; senior-men, senior-women, and U17/U20/U23 national teams and international competition.
- Stadium, training, youth, medical, and technical infrastructure; desktop runtime and SQLite; legal and data provenance.

## Built but Not Proven

### Core training closure

Core player training is **COMPLETE**; the former `COMPLETE_BUT_DOC_STALE` label was
stale, not a missing production system. `advanceManagerCareer` consumes the persisted team
plan on each normal day, passes staff/facility environment into the canonical
development model, updates bounded fatigue/fitness/development, rolls seeded
training injuries through the normal injury repository, and records stable
training history. Eligibility excludes injured or unavailable training through
the existing availability model. Focused phase-A/phase-B and history/reload
tests cover these paths. Detailed AI-club training is not a separate current
design requirement; foreign clubs remain on lightweight context development.

### Long-save continuity (10–15 season viability)

The annual youth/retirement and workforce reconciliation path is live and a 12-season
structural test passes. A 20/50-year save, balance run, and current long-save performance
gate were intentionally not started. This is proof debt, not a new implementation request.

## Partial Systems

Legacy partials:

- Chairman/owner career; federation-president career; broader role transitions, authority, and permissions (bounded active-role switching, approved-proposal implementation, chairman budget setting, and chairman infrastructure approval are now production-wired).
- Federation-president proposal submission now has a Nepal/FULL role-facing command adapter
  and approved-proposal implementation now has a Nepal/FULL role-facing command adapter that delegates to the canonical proposal service; a complete playable federation-president
  career and broader command surface remain PARTIAL.
- Career default match-view wiring; club creation and new clubs; takeover/ownership lifecycle.
- Grants, restricted funds, and government/NSC relationship; prize money and revenue sharing.
- Insurance and welfare; the national-team camp slice and federation severe-injury welfare programme are COMPLETE; diaspora and Nepalis abroad.
- Real Nepal player database and provenance; role-limited real staff database (the verified
  Nepal senior-men national-team head-coach relationship is now production-wired); girls
  development, schools, grassroots, and academies.
- media and journalism (notable-event publishing is now production-wired); rivalries (stored relationships now reach match history/media, with broader seeding/evolution remaining partial); AI chairman.
- Tauri shell/native packaging; performance.

High-risk overlays:

1. **Foreign staff movement — COMPLETE.** Existing staff identities now move through the
   normal vacancy/application/decision/contract path in both directions. CONTEXT_ONLY clubs
   have bounded external vacancy processing, staff employment history, contract closure,
   retirement/replacement, imported-staff visibility, and Nepal refill after an outgoing move;
   they remain non-playable and do not receive a full foreign payroll simulation.
2. **Global club tournaments — LATER.** Continental context is lightweight and seasonal;
   no detailed intercontinental club tournament is currently planned.
4. **International partnerships — COMPLETE for bounded P1 type wiring and lifecycle.** The type vocabulary exists for
   `SCOUTING`, `TECHNICAL`, `YOUTH_DEVELOPMENT`, `ACADEMY`, `STAFF_EXCHANGE`, `TRAINING`,
   `LOAN_PLAYER_PATHWAY`, `LOAN`, `PREFERRED_TRANSFER`, `COMMERCIAL`, and `FRIENDLY_TOUR`.
   Proposal/activation, bounded benefit calculation, and expiry/lifecycle enforcement are tested.
   SCOUTING, TECHNICAL, YOUTH_DEVELOPMENT, ACADEMY, and LOAN have production consumers, and PREFERRED_TRANSFER now
   feeds the canonical permanent-transfer candidate path. COMMERCIAL now feeds a bounded,
   idempotent monthly club-economy settlement using partner quality. FRIENDLY_TOUR now feeds
   a bounded preseason destination planner that hands context to the existing commercial-camp
   machinery; it does not schedule guaranteed fixtures. TRAINING and LOAN_PLAYER_PATHWAY remain
   persisted-only benefit paths. STAFF_EXCHANGE is satisfied by the existing TECHNICAL
   international-placement programme; LOAN_PLAYER_PATHWAY is satisfied by the canonical LOAN
   engine plus bounded partnership and related-club preference. TRAINING remains a separate
   explicitly deferred partnership type, distinct from the already-complete core player-training
   system.
5. **Multi-club ownership/network effects — COMPLETE for the bounded P1 player-pathway scope.**
   Ownership records resolve active related clubs into existing scouting, transfer, and loan
   candidate flows; related-party valuation and same-competition safeguards are enforced at
   offer evaluation; finance remains per-club and foreign clubs remain `CONTEXT_ONLY`.
   Technical placements satisfy staff exchange; ownership-specific academy collaboration remains
   a separate partial nuance while partnership-driven academy behavior is complete.
6. **Sell-on clauses — COMPLETE.** Negotiated percentages become durable total-resale-fee
   entitlements at permanent-transfer completion. Later qualifying resales settle the entitlement
   exactly once through separate seller-payment and former-club-income ledger entries, with
   reload-safe history and no payout for failed or non-permanent movement.

### Remaining-candidate coverage matrix

| Candidate | Unit | Integration | Production flow | Reload |
| --- | --- | --- | --- | --- |
| Trials | invitation, response, knowledge, expiry, offer handoff | 4 focused lifecycle tests | scouting cadence, seasonal AI, and external-interest paths | active and completed reload |
| Women / youth internationals | category-aware selection, age/availability/eligibility filters, shared fixture/result records | women and U17 end-to-end, sanctions, age-out, senior pathway | bounded seasonal SAFF/AFC calendar | squads, results, caps, history, and repeated progression |
| Foreign staff movement | vacancy, decision, contract, retirement helpers | two-way CONTEXT_ONLY moves and replacement | desktop and seasonal context cadence | contracts/history/replacements reload |
| Global generated lifecycle | canonical attributes, potential, development, retirement, and context records | focused lifecycle/reload/determinism coverage | seasonal context lifecycle plus bounded replenishment | identity, retirement, development, and replenishment reload-safe |
| External competition context | external profile helpers | global-context season persistence | career seasonal cadence seam (`career-external-context.test.ts`) | context rows reload |
| Partnerships | pathway/evaluation helpers and lifecycle | all eight bounded production types, expiry, and reload | bounded production consumers | partnership-specific reload and expiry coverage |
| Multi-club | ownership lookup, pathway, valuation, governance helpers | imported external club, scouting, offer review, reload | scouting/transfer/loan candidate paths and offer governance | ownership lookup reload |
| Sell-on | offer persistence and entitlement | resale, exact-once ledger/history settlement | canonical permanent-transfer completion | clause and settlement reload |
| Loan development attribution | none | none | none | none |

## Missing Systems

- Women's player data in the shipped factual dataset; legends and cult heroes; real referee database.

The real staff entry remains role-limited: the canonical seed has 149 verified `HEAD_COACH`
rows. Suitable club-linked entries now become factual staff appointments and participate in the
same bounded hiring pipeline as generated staff; the verified Nepal senior-men national-team
head coach now resolves to the canonical national-team and federation relationship during
international initialization. Other federation/national-team roles remain outside this bounded
pass. The referee entry remains MISSING. Generated supply is the active continuity mechanism.
Women's factual player-data coverage remains separate from the now-complete women’s international
production path.

## Later / Explicitly Deferred

- Loan-development/minutes attribution: no initial-scope contract in the repository; current
  loan scope is contract, wages, recall, expiry, return, and option-to-buy.
- Final 20/50-year balancing; mobile; final release workflow.

## Final Reconciliation (HEAD `6f5cc74`)

The 92 normalized rows were rechecked against source reachability and focused production tests.
The mechanical status total is now 69 COMPLETE, 1 BUILT_NOT_PROVEN, 15 PARTIAL, 3 MISSING,
and 4 LATER. The BUILT_NOT_PROVEN row is long-save continuity only: its 12-season structural
proof exists, while the 20/50-season performance and durability gates are intentionally not run.

The 15 PARTIAL rows are: chairman/owner career (including bounded budget setting and infrastructure approval, but not a complete chairman command surface); federation-president career (including the
bounded proposal submission and approved-proposal implementation command adapters, but not a complete playable career); broader role transitions
and authority (bounded active-role switching is complete); default match-view wiring; club creation; takeover lifecycle; grants/government
distribution; prize/revenue sharing;
real Nepal player coverage; diaspora/Nepalis abroad; girls development/schools/grassroots;
media/journalism (bounded notable-event publishing is complete, but the broader journalism
surface remains partial); rivalries (stored match context is wired, broader rivalry surface remains partial); AI chairman; and the role-limited real staff
dataset. The three MISSING rows are women's factual player data, legends/cult heroes, and a real
referee database. The four LATER rows are global club tournaments, loan-development/minutes
attribution, mobile, and final release workflow.

Federation referee development is now COMPLETE: the annual ANFA cadence selects up to four active
domestic referees, applies bounded progression to the persisted workforce quality state, records
stable completion history, charges the existing federation ledger, and skips duplicate periods and
external/duplicate federation rows. Focused production proof covers selection, cap, replay,
reload-visible state, and exclusion; assignment continues to consume the same workforce quality.

Rows corrected since the prior narrative: core training, district infrastructure, women/youth
internationals, bounded global context, VAR goal review, AI staff planning, the eight partnership/network types,
multi-club pathways,
and sell-on settlement are COMPLETE. Deeper tournaments, ownership-specific academy effects, and
TRAINING partnership benefits remain outside the bounded release slice and are not duplicate
systems to build here.

Feature freeze remains **NO**: P0 unresolved must-build count is 0, but concrete P1 production
gaps remain in governance/ownership depth, factual coverage, federation support systems, and
AI/media/VAR surfaces. Performance is separate release debt: the seeded season completes in
202.8s, but long-save validation is not authorized at the current projection.

## Performance Notes

The instrumented stage-eight three-season test is classified **REAL_SIMULATION_COST**:
it runs the actual career world twice for three seasons and remained CPU-active. It is not
classified TEST_HARNESS_ONLY. Targeted counters showed bounded bootstrap activity (two world
bootstraps, zero canonical-seed initializations, two transfer bootstraps), so there is no
evidence that repeated bootstrap is the primary cause. No database N+1 diagnosis is claimed
for the unfinished full-suite tail. The controlled broad run completed 15/17 tests before
being stopped and is **SLOW_BUT_PROGRESSING**, not a suite PASS.

No 20/50-year save or balance run was performed. The latest bounded seeded-season optimization
reduced runtime from 267.5s to 202.8s; see `docs/PERFORMANCE_PROFILE.md`. This is release
validation/performance debt, not a missing gameplay engine.

## Final Feature Passes Before Freeze

- **P0 — scope and core closure:** empty. International trials, two-way foreign staff movement,
  and women/youth international football are production-reachable with focused proof. This does
  not imply a feature freeze.
- **P1 — connected-world depth:** extend external competition context; wire the remaining
  `TRAINING` partnership type and effects outside the bounded player-pathway scope;
  production gaps for government/distribution,
  media/rivalries, club creation/takeovers, and diaspora as their scope is confirmed.
- **P2 — proof and release:** add a repeatable performance benchmark, then run the bounded
  20-year gate before any 50-year run; complete factual-data enrichment, packaging/CI, UI
  conveniences, legends, balance, legal attribution, and release QA.

Only the focused current gates are evidence-supported: root typecheck and build pass;
canonical/global/context/corridor coverage is green; the permanent-transfer/integrity gate
is green; loan lifecycle and bounded AI recall regressions are green. No future roadmap pass
is being marked green automatically.

## Feature Freeze Decision

**NO — not ready for a true feature freeze.** The bounded core and global-context slices are
production-reachable, but the P1 production gaps listed above remain. Long-save performance is
separately a release-readiness gate, not evidence that those complete gameplay systems are
missing. The current uncommitted repository work remains untouched.
