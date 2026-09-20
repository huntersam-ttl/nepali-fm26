import React from "react";
import type { TrainingView } from "@nepal-football-sim/shared-types";
import { readiness, sessionDayLabel, weekSessions } from "./training.js";

/**
 * Phase 3B — weekly training planner (read-only, real plan sessions only).
 * A MON–SUN timetable built from the canonical plan; empty days stay empty.
 * Readiness summarizes real squad-development fatigue/match-sharpness.
 */
export const TrainingPlanner = ({ view }: { view: TrainingView }): React.ReactElement | null => {
  const week = weekSessions(view.plan.sessions);
  const load = readiness(view);
  return (
    <section className="training-planner" aria-label="Weekly training planner">
      <div className="button-row">
        <span className="page-eyebrow">{view.plan.name} · {view.plan.intensity} intensity</span>
      </div>
      <div className="training-week">
        {week.map(({ day, sessions }) => (
          <div className={`training-day${sessions.length === 0 ? " empty" : ""}`} key={day}>
            <h4 className="data-label">{sessionDayLabel(day)}</h4>
            {sessions.length === 0 ? (
              <p className="quiet-region">—</p>
            ) : (
              sessions.map((session, index) => (
                <div className="training-session" key={`${day}-${index}`}>
                  <span className="training-session-cat">{session.category}</span>
                  <span className="page-metadata">{session.intensity.toLowerCase()}</span>
                  {session.targetGroup && <span className="page-metadata"> · {session.targetGroup.toLowerCase()}</span>}
                </div>
              ))
            )}
          </div>
        ))}
      </div>
      {load && (
        <div className="stats-strip">
          <div><span className="data-label">Players</span><span className="stat-value">{load.count}</span></div>
          <div><span className="data-label">Avg fatigue</span><span className="stat-value">{load.averageFatigue}</span></div>
          <div><span className="data-label">Avg sharpness</span><span className="stat-value">{load.averageSharpness}</span></div>
        </div>
      )}
      {view.facility && (
        <p className="quiet-region">
          Training facility {view.facility.trainingQuality ?? "unknown"} · Academy {view.facility.youthQuality ?? "unknown"}
          {view.facility.medicalQuality !== undefined ? ` · Medical ${view.facility.medicalQuality}` : ""}
        </p>
      )}
    </section>
  );
};