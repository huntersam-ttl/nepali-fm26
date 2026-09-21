import React from "react";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Panel, useRuntimeData } from "../ui.js";
import { confidenceTone, rangeText, recommendationsOrdered, reportAgeDays } from "../recruitment.js";

export const RecommendationsScreen = ({
  onSelectPlayer,
  today,
}: {
  onSelectPlayer: (playerId: EntityId) => void;
  today?: string;
}): React.ReactElement => {
  const [dashboard, refreshDashboard] = useRuntimeData(() => managerBridge.getScoutingDashboard());
  const referenceToday = today ?? new Date().toISOString().slice(0, 10);

  return (
    <section className="dashboard">
      <Panel title="Recommendations" className="panel-wide">
        <p className="subtle">
          Real scouting recommendations only — scout names, confidence and report age are shown where the model
          provides them. No fabricated grades or interest.
        </p>
        <AsyncPanel
          state={dashboard}
          isEmpty={(view) => view.recentReports.length === 0}
          empty="No scout reports yet. Assign a scout from the Player Database and continue."
        >
          {(view) => (
            <>
              {recommendationsOrdered(view.recentReports).map((report) => (
                <article className="recommendation" key={`${report.playerId}-${report.generatedAt}`}>
                  <header>
                    <strong>
                      {report.playerName ? (
                        <button className="link" onClick={() => onSelectPlayer(report.playerId)}>
                          {report.playerName}
                        </button>
                      ) : (
                        "Unknown player"
                      )}
                    </strong>
                    <span className="subtle">
                      · report {reportAgeDays(report.generatedAt, referenceToday)} day(s) ago · confidence{" "}
                      <Badge tone={confidenceTone(report.confidence)}>{report.confidence.toLowerCase()}</Badge>
                      {report.scoutName ? ` · scout: ${report.scoutName}` : ""}
                    </span>
                  </header>
                  <div className="subtle">
                    {report.estimatedAbility ? `Est. ability ${rangeText(report.estimatedAbility)} · ` : "Ability unknown · "}
                    Potential {report.estimatedPotentialBand.toLowerCase()} · {report.observations} observations
                  </div>
                  <p>{report.recommendation}</p>
                  <ul className="report-list">
                    {report.strengths.map((strength) => (
                      <li key={strength}>Strength: {strength}</li>
                    ))}
                    {report.weaknesses.map((weakness) => (
                      <li key={weakness}>Weakness: {weakness}</li>
                    ))}
                  </ul>
                  {report.positionAssessment && <div className="subtle">Position: {report.positionAssessment}</div>}
                  {report.roleAssessment && <div className="subtle">Role: {report.roleAssessment}</div>}
                </article>
              ))}
              <button className="ghost" onClick={refreshDashboard}>
                Refresh
              </button>
            </>
          )}
        </AsyncPanel>
      </Panel>
    </section>
  );
};