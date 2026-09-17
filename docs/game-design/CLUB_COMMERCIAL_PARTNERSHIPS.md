# Club Commercial Partnerships — Phase 2

## Architecture audit (before writing any code)

The headline finding repeated the Phase 1 pattern: **most of what this
phase asked for already existed and was already running live.**
`SponsorshipContract` is not a stub — it already models a full commercial
agreement *and* its negotiation:

- `type: SponsorshipType`, `startDate`/`endDate`, `annualValue`,
  `bonuses: Record<string, number>`, `currency`
- a real status machine: `OFFERED → COUNTERED → ACTIVE → EXPIRED /
  REJECTED / WITHDRAWN`
- `negotiationRound`, `maxNegotiationRounds`, `counterpartyResponse`,
  `negotiationNote`
- `exclusivityGroup` — slot exclusivity was already modelled
- `expectations`, `provenanceStatus`

And `club-economy.ts` already exposed the whole lifecycle:
`generateSponsorOffers`, `acceptSponsorOffer`, `rejectSponsorOffer`,
`counterSponsorOffer`, `renewSponsorship`, `expireSponsorships`,
`sponsorMeetingOverview`, with executive-authority wrappers on top.

So the collision rule applied directly: **extend, do not rebuild.** What
this phase actually added is narrow and deliberate.

### What already existed (and was therefore NOT rebuilt)

| Phase 2 requirement | Pre-existing reality |
| --- | --- |
| Shirt sponsor contracts | `SHIRT_MAIN`, `SHIRT_SECONDARY`, `SLEEVE` |
| Commercial partners | `OFFICIAL_PARTNER`, `LOCAL_PARTNER` |
| Offer generation | `generateSponsorOffers` — bounded, macro-adjusted, slot-aware, deterministic |
| Negotiation | `counterSponsorOffer` — budget-tier ceiling, bounded rounds, ACCEPT/COUNTER/REJECT |
| Accept / reject | `acceptSponsorOffer` / `rejectSponsorOffer` (+ executive variants) |
| Canonical finance | `postClubTransaction`, category `SPONSORSHIP`, with idempotency keys |
| Payment cadence | `processClubEconomyMonth` posts `annualValue / 12` monthly |
| Expiry | `expireSponsorships` → `EXPIRED` + historical event |
| Renewal | `renewSponsorship` |
| AI participation | `ai-club-strategy` generates, ranks and accepts offers |
| Exclusivity | `exclusivityGroup` + conflict check inside `acceptSponsorOffer` |
| Owner UI | `SponsorMeeting`, already wired to the Chairman `sponsorship` route |
| Partner identity | `SponsorOrganisation` (name, industry, budget tier, identity provenance) |

Building any of those again would have produced exactly the duplicate
sponsorship system and duplicate finance engine the brief forbids.

## Contract types

`KIT_SUPPLIER` is the one contract type that genuinely did not exist, and
it is a `SponsorshipType` rather than a parallel model. A supplier is a
commercial agreement like any other: same lifecycle, same exclusivity
slot, same canonical ledger posting.

**No migration was required.** `sponsorship_type` is unconstrained
`TEXT`, the repository maps `contract.type` straight through, and there
is no exhaustive `Record<SponsorshipType, …>` anywhere in the codebase —
the only type-aware UI is a partial label map with a graceful fallback.
Old saves simply never carry the value.

Deliberately **not** added: a fan of ten sponsor slots. `TRAINING_KIT`,
`STADIUM` and `ACADEMY` already exist in the enum for a future phase that
wants them; this phase did not wire them into the offer rotation.

## The slot model

The "a club can hold four sponsors" assumption previously lived as a
literal `4` in three separate places: offer generation, the monthly
economy tick, and the AI planner. All three now read one exported
constant:

```ts
export const SPONSORSHIP_SLOT_ORDER: readonly SponsorshipType[] = [
  "SHIRT_MAIN", "OFFICIAL_PARTNER", "SLEEVE", "LOCAL_PARTNER", "KIT_SUPPLIER",
] as const;
```

**Order matters.** World creation seeds every club with `count: 1`, which
fills the *first open slot*. Kit supply is appended last precisely so a
club still starts with a shirt sponsor and has to go to market for a
supplier like any other deal — it is never handed one for free. This is
covered by a test, not just by intent.

## Kit supplier

- **Term**: two years, matching `SHIRT_MAIN`. The minor slots stay on a
  one-year cycle.
- **Value**: produced by the existing `generateSponsorOffers` valuation —
  audience, reputation, brand strength, digital reach, league standing,
  sponsor budget tier, macro economy. No separate supplier pricing model.
- **Exclusivity**: `exclusivityGroup` is the type itself, so
  `acceptSponsorOffer`'s existing conflict check refuses a second active
  supplier with no new code.
- **Royalty**: a completed supply deal also pays a bounded share of the
  merchandise the club *actually sold* that month:

```ts
export const KIT_SUPPLIER_ROYALTY_SHARE = 0.06;
```

  This is derived from the figure `postMerchandiseRevenue` returns — not
  a second sales model, and never a direct cash mutation. The club keeps
  its merchandise income in full; the royalty is additional rights money
  posted under the canonical `SPONSORSHIP` category, keyed
  `kit-royalty:<contractId>:<date>` so a replayed tick cannot pay twice.

  It is a bounded module constant rather than a per-contract field
  because the contract model does not need another column to express
  "this is a supply deal".

## Finance integration

Every rupee goes through `postClubTransaction` under the existing
`SPONSORSHIP` category. There is no new ledger category and no new
payment path:

| Money | Cadence | Idempotency key |
| --- | --- | --- |
| Initial payment | on acceptance | `sponsor-initial:<contractId>` |
| Monthly payment | monthly tick | `sponsor-month:<contractId>:<date>` |
| Kit royalty | monthly tick | `kit-royalty:<contractId>:<date>` |
| Performance bonus | season close | `sponsor-bonus:<contractId>:<season>:<clause>` |

Exact-once is **structural, not guarded by new state**:
`postClubTransaction` derives the ledger row id from
`clubId:date:category:direction:idempotencyKey`, so a replay, a reload or
a repeated close collapses onto the same row instead of paying again.

## Performance bonuses

`bonuses` was already written at offer generation (`champion`,
`promotion`) and read by **nothing** — the contracts advertised bonuses
the economy never paid. `settleSponsorshipPerformanceBonuses` now settles
them at season close, before the financial statement is totalled so the
money lands in the season it was earned.

Only clauses with a real canonical outcome behind them are paid:

- **champion** — reads `competition_winners`, the same row season
  finalisation writes when it crowns a champion, scoped to the season
  being closed. A proper relational hook, not JSON matching inside
  `historical_events`.
- **promotion** — reads `competition_movements` joined to
  `competition_seasons` for date scoping.
- **continental qualification — NOT IMPLEMENTED.** No reliable canonical
  event exists, and no offer advertises one. Per the brief's own rule, a
  bonus without a real hook is not invented.

A real discrepancy surfaced here and is guarded rather than assumed:
`CompetitionMovementType` declares `PROMOTION` while existing callers
compare against `PROMOTED`. The query accepts both, and a test proves the
promotion bonus actually pays rather than silently never firing.

## Expiry and renewal

Unchanged canonical behaviour: `expireSponsorships` moves a contract to
`EXPIRED` and emits a historical event; the monthly tick only pays
contracts that are `ACTIVE` and in date, so an expired deal stops paying
by construction. `renewSponsorship` produces a fresh `OFFERED` contract
from the previous one. Nothing auto-renews silently.

## AI clubs

AI participation was already real — `ai-club-strategy` generates, ranks
(`rankSponsorOffer`) and accepts offers on the same canonical path a
player uses. The only change needed was the slot bound, which now reads
`SPONSORSHIP_SLOT_ORDER.length`, so AI clubs can reach the supplier slot.
Verified: AI clubs do sign kit suppliers, and never more than one each.

This also invalidated a pre-existing assertion in
`ai-commercial-participation.test.ts` that capped clubs at four
sponsorships. That test now reads the canonical constant — capping the AI
at four to keep an old number true would have masked the feature instead
of testing it.

## Owner UI

**No new Partnerships page was created.** The existing Sponsorship screen
already *is* the offers / active / history deal surface, backed by
`sponsorMeetingOverview` which already enriches contracts with sponsor
name, industry, budget tier and identity provenance. Adding a second
screen over the same data would have been the unrelated page family the
brief warns against.

The Club Store instead gained a supplier summary — partner, contract end,
annual value, royalty share — linking through to Sponsorship, so the deal
is reported where it is relevant and managed where it is owned.

Kit supply is connected to the kits **textually**. No sponsor or supplier
mark is drawn on the kit SVG: no original generated partner-mark system
exists, and real brand logos are out of the question.

## Persistence, old saves, Create-a-Club

- **Save/load** — a signed supplier, its royalty ledger entries and the
  Owner's commercial overview all survive a real `saveCareer` /
  `loadCareer` cycle through a *separate* service instance.
- **Old saves** — a save written before the type existed carries no
  `KIT_SUPPLIER` row at all; it loads without migration failure and the
  overview reports no supplier rather than inventing one. (Note: a *fresh*
  save on current code is not an old save — the monthly tick correctly
  offers the newly-opened slot, so an `OFFERED` supplier row legitimately
  appears. The test constructs a genuine pre-feature shape instead.)
- **Create-a-Club** — a founded club starts with no kit supplier and no
  active commercial deals at all. No founder wizard step was added;
  `club-creation.ts` contains no sponsorship seeding, so this is verified
  existing behaviour rather than new code.

## Provenance

Every partner is a generated `SponsorOrganisation` carrying
`identityProvenance`, and all contract figures remain `SIMULATION_ONLY`.
No real brands were introduced, and nothing claims that a real company
sponsors a simulated club.

## Verification

Unit and integration coverage is green: kit-supply lifecycle and term,
no free supplier at world creation, exclusivity refusal, bounded and
replay-safe royalty, champion and promotion bonuses paying exactly once
across a re-close, no bonus without a real outcome, AI participation,
save/load, pre-feature old saves, and the Create-a-Club default — plus
the full `apps/desktop` suite and the root typecheck at its historical
baseline.

### Browser coverage

`apps/desktop/e2e/club-partnerships.spec.ts` drives the real Owner flow:
a `KIT_SUPPLIER` offer reaching the Sponsorship desk through the canonical
pipeline, the Counter button staying disabled until a positive amount is
entered, countering within the sponsor's ceiling signing the deal at
exactly the countered value, the contract appearing in the visible
Sponsors table, **the Club Store reporting the Phase 2 supplier**, and the
whole thing surviving save and reload — with zero console errors.

Figures are asserted against the authoritative `getSponsorMeeting` payload
rather than hard-coded, because the save's `randomSeed` embeds
`Date.now()`.

The counter is deliberately 1.02x the offer: `counterSponsorOffer` accepts
at or below 1.03x and otherwise counters or walks away, so the spec
exercises a real negotiation round with a deterministic outcome rather
than a coin flip that would look like flakiness.

- **Accessibility**: axe reports 0 serious and 0 critical on both the
  Sponsorship meeting and the Club Store.
- **Keyboard**: the counter field and the response buttons take focus, and
  the responses are grouped under an `aria-label`ed `role="group"`.
- **Responsive**: 1024/1280/1440/1600 — no page-level horizontal overflow,
  and the response controls are checked by bounding-box containment rather
  than DOM visibility.

*Proven non-tautological*: swapping the Club Store's supplier name for the
contract end date made the spec fail on exactly that assertion ("expected
Nepal Football Development Partner", received "Kit supplied by 2028-08-01
until 2028-08-01") while the adjacent "Kit supplied by" assertion still
passed — so the failure was specific to the partner identity rather than a
generic breakage or timeout. Reverting restored green. A browser test that
has never failed has not been shown to detect anything.

### Multi-season soak

`club-commercial-partnerships-soak.test.ts` runs the canonical whole-world
simulation for five seasons with the economy enabled, then audits every
club's contracts. Results: contract values finite and positive, mean value
from first to last season well inside the runaway guard, no club exceeding
the canonical slot count, no duplicated exclusivity group, at most one kit
supplier per club, expired deals paying nothing after their end date, and
no bonus or royalty posting twice for one period.

**A measurement correction worth recording.** The proportionality check
first reported a club at 94.4% sponsorship and failed. The instinct to
widen the bound would have been wrong — and the second instinct, that the
world posts no matchday income, was wrong too. Partitioning the clubs
showed what was actually happening:

| Population | Clubs | Median | Worst | Worst club's breakdown |
| --- | --- | --- | --- | --- |
| Actually played fixtures | 57 | 68.9% | 82.6% | `SPONSORSHIP=83% MERCHANDISE=6% BROADCASTING=5% MATCHDAY_REVENUE=4% PRIZE_MONEY=1%` |
| Account-only, no fixtures | 13 | 91.1% | 94.4% | `SPONSORSHIP=94% MERCHANDISE=6%` |

`processClubEconomyMonth` pays sponsorship and merchandise to every club
holding a financial account, including foreign and context clubs that never
play a Nepal fixture and therefore cannot earn matchday or prize money.
Their share is ~100% by construction, so including them measured the
harness's club population rather than the economy's balance. The bound now
applies to clubs that actually play — and it was written at 0.9 *before*
that population was measured at 82.6%, so it is a bound the data had to
satisfy rather than one fitted to it. Both populations are logged on every
run so the figures can be judged directly.

### Known P2 — sponsorship is the dominant income line

Even among clubs that genuinely compete, sponsorship is 68.9% of credit
income at the median. That is a pre-existing characteristic of the
economy rather than something this phase introduced — the baseline already
had four sponsorship slots — but this phase does nudge it upward by adding
a fifth slot and posting the kit royalty under the same `SPONSORSHIP`
category. Whether matchday, broadcasting and prize money should carry more
weight is a balance question for a future economy pass; it is recorded here
rather than quietly tuned inside a commercial phase.

### Known P2 — the negotiation outcome notice is wiped by its own refresh

`counter()` sets the outcome message ("… accepted your counter at …" /
"… walked away from the negotiation") and then calls `refresh()`, which
remounts `SponsorMeetingView` through `AsyncPanel` and resets that local
state. The player may therefore never see the result of the negotiation
they just triggered.

This is pre-existing behaviour in a screen this phase did not otherwise
touch, and this was an extend-not-refactor pass, so it is recorded rather
than silently changed. The E2E deliberately does **not** assert that notice
— papering over it with a timing-sensitive assertion would have hidden a
real UX defect behind a green test. The negotiation's outcome is instead
proven against the authoritative payload and the visible contract table.

## Next

**Supplier/sponsor work is now in place; the next commercial step is
partner depth** — the remaining enum slots (`TRAINING_KIT`, `STADIUM`,
`ACADEMY`), and relationship/renewal richness if a canonical relationship
signal ever exists. Named-player and star-player commercial effects remain
deferred for the reasons recorded in `CLUB_RETAIL.md`.
