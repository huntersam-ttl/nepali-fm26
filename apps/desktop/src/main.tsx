import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createAppBridge,
  type AppError,
  type DesktopApplicationState,
  type SaveListItem,
  type SquadRow,
  type TacticalSetup,
} from "./appBridge.js";
import "./styles.css";

type Screen = "home" | "squad" | "tactics" | "fixtures" | "competition" | "profile";
type Entry = "start" | "new" | "load" | "manager";

const bridge = createAppBridge();

const App = (): React.ReactElement => {
  const [entry, setEntry] = useState<Entry>("start");
  const [screen, setScreen] = useState<Screen>("home");
  const [state, setState] = useState<DesktopApplicationState | null>(null);
  const [saves, setSaves] = useState<SaveListItem[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | undefined>();
  const [error, setError] = useState<AppError | null>(null);

  const refreshSaves = async (): Promise<void> => {
    const result = await bridge.listSaves();
    if (result.ok) {
      setSaves(result.data);
    } else {
      setError(result.error);
    }
  };

  useEffect(() => {
    void refreshSaves();
  }, []);

  const applyState = (next: DesktopApplicationState): void => {
    setState(next);
    setSelectedPlayerId(next.squad[0]?.personId);
    setEntry("manager");
    setScreen("home");
    setError(null);
    void refreshSaves();
  };

  if (entry === "new") {
    return (
      <NewCareer onCancel={() => setEntry("start")} onCreated={applyState} onError={setError} />
    );
  }

  if (entry === "load") {
    return (
      <StartShell error={error}>
        <section className="career-panel">
          <p className="eyebrow">Load Career</p>
          <h1>Saved Careers</h1>
          <div className="club-choice">
            {saves.length === 0 && <p>No saves found.</p>}
            {saves.map((save) => (
              <button
                className="club-row"
                key={save.saveId}
                onClick={async () => {
                  const result = await bridge.loadSave(save.saveId);
                  if (result.ok) {
                    applyState(result.data);
                  } else {
                    setError(result.error);
                  }
                }}
              >
                <strong>{save.displayName}</strong>
                <span>
                  {save.characterName ?? "Unknown manager"} · {save.currentClub ?? "Unemployed"} ·{" "}
                  {save.worldDate}
                </span>
              </button>
            ))}
            <button className="ghost" onClick={() => setEntry("start")}>
              Back
            </button>
          </div>
        </section>
      </StartShell>
    );
  }

  if (!state || entry === "start") {
    return (
      <StartShell error={error}>
        <section className="career-panel">
          <p className="eyebrow">Nepal Football Universe</p>
          <h1>Career Saves</h1>
          <div className="club-choice">
            <button className="club-row" onClick={() => setEntry("new")}>
              <strong>New Career</strong>
              <span>Create a persisted testing-world manager save.</span>
            </button>
            <button className="club-row" onClick={() => setEntry("load")}>
              <strong>Load Career</strong>
              <span>
                {saves.length} save{saves.length === 1 ? "" : "s"} available.
              </span>
            </button>
          </div>
        </section>
      </StartShell>
    );
  }

  const selectedPlayer =
    state.squad.find((candidate) => candidate.personId === selectedPlayerId) ?? state.squad[0];

  return (
    <main className="manager-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Manager Mode</p>
          <h1>Nepal Football</h1>
        </div>
        <nav>
          {(["home", "squad", "tactics", "fixtures", "competition", "profile"] as Screen[]).map(
            (item) => (
              <button
                key={item}
                className={screen === item ? "active" : ""}
                onClick={() => setScreen(item)}
              >
                {item === "home" ? "Home / Inbox" : title(item)}
              </button>
            ),
          )}
        </nav>
        <button className="ghost" onClick={() => setEntry("start")}>
          Saves
        </button>
      </aside>
      <section className="workspace">
        {error && <ErrorBanner error={error} />}
        <header className="topbar">
          <div>
            <strong>{state.home.managerName}</strong>
            <span>{state.home.clubName ?? "Unemployed"}</span>
          </div>
          <div>
            <strong>{state.save.worldDate}</strong>
            <span>
              {state.home.nextFixture
                ? `Next: ${state.home.nextFixture.opponent}`
                : "No fixture pending"}
            </span>
          </div>
        </header>
        {screen === "home" && (
          <section className="dashboard">
            <Panel title="Inbox">
              {state.home.inbox.map((item) => (
                <div className="inbox-item" key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </div>
              ))}
            </Panel>
            <Panel title="Dashboard">
              <dl className="metrics">
                <div>
                  <dt>Position</dt>
                  <dd>{state.home.position ?? "-"}</dd>
                </div>
                <div>
                  <dt>Unavailable</dt>
                  <dd>{state.home.unavailablePlayers.length}</dd>
                </div>
                <div>
                  <dt>Tactic</dt>
                  <dd>{state.activeTactic?.name ?? "None"}</dd>
                </div>
              </dl>
              <button
                className="primary"
                onClick={async () => {
                  const result = await bridge.continueToNextFixture(state.save.id);
                  if (result.ok) {
                    applyState(result.data);
                  } else {
                    setError(result.error);
                  }
                }}
              >
                Continue
              </button>
            </Panel>
            {state.home.previousResult && (
              <Panel title="Previous Result">
                <h2>{state.home.previousResult.score}</h2>
                <p>
                  {state.home.previousResult.homeTeam} vs {state.home.previousResult.awayTeam}
                </p>
              </Panel>
            )}
          </section>
        )}
        {screen === "squad" && (
          <SquadScreen
            rows={state.squad}
            selectedPlayer={selectedPlayer}
            onSelect={setSelectedPlayerId}
          />
        )}
        {screen === "tactics" && (
          <TacticsScreen
            squad={state.squad}
            tactic={state.activeTactic}
            onSave={async (tactic) => {
              const result = await bridge.saveTactic(state.save.id, tactic);
              if (result.ok) {
                setState({ ...state, activeTactic: result.data, tactics: [result.data] });
                setError(null);
              } else {
                setError(result.error);
              }
            }}
          />
        )}
        {screen === "fixtures" && (
          <section className="dashboard">
            <Panel title="Fixtures">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Opponent</th>
                    <th>H/A</th>
                    <th>Status</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {state.fixtures.map((fixture) => (
                    <tr key={fixture.id}>
                      <td>{fixture.date}</td>
                      <td>{fixture.opponent}</td>
                      <td>{fixture.homeAway}</td>
                      <td>{fixture.status}</td>
                      <td>{fixture.score ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                className="primary"
                onClick={async () => {
                  const result = await bridge.quickSimMatch(
                    state.save.id,
                    state.home.nextFixture?.id,
                  );
                  if (result.ok) {
                    applyState(result.data);
                  } else {
                    setError(result.error);
                  }
                }}
              >
                Quick Sim
              </button>
            </Panel>
            {state.home.previousResult && <PostMatch result={state.home.previousResult} />}
          </section>
        )}
        {screen === "competition" && (
          <Panel title={state.competition.name}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th>P</th>
                  <th>GD</th>
                  <th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {state.competition.table.map((row, index) => (
                  <tr key={row.teamId}>
                    <td>{index + 1}</td>
                    <td>{row.teamName}</td>
                    <td>{row.played}</td>
                    <td>{row.goalDifference}</td>
                    <td>{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
        {screen === "profile" && (
          <Panel title="Manager Profile">
            <dl className="profile-grid">
              <div>
                <dt>Name</dt>
                <dd>{state.home.managerName}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{state.saveListItem.currentRole ?? "Manager"}</dd>
              </div>
              <div>
                <dt>Club</dt>
                <dd>{state.home.clubName ?? "Unemployed"}</dd>
              </div>
              <div>
                <dt>Save</dt>
                <dd>{state.save.name}</dd>
              </div>
            </dl>
          </Panel>
        )}
      </section>
    </main>
  );
};

const NewCareer = (props: {
  onCancel: () => void;
  onCreated: (state: DesktopApplicationState) => void;
  onError: (error: AppError) => void;
}): React.ReactElement => {
  const [saveName, setSaveName] = useState("Maya Manager Save");
  const [fullName, setFullName] = useState("Maya Adhikari");
  const [displayName, setDisplayName] = useState("Maya");
  const [dateOfBirth, setDateOfBirth] = useState("1993-05-12");
  const [startingAge, setStartingAge] = useState(33);
  const [step, setStep] = useState(1);
  return (
    <StartShell>
      <section className="career-panel">
        <p className="eyebrow">New Career</p>
        <h1>
          {["Character", "Background", "Career Role", "Starting World", "Confirmation"][step - 1]}
        </h1>
        {step === 1 && (
          <div className="form-grid">
            <label>
              Save name
              <input value={saveName} onChange={(event) => setSaveName(event.target.value)} />
            </label>
            <label>
              Full name
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>
            <label>
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label>
              Date of birth
              <input
                type="date"
                value={dateOfBirth}
                onChange={(event) => setDateOfBirth(event.target.value)}
              />
            </label>
            <label>
              Starting age
              <input
                type="number"
                min="16"
                max="90"
                value={startingAge}
                onChange={(event) => setStartingAge(Number(event.target.value))}
              />
            </label>
          </div>
        )}
        {step === 2 && (
          <div className="form-grid">
            <label>
              Playing experience
              <select defaultValue="AMATEUR_PLAYER">
                <option value="NO_PLAYING_EXPERIENCE">No Playing Experience</option>
                <option value="AMATEUR_PLAYER">Amateur Player</option>
                <option value="SEMI_PROFESSIONAL_PLAYER">Semi-Professional Player</option>
              </select>
            </label>
            <label>
              Coaching experience
              <select defaultValue="YOUTH_COACH">
                <option value="NONE">None</option>
                <option value="GRASSROOTS">Grassroots</option>
                <option value="YOUTH_COACH">Youth Coach</option>
              </select>
            </label>
            <label>
              Education
              <select defaultValue="SPORTS_RELATED_DEGREE">
                <option value="SECONDARY">Secondary</option>
                <option value="UNIVERSITY">University</option>
                <option value="SPORTS_RELATED_DEGREE">Sports-related Degree</option>
              </select>
            </label>
          </div>
        )}
        {step === 3 && <p>Manager career is available for Stage 4.1.</p>}
        {step === 4 && <p>Starting world: Testing-only Nepal League 2026.</p>}
        {step === 5 && <p>Join Kathmandu Testing Club as manager and create a persisted save.</p>}
        <div className="button-row">
          <button className="ghost" onClick={step === 1 ? props.onCancel : () => setStep(step - 1)}>
            Back
          </button>
          <button
            className="primary"
            onClick={async () => {
              if (step < 5) {
                setStep(step + 1);
                return;
              }
              const result = await bridge.createCareer({
                saveName,
                character: {
                  fullName,
                  preferredDisplayName: displayName,
                  dateOfBirth,
                  startingAge,
                  languages: ["ne", "en"],
                  footballBackground: "COMMUNITY_COACHING",
                  education: "SPORTS_RELATED_DEGREE",
                  playingExperience: "AMATEUR_PLAYER",
                  coachingExperience: "YOUTH_COACH",
                  businessBackground: "SMALL_BUSINESS",
                  startingReputationProfile: "LOCAL_RESPECTED",
                },
              });
              if (result.ok) {
                props.onCreated(result.data);
              } else {
                props.onError(result.error);
              }
            }}
          >
            {step < 5 ? "Continue" : "Create Save"}
          </button>
        </div>
      </section>
    </StartShell>
  );
};

const SquadScreen = (props: {
  rows: SquadRow[];
  selectedPlayer?: SquadRow;
  onSelect: (id: string) => void;
}): React.ReactElement => {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<"overall" | "fitness" | "rating">("overall");
  const rows = useMemo(
    () =>
      [...props.rows]
        .filter((row) => row.name.toLowerCase().includes(filter.toLowerCase()))
        .sort((a, b) =>
          sortKey === "rating"
            ? b.averageRating - a.averageRating
            : sortKey === "fitness"
              ? b.fitness - a.fitness
              : b.overall - a.overall,
        ),
    [filter, props.rows, sortKey],
  );
  return (
    <section className="split">
      <div>
        <div className="table-tools">
          <input
            placeholder="Filter squad"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <select
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as typeof sortKey)}
          >
            <option value="overall">Overall</option>
            <option value="fitness">Fitness</option>
            <option value="rating">Average rating</option>
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Age</th>
              <th>Nat</th>
              <th>Positions</th>
              <th>Fit</th>
              <th>Role</th>
              <th>Apps</th>
              <th>G</th>
              <th>A</th>
              <th>AvR</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.personId} onClick={() => props.onSelect(row.personId)}>
                <td>{row.name}</td>
                <td>{row.age ?? "-"}</td>
                <td>{row.nationality}</td>
                <td>{row.positions.join(", ")}</td>
                <td>{row.fitness}</td>
                <td>{row.roleSuitability}</td>
                <td>{row.appearances}</td>
                <td>{row.goals}</td>
                <td>{row.assists}</td>
                <td>{row.averageRating ? row.averageRating.toFixed(2) : "-"}</td>
                <td>{row.availability}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.selectedPlayer && <PlayerProfile player={props.selectedPlayer} />}
    </section>
  );
};

const TacticsScreen = (props: {
  squad: SquadRow[];
  tactic?: TacticalSetup;
  onSave: (tactic: TacticalSetup) => Promise<void>;
}): React.ReactElement => {
  const [draft, setDraft] = useState<TacticalSetup | undefined>(props.tactic);
  useEffect(() => setDraft(props.tactic), [props.tactic]);
  if (!draft) return <Panel title="Tactics">No tactic loaded.</Panel>;
  const starters = draft.assignments.flatMap((assignment) =>
    assignment.playerId
      ? [props.squad.find((player) => player.personId === assignment.playerId)]
      : [],
  );
  return (
    <section className="tactics-layout">
      <Panel title="Team Instructions">
        <div className="controls">
          <label>
            Tactic name
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            Style
            <select
              value={draft.style}
              onChange={(event) => setDraft({ ...draft, style: event.target.value })}
            >
              {["BALANCED", "POSSESSION", "HIGH_PRESS", "DIRECT", "LOW_BLOCK", "VERTICAL"].map(
                (style) => (
                  <option key={style}>{style}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Tempo
            <input
              type="range"
              min="0"
              max="100"
              value={draft.instructions.inPossession.tempo}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  instructions: {
                    ...draft.instructions,
                    inPossession: {
                      ...draft.instructions.inPossession,
                      tempo: Number(event.target.value),
                    },
                  },
                })
              }
            />
          </label>
          <button className="primary" onClick={() => props.onSave(draft)}>
            Save Tactic
          </button>
        </div>
      </Panel>
      <div className="pitch">
        {draft.formation.slots.map((slot) => {
          const assignment = draft.assignments.find((candidate) => candidate.slotId === slot.id);
          const player = props.squad.find(
            (candidate) => candidate.personId === assignment?.playerId,
          );
          return (
            <button
              key={slot.id}
              className="slot"
              style={{ left: `${slot.x}%`, top: `${100 - slot.y}%` }}
            >
              <strong>{slot.label}</strong>
              <span>{player?.name.split(" ").at(0) ?? "-"}</span>
            </button>
          );
        })}
      </div>
      <Panel title="Selection">
        <div className="ok">Starters: {starters.length}</div>
        <p>
          Bench:{" "}
          {draft.bench
            .map((id) => props.squad.find((player) => player.personId === id)?.name)
            .join(", ")}
        </p>
        <p>Set pieces: penalty, free-kick, and corners are saved with this tactic.</p>
      </Panel>
    </section>
  );
};

const PlayerProfile = ({ player }: { player: SquadRow }): React.ReactElement => (
  <aside className="player-profile">
    <h2>{player.name}</h2>
    <p>
      {player.positions.join(" / ")} · {player.age ?? "-"} · {player.preferredFoot} foot
    </p>
    <div className="attribute-groups">
      {["Overview", "Attributes", "Form", "Match Stats"].map((group) => (
        <section key={group}>
          <h3>{group}</h3>
          <div className="attribute">
            <span>Overall assessment</span>
            <strong>{player.overall}</strong>
          </div>
          <div className="attribute">
            <span>Fitness</span>
            <strong>{player.fitness}</strong>
          </div>
          <div className="attribute">
            <span>Average rating</span>
            <strong>{player.averageRating ? player.averageRating.toFixed(2) : "-"}</strong>
          </div>
        </section>
      ))}
    </div>
  </aside>
);

const PostMatch = ({
  result,
}: {
  result: NonNullable<DesktopApplicationState["home"]["previousResult"]>;
}) => (
  <Panel title="Post Match">
    <h2>{result.score}</h2>
    <dl className="metrics">
      <div>
        <dt>Shots</dt>
        <dd>
          {result.homeStats.shots}-{result.awayStats.shots}
        </dd>
      </div>
      <div>
        <dt>xG</dt>
        <dd>
          {result.homeStats.xg}-{result.awayStats.xg}
        </dd>
      </div>
      <div>
        <dt>Possession</dt>
        <dd>
          {result.homeStats.possession}-{result.awayStats.possession}
        </dd>
      </div>
    </dl>
    {result.events.slice(0, 8).map((event) => (
      <div className="event" key={event.id}>
        {event.minute}' {event.type}
      </div>
    ))}
  </Panel>
);

const Panel = (props: { title: string; children: React.ReactNode }): React.ReactElement => (
  <article className="panel">
    <h2>{props.title}</h2>
    {props.children}
  </article>
);

const StartShell = (props: {
  children: React.ReactNode;
  error?: AppError | null;
}): React.ReactElement => (
  <main className="career-shell">
    {props.error && <ErrorBanner error={props.error} />}
    {props.children}
  </main>
);

const ErrorBanner = ({ error }: { error: AppError }): React.ReactElement => (
  <div className="warning">
    <strong>{error.code}</strong> {error.message} {error.detail}
  </div>
);

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
