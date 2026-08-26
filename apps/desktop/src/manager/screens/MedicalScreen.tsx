import React, { useState } from "react";
import type { MedicalCentreEntryView, MedicalCentreView } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Panel, useRuntimeData } from "../ui.js";
import type { AppError } from "../../appBridge.js";

export const MedicalScreen = (): React.ReactElement => {
  const [state, , replace] = useRuntimeData(() => managerBridge.getMedicalCentre());
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const decide = async (personId: MedicalCentreEntryView["personId"], decision: string) => {
    setBusy(true);
    const result = await managerBridge.decideReturnToPlay({ personId, decision });
    setBusy(false);
    if (result.ok) {
      replace(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  };

  return (
    <>
      {error && <ErrorBanner error={error} />}
      <AsyncPanel state={state}>{(view) => <MedicalBoard view={view} busy={busy} onDecide={decide} />}</AsyncPanel>
    </>
  );
};

const stageLabel = (stage: string): string => stage.replace(/_/g, " ").toLowerCase();

const recommendationTone = (recommendation: string): "ok" | "warn" | "bad" | "info" => {
  if (recommendation === "FULLY_FIT") return "ok";
  if (recommendation === "UNAVAILABLE") return "bad";
  return "warn";
};

const MedicalBoard = ({
  view,
  busy,
  onDecide,
}: {
  view: MedicalCentreView;
  busy: boolean;
  onDecide: (personId: MedicalCentreEntryView["personId"], decision: string) => Promise<void>;
}): React.ReactElement => (
  <section className="dashboard">
    <Panel title="Medical centre">
      {view.players.length === 0 ? (
        <p className="empty-state">No player currently needs medical attention.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Rehab stage</th>
                <th>Recommendation</th>
                <th>Confidence</th>
                <th>Recurrence risk</th>
                <th>Workload</th>
                <th>Flags</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {view.players.map((player) => (
                <tr key={player.personId}>
                  <td>{player.name}</td>
                  <td>{player.rehabPlan ? stageLabel(player.rehabPlan.stage) : stageLabel(player.stage)}</td>
                  <td>
                    <Badge tone={recommendationTone(player.availabilityRecommendation)}>
                      {player.availabilityRecommendation.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                  </td>
                  <td>{player.confidence.toFixed(1)}/10</td>
                  <td>{Math.round(player.recurrenceRisk * 100)}%</td>
                  <td>
                    <Badge tone={player.workloadFlag === "OVERLOADED" ? "bad" : player.workloadFlag === "ELEVATED" ? "warn" : "info"}>
                      {player.workloadFlag.toLowerCase()}
                    </Badge>
                    {player.congestionMultiplier < 1 && <span className="subtle"> · congested</span>}
                  </td>
                  <td>
                    {player.chronicRisk && <Badge tone="warn">recurring risk</Badge>}
                    {player.trainingAvailability === "RETURNING" && <Badge tone="info">ramping up</Badge>}
                  </td>
                  <td>
                    <div className="button-row">
                      <button
                        className="ghost small"
                        disabled={busy}
                        onClick={() => void onDecide(player.personId, "FOLLOW_ADVICE")}
                      >
                        Follow advice
                      </button>
                      <button className="ghost small" disabled={busy} onClick={() => void onDecide(player.personId, "DELAY")}>
                        Delay
                      </button>
                      <button
                        className="ghost small"
                        disabled={busy}
                        onClick={() => void onDecide(player.personId, "ACCEPT_RISK")}
                      >
                        Accept risk
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>

    {view.players.some((player) => player.decisionHistory.length > 0) && (
      <Panel title="Recent return-to-play decisions">
        <ul className="report-list">
          {view.players
            .flatMap((player) => player.decisionHistory.map((decision) => ({ player, decision })))
            .slice(0, 15)
            .map(({ player, decision }) => (
              <li key={decision.id}>
                {player.name} · {decision.decidedOn} · {decision.decision.replace(/_/g, " ").toLowerCase()} →{" "}
                <Badge tone={decision.outcome === "SETBACK" ? "bad" : decision.outcome === "ADVANCED" ? "ok" : "info"}>
                  {decision.outcome.toLowerCase()}
                </Badge>{" "}
                <span className="subtle">{decision.rationale}</span>
              </li>
            ))}
        </ul>
      </Panel>
    )}
  </section>
);
