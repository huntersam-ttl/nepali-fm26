import React, { useCallback, useMemo, useState } from "react";
import type { FederationPresidentDashboard } from "@nepal-football-sim/shared-types";
import { buildFederationSceneProfile } from "./federationScenePresentation.js";
import { SceneCanvas, SceneErrorBoundary, type SceneHandle } from "./SceneCanvas.js";
import {
  effectiveMotion,
  prefersReducedMotion,
  qualitySettings,
  readScenePreferences,
  shouldRender3d,
} from "./scenePreferences.js";

/**
 * The President Dashboard hero: a state-driven 3D view of the federation's
 * actual headquarters and national football centre, with the same facts
 * stated in the DOM beside it. Mirrors ClubEnvironmentScene's structure and
 * guarantees (additive, text-parity, 2D fallback) for the federation world.
 *
 * Unlike the club scene (opened from a shared any-role/any-club panel),
 * this is only ever the President's own dashboard for their own federation
 * — so clicking a building can safely navigate straight to the matching
 * canonical screen via the President workspace's own onNavigate, no
 * per-entity reference plumbing required.
 */

const CAMERA_PRESETS = ["OVERVIEW", "HQ", "NATIONAL_CENTRE"] as const;
type CameraPresetName = (typeof CAMERA_PRESETS)[number];
const CAMERA_PRESET_LABEL: Record<CameraPresetName, string> = {
  OVERVIEW: "Overview",
  HQ: "Headquarters",
  NATIONAL_CENTRE: "National football centre",
};

export const FederationEnvironmentScene = ({
  dashboard,
  fallback,
  onOpenGovernance,
  onOpenNationalDevelopment,
}: {
  dashboard: FederationPresidentDashboard;
  /** The established 2D fallback, used whenever 3D cannot run. */
  fallback: React.ReactNode;
  /** Opens the real Governance screen — only ever a genuine destination. */
  onOpenGovernance?: () => void;
  /** Opens the real National Development screen. */
  onOpenNationalDevelopment?: () => void;
}): React.ReactElement => {
  const sceneProfile = useMemo(() => buildFederationSceneProfile(dashboard), [dashboard]);
  const preferences = useMemo(() => readScenePreferences(), []);
  const motion = useMemo(
    () => effectiveMotion(preferences.motion, prefersReducedMotion()),
    [preferences.motion],
  );
  const quality = useMemo(() => qualitySettings(preferences.quality), [preferences.quality]);
  const render3d = useMemo(() => shouldRender3d(preferences), [preferences]);

  const factory = useCallback(
    async (qualityInput: ReturnType<typeof qualitySettings>, motionInput: typeof motion): Promise<SceneHandle> => {
      const { buildFederationScene } = await import("./federationSceneBuilder.js");
      return buildFederationScene(sceneProfile, qualityInput, motionInput) as unknown as SceneHandle;
    },
    [sceneProfile],
  );

  const openBuilding = useCallback(
    (kind: string) => {
      if (kind === "HQ") onOpenGovernance?.();
      else if (kind === "NATIONAL_CENTRE") onOpenNationalDevelopment?.();
    },
    [onOpenGovernance, onOpenNationalDevelopment],
  );

  const [cameraPreset, setCameraPreset] = useState<CameraPresetName>("OVERVIEW");

  return (
    <section className="club-scene" aria-label={`${sceneProfile.federationName} federation environment`}>
      {render3d ? (
        <SceneErrorBoundary fallback={<div className="club-scene-fallback">{fallback}</div>}>
          <SceneCanvas
            factory={factory}
            quality={quality}
            motion={motion}
            ariaLabel={`${sceneProfile.federationName}: headquarters and national football centre`}
            onPick={openBuilding}
            fallback={<div className="club-scene-fallback">{fallback}</div>}
            focusTarget={cameraPreset}
          />
        </SceneErrorBoundary>
      ) : (
        <div className="club-scene-fallback">{fallback}</div>
      )}

      {render3d && (
        <div className="club-scene-cameras" role="group" aria-label="Camera view">
          {CAMERA_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={cameraPreset === preset ? "ghost small active" : "ghost small"}
              aria-pressed={cameraPreset === preset}
              onClick={() => setCameraPreset(preset)}
            >
              {CAMERA_PRESET_LABEL[preset]}
            </button>
          ))}
        </div>
      )}

      {/* Everything the scene depicts, in words. The canvas never carries
          information that is not also here. */}
      <div className="club-scene-readout">
        <h4>Federation environment</h4>
        <ul className="report-list">
          {sceneProfile.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="subtle">
          The view is generated from this federation&apos;s recorded development, project and reputation data.
          Federation colours shown are simulation-only accents, not a real federation kit or crest.
        </p>
        <div className="button-row">
          {onOpenGovernance && (
            <button className="ghost small" onClick={onOpenGovernance}>
              Open governance
            </button>
          )}
          {onOpenNationalDevelopment && (
            <button className="ghost small" onClick={onOpenNationalDevelopment}>
              Open national development
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
