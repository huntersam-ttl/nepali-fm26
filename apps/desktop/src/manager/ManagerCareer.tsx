import React, { useEffect, useRef, useState } from "react";
import type { AutosaveStatusView, CareerHeader, CareerRole, CareerRoleState, EntityId, FixtureRow } from "@nepal-football-sim/shared-types";
import type { AppError, DesktopRuntimeApi } from "../appBridge.js";
import { managerBridge } from "./managerBridge.js";
import { ErrorBanner, useRuntimeData } from "./ui.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { SquadScreen } from "./screens/SquadScreen.js";
import { DressingRoomScreen } from "./screens/DressingRoomScreen.js";
import { PlayerProfileScreen } from "./screens/PlayerProfileScreen.js";
import { TacticsScreen } from "./screens/TacticsScreen.js";
import { TrainingScreen } from "./screens/TrainingScreen.js";
import { FixturesScreen } from "./screens/FixturesScreen.js";
import { CompetitionScreen } from "./screens/CompetitionScreen.js";
import { ScoutingScreen } from "./screens/ScoutingScreen.js";
import { TransfersScreen } from "./screens/TransfersScreen.js";
import { ContractsScreen } from "./screens/ContractsScreen.js";
import { StaffScreen } from "./screens/StaffScreen.js";
import { MedicalScreen } from "./screens/MedicalScreen.js";
import { MediaScreen } from "./screens/MediaScreen.js";
import { MatchdayScreen } from "./matchday/MatchdayScreen.js";
import { RoleLandingScreen, EXECUTIVE_ROLES } from "./RoleLandingScreen.js";
import type { ChairmanScreen, PresidentScreen } from "./RoleDetailScreen.js";
import { OrganizationProfilePanel } from "./RoleDetailScreen.js";
import { PresentationSettingsPanel } from "../presentation/PresentationSettingsPanel.js";
import { PersonPortrait } from "../presentation/PersonPortrait.js";
import { buildPersonVisualIdentity, type PersonRole } from "../presentation/personVisualIdentity.js";
import { ClubBadge } from "../presentation/ClubBadge.js";
import { resolveClubVisualIdentity } from "../presentation/clubVisualIdentity.js";

/** The portrait's `role` must derive from the same real career person
 * regardless of which office they currently hold — a Manager who becomes
 * temporary Federation President (or an Owner who does) keeps the same
 * face, because `buildPersonVisualIdentity` seeds only on `personId`, never
 * on role. Only the attire this maps to changes. */
const portraitRoleFor = (role: CareerRole): PersonRole =>
  role === "CHAIRMAN_OWNER" ? "OWNER" : role === "FEDERATION_PRESIDENT" ? "PRESIDENT" : role === "MANAGER" ? "MANAGER" : "EXECUTIVE";

const careerRoleLabel = (role: CareerRole): string =>
  role === "CHAIRMAN_OWNER"
    ? "Chairman / Owner"
    : role === "FEDERATION_PRESIDENT"
      ? "Federation President"
      : role === "CEO"
        ? "CEO"
        : role === "GENERAL_SECRETARY"
          ? "General Secretary"
          : role === "SPORTING_DIRECTOR"
            ? "Sporting Director"
            : role === "DIRECTOR_OF_FOOTBALL"
              ? "Director of Football"
              : "Manager";

const SCREENS = [
  "home",
  "squad",
  "dressing-room",
  "tactics",
  "training",
  "fixtures",
  "competition",
  "scouting",
  "transfers",
  "contracts",
  "staff",
  "medical",
  "media",
] as const;

const NAV_GROUPS: Array<{ label: string; items: Screen[] }> = [
  { label: "Team", items: ["home", "squad", "dressing-room", "tactics", "training", "medical"] },
  { label: "Competition", items: ["fixtures", "competition"] },
  { label: "Recruitment", items: ["scouting", "transfers", "contracts"] },
  { label: "Club", items: ["staff", "media"] },
];

type Screen = (typeof SCREENS)[number];
type RoleScreen = ChairmanScreen | PresidentScreen;

const CHAIRMAN_NAV: Array<{ group: string; items: Array<{ id: ChairmanScreen; label: string }> }> = [
  { group: "Owner office", items: [{ id: "dashboard", label: "Dashboard" }, { id: "matchday", label: "Matchday" }, { id: "finance", label: "Finances" }, { id: "manager", label: "Manager" }, { id: "meeting", label: "Talk to Manager" }] },
  { group: "Ownership", items: [{ id: "investors", label: "Investors" }] },
  { group: "Staff", items: [{ id: "executive", label: "Executive Management" }] },
  { group: "Development", items: [{ id: "facilities", label: "Facilities" }] },
  { group: "Commercial", items: [{ id: "sponsorship", label: "Sponsorship" }, { id: "supporters", label: "Supporters" }, { id: "club-store", label: "Club Store" }] },
  { group: "Club", items: [{ id: "identity", label: "Club Identity" }] },
  { group: "External relations", items: [{ id: "bank", label: "Bank" }] },
];
const PRESIDENT_NAV: Array<{ group: string; items: Array<{ id: PresidentScreen; label: string }> }> = [
  { group: "Federation", items: [{ id: "dashboard", label: "Dashboard" }, { id: "governance", label: "Governance" }, { id: "finance", label: "Finance" }, { id: "commercial", label: "Commercial" }] },
  { group: "Football", items: [{ id: "national-teams", label: "National Teams" }, { id: "national-development", label: "National Development" }, { id: "competition-pyramid", label: "Domestic Pyramid" }, { id: "nepal-map", label: "Nepal Map" }] },
  { group: "External relations", items: [{ id: "government-relations", label: "Government" }] },
  { group: "Career", items: [{ id: "tenure", label: "Election / Tenure" }] },
];
// Executive roles (CEO, General Secretary, Sporting Director, Director of
// Football) currently have exactly one screen — showing the Chairman/
// President sub-navigation next to it would suggest sections that do
// nothing for this role and never actually render for it.
const EXECUTIVE_NAV: Array<{ group: string; items: Array<{ id: PresidentScreen; label: string }> }> = [
  { group: "Executive office", items: [{ id: "dashboard", label: "Dashboard" }] },
];

const LABELS: Record<Screen, string> = {
  home: "Home / Inbox",
  squad: "Squad",
  "dressing-room": "Dressing Room",
  tactics: "Tactics",
  training: "Training",
  fixtures: "Fixtures",
  competition: "Competition",
  scouting: "Scouting",
  transfers: "Transfers",
  contracts: "Contracts",
  staff: "Staff",
  medical: "Medical",
  media: "Media",
};

const SUBTITLES: Record<Screen, string> = {
  home: "Decisions, inbox updates, and the next match.",
  squad: "Review player availability, form, and contracts.",
  "dressing-room": "Hierarchy, concerns, demands, promises, and squad mood.",
  tactics: "Set the shape and instructions for your team.",
  training: "Plan the week and monitor squad development.",
  fixtures: "Prepare for upcoming matches and review results.",
  competition: "Track the table, form, and scoring leaders.",
  scouting: "Turn reports into focused recruitment decisions.",
  transfers: "Manage targets, offers, and squad movement.",
  contracts: "Keep player terms aligned with the club plan.",
  staff: "Build the support team around your squad.",
  medical: "Monitor recovery and return-to-play decisions.",
  media: "Supporter mood, press coverage, and press conferences.",
};

/**
 * Manager career workspace.
 *
 * Deliberately self-contained so the surrounding shell can stay role-agnostic:
 * it receives the career header and the core runtime bridge, and owns nothing
 * about career creation or role selection.
 */
export const ManagerCareer = ({
  header,
  bridge,
  onHeaderChange,
  roles,
  onRoleSwitch,
  onSave,
  onExit,
}: {
  header: CareerHeader;
  bridge: DesktopRuntimeApi;
  onHeaderChange: (header: CareerHeader) => void;
  roles: CareerRoleState;
  onRoleSwitch: (role: CareerRole) => Promise<void>;
  onSave: () => Promise<void>;
  onExit: () => void;
}): React.ReactElement => {
  const [screen, setScreen] = useState<Screen>("home");
  const [roleScreen, setRoleScreen] = useState<RoleScreen>("dashboard");
  const [playerId, setPlayerId] = useState<EntityId | null>(null);
  const [matchFixtureId, setMatchFixtureId] = useState<EntityId | null>(null);
  const [resumingMatch, setResumingMatch] = useState(false);
  const [openMatchAsReport, setOpenMatchAsReport] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [autosave, setAutosave] = useState<AutosaveStatusView | null>(null);
  const [matchdayFixture, setMatchdayFixture] = useState<FixtureRow | null>(null);
  const [openClubId, setOpenClubId] = useState<EntityId | null>(null);
  const [presentationOpen, setPresentationOpen] = useState(false);

  const refreshAutosave = async (): Promise<void> => {
    const result = await bridge.getAutosaveStatus();
    if (result.ok) setAutosave(result.data);
  };

  useEffect(() => {
    void refreshAutosave();
  }, [refreshKey]);

  useEffect(() => {
    if (header.activeRole !== "MANAGER") {
      setMatchdayFixture(null);
      return;
    }
    void managerBridge.getFixtures().then((result) => {
      if (result.ok) {
        setMatchdayFixture(
          result.data.upcoming.find((fixture) => fixture.date <= result.data.worldDate) ?? null,
        );
      }
    });
  }, [bridge, header.activeRole, header.worldDate, refreshKey]);

  // An interrupted match must be resumed, never restarted.
  const [pendingMatch, setPendingMatch] = useState<EntityId | null>(null);
  useEffect(() => {
    void managerBridge.resumeMatch().then((result) => {
      if (result.ok && result.data && result.data.period !== "FULL_TIME") {
        setPendingMatch(result.data.fixtureId);
      } else {
        setPendingMatch(null);
      }
    });
  }, [refreshKey]);

  const refreshHeader = async (): Promise<void> => {
    const result = await bridge.getCareerHeader();
    if (result.ok) onHeaderChange(result.data);
  };

  const openPlayer = (id: EntityId): void => {
    setPlayerId(id);
    setScreen("squad");
  };

  const advance = async (): Promise<void> => {
    if (matchdayFixture) {
      setNotice("You have a match today. Choose a match action before continuing.");
      return;
    }
    setBusy(true);
    const result = await bridge.continueCareer();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    const latest = result.data.home.inbox[0];
    setNotice(latest ? `${latest.title} — ${latest.body}` : null);
    await refreshHeader();
    setRefreshKey((key) => key + 1);
  };

  const openMatch = (fixtureId: EntityId, resume = false, alreadyPlayed = false): void => {
    setMatchFixtureId(fixtureId);
    setResumingMatch(resume);
    setOpenMatchAsReport(alreadyPlayed);
    setScreen("fixtures");
  };

  const leaveMatch = async (): Promise<void> => {
    setMatchFixtureId(null);
    setResumingMatch(false);
    await refreshHeader();
    setRefreshKey((key) => key + 1);
  };

  // A finished match changes the table, squad and finances.
  const onMatchComplete = async (): Promise<void> => {
    await refreshHeader();
    setRefreshKey((key) => key + 1);
  };

  const roleLabel = careerRoleLabel(header.activeRole);

  /*
   * Club identity, fetched once per shell load.
   *
   * Keyed on header.clubId so it refetches only when the club actually
   * changes — never per nav item, per panel, or per render. An unemployed
   * career and the Federation President have no clubId, and then no request
   * is made at all: identity is never fabricated for a club the shell has not
   * identified. The bridge command is optional in the contract, so it is
   * guarded the same way PlayerProfileScreen and RoleDetailScreen guard it.
   */
  const clubId = header.clubId;
  /*
   * StrictMode (active under the dev server, which E2E drives) intentionally
   * invokes effects twice on mount, so useRuntimeData calls this loader twice
   * for the same club. Sharing the per-club promise keeps that to a single
   * HTTP request; keyed on clubId it naturally refetches when the club change.
   */
  const identityRequests = useRef(
    new Map<EntityId, ReturnType<NonNullable<DesktopRuntimeApi["getClubVisualIdentity"]>>>(),
  );
  const [clubIdentityState] = useRuntimeData(
    () => {
      if (!clubId || !bridge.getClubVisualIdentity) {
        return Promise.resolve({
          ok: false as const,
          error: { code: "INVALID_SELECTION" as const, message: "No club" },
        });
      }
      const cached = identityRequests.current.get(clubId);
      if (cached) return cached;
      const request = bridge.getClubVisualIdentity(clubId);
      identityRequests.current.set(clubId, request);
      return request;
    },
    [clubId],
  );
  /* resolveClubVisualIdentity handles every historical storage shape, so a
   * club with no saved override still gets its deterministic badge rather
   * than nothing. Only ever built from a real clubId. */
  const clubIdentity =
    clubId && header.clubName
      ? resolveClubVisualIdentity(
          clubIdentityState.status === "ready" ? clubIdentityState.data : undefined,
          clubId,
          header.clubName,
        )
      : undefined;

  return (
    /*
     * Shell landmarks (UI Phase 1).
     *
     * The shell wrapper is a plain element and `.workspace` is the `main`
     * landmark, so primary navigation sits OUTSIDE main rather than nested
     * inside it — the audit measured `navInsideMain: true`, which made the
     * one landmark that should contain the current screen contain the whole
     * application instead.
     *
     * The sidebar keeps the page's single `<h1>` (the club is the durable
     * identity of the workspace, and create-a-club-failure-recovery asserts
     * the first level-1 heading is the founded club). The screen title below
     * is a section heading, not a second page title.
     */
    <div
      className="manager-shell"
      /* The club's real primary colour, used only as an accent (see the
       * --club-accent rules at the end of styles.css). Absent for an
       * unemployed career and for the Federation President, where the token's
       * own default keeps the app accent rather than inventing a club colour. */
      style={clubIdentity ? ({ "--club-accent": clubIdentity.primaryColour } as React.CSSProperties) : undefined}
    >
      <aside className="sidebar">
        <div className="sidebar-identity">
          {/* Decorative: the <h1> beside it already names the club, so the
           * badge deliberately omits clubName rather than announcing the club
           * a second time to assistive tech. Not focusable — it is an <svg>
           * with no tabindex, so it never enters the Tab order. */}
          {clubIdentity && <ClubBadge design={clubIdentity.badge} size="small" />}
          <div>
            <p className="eyebrow">Career workspace</p>
            <h1>{header.activeRole === "FEDERATION_PRESIDENT" ? "All Nepal Football Association" : header.clubName ?? "Nepal Football"}</h1>
            <span className="role-badge">{roleLabel}</span>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          {header.activeRole === "MANAGER" ? NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {group.items.map((item) => (
            <button
              key={item}
              className={screen === item ? "active" : ""}
              onClick={() => {
                setScreen(item);
                if (item !== "squad") setPlayerId(null);
                // Leaving a live match is safe: the session is persisted and
                // can be resumed from the fixtures screen.
                if (item !== "fixtures") setMatchFixtureId(null);
              }}
            >
              {LABELS[item]}
            </button>
              ))}
            </div>
          )) : (header.activeRole === "CHAIRMAN_OWNER" ? CHAIRMAN_NAV : EXECUTIVE_ROLES.includes(header.activeRole) ? EXECUTIVE_NAV : PRESIDENT_NAV).map((group) => (
            <div className="nav-group" key={group.group}>
              <span className="nav-label">{group.group}</span>
              {group.items.map((item) => <button key={item.id} className={roleScreen === item.id ? "active" : ""} onClick={() => setRoleScreen(item.id)}>{item.label}</button>)}
            </div>
          ))}
        </nav>
        <div className="sidebar-status">
          {header.worldDate && <div>World date: <strong>{header.worldDate}</strong></div>}
          {autosave && (
            <div>
              Autosave: {autosave.enabled ? `every ${autosave.intervalDays}d` : "off"}
              {autosave.lastAutosaveWorldDate && ` · last ${autosave.lastAutosaveWorldDate}`}
              {autosave.slots.length > 0 && ` · ${autosave.slots.length}/${autosave.slotCount} slots`}
            </div>
          )}
          {autosave && autosave.slots.length > 0 && (
            <button
              className="ghost small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const result = await bridge.loadAutosaveSlot(autosave.slots[0]!.slotIndex);
                setBusy(false);
                if (result.ok) {
                  onHeaderChange(result.data.header);
                  setNotice("Restored the most recent autosave.");
                  setRefreshKey((key) => key + 1);
                } else {
                  setError(result.error);
                }
              }}
            >
              Restore latest autosave
            </button>
          )}
          {/* The only other entry point for these settings is the pre-career
              "Career Saves" screen, which meant changing 3D/quality/motion
              mid-career required Save -> Main Menu -> adjust -> Continue.
              Reuses the exact same panel component, never a second settings
              surface. */}
          <button className="ghost small" onClick={() => setPresentationOpen(true)}>
            Presentation
          </button>
        </div>
      </aside>

      <main className="workspace">
        {error && <ErrorBanner error={error} />}
        {pendingMatch && !matchFixtureId && (
          <div className="notice" role="status">
            A match is in progress.
            <button className="primary small" onClick={() => openMatch(pendingMatch, true)}>
              Resume match
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button className="ghost small" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
        <header className="topbar">
          <div className="identity">
            {header.personId && (
              // `name` is omitted: the visible <strong>{characterName}</strong>
              // right beside it already names the person, so repeating it in
              // the portrait's own alt text would be redundant announcement.
              <PersonPortrait
                identity={buildPersonVisualIdentity(header.personId, header.personAge)}
                role={portraitRoleFor(header.activeRole)}
                size="small"
              />
            )}
            <div>
              <strong>{header.characterName}</strong>
              <span>{header.activeRole === "FEDERATION_PRESIDENT" ? "Federation office" : header.teamName ?? "Unemployed"}</span>
              <span className="topbar-role">{roleLabel} · {header.activeRole === "FEDERATION_PRESIDENT" ? "All Nepal Football Association" : header.clubName ?? "Nepal Football"}</span>
            </div>
          </div>
          <label className="role-picker">
            Role
            <select
              aria-label="Active career role"
              value={header.activeRole}
              disabled={busy}
              onChange={async (event) => {
                await onRoleSwitch(event.target.value as CareerRole);
                setScreen("home");
                setRoleScreen("dashboard");
                setPlayerId(null);
                setMatchFixtureId(null);
              }}
            >
              {roles.heldRoles.map((role) => (
                <option key={role} value={role}>
                  {careerRoleLabel(role)}
                </option>
              ))}
            </select>
          </label>
          <div className="date-block">
            <strong>{header.worldDate}</strong>
            {/* The competition name is ellipsised when the bar is tight, so the
                full name stays reachable on hover rather than being lost. */}
            <span title={header.competitionName ?? undefined}>{header.competitionName ?? ""}</span>
          </div>
          <div className="topbar-actions">
            {matchdayFixture && (
              <button
                className="matchday-cta"
                title={`Matchday · ${matchdayFixture.homeAway === "home" ? "vs" : "at"} ${matchdayFixture.opponent}`}
                onClick={() => openMatch(matchdayFixture.id)}
              >
                Matchday · {matchdayFixture.homeAway === "home" ? "vs" : "at"} {matchdayFixture.opponent}
              </button>
            )}
            <button className="primary" disabled={busy || !["MANAGER", "CHAIRMAN_OWNER"].includes(header.activeRole) || Boolean(matchdayFixture)} onClick={() => void advance()}>
              {busy ? "Working…" : "Continue"}
            </button>
            <button
              className="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onSave();
                setBusy(false);
                setNotice("Career saved.");
                void refreshAutosave();
              }}
            >Save</button>
            <button
              className="ghost"
              disabled={busy}
              onClick={async () => {
                const name = window.prompt("Save as new slot named:");
                if (!name) return;
                setBusy(true);
                const result = await bridge.saveCareerAs(name);
                setBusy(false);
                if (result.ok) {
                  setNotice(`Saved as new slot "${result.data.saveName}".`);
                  void refreshAutosave();
                } else setError(result.error);
              }}
            >Save As</button>
            <button className="ghost" disabled={busy} onClick={onExit}>Main Menu</button>
          </div>
        </header>

        {header.activeRole !== "MANAGER" ? (
          <RoleLandingScreen header={header} roles={roles} bridge={bridge} screen={roleScreen} onNavigate={setRoleScreen} />
        ) : (
          <header className="page-header">
            <div>
              <p className="eyebrow">Manager workspace</p>
              {/* A section heading, not a second page title: the sidebar's
                  club name is the page's single <h1>. Specs that assert these
                  screen titles use getByRole("heading") without a level, so
                  the demotion keeps them passing. */}
              <h2>{LABELS[screen]}</h2>
              <p className="subtle">{SUBTITLES[screen]}</p>
            </div>
          </header>
        )}

        {header.activeRole === "MANAGER" && screen === "home" && (
          <HomeScreen
            busy={busy}
            refreshKey={refreshKey}
            onAction={async () => {
              await refreshHeader();
              setRefreshKey((key) => key + 1);
            }}
            onNavigate={(next) => {
              setScreen(next);
              setPlayerId(null);
              setMatchFixtureId(null);
            }}
            bridge={bridge}
            onSelectPlayer={openPlayer}
          />
        )}
        {header.activeRole === "MANAGER" && screen === "squad" &&
          (playerId ? (
            <PlayerProfileScreen
              playerId={playerId}
              onClose={() => setPlayerId(null)}
              onOpenClub={setOpenClubId}
              onOpenPlayer={setPlayerId}
              onOpenDressingRoom={() => {
                setScreen("dressing-room");
                setPlayerId(null);
              }}
              bridge={bridge}
            />
          ) : (
            <SquadScreen onSelectPlayer={setPlayerId} />
          ))}
        {header.activeRole === "MANAGER" && screen === "dressing-room" && (
          <DressingRoomScreen onSelectPlayer={openPlayer} />
        )}
        {header.activeRole === "MANAGER" && screen === "tactics" && (
          <TacticsScreen onSelectPlayer={openPlayer} />
        )}
        {header.activeRole === "MANAGER" && screen === "training" && <TrainingScreen onSelectPlayer={openPlayer} />}
        {header.activeRole === "MANAGER" && screen === "fixtures" &&
          (matchFixtureId ? (
            <MatchdayScreen
              fixtureId={matchFixtureId}
              resume={resumingMatch}
              alreadyPlayed={openMatchAsReport}
              onExit={() => void leaveMatch()}
              onMatchComplete={() => void onMatchComplete()}
              onSelectPlayer={openPlayer}
            />
          ) : (
            <FixturesScreen
              onOpenMatch={(fixtureId, alreadyPlayed) => openMatch(fixtureId, false, alreadyPlayed)}
              onOpenClub={setOpenClubId}
            />
          ))}
        {header.activeRole === "MANAGER" && screen === "competition" && (
          <CompetitionScreen onOpenClub={setOpenClubId} />
        )}
        {header.activeRole === "MANAGER" && screen === "scouting" && (
          <ScoutingScreen onSelectPlayer={openPlayer} onOpenClub={setOpenClubId} />
        )}
        {header.activeRole === "MANAGER" && screen === "transfers" && (
          <TransfersScreen onSelectPlayer={openPlayer} onOpenClub={setOpenClubId} />
        )}
        {header.activeRole === "MANAGER" && screen === "contracts" && <ContractsScreen onSelectPlayer={openPlayer} />}
        {header.activeRole === "MANAGER" && screen === "staff" && (
          <StaffScreen refreshKey={refreshKey} />
        )}
        {header.activeRole === "MANAGER" && screen === "medical" && <MedicalScreen onSelectPlayer={openPlayer} />}
        {header.activeRole === "MANAGER" && screen === "media" && <MediaScreen onSelectPlayer={openPlayer} />}
      </main>
      {openClubId && (
        <OrganizationProfilePanel
          bridge={bridge}
          entityType="CLUB"
          entityId={openClubId}
          onClose={() => setOpenClubId(null)}
          onOpenPlayer={(id) => {
            // Close this club overlay and navigate to the real Player
            // Profile underneath — the same pattern PlayerProfileScreen's
            // own nested OrganizationProfilePanel already uses, so a
            // squad chip (domestic or a real CONTEXT_ONLY foreign player)
            // is just as navigable from here.
            setOpenClubId(null);
            openPlayer(id);
          }}
        />
      )}
      {presentationOpen && <PresentationSettingsPanel onClose={() => setPresentationOpen(false)} />}
    </div>
  );
};
