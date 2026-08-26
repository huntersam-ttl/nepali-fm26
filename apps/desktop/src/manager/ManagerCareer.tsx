import React, { useEffect, useState } from "react";
import type { CareerHeader, EntityId } from "@nepal-football-sim/shared-types";
import type { AppError, DesktopRuntimeApi } from "../appBridge.js";
import { managerBridge } from "./managerBridge.js";
import { ErrorBanner } from "./ui.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { SquadScreen } from "./screens/SquadScreen.js";
import { PlayerProfileScreen } from "./screens/PlayerProfileScreen.js";
import { TacticsScreen } from "./screens/TacticsScreen.js";
import { TrainingScreen } from "./screens/TrainingScreen.js";
import { FixturesScreen } from "./screens/FixturesScreen.js";
import { CompetitionScreen } from "./screens/CompetitionScreen.js";
import { ScoutingScreen } from "./screens/ScoutingScreen.js";
import { TransfersScreen } from "./screens/TransfersScreen.js";
import { ContractsScreen } from "./screens/ContractsScreen.js";
import { StaffScreen } from "./screens/StaffScreen.js";
import { MatchdayScreen } from "./matchday/MatchdayScreen.js";

const SCREENS = [
  "home",
  "squad",
  "tactics",
  "training",
  "fixtures",
  "competition",
  "scouting",
  "transfers",
  "contracts",
  "staff",
] as const;

type Screen = (typeof SCREENS)[number];

const LABELS: Record<Screen, string> = {
  home: "Home / Inbox",
  squad: "Squad",
  tactics: "Tactics",
  training: "Training",
  fixtures: "Fixtures",
  competition: "Competition",
  scouting: "Scouting",
  transfers: "Transfers",
  contracts: "Contracts",
  staff: "Staff",
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
  onSave,
  onExit,
}: {
  header: CareerHeader;
  bridge: DesktopRuntimeApi;
  onHeaderChange: (header: CareerHeader) => void;
  onSave: () => Promise<void>;
  onExit: () => void;
}): React.ReactElement => {
  const [screen, setScreen] = useState<Screen>("home");
  const [playerId, setPlayerId] = useState<EntityId | null>(null);
  const [matchFixtureId, setMatchFixtureId] = useState<EntityId | null>(null);
  const [resumingMatch, setResumingMatch] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

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

  const openMatch = (fixtureId: EntityId, resume = false): void => {
    setMatchFixtureId(fixtureId);
    setResumingMatch(resume);
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

  return (
    <main className="manager-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">{header.activeRole.toLowerCase()} mode</p>
          <h1>{header.clubName ?? "Nepal Football"}</h1>
        </div>
        <nav>
          {SCREENS.map((item) => (
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
        </nav>
        <div className="button-row">
          <button
            className="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onSave();
              setBusy(false);
              setNotice("Career saved.");
            }}
          >
            Save
          </button>
          <button className="ghost" disabled={busy} onClick={onExit}>
            Main Menu
          </button>
        </div>
      </aside>

      <section className="workspace">
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
          <div>
            <strong>{header.characterName}</strong>
            <span>{header.teamName ?? "Unemployed"}</span>
          </div>
          <div>
            <strong>{header.worldDate}</strong>
            <span>{header.competitionName ?? ""}</span>
          </div>
        </header>

        {screen === "home" && (
          <HomeScreen
            onContinue={() => void advance()}
            busy={busy}
            refreshKey={refreshKey}
            onAction={async () => {
              await refreshHeader();
              setRefreshKey((key) => key + 1);
            }}
          />
        )}
        {screen === "squad" &&
          (playerId ? (
            <PlayerProfileScreen playerId={playerId} onClose={() => setPlayerId(null)} />
          ) : (
            <SquadScreen onSelectPlayer={setPlayerId} />
          ))}
        {screen === "tactics" && <TacticsScreen />}
        {screen === "training" && <TrainingScreen />}
        {screen === "fixtures" &&
          (matchFixtureId ? (
            <MatchdayScreen
              fixtureId={matchFixtureId}
              resume={resumingMatch}
              onExit={() => void leaveMatch()}
              onMatchComplete={() => void onMatchComplete()}
            />
          ) : (
            <FixturesScreen onOpenMatch={(fixtureId) => openMatch(fixtureId)} />
          ))}
        {screen === "competition" && <CompetitionScreen />}
        {screen === "scouting" && <ScoutingScreen onSelectPlayer={openPlayer} />}
        {screen === "transfers" && <TransfersScreen onSelectPlayer={openPlayer} />}
        {screen === "contracts" && <ContractsScreen />}
        {screen === "staff" && <StaffScreen />}
      </section>
    </main>
  );
};
