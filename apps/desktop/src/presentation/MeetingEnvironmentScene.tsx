import React, { useCallback, useMemo, useState } from "react";
import { buildMeetingSceneProfile, type MeetingContext, type MeetingImportance } from "./meetingScenePresentation.js";
import type { FacilityVisualTier } from "./clubScenePresentation.js";
import { SceneCanvas, SceneErrorBoundary, type SceneHandle } from "./SceneCanvas.js";
import {
  effectiveMotion,
  prefersReducedMotion,
  qualitySettings,
  readScenePreferences,
  shouldRender3d,
} from "./scenePreferences.js";

/**
 * A reusable off-pitch decision-room presentation: a boardroom, negotiation
 * room or press room, framed around whatever canonical DOM controls the
 * caller renders beside/below it. The scene never carries information or
 * actions the DOM does not also carry — it is context only, exactly like
 * ClubEnvironmentScene/FederationEnvironmentScene.
 */

const CAMERA_PRESETS = ["ROOM", "TABLE"] as const;
type CameraPresetName = (typeof CAMERA_PRESETS)[number];
const CAMERA_PRESET_LABEL: Record<CameraPresetName, string> = {
  ROOM: "Room",
  TABLE: "Table",
};

export const MeetingEnvironmentScene = ({
  context,
  environmentTier,
  importance,
  organisationId,
  organisationName,
  fallback,
}: {
  context: MeetingContext;
  environmentTier: FacilityVisualTier;
  importance: MeetingImportance;
  organisationId: string;
  organisationName: string;
  /** Rendered instead of the canvas whenever 3D cannot or should not run —
   * typically nothing at all, since this scene is always additive to
   * existing canonical controls. */
  fallback: React.ReactNode;
}): React.ReactElement => {
  const sceneProfile = useMemo(
    () => buildMeetingSceneProfile({ context, environmentTier, importance, organisationId, organisationName }),
    [context, environmentTier, importance, organisationId, organisationName],
  );
  const preferences = useMemo(() => readScenePreferences(), []);
  const motion = useMemo(
    () => effectiveMotion(preferences.motion, prefersReducedMotion()),
    [preferences.motion],
  );
  const quality = useMemo(() => qualitySettings(preferences.quality), [preferences.quality]);
  const render3d = useMemo(() => shouldRender3d(preferences), [preferences]);

  const factory = useCallback(
    async (qualityInput: ReturnType<typeof qualitySettings>, motionInput: typeof motion): Promise<SceneHandle> => {
      const { buildMeetingScene } = await import("./meetingSceneBuilder.js");
      return buildMeetingScene(sceneProfile, qualityInput, motionInput) as unknown as SceneHandle;
    },
    [sceneProfile],
  );

  const [cameraPreset, setCameraPreset] = useState<CameraPresetName>("ROOM");

  if (!render3d) return <>{fallback}</>;

  return (
    <section className="club-scene" aria-label={`${sceneProfile.organisationName} ${sceneProfile.context.toLowerCase()}`}>
      <SceneErrorBoundary fallback={<>{fallback}</>}>
        <SceneCanvas
          factory={factory}
          quality={quality}
          motion={motion}
          ariaLabel={sceneProfile.summary.join(". ")}
          fallback={<>{fallback}</>}
          focusTarget={cameraPreset}
          className="meeting-scene-canvas"
        />
      </SceneErrorBoundary>

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

      {/* Text parity: everything the scene depicts is also stated here —
          the canvas (role="img") is never the sole information surface. */}
      <p className="subtle">{sceneProfile.summary.join(" · ")}</p>
    </section>
  );
};
