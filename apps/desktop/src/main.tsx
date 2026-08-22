import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Screen = "home" | "squad" | "tactics" | "fixtures" | "competition" | "profile";
type CareerStep = "character" | "club" | "manager";

type Player = {
  id: string;
  name: string;
  age: number;
  nationality: string;
  positions: string[];
  foot: "Left" | "Right";
  fitness: number;
  form: number;
  morale: string;
  overall: number;
  appearances: number;
  goals: number;
  assists: number;
  averageRating: number;
  availability: string;
  attributes: Record<string, number>;
};

type TacticalSlot = {
  id: string;
  label: string;
  x: number;
  y: number;
  role: string;
  playerId?: string;
};

const players: Player[] = [
  player("p1", "Kiran Rai", 28, ["GK"], "Right", 84, 7.01, 12),
  player("p2", "Suman Lama", 24, ["RB", "LB"], "Right", 91, 6.79, 11),
  player("p3", "Anil Gurung", 31, ["CB"], "Right", 76, 6.88, 12),
  player("p4", "Bikash Thapa", 22, ["CB", "DM"], "Left", 88, 6.95, 10),
  player("p5", "Nabin Shrestha", 25, ["LB", "WBL"], "Left", 82, 6.72, 10),
  player("p6", "Rohit Karki", 27, ["DM", "CM"], "Right", 79, 6.91, 12),
  player("p7", "Aakash Tamang", 23, ["CM"], "Right", 86, 6.84, 11),
  player("p8", "Sanjay Magar", 21, ["AM", "CM"], "Left", 92, 7.12, 13),
  player("p9", "Prakash Bista", 26, ["RW", "AM"], "Right", 73, 6.66, 10),
  player("p10", "Milan Sunar", 20, ["LW", "ST"], "Left", 89, 6.93, 11),
  player("p11", "Dinesh Ale", 29, ["ST"], "Right", 81, 7.2, 13),
  player("p12", "Ramesh Chaudhary", 19, ["GK"], "Right", 96, 6.41, 8),
  player("p13", "Ashim KC", 24, ["CB", "RB"], "Right", 83, 6.54, 9),
  player("p14", "Manish Bhandari", 27, ["CM", "DM"], "Left", 77, 6.5, 9),
  player("p15", "Sagar Budha", 22, ["RW", "LW"], "Right", 87, 6.69, 10),
  player("p16", "Bimal Rana", 30, ["ST", "AM"], "Right", 74, 6.61, 10),
  player("p17", "Hari Malla", 23, ["LB", "CB"], "Left", 90, 6.48, 9),
  player("p18", "Deepak Tamang", 21, ["CM"], "Right", 93, 6.36, 8),
];

const initialSlots: TacticalSlot[] = [
  slot("GK", 50, 8, "Goalkeeper", "p1"),
  slot("DL", 18, 25, "Full Back", "p5"),
  slot("DCL", 38, 23, "Ball-Playing Defender", "p3"),
  slot("DCR", 62, 23, "Cover", "p4"),
  slot("DR", 82, 25, "Full Back", "p2"),
  slot("MCL", 38, 52, "Box-to-Box Midfielder", "p6"),
  slot("MC", 50, 49, "Deep-Lying Playmaker", "p7"),
  slot("MCR", 62, 52, "Advanced Playmaker", "p8"),
  slot("AML", 22, 76, "Inside Forward", "p10"),
  slot("AMR", 78, 76, "Winger", "p9"),
  slot("STC", 50, 89, "Pressing Forward", "p11"),
];

const bench = ["p12", "p13", "p14", "p15", "p16", "p17", "p18"];

const App = (): React.ReactElement => {
  const [careerStep, setCareerStep] = useState<CareerStep>("character");
  const [screen, setScreen] = useState<Screen>("home");
  const [managerName, setManagerName] = useState("Maya Adhikari");
  const [displayName, setDisplayName] = useState("Maya");
  const [dateOfBirth, setDateOfBirth] = useState("1993-05-12");
  const [startingAge, setStartingAge] = useState(33);
  const [clubJoined, setClubJoined] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState("p11");
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<"overall" | "fitness" | "rating">("overall");
  const [slots, setSlots] = useState(initialSlots);
  const [style, setStyle] = useState("Balanced");
  const [mentality, setMentality] = useState("Balanced");
  const [tempo, setTempo] = useState(50);
  const [pressing, setPressing] = useState(50);
  const [result, setResult] = useState<null | { score: string; events: string[] }>(null);
  const selectedPlayer =
    players.find((candidate) => candidate.id === selectedPlayerId) ?? players[0]!;
  const starters = slots.flatMap((candidate) => {
    const picked = players.find((playerItem) => playerItem.id === candidate.playerId);
    return picked ? [picked] : [];
  });
  const squadRows = useMemo(
    () =>
      [...players]
        .filter((candidate) => candidate.name.toLowerCase().includes(filter.toLowerCase()))
        .sort((a, b) =>
          sortKey === "rating"
            ? b.averageRating - a.averageRating
            : sortKey === "fitness"
              ? b.fitness - a.fitness
              : b.overall - a.overall,
        ),
    [filter, sortKey],
  );
  const warnings = [
    starters.length !== 11 ? "Starting XI must contain 11 players." : undefined,
    new Set(starters.map((playerItem) => playerItem.id)).size !== starters.length
      ? "Duplicate starter detected."
      : undefined,
    starters.some((playerItem) => playerItem.positions.includes("GK"))
      ? undefined
      : "No goalkeeper selected.",
    pressing > 75 ? "High press will increase fatigue and transition risk." : undefined,
  ].filter(Boolean);

  if (careerStep !== "manager") {
    return (
      <main className="career-shell">
        <section className="career-panel">
          <p className="eyebrow">New Career</p>
          <h1>{careerStep === "character" ? "Create Character" : "Join A Club"}</h1>
          {careerStep === "character" ? (
            <div className="form-grid">
              <label>
                Full name
                <input
                  value={managerName}
                  onChange={(event) => setManagerName(event.target.value)}
                />
              </label>
              <label>
                Display name
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
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
              <label>
                Nationality
                <select defaultValue="Nepal">
                  <option>Nepal</option>
                  <option>Second nationality optional</option>
                </select>
              </label>
              <label>
                Background
                <select defaultValue="Youth Coach">
                  <option>No Playing Experience</option>
                  <option>Amateur Player</option>
                  <option>Semi-Professional Player</option>
                  <option>Professional Player</option>
                  <option>Former International</option>
                  <option>Youth Coach</option>
                  <option>Sports-related Degree</option>
                </select>
              </label>
              <button className="primary" onClick={() => setCareerStep("club")}>
                Continue
              </button>
            </div>
          ) : (
            <div className="club-choice">
              <button
                className="club-row"
                onClick={() => {
                  setClubJoined(true);
                  setCareerStep("manager");
                }}
              >
                <strong>Kathmandu Testing Club</strong>
                <span>Manager, NPR 90,000/month, active testing appointment</span>
              </button>
              <button className="ghost" onClick={() => setCareerStep("manager")}>
                Start Unemployed
              </button>
            </div>
          )}
        </section>
      </main>
    );
  }

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
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <strong>{displayName}</strong>
            <span>{clubJoined ? "Kathmandu Testing Club" : "Unemployed"}</span>
          </div>
          <div>
            <strong>2026-08-01</strong>
            <span>Next: Testing League opener</span>
          </div>
        </header>
        {screen === "home" && (
          <section className="dashboard">
            <Panel title="Inbox">
              <div className="inbox-item">
                Fixture upcoming: Kathmandu Testing Club vs Lalitpur Test XI.
              </div>
              {result && (
                <div className="inbox-item">Match result: {result.score} quick sim completed.</div>
              )}
            </Panel>
            <Panel title="Match Preparation">
              <dl className="metrics">
                <div>
                  <dt>Formation</dt>
                  <dd>4-3-3 Custom</dd>
                </div>
                <div>
                  <dt>Style</dt>
                  <dd>{style}</dd>
                </div>
                <div>
                  <dt>Fitness warning</dt>
                  <dd>{players.filter((playerItem) => playerItem.fitness < 80).length}</dd>
                </div>
              </dl>
              <button className="primary" onClick={() => setScreen("fixtures")}>
                Prepare Match
              </button>
            </Panel>
            <Panel title="Recent Form">
              <div className="form-strip">
                {result ? "W D W L W" : "No competitive results yet"}
              </div>
            </Panel>
          </section>
        )}
        {screen === "squad" && (
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
                    <th>Foot</th>
                    <th>Fit</th>
                    <th>Form</th>
                    <th>Role fit</th>
                    <th>Apps</th>
                    <th>G</th>
                    <th>A</th>
                    <th>AvR</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {squadRows.map((playerItem) => (
                    <tr key={playerItem.id} onClick={() => setSelectedPlayerId(playerItem.id)}>
                      <td>{playerItem.name}</td>
                      <td>{playerItem.age}</td>
                      <td>{playerItem.nationality}</td>
                      <td>{playerItem.positions.join(", ")}</td>
                      <td>{playerItem.foot}</td>
                      <td>{playerItem.fitness}</td>
                      <td>{playerItem.form}</td>
                      <td>{roleFitLabel(playerItem.overall)}</td>
                      <td>{playerItem.appearances}</td>
                      <td>{playerItem.goals}</td>
                      <td>{playerItem.assists}</td>
                      <td>{playerItem.averageRating.toFixed(2)}</td>
                      <td>{playerItem.availability}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PlayerProfile playerItem={selectedPlayer} />
          </section>
        )}
        {screen === "tactics" && (
          <section className="tactics-layout">
            <Panel title="Team Instructions">
              <div className="controls">
                <label>
                  Style
                  <select value={style} onChange={(event) => setStyle(event.target.value)}>
                    {[
                      "Balanced",
                      "Possession",
                      "Gegenpress",
                      "High Press",
                      "Counter Attack",
                      "Direct",
                      "Low Block",
                      "Wing Play",
                      "Vertical",
                    ].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Mentality
                  <select value={mentality} onChange={(event) => setMentality(event.target.value)}>
                    {[
                      "Very Defensive",
                      "Defensive",
                      "Cautious",
                      "Balanced",
                      "Positive",
                      "Attacking",
                      "Very Attacking",
                    ].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Tempo
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={tempo}
                    onChange={(event) => setTempo(Number(event.target.value))}
                  />
                </label>
                <label>
                  Pressing
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={pressing}
                    onChange={(event) => setPressing(Number(event.target.value))}
                  />
                </label>
              </div>
            </Panel>
            <div className="pitch">
              {slots.map((slotItem) => (
                <button
                  key={slotItem.id}
                  className="slot"
                  style={{ left: `${slotItem.x}%`, top: `${100 - slotItem.y}%` }}
                  onClick={() =>
                    setSlots((current) =>
                      current.map((candidate) =>
                        candidate.id === slotItem.id
                          ? {
                              ...candidate,
                              role: candidate.role === "Winger" ? "Inside Forward" : "Winger",
                            }
                          : candidate,
                      ),
                    )
                  }
                >
                  <strong>{slotItem.label}</strong>
                  <span>
                    {players
                      .find((candidate) => candidate.id === slotItem.playerId)
                      ?.name.split(" ")
                      .at(-1)}
                  </span>
                </button>
              ))}
            </div>
            <Panel title="Selection Validation">
              {warnings.length ? (
                warnings.map((warning) => (
                  <div key={warning} className="warning">
                    {warning}
                  </div>
                ))
              ) : (
                <div className="ok">XI, bench, goalkeeper and duplicate checks pass.</div>
              )}
              <p>
                Bench:{" "}
                {bench
                  .map((id) => players.find((candidate) => candidate.id === id)?.name)
                  .join(", ")}
              </p>
            </Panel>
          </section>
        )}
        {screen === "fixtures" && (
          <section className="dashboard">
            <Panel title="Next Fixture">
              <h2>Kathmandu Testing Club vs Lalitpur Test XI</h2>
              <p>Testing League, Dasarath testing venue, 2026-08-03.</p>
              <dl className="metrics">
                <div>
                  <dt>XI</dt>
                  <dd>{starters.length}</dd>
                </div>
                <div>
                  <dt>Bench</dt>
                  <dd>{bench.length}</dd>
                </div>
                <div>
                  <dt>Style</dt>
                  <dd>{style}</dd>
                </div>
              </dl>
              <button
                className="primary"
                onClick={() =>
                  setResult({
                    score: pressing > 70 ? "2-1" : style === "Low Block" ? "1-0" : "1-1",
                    events: ["12' Shot saved", "31' Goal", "63' Substitution", "77' Yellow card"],
                  })
                }
              >
                Quick Sim
              </button>
            </Panel>
            {result && (
              <Panel title="Post Match">
                <h2>{result.score}</h2>
                <dl className="metrics">
                  <div>
                    <dt>Shots</dt>
                    <dd>8-6</dd>
                  </div>
                  <div>
                    <dt>On target</dt>
                    <dd>5-3</dd>
                  </div>
                  <div>
                    <dt>xG</dt>
                    <dd>1.42-1.08</dd>
                  </div>
                  <div>
                    <dt>Possession</dt>
                    <dd>52-48</dd>
                  </div>
                </dl>
                {result.events.map((event) => (
                  <div className="event" key={event}>
                    {event}
                  </div>
                ))}
              </Panel>
            )}
          </section>
        )}
        {screen === "competition" && (
          <Panel title="Testing League Table">
            <table>
              <tbody>
                {[
                  "Kathmandu Testing Club",
                  "Lalitpur Test XI",
                  "Pokhara Sample Club",
                  "Biratnagar Demo",
                ].map((team, index) => (
                  <tr key={team}>
                    <td>{index + 1}</td>
                    <td>{team}</td>
                    <td>{result && index === 0 ? 3 : 0}</td>
                    <td>{result && index === 0 ? "+1" : "0"}</td>
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
                <dd>{managerName}</dd>
              </div>
              <div>
                <dt>Date of birth</dt>
                <dd>{dateOfBirth}</dd>
              </div>
              <div>
                <dt>Starting age</dt>
                <dd>{startingAge}</dd>
              </div>
              <div>
                <dt>Nationality</dt>
                <dd>Nepal</dd>
              </div>
              <div>
                <dt>Licences</dt>
                <dd>Testing C Licence</dd>
              </div>
              <div>
                <dt>Reputation</dt>
                <dd>Local respected</dd>
              </div>
            </dl>
          </Panel>
        )}
      </section>
    </main>
  );
};

const Panel = (props: { title: string; children: React.ReactNode }): React.ReactElement => (
  <article className="panel">
    <h2>{props.title}</h2>
    {props.children}
  </article>
);

const PlayerProfile = ({ playerItem }: { playerItem: Player }): React.ReactElement => (
  <aside className="player-profile">
    <h2>{playerItem.name}</h2>
    <p>
      {playerItem.positions.join(" / ")} · {playerItem.age} · {playerItem.foot} foot
    </p>
    <div className="attribute-groups">
      {["Technical", "Mental", "Physical", "Goalkeeping"].map((group) => (
        <section key={group}>
          <h3>{group}</h3>
          {Object.entries(playerItem.attributes)
            .slice(0, 5)
            .map(([key, value]) => (
              <div className="attribute" key={`${group}-${key}`}>
                <span>{key}</span>
                <strong>{value}</strong>
              </div>
            ))}
        </section>
      ))}
    </div>
  </aside>
);

function player(
  id: string,
  name: string,
  age: number,
  positions: string[],
  foot: Player["foot"],
  fitness: number,
  averageRating: number,
  overall: number,
): Player {
  return {
    id,
    name,
    age,
    nationality: "NEP",
    positions,
    foot,
    fitness,
    form: Math.round((averageRating - 6) * 20),
    morale: "Okay",
    overall,
    appearances: Math.max(0, overall - 6),
    goals: positions.includes("ST") ? 4 : positions.includes("GK") ? 0 : 1,
    assists: positions.includes("CM") || positions.includes("AM") ? 3 : 1,
    averageRating,
    availability: fitness < 78 ? "Managed minutes" : "Available",
    attributes: {
      passing: overall,
      decisions: overall - 1,
      stamina: Math.min(20, overall + 2),
      tackling: positions.includes("CB") ? overall + 1 : overall - 1,
      finishing: positions.includes("ST") ? overall + 1 : overall - 2,
    },
  };
}

function slot(label: string, x: number, y: number, role: string, playerId?: string): TacticalSlot {
  return { id: label, label, x, y, role, playerId };
}

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function roleFitLabel(overall: number): string {
  if (overall >= 13) return "Very Good";
  if (overall >= 11) return "Good";
  if (overall >= 9) return "Adequate";
  return "Weak";
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
