import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  EntityId,
  LiveMatchView,
  LivePlayerState,
  LiveTeamView,
  MatchCommentaryLine,
} from "@nepal-football-sim/shared-types";
import { Badge, ErrorBanner, Panel } from "../ui.js";
import type { PlaybackSpeed, useMatchController } from "./useMatchController.js";

type Controller = ReturnType<typeof useMatchController>;

const SPEEDS: PlaybackSpeed[] = [1, 2, 4, 8];

const PERIOD_LABEL: Record<LiveMatchView["period"], string> = {
  NOT_STARTED: "Kick off",
  FIRST_HALF: "First half",
  HALF_TIME: "Half time",
  SECOND_HALF: "Second half",
  EXTRA_TIME_FIRST_HALF: "Extra time — first half",
  EXTRA_TIME_HALF_TIME: "Extra time — half time",
  EXTRA_TIME_SECOND_HALF: "Extra time — second half",
  PENALTY_SHOOTOUT: "Penalties",
  FULL_TIME: "Full time",
};

const PAUSE_MESSAGE: Record<NonNullable<LiveMatchView["pauseReason"]>, string> = {
  HALF_TIME: "Half time — make your changes, then continue.",
  INJURY_DECISION: "A player is injured and may need replacing.",
  RED_CARD: "A player has been sent off. You may reshape the team.",
  FULL_TIME: "Full time.",
  EXTRA_TIME_START: "Still level after 90 minutes. Extra time begins.",
  EXTRA_TIME_HALF_TIME: "Extra time, half time — make your changes, then continue.",
  PENALTY_SHOOTOUT: "Still level after extra time. It goes to penalties.",
};

export const LiveMatchScreen = ({
  controller,
  onViewReport,
  onLeave,
}: {
  controller: Controller;
  onViewReport: () => void;
  onLeave: () => void;
}): React.ReactElement => {
  const { state } = controller;
  const view = state.view;
  const [drawer, setDrawer] = useState<"none" | "subs" | "tactics">("none");

  const managed = useMemo(() => {
    if (!view) return undefined;
    return view.home.teamId === view.managedTeamId ? view.home : view.away;
  }, [view]);

  // Keyboard shortcuts, ignored while typing.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (!view || view.period === "FULL_TIME") return;
      if (event.key === " ") {
        event.preventDefault();
        if (state.playing) controller.pause();
        else controller.play(view.viewMode);
      } else if (event.key.toLowerCase() === "n") {
        void controller.advanceToNextEvent("MAJOR");
      } else if (event.key.toLowerCase() === "s") {
        setDrawer((current) => (current === "subs" ? "none" : "subs"));
      } else if (event.key.toLowerCase() === "t") {
        setDrawer((current) => (current === "tactics" ? "none" : "tactics"));
      } else if (event.key === "Escape") {
        setDrawer("none");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [controller, state.playing, view]);

  if (!view || !managed) return <p className="muted">Loading match…</p>;

  const finished = view.period === "FULL_TIME";
  const atHalfTime = view.period === "HALF_TIME" || view.period === "EXTRA_TIME_HALF_TIME";
  const atPenalties = view.pauseReason === "PENALTY_SHOOTOUT";

  return (
    <section className="matchday">
      {state.error && <ErrorBanner error={state.error} />}

      <Scoreboard view={view} />

      {view.pauseReason && !finished && (
        <div className="notice match-pause" role="status">
          <strong>{PAUSE_MESSAGE[view.pauseReason]}</strong>
          {atHalfTime && (
            <button
              className="primary"
              disabled={state.busy}
              onClick={() => void controller.continueSecondHalf()}
            >
              {view.period === "EXTRA_TIME_HALF_TIME"
                ? "Continue extra time"
                : "Continue second half"}
            </button>
          )}
          {atPenalties && (
            <button
              className="primary"
              disabled={state.busy}
              onClick={() => void controller.advanceMinutes(1)}
            >
              Take penalties
            </button>
          )}
        </div>
      )}

      {view.pauseReason === "INJURY_DECISION" && view.injuryDecisions.length > 0 && (
        <Panel title="Injury">
          <ul>
            {view.injuryDecisions.map((player) => (
              <li key={player.personId}>
                <strong>{player.name}</strong> ({player.position}) — condition {player.fitness}
              </li>
            ))}
          </ul>
          <p className="subtle">
            Replace the player from the bench, or continue with them on the pitch.
          </p>
          <button className="ghost" onClick={() => setDrawer("subs")}>
            Open substitutions
          </button>
        </Panel>
      )}

      <div className="matchday-body">
        <CommentaryFeed lines={state.commentary} following={state.playing} />

        <div className="matchday-side">
          <StatsPanel home={view.home} away={view.away} />
          <SquadPanel team={managed} />
        </div>
      </div>

      <div className="matchday-controls">
        {!finished ? (
          <>
            <button
              className="primary"
              disabled={state.busy || atHalfTime || atPenalties}
              onClick={() => (state.playing ? controller.pause() : controller.play(view.viewMode))}
            >
              {state.playing ? "Pause" : "Play"}
            </button>
            <button
              className="ghost"
              disabled={state.busy || state.playing || atHalfTime || atPenalties}
              onClick={() => void controller.advanceToNextEvent("MAJOR")}
            >
              Next event
            </button>
            {view.viewMode === "TEXT_LIVE" && (
              <button
                className="ghost"
                disabled={state.busy || state.playing || atHalfTime || atPenalties}
                onClick={() => void controller.advanceMinutes(5)}
              >
                +5 min
              </button>
            )}
            <span className="speed-group" role="group" aria-label="Playback speed">
              {SPEEDS.map((speed) => (
                <button
                  key={speed}
                  className={state.speed === speed ? "active" : ""}
                  aria-pressed={state.speed === speed}
                  onClick={() => controller.setSpeed(speed)}
                >
                  {speed}x
                </button>
              ))}
            </span>
            <button
              className="ghost"
              disabled={state.busy}
              onClick={() => setDrawer(drawer === "subs" ? "none" : "subs")}
            >
              Substitutions ({managed.substitutionsRemaining})
            </button>
            <button
              className="ghost"
              disabled={state.busy}
              onClick={() => setDrawer(drawer === "tactics" ? "none" : "tactics")}
            >
              Tactics
            </button>
            <button
              className="ghost"
              disabled={state.busy}
              onClick={() => void controller.quickSimRest()}
            >
              Quick Sim remaining
            </button>
          </>
        ) : (
          <>
            <strong className="full-time-flag">Full Time</strong>
            <button className="primary" onClick={onViewReport}>
              View match report
            </button>
          </>
        )}
        <button className="ghost" onClick={onLeave} disabled={state.busy}>
          {finished ? "Back to fixtures" : "Leave (match is saved)"}
        </button>
      </div>

      {drawer === "subs" && (
        <SubstitutionDrawer
          team={managed}
          busy={state.busy}
          onClose={() => setDrawer("none")}
          onSubstitute={(off, on) => void controller.substitute(off, on)}
        />
      )}
      {drawer === "tactics" && (
        <TacticsDrawer
          team={managed}
          busy={state.busy}
          onClose={() => setDrawer("none")}
          onApply={(command) => void controller.changeTactics(command)}
        />
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------

const Scoreboard = ({ view }: { view: LiveMatchView }): React.ReactElement => (
  <header className="scoreboard">
    <div className="scoreboard-team">{view.home.teamName}</div>
    <div className="scoreboard-score">
      <strong>
        {view.home.goals} – {view.away.goals}
      </strong>
      <span className="scoreboard-clock">
        {view.period === "NOT_STARTED"
          ? "0'"
          : `${view.minute}'${view.stoppageTime > 0 ? `+${view.stoppageTime}` : ""}`}
      </span>
      <span className="scoreboard-period">{PERIOD_LABEL[view.period]}</span>
    </div>
    <div className="scoreboard-team">{view.away.teamName}</div>
  </header>
);

/** Auto-follows the newest line unless the reader has scrolled up. */
const CommentaryFeed = ({
  lines,
  following,
}: {
  lines: MatchCommentaryLine[];
  following: boolean;
}): React.ReactElement => {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);

  useEffect(() => {
    if (!autoFollow || !scroller.current) return;
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [lines, autoFollow]);

  return (
    <div className="commentary">
      <div className="panel-head">
        <h2>Commentary</h2>
        {!autoFollow && (
          <button className="ghost small" onClick={() => setAutoFollow(true)}>
            Follow live
          </button>
        )}
      </div>
      <div
        className="commentary-feed"
        ref={scroller}
        tabIndex={0}
        role="log"
        aria-live={following ? "polite" : "off"}
        aria-label="Match commentary"
        onScroll={(event) => {
          const element = event.currentTarget;
          const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
          setAutoFollow(atBottom);
        }}
      >
        {lines.length === 0 && <p className="empty-state">The match has not started.</p>}
        {lines.map((line) => (
          <div
            key={`${line.eventId}-${line.sequence}`}
            className={`commentary-line importance-${line.importance.toLowerCase()} type-${line.type.toLowerCase()}`}
          >
            <span className="commentary-minute">
              {line.minute ?? 0}&rsquo;
              {line.stoppageTime ? `+${line.stoppageTime}` : ""}
            </span>
            <span className="commentary-text">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const StatsPanel = ({
  home,
  away,
}: {
  home: LiveTeamView;
  away: LiveTeamView;
}): React.ReactElement => (
  <Panel title="Match stats">
    <table className="stat-table">
      <thead>
        <tr>
          <th>{home.teamName.split(" ")[0]}</th>
          <th />
          <th>{away.teamName.split(" ")[0]}</th>
        </tr>
      </thead>
      <tbody>
        {(
          [
            ["Possession", `${home.possession}%`, `${away.possession}%`],
            ["Shots", home.shots, away.shots],
            ["On target", home.shotsOnTarget, away.shotsOnTarget],
            ["xG", home.xg.toFixed(2), away.xg.toFixed(2)],
            ["Corners", home.corners, away.corners],
            ["Fouls", home.fouls, away.fouls],
            ["Yellow", home.yellowCards, away.yellowCards],
            ["Red", home.redCards, away.redCards],
          ] as const
        ).map(([label, homeValue, awayValue]) => (
          <tr key={label}>
            <td>{homeValue}</td>
            <th scope="row">{label}</th>
            <td>{awayValue}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </Panel>
);

const statusTone = (status: LivePlayerState["status"]): "ok" | "warn" | "bad" | "info" => {
  switch (status) {
    case "ON_PITCH":
      return "ok";
    case "SENT_OFF":
      return "bad";
    case "SUBBED_OFF":
      return "info";
    default:
      return "warn";
  }
};

const SquadPanel = ({ team }: { team: LiveTeamView }): React.ReactElement => (
  <Panel title={`On the pitch (${team.playersOnPitch})`}>
    <div className="table-scroll live-squad">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Pos</th>
            <th>Min</th>
            <th>Rat</th>
            <th>Fit</th>
            <th>G/A</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {team.onPitch.map((player) => (
            <tr key={player.personId}>
              <td>{player.name}</td>
              <td>{player.position}</td>
              <td>{player.minutes}</td>
              <td>{player.rating.toFixed(1)}</td>
              <td>{player.fitness}</td>
              <td>
                {player.goals}/{player.assists}
              </td>
              <td>
                {player.injured && <Badge tone="bad">injured</Badge>}
                {player.yellowCards > 0 && <Badge tone="warn">YC</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {team.playersOff.length > 0 && (
      <>
        <h3>Off the pitch</h3>
        <ul className="report-list">
          {team.playersOff.map((player) => (
            <li key={player.personId}>
              {player.name}{" "}
              <Badge tone={statusTone(player.status)}>
                {player.status.replace("_", " ").toLowerCase()}
              </Badge>
              {player.subbedOffMinute ? ` ${player.subbedOffMinute}'` : ""}
            </li>
          ))}
        </ul>
      </>
    )}
  </Panel>
);

const SubstitutionDrawer = ({
  team,
  busy,
  onClose,
  onSubstitute,
}: {
  team: LiveTeamView;
  busy: boolean;
  onClose: () => void;
  onSubstitute: (off: EntityId, on: EntityId) => void;
}): React.ReactElement => {
  const [off, setOff] = useState<EntityId | "">("");
  const [on, setOn] = useState<EntityId | "">("");
  const exhausted = team.substitutionsRemaining === 0;

  return (
    <Panel
      title={`Substitutions — ${team.substitutionsUsed} used, ${team.substitutionsRemaining} left`}
      actions={
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      }
    >
      {exhausted ? (
        <p className="empty-state">You have used all your substitutions.</p>
      ) : team.bench.length === 0 ? (
        <p className="empty-state">No substitutes remain on the bench.</p>
      ) : (
        <div className="controls">
          <label>
            Player off
            <select
              value={off}
              onChange={(event) => setOff(event.target.value as EntityId)}
              disabled={busy}
            >
              <option value="">— choose —</option>
              {team.onPitch.map((player) => (
                <option key={player.personId} value={player.personId}>
                  {player.name} ({player.position}) · {player.fitness} fit
                  {player.injured ? " · injured" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Player on
            <select
              value={on}
              onChange={(event) => setOn(event.target.value as EntityId)}
              disabled={busy}
            >
              <option value="">— choose —</option>
              {team.bench.map((player) => (
                <option key={player.personId} value={player.personId}>
                  {player.name} ({player.position})
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={busy || !off || !on}
            onClick={() => {
              if (off && on) {
                onSubstitute(off, on);
                setOff("");
                setOn("");
              }
            }}
          >
            {busy ? "Making change…" : "Make substitution"}
          </button>
        </div>
      )}
    </Panel>
  );
};

const TacticsDrawer = ({
  team,
  busy,
  onClose,
  onApply,
}: {
  team: LiveTeamView;
  busy: boolean;
  onClose: () => void;
  onApply: (command: {
    style?: string;
    mentality?: string;
    pressingIntensity?: number;
    defensiveLine?: number;
    tempo?: number;
  }) => void;
}): React.ReactElement => {
  const [style, setStyle] = useState(team.style ?? "BALANCED");
  const [mentality, setMentality] = useState(team.mentality ?? "BALANCED");
  const [pressing, setPressing] = useState(50);
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <Panel
      title="Tactics"
      actions={
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="subtle">
        Currently {team.formation ?? "unknown shape"} ·{" "}
        {(team.style ?? "").replace(/_/g, " ").toLowerCase()} ·{" "}
        {(team.mentality ?? "").replace(/_/g, " ").toLowerCase()}
      </p>
      <div className="controls">
        <label>
          Style
          <select value={style} onChange={(event) => setStyle(event.target.value)} disabled={busy}>
            {[
              "BALANCED",
              "POSSESSION",
              "GEGENPRESS",
              "HIGH_PRESS",
              "COUNTER_ATTACK",
              "DIRECT",
              "LOW_BLOCK",
              "WING_PLAY",
              "VERTICAL",
            ].map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mentality
          <select
            value={mentality}
            onChange={(event) => setMentality(event.target.value)}
            disabled={busy}
          >
            {[
              "VERY_DEFENSIVE",
              "DEFENSIVE",
              "CAUTIOUS",
              "BALANCED",
              "POSITIVE",
              "ATTACKING",
              "VERY_ATTACKING",
            ].map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pressing intensity ({pressing})
          <input
            type="range"
            min="0"
            max="100"
            value={pressing}
            onChange={(event) => setPressing(Number(event.target.value))}
            disabled={busy}
          />
        </label>
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            onApply({ style, mentality, pressingIntensity: pressing });
            // Qualitative confirmation only; no engine numbers are exposed.
            setFeedback(
              `Style ${style.replace(/_/g, " ").toLowerCase()}, mentality ${mentality
                .replace(/_/g, " ")
                .toLowerCase()}, pressing ${pressing >= 65 ? "increased" : pressing <= 35 ? "reduced" : "steady"}.`,
            );
          }}
        >
          {busy ? "Applying…" : "Apply changes"}
        </button>
      </div>
      {feedback && <div className="ok">{feedback}</div>}
    </Panel>
  );
};
