import React, { useEffect, useState } from "react";
import type { EntityId, MatchViewMode } from "@nepal-football-sim/shared-types";
import { PreMatchPanel } from "./PreMatchPanel.js";
import { LiveMatchScreen } from "./LiveMatchScreen.js";
import { PostMatchReportScreen } from "./PostMatchReportScreen.js";
import { useMatchController } from "./useMatchController.js";

type Stage = "PRE_MATCH" | "LIVE" | "REPORT";

/**
 * Owns the matchday flow for one fixture: pre-match, the live match, and the
 * report. All match state lives in the controller, which talks to the runtime.
 */
export const MatchdayScreen = ({
  fixtureId,
  resume,
  onExit,
  onMatchComplete,
}: {
  fixtureId: EntityId;
  /** True when re-entering a match that is already in progress. */
  resume?: boolean;
  onExit: () => void;
  onMatchComplete: () => void;
}): React.ReactElement => {
  const controller = useMatchController(fixtureId);
  const [stage, setStage] = useState<Stage>(resume ? "LIVE" : "PRE_MATCH");

  // Re-entering a live match restores it from the persisted session.
  useEffect(() => {
    if (!resume) return;
    void controller.resume().then((view) => {
      if (view?.period === "FULL_TIME") setStage("REPORT");
    });
    // Intentionally keyed on the fixture only: resuming is a mount-time action.
  }, [fixtureId, resume]);

  const kickOff = async (viewMode: MatchViewMode): Promise<void> => {
    const view = await controller.start(viewMode);
    if (!view) return;
    if (viewMode === "QUICK_SIM") {
      // Quick Sim goes straight from kick-off to the report.
      const finished = await controller.quickSimRest();
      if (finished) {
        onMatchComplete();
        setStage("REPORT");
      }
      return;
    }
    setStage("LIVE");
  };

  // A match that reaches full time has been finalised by the runtime.
  useEffect(() => {
    if (controller.state.finished) onMatchComplete();
    // Fires once when the match reaches full time.
  }, [controller.state.finished]);

  if (stage === "PRE_MATCH") {
    return (
      <PreMatchPanel
        fixtureId={fixtureId}
        busy={controller.state.busy}
        onKickOff={(viewMode) => void kickOff(viewMode)}
        onBack={onExit}
      />
    );
  }

  if (stage === "REPORT") {
    return <PostMatchReportScreen fixtureId={fixtureId} onReturn={onExit} />;
  }

  return (
    <LiveMatchScreen
      controller={controller}
      onViewReport={() => setStage("REPORT")}
      onLeave={onExit}
    />
  );
};
