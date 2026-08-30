import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createAppBridge,
  type AppError,
  type DesktopApplicationState,
  type EntityId,
  type CareerRole,
  type CareerRoleState,
  type SaveCatalogEntry,
  type StartingClubOption,
} from "./appBridge.js";
import { ManagerCareer } from "./manager/ManagerCareer.js";
import "./styles.css";

type Entry = "start" | "new" | "load" | "career";

const bridge = createAppBridge();

const App = (): React.ReactElement => {
  const [entry, setEntry] = useState<Entry>("start");
  const [state, setState] = useState<DesktopApplicationState | null>(null);
  const [saves, setSaves] = useState<SaveCatalogEntry[]>([]);
  const [roles, setRoles] = useState<CareerRoleState>({ activeRole: "MANAGER", heldRoles: ["MANAGER"] });
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
    setRoles((current) => ({ ...current, activeRole: next.header.activeRole }));
    void bridge.getCareerRoles().then((result) => {
      if (result.ok) setRoles(result.data);
    });
    setEntry("career");
    setError(null);
    void refreshSaves();
  };

  const switchRole = async (role: CareerRole): Promise<void> => {
    const result = await bridge.switchActiveCareerRole(role);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRoles((current) => ({ ...current, activeRole: role }));
    setState((current) => (current ? { ...current, header: result.data } : current));
    setError(null);
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

  return (
    <ManagerCareer
      header={state.header}
      bridge={bridge}
      onHeaderChange={(header) => setState({ ...state, header })}
      roles={roles}
      onRoleSwitch={switchRole}
      onSave={async () => {
        const result = await bridge.saveCareer();
        if (result.ok) void refreshSaves();
        else setError(result.error);
      }}
      onExit={() => void backToMenu()}
    />
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

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
