# UI / Presentation System — Phase 1 (shell + Home)

> Status: audit and design direction recorded first; the delivered system,
> its verification results and any findings are written into this document
> as they are actually observed, not predicted.

## Design goals

The simulation is deeper than its presentation. The game currently reads
as a football *database*; it should read as a living football *world*.
That is a hierarchy and composition problem, not a colour problem.

Phase 1 is deliberately narrow: the **global shell** and **Home**. Inbox,
Player Profile, Calendar, Training, Squad and Transfers are later phases.
The point of this phase is to establish a shell and a Home design grammar
that those screens can reuse.

## Originality rule

Borrow *information architecture* from premium football-management games —
a persistent football shell, strong screen hierarchy, dense-but-structured
information, football-first navigation, profiles with identity, calendars
that look like calendars. Do **not** borrow visual identity: no copied
layout proportions, typography, colour palette, card shapes, iconography,
screen composition or tab naming. Nepal Football Universe gets its own
visual identity.

## Audit — where the "database UI" feel actually comes from

This was measured against the real code before any redesign, so the
diagnosis is specific rather than aesthetic opinion.

### 1. Card soup is structural, not incidental

```css
.dashboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
```

Manager Home renders **14 `<Panel>` modules** into that grid. Every module
gets the same width, the same weight and the same treatment, so a dominant
anchor is impossible *by construction* — no amount of restyling individual
panels fixes it while the grid treats everything as equal.

### 2. A border around every information unit

`.panel` is `padding: 16px; border: 1px solid; border-radius: 8px;
background: …`, and **every** information unit in the game routes through
that single component. The result is a page of boxes inside boxes. This
also makes `Panel` the highest-leverage — and highest-risk — thing to
change, since it touches every screen at once.

### 3. Competing hierarchy

- `.topbar` **and** `.page-header` both act as page headers.
- `<h1>` appears in the sidebar *and* again in the page header.
- Every `Panel` emits `<h2>` at `1rem`, so Home has ~14 sibling `<h2>`s.

Fourteen equally-sized headings with no intermediate structure is the
literal reason nothing on Home reads as more important than anything else.

### 4. Home is also the Inbox

The Manager screen is labelled **"Home / Inbox"** and renders `InboxPanel`
alongside everything else. That is where the article-feed quality comes
from: routine narrative content sits at the same level as operational
state.

### 5. Typography is nearly flat

`h1` 1.55rem · `h2` 1rem · `h3` 0.82rem · `.subtle`/`.muted` 12px, with an
`.eyebrow` rule forced by `!important`. There is a scale, but the working
range for page content is compressed into roughly 12–16px.

### 6. Token layer barely exists

Nine custom properties, all colour (`--shell`, `--rail`, `--surface`,
`--surface-2`, `--line`, `--text`, `--muted`, `--accent`, `--accent-2`,
`--danger`). No spacing scale, no radius scale, no typography scale across
3,082 lines of CSS — so spacing and sizing are hand-chosen per rule, which
is why hierarchy drifts.

## Measured baseline (captured live, before any change)

Taken from the running app on a real Manager career at 1280x900, so the
"before" is recorded rather than remembered:

| Measurement | Before |
| --- | --- |
| `<h1>` elements | **2** — "Church Boys United" (sidebar) and "Home / Inbox" (page header) |
| Headings on Home | 16 total, **13 sibling `<h2>`s** |
| `<nav>` inside `<main>` | **yes** |
| `<header>` elements | **15** (one per panel) |
| `.panel` count on Home | **13**, each `border: 1px solid` |
| `.dashboard` grid | `309.6px 309.7px 309.6px`, gap 14px |
| Type scale in use | h1 20px · h2 16px · body 16px · `.subtle` 12px |
| Overflow 1024/1280/1440/1600 | none (clean — must not regress) |
| Columns at 1024 / 1440 / 1600 | 2 / 2 / 2 (545px → 625px cards) |
| Workspace width at 1600 | 1337px, no max-width |

Two things this makes concrete. Large screens currently gain nothing but
wider cards — the composition never changes, which is what Phase 36 means
by "don't just stretch edge to edge". And raw enum values are visibly
leaking into the UI (`NORMAL`, `STABLE`, `NEUTRAL`, `PRIMARY`).

## Data available to Home (no new read model)

`ManagerDashboard` already carries identity, `leaguePosition`/`played`/
`points`/`form`, `nextFixture` + `recentResults`, `boardConfidence`/
`boardExpectation`, `squadAvailability`, `moraleSummary`,
`trainingSummary`, cohesion, `concernCount`, the attention counts
(`scoutingUpdates`, `transferActivity`, `contractIssues`, `staffIssues`),
`inbox`, `medicalCentre` and `jobCentre`. `CalendarEntry` supplies typed
events for the strip. `FixtureRow` carries `opponentClub` as a real
`EntityReference`, so the fixture treatment can show a genuine opponent
badge and link canonically instead of matching on text. `InboxItem`
carries `importanceBand`, so the compact-vs-narrative split keys off real
data rather than an invented rule.

A `ManagerHomeReadModel` type exists on `DesktopApplicationState`, but
nothing in the app consumes it — Home uses `getManagerDashboard` and
friends. It is deliberately **not** resurrected here: Phase 45 asks for a
read model only if it materially simplifies data flow, and four
page-level calls with no per-row fetching already do.

**Known cost:** `CareerHeader` carries `clubName` but no `clubId`, and
`careerHeaderFromContext` omits it. Club badge/colour accents in the shell
therefore require adding `clubId` to that header — presentation read-model
support, not a simulation feature. Identity is never fabricated from the
club's name.

## What is already good (and must be reused, not rebuilt)

- **Role-aware navigation already exists** — `NAV_GROUPS` (Manager),
  `CHAIRMAN_NAV`, `PRESIDENT_NAV`, `EXECUTIVE_NAV`, all grouped with
  labels. The shell model is sound; it needs hierarchy, not replacement.
- **Rich non-match 3D infrastructure exists**: `ClubEnvironmentScene`,
  `FederationEnvironmentScene`, `MeetingEnvironmentScene`, `SceneCanvas`
  (with error boundary and 2D fallback), scene builders, `motion.ts`
  (`OFF` / `REDUCED` / `FULL`), and `PresentationSettingsPanel`.
  `ClubEnvironmentScene({ profile, fallback, onOpenReference })` already
  resolves motion, quality, `shouldRender3d` and fallback internally — the
  Home hero should use it rather than invent anything.
- **Club visual identity is canonical and deterministic**: `ClubBadge`,
  `ClubKit`, `resolveClubVisualIdentity`, `PersonPortrait`.
- **Home's data flow is already sound**: four page-level bridge calls
  (`getManagerDashboard`, `getCalendar`, `getCareerHistory`,
  `getSquadConcerns`) with no per-row fetching. There is no existing N+1 to
  fix — only one to avoid introducing.

## Capability baseline (must survive the redesign)

Presentation may change; capability may not be silently dropped.

**Manager Home** — Club · Job Centre (vacancies, applications) · Next
fixture · Squad availability · Club attention · Medical Centre · Dressing
room (disputes, meetings) · Squad concerns · Recent results · Inbox ·
transfer-negotiation launcher · structured press conference · player
meeting · owner player requests · Career history · Calendar · ANFA
Presidency Path.
Destinations: fixtures, squad, staff, contracts, competition,
dressing-room, and player selection.

**Owner Home** — Club summary · Ownership · Club management · Manager
appointment · Operations · Recent club transactions.

**President Home** — Federation world · Federation summary · Presidency ·
National teams · Programmes and finance · Explore the federation ·
Build-a-Nation development scorecard.

## Constraints this phase must respect

- **`nav-responsive.spec.ts` pins literal nav text** — the group labels
  `Team`, `Club`, `External relations`, the button `Home / Inbox`, and
  bounding-box containment for `Media`, `Bank` and `Club Identity` across
  721 / 900 / 1024 / 1080 / 1280 / 1440 / 1600. That spec exists because a
  real nav-clipping bug shipped once. Any label change is a deliberate,
  justified spec update — never a silent break.
- **No match rendering.** A static fixture visual or a stadium environment
  is fine; moving footballers, a ball, a match camera or a replay are not.
- **No new simulation features.** This is a presentation pass; Home reads
  existing application/read models and must not compute canonical state.
- **PC-first**: 1024 / 1280 / 1440 / 1600. Sub-720px mobile shell is
  explicitly out of scope for this phase.

## Direction (to be implemented and then verified)

1. **A small token layer** — spacing, radius and typography scales beside
   the existing colour tokens. Not a design-system package.
2. **Shell hierarchy** — one page header rather than two competing ones,
   a single `<h1>`, correct landmarks (navigation outside `main`).
3. **Home as a command centre** — one dominant anchor (a state-driven club
   hero), then attention / next fixture / squad state / club state, with
   routine data compact and narrative treatment reserved for genuinely
   major events.
4. **Club identity used structurally but sparingly** — accents and
   anchors, never recolouring the whole UI, always with readable contrast.

Verification results — axe, keyboard, the responsive matrix, E2E across
all three roles, role-switch continuity and typecheck — are recorded here
once observed.
