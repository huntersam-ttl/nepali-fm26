import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createAppBridge,
  type AppError,
  type DatasetAttributionSummary,
  type DesktopApplicationState,
  type EntityId,
  type CareerRole,
  type CareerRoleState,
  type CareerStartMode,
  type SaveCatalogEntry,
  type StartingClubOption,
  type FounderLocationOption,
} from "./appBridge.js";
import { ManagerCareer } from "./manager/ManagerCareer.js";
import { PresentationSettingsPanel } from "./presentation/PresentationSettingsPanel.js";
import { presentationCapabilityLabel } from "./presentation/scenePreferences.js";
import { ClubBadge } from "./presentation/ClubBadge.js";
import type { ClubBadgeDesign } from "./presentation/clubVisualIdentity.js";
import type { ClubBadgeShape, ClubBadgeSymbol } from "@nepal-football-sim/shared-types";
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
            {/*
             * Each card is a button whose visible text is a heading plus a
             * description. An explicit label keeps the announced name short and
             * stable instead of the two run together.
             */}
            <button className="club-row" aria-label="New career" disabled={busy} onClick={() => setEntry("new")}>
              <strong>New Career</strong>
              <span>Start a manager career in the real Nepal football world.</span>
            </button>
            {mostRecent && (
              <button
                className="club-row"
                aria-label={`Continue career ${mostRecent.saveName}`}
                disabled={busy}
                onClick={() => void run(() => bridge.loadCareer(mostRecent.saveId))}
              >
                <strong>Continue</strong>
                <span>
                  {mostRecent.saveName} · {mostRecent.worldDate}
                </span>
              </button>
            )}
            <button className="club-row" aria-label="Load career" disabled={busy} onClick={() => setEntry("load")}>
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
  const [careerMode, setCareerMode] = useState<CareerStartMode>("MANAGER");
  const [coachingExperience, setCoachingExperience] = useState("YOUTH_COACH");
  const [education, setEducation] = useState("SPORTS_RELATED_DEGREE");
  const [clubs, setClubs] = useState<StartingClubOption[]>([]);
  const [founderLocations, setFounderLocations] = useState<FounderLocationOption[]>([]);
  const [founderLocationId, setFounderLocationId] = useState("");
  const [founderClubName, setFounderClubName] = useState("Nepal Community FC");
  const [founderGroundName, setFounderGroundName] = useState("");
  const [founderPrimaryColour, setFounderPrimaryColour] = useState("#2b3a67");
  const [founderSecondaryColour, setFounderSecondaryColour] = useState("#e7ebef");
  const [founderAccentColour, setFounderAccentColour] = useState("#8fd14f");
  const [founderBadgeShape, setFounderBadgeShape] = useState<ClubBadgeShape>("SHIELD");
  const [founderBadgeSymbol, setFounderBadgeSymbol] = useState<ClubBadgeSymbol>("FOOTBALL");
  const [founderBadgeInitials, setFounderBadgeInitials] = useState("");
  const [teamId, setTeamId] = useState<EntityId | "">("");
  const [step, setStep] = useState(1);
  const [division, setDivision] = useState("All");
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
      const locations = await bridge.listFounderLocations();
      if (locations.ok) setFounderLocations(locations.data);
      else props.onError(locations.error);
    })();
  }, []);

  const selectedClub = clubs.find((club) => club.teamId === teamId);
  const selectedFounderLocation = founderLocations.find((location) => location.id === founderLocationId);
  const derivedInitials =
    founderClubName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "FC";
  const founderBadgePreview: ClubBadgeDesign = {
    shape: founderBadgeShape,
    symbol: founderBadgeSymbol,
    primaryColour: founderPrimaryColour,
    secondaryColour: founderSecondaryColour,
    accentColour: founderAccentColour,
    initials: (founderBadgeInitials || derivedInitials).toUpperCase().slice(0, 4),
    provenanceStatus: "SIMULATION_ONLY",
  };
  const visibleClubs = clubs.filter((club) => division === "All" || club.division === division);

  return (
    <StartShell error={props.error}>
      <section className="career-panel">
        <p className="eyebrow">New Career</p>
        <h1>{["Character", "Background", "Starting Club", "Confirmation"][step - 1]}</h1>
        <ol className="setup-steps" aria-label="Career setup progress">
          {["Character", "Career type", "Starting club", "Confirm"].map((label, index) => <li key={label} className={index + 1 === step ? "active" : index + 1 < step ? "complete" : ""}>{index + 1}. {label}</li>)}
        </ol>
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
            <label>Career mode<select value={careerMode} onChange={(event) => { const mode = event.target.value as CareerStartMode; setCareerMode(mode); if (mode === "OWNER") setTeamId(""); else setFounderLocationId(""); }}><option value="MANAGER">Manager Career — manage an existing club</option><option value="OWNER">Owner / Founder — build a new club</option></select></label>
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
          careerMode === "OWNER" ? (
          <div className="form-grid">
            <p className="subtle">Founder setup · your club enters the lowest supported playable tier: C Division.</p>
            <label>Club name<input value={founderClubName} onChange={(event) => setFounderClubName(event.target.value)} /></label>
            <label>Province / district<select value={founderLocationId} onChange={(event) => setFounderLocationId(event.target.value)}><option value="">Choose district</option>{founderLocations.map((location) => <option key={location.id} value={location.id}>{location.province} · {location.district}</option>)}</select></label>
            <label>Starter ground name<input placeholder={`${founderClubName || "Club"} Ground`} value={founderGroundName} onChange={(event) => setFounderGroundName(event.target.value)} /></label>
            <p className="subtle">The starter ground is a modest simulation-only local ground. Manager: vacant until you appoint one.</p>
            <div className="club-identity-editor">
              <div className="club-identity-controls">
                <p className="subtle">
                  Club identity (SIMULATION_ONLY) — this project holds no licensed real club branding.
                </p>
                <label>
                  Primary colour
                  <input
                    type="color"
                    aria-label="Primary colour"
                    value={founderPrimaryColour}
                    onChange={(event) => setFounderPrimaryColour(event.target.value)}
                  />
                </label>
                <label>
                  Secondary colour
                  <input
                    type="color"
                    aria-label="Secondary colour"
                    value={founderSecondaryColour}
                    onChange={(event) => setFounderSecondaryColour(event.target.value)}
                  />
                </label>
                <label>
                  Accent colour
                  <input
                    type="color"
                    aria-label="Accent colour"
                    value={founderAccentColour}
                    onChange={(event) => setFounderAccentColour(event.target.value)}
                  />
                </label>
                <label>
                  Badge shape
                  <select
                    aria-label="Badge shape"
                    value={founderBadgeShape}
                    onChange={(event) => setFounderBadgeShape(event.target.value as ClubBadgeShape)}
                  >
                    {(["SHIELD", "ROUND", "DIAMOND", "OVAL", "MODERN", "CREST"] as const).map((option) => (
                      <option key={option} value={option}>
                        {option.charAt(0) + option.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Badge symbol
                  <select
                    aria-label="Badge symbol"
                    value={founderBadgeSymbol}
                    onChange={(event) => setFounderBadgeSymbol(event.target.value as ClubBadgeSymbol)}
                  >
                    {(["FOOTBALL", "MOUNTAIN", "STAR", "STRIPES", "MONOGRAM", "GEOMETRIC"] as const).map((option) => (
                      <option key={option} value={option}>
                        {option.charAt(0) + option.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Initials
                  <input
                    type="text"
                    aria-label="Badge initials"
                    placeholder={derivedInitials}
                    maxLength={4}
                    value={founderBadgeInitials}
                    onChange={(event) => setFounderBadgeInitials(event.target.value.toUpperCase())}
                  />
                </label>
              </div>
              <div className="club-identity-preview">
                <ClubBadge design={founderBadgePreview} size="large" clubName={founderClubName || "Your club"} />
              </div>
            </div>
          </div>
          ) : (
          <div>
            <p className="subtle">Choose a playable Nepal division, then select your club.</p>
            <div className="division-tabs" role="tablist" aria-label="Playable divisions">
              {["All", "A", "B", "C"].map((option) => <button key={option} type="button" role="tab" aria-selected={division === option} className={division === option ? "active" : ""} onClick={() => setDivision(option)}>{option === "All" ? "All divisions" : `${option} Division`}</button>)}
            </div>
            {clubs.length === 0 ? <p className="empty-state" role="status">Loading playable Nepal clubs…</p> : <div className="club-choice setup-clubs" role="group" aria-label="Starting club">{visibleClubs.map((club) => <button type="button" key={club.teamId} className={`club-row ${teamId === club.teamId ? "selected" : ""}`} aria-pressed={teamId === club.teamId} onClick={() => setTeamId(club.teamId)}><strong>{club.clubName}</strong><span>{club.division} Division · {club.locationName ?? "Location unknown"}</span><span>{club.squadSize} players · {club.competitionName}</span></button>)}</div>}
            {selectedClub && <p className="selection-note" role="status">Selected: <strong>{selectedClub.clubName}</strong> · {selectedClub.locationName ?? "Location unknown"} · {selectedClub.professionalStatus ?? "Status unknown"}</p>}
          </div>
          )
        )}
        {step === 4 && (
          careerMode === "OWNER" ? (
            <div className="club-identity-editor">
              <p>
                Found <strong>{founderClubName}</strong> in {selectedFounderLocation?.province} ·{" "}
                {selectedFounderLocation?.district}, entering C Division with 100% Founder ownership and a modest
                local ground.
              </p>
              <div className="club-identity-preview">
                <ClubBadge design={founderBadgePreview} size="large" clubName={founderClubName} />
              </div>
            </div>
          ) : (
            <p>
              Join {selectedClub?.clubName ?? "your club"} as manager in the{" "}
              {selectedClub?.competitionName ?? "Nepal league"} and create a SQLite career save.
            </p>
          )
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
            disabled={busy || (step === 3 && (careerMode === "OWNER" ? (!founderLocationId || !founderClubName.trim()) : !teamId))}
            onClick={async () => {
              if (step < 4) {
                setStep(step + 1);
                return;
              }
              setBusy(true);
              const result = await bridge.createCareer({
                  saveName,
                careerMode,
                joinTeamId: careerMode === "MANAGER" ? (teamId || undefined) : undefined,
                founder: careerMode === "OWNER" && selectedFounderLocation ? { clubName: founderClubName.trim(), locationId: selectedFounderLocation.id, locationName: selectedFounderLocation.district, groundName: founderGroundName.trim() || `${founderClubName.trim()} Ground`, philosophy: "COMMUNITY" } : undefined,
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
              // The chosen identity is applied as a real, immediate follow-up
              // write against the club that now really exists — createCareer
              // itself has no identity fields, so this cannot be one atomic
              // transaction. A failure here does not undo the (successful)
              // career creation; it is logged rather than silently treated
              // as full success, and the club still shows its real
              // deterministic default identity until the player retries via
              // the Club Identity screen.
              if (result.ok && careerMode === "OWNER" && bridge.getChairmanDashboard && bridge.setClubVisualIdentity) {
                const dashboard = await bridge.getChairmanDashboard();
                if (dashboard.ok) {
                  const identitySaved = await bridge.setClubVisualIdentity(dashboard.data.club.id, {
                    primaryColour: founderPrimaryColour,
                    secondaryColour: founderSecondaryColour,
                    accentColour: founderAccentColour,
                    badgeShape: founderBadgeShape,
                    badgeSymbol: founderBadgeSymbol,
                    badgeInitials: founderBadgePreview.initials,
                  });
                  if (!identitySaved.ok) {
                    console.error("Founder club identity failed to save:", identitySaved.error);
                  }
                }
              }
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
}): React.ReactElement => {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [presentationOpen, setPresentationOpen] = useState(false);
  return (
    <main className="career-shell">
      {props.error && <ErrorBanner error={props.error} />}
      {props.children}
      <p className="subtle">
        <button className="link" onClick={() => setAboutOpen(true)}>
          About &amp; Data Attribution
        </button>
        {" · "}
        <button className="link" onClick={() => setPresentationOpen(true)}>
          Presentation settings
        </button>
        {" · "}
        {/* Stated up front rather than only behind the settings panel: a player
            whose machine falls back to the 2D views should be able to see why
            without hunting for it. */}
        <span>{presentationCapabilityLabel()}</span>
      </p>
      {aboutOpen && <AboutPanel onClose={() => setAboutOpen(false)} />}
      {presentationOpen && <PresentationSettingsPanel onClose={() => setPresentationOpen(false)} />}
    </main>
  );
};

/**
 * Minimal Credits surface for the dataset attribution/licensing record that
 * ships inside the bundle (docs/DATASET_ATTRIBUTION_AND_LICENSING.md,
 * data/DATASET_MANIFEST.json) — reads only getDatasetAttribution's own
 * honest summary, never claiming a permission the manifest itself records
 * as UNRESOLVED/UNKNOWN.
 */
const AboutPanel = ({ onClose }: { onClose: () => void }): React.ReactElement => {
  const [summary, setSummary] = useState<DatasetAttributionSummary | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    let cancelled = false;
    void bridge.getDatasetAttribution().then((result) => {
      if (cancelled) return;
      if (result.ok) setSummary(result.data);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="career-panel" role="dialog" aria-label="About and data attribution">
      <p className="eyebrow">About</p>
      <h1>Data Attribution</h1>
      {error && <ErrorBanner error={error} />}
      {summary && (
        <>
          <p>
            <strong>Dataset version:</strong> {summary.datasetVersion}
          </p>
          <p>{summary.factualDataNotice}</p>
          <p>{summary.simulationOnlyNotice}</p>
          <p>{summary.externalWorldPolicy}</p>
          <p className="warning">{summary.licensingNotice}</p>
          <p className="subtle">
            Full record: {summary.fullDocumentLabel} (docs/DATASET_ATTRIBUTION_AND_LICENSING.md,
            bundled with this application).
          </p>
        </>
      )}
      <button className="ghost" onClick={onClose}>
        Close
      </button>
    </section>
  );
};

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
