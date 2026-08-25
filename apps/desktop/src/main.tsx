import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createAppBridge,
  type AppError,
  type DesktopApplicationState,
  type EntityId,
  type SaveCatalogEntry,
  type SquadRow,
  type StartingClubOption,
  type TacticalSetup,
} from "./appBridge.js";
import "./styles.css";

type Screen = "home" | "squad" | "tactics" | "fixtures" | "competition" | "profile";
type Entry = "start" | "new" | "load" | "career";

const bridge = createAppBridge();

const App = (): React.ReactElement => {
  const [entry, setEntry] = useState<Entry>("start");
  const [screen, setScreen] = useState<Screen>("home");
  const [state, setState] = useState<DesktopApplicationState | null>(null);
  const [saves, setSaves] = useState<SaveCatalogEntry[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | undefined>();
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshSaves = async (): Promise<void> => {
    const result = await bridge.listSaves();
    if (result.ok) setSaves(result.data);
    else setError(result.error);
  };

  useEffect(() => {
    void refreshSaves();
  }, []);

  const applyState = (next: DesktopApplicationState): void => {
    setState(next);
    setSelectedPlayerId(next.squad[0]?.personId);
    setEntry("career");
    setScreen("home");
    setError(null);
    void refreshSaves();
  };

  const run = async (
    action: () => Promise<
      { ok: true; data: DesktopApplicationState } | { ok: false; error: AppError }
    >,
  ): Promise<void> => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result.ok) applyState(result.data);
    else setError(result.error);
  };

  const backToMenu = async (): Promise<void> => {
    setBusy(true);
    await bridge.closeCareer();
    setBusy(false);
    setState(null);
    setEntry("start");
    void refreshSaves();
  };

  if (entry === "new") {
    return (
      <NewCareer
        onCancel={() => setEntry("start")}
        onCreated={applyState}
        onError={setError}
        error={error}
      />
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
              <div className="club-row-group" key={save.saveId}>
                <button
                  className="club-row"
                  disabled={busy}
                  onClick={() => void run(() => bridge.loadCareer(save.saveId))}
                >
                  <strong>{save.saveName}</strong>
                  <span>
                    {save.characterName ?? "Unknown"} · {save.organisation ?? "Unemployed"} ·{" "}
                    {save.worldDate}
                  </span>
                </button>
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={async () => {
                    const result = await bridge.deleteSave(save.saveId);
                    if (!result.ok) setError(result.error);
                    void refreshSaves();
                  }}
                >
                  Delete
                </button>
              </div>
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
    const mostRecent = saves[0];
    return (
      <StartShell error={error}>
        <section className="career-panel">
          <p className="eyebrow">Nepal Football Universe</p>
          <h1>Career Saves</h1>
          <div className="club-choice">
            <button className="club-row" disabled={busy} onClick={() => setEntry("new")}>
              <strong>New Career</strong>
              <span>Start a manager career in the real Nepal football world.</span>
            </button>
            {mostRecent && (
              <button
                className="club-row"
                disabled={busy}
                onClick={() => void run(() => bridge.loadCareer(mostRecent.saveId))}
              >
                <strong>Continue</strong>
                <span>
                  {mostRecent.saveName} · {mostRecent.worldDate}
                </span>
              </button>
            )}
            <button className="club-row" disabled={busy} onClick={() => setEntry("load")}>
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
          <p className="eyebrow">{title(state.header.activeRole)} Mode</p>
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
        <div className="button-row">
          <button
            className="ghost"
            disabled={busy}
            onClick={async () => {
              const result = await bridge.saveCareer();
              if (result.ok) void refreshSaves();
              else setError(result.error);
            }}
          >
            Save
          </button>
          <button className="ghost" disabled={busy} onClick={() => void backToMenu()}>
            Main Menu
          </button>
        </div>
      </aside>
      <section className="workspace">
        {error && <ErrorBanner error={error} />}
        <header className="topbar">
          <div>
            <strong>{state.header.characterName}</strong>
            <span>{state.header.clubName ?? "Unemployed"}</span>
          </div>
          <div>
            <strong>{state.header.worldDate}</strong>
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
                  <dt>Competition</dt>
                  <dd>{state.header.competitionName ?? "-"}</dd>
                </div>
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
                disabled={busy}
                onClick={() => void run(() => bridge.continueCareer())}
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
              const result = await bridge.saveTactic(tactic);
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
                disabled={busy}
                onClick={() => void run(() => bridge.quickSimMatch(state.home.nextFixture?.id))}
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
          <Panel title="Career Profile">
            <dl className="profile-grid">
              <div>
                <dt>Name</dt>
                <dd>{state.header.characterName}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{title(state.header.activeRole)}</dd>
              </div>
              <div>
                <dt>Club</dt>
                <dd>{state.header.clubName ?? "Unemployed"}</dd>
              </div>
              <div>
                <dt>Save</dt>
                <dd>{state.header.saveName}</dd>
              </div>
              <div>
                <dt>Save file</dt>
                <dd>{state.catalogEntry.filePath}</dd>
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
  error: AppError | null;
}): React.ReactElement => {
  const [saveName, setSaveName] = useState("Nepal Manager Career");
  const [fullName, setFullName] = useState("Maya Adhikari");
  const [displayName, setDisplayName] = useState("Maya");
  const [dateOfBirth, setDateOfBirth] = useState("1993-05-12");
  const [startingAge, setStartingAge] = useState(33);
  const [playingExperience, setPlayingExperience] = useState("AMATEUR_PLAYER");
  const [coachingExperience, setCoachingExperience] = useState("YOUTH_COACH");
  const [education, setEducation] = useState("SPORTS_RELATED_DEGREE");
  const [clubs, setClubs] = useState<StartingClubOption[]>([]);
  const [teamId, setTeamId] = useState<EntityId | "">("");
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await bridge.listStartingClubs();
      if (result.ok) {
        setClubs(result.data);
        setTeamId((current) => current || (result.data[0]?.teamId ?? ""));
      } else {
        props.onError(result.error);
      }
    })();
  }, []);

  const selectedClub = clubs.find((club) => club.teamId === teamId);

  return (
    <StartShell error={props.error}>
      <section className="career-panel">
        <p className="eyebrow">New Career</p>
        <h1>{["Character", "Background", "Starting Club", "Confirmation"][step - 1]}</h1>
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
              <select
                value={playingExperience}
                onChange={(event) => setPlayingExperience(event.target.value)}
              >
                <option value="NO_PLAYING_EXPERIENCE">No Playing Experience</option>
                <option value="AMATEUR_PLAYER">Amateur Player</option>
                <option value="SEMI_PROFESSIONAL_PLAYER">Semi-Professional Player</option>
              </select>
            </label>
            <label>
              Coaching experience
              <select
                value={coachingExperience}
                onChange={(event) => setCoachingExperience(event.target.value)}
              >
                <option value="NONE">None</option>
                <option value="GRASSROOTS">Grassroots</option>
                <option value="YOUTH_COACH">Youth Coach</option>
              </select>
            </label>
            <label>
              Education
              <select value={education} onChange={(event) => setEducation(event.target.value)}>
                <option value="SECONDARY">Secondary</option>
                <option value="UNIVERSITY">University</option>
                <option value="SPORTS_RELATED_DEGREE">Sports-related Degree</option>
              </select>
            </label>
          </div>
        )}
        {step === 3 && (
          <div className="form-grid">
            <label>
              Starting club
              <select
                value={teamId}
                onChange={(event) => setTeamId(event.target.value as EntityId)}
              >
                {clubs.map((club) => (
                  <option key={club.teamId} value={club.teamId}>
                    {club.clubName} ({club.squadSize} players)
                  </option>
                ))}
              </select>
            </label>
            {clubs.length === 0 && <p>Loading Nepal clubs…</p>}
            {selectedClub && <p>{selectedClub.competitionName}</p>}
          </div>
        )}
        {step === 4 && (
          <p>
            Join {selectedClub?.clubName ?? "your club"} as manager in the{" "}
            {selectedClub?.competitionName ?? "Nepal league"} and create a SQLite career save.
          </p>
        )}
        <div className="button-row">
          <button
            className="ghost"
            disabled={busy}
            onClick={step === 1 ? props.onCancel : () => setStep(step - 1)}
          >
            Back
          </button>
          <button
            className="primary"
            disabled={busy || (step === 3 && !teamId)}
            onClick={async () => {
              if (step < 4) {
                setStep(step + 1);
                return;
              }
              setBusy(true);
              const result = await bridge.createCareer({
                saveName,
                joinTeamId: teamId || undefined,
                character: {
                  fullName,
                  preferredDisplayName: displayName,
                  dateOfBirth,
                  startingAge,
                  languages: ["ne", "en"],
                  footballBackground: "COMMUNITY_COACHING",
                  education,
                  playingExperience,
                  coachingExperience,
                  businessBackground: "SMALL_BUSINESS",
                  startingReputationProfile: "LOCAL_RESPECTED",
                },
              });
              setBusy(false);
              if (result.ok) props.onCreated(result.data);
              else props.onError(result.error);
            }}
          >
            {step < 4 ? "Continue" : busy ? "Creating…" : "Create Save"}
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
              onChange={(event) =>
                setDraft({ ...draft, style: event.target.value as TacticalSetup["style"] })
              }
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
    <strong>{error.code}</strong> {error.message}
  </div>
);

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
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
