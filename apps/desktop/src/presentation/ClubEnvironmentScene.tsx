import React, { useCallback, useMemo } from "react";
import type { ClubProfile, EntityReference } from "@nepal-football-sim/shared-types";
import { buildClubSceneProfile, facilityTierLabel, type SceneBuilding } from "./clubScenePresentation.js";
import { SceneCanvas, SceneErrorBoundary, type SceneHandle } from "./SceneCanvas.js";
import {
  effectiveMotion,
  prefersReducedMotion,
  qualitySettings,
  readScenePreferences,
  shouldRender3d,
} from "./scenePreferences.js";

/**
 * The Club Profile hero: a state-driven 3D view of the club's actual ground
 * and campus, with the same facts stated in the DOM beside it.
 *
 * The scene is additive. Every destination reachable by clicking a building
 * is also a real, labelled button underneath, so nothing here is required to
 * play — and when 3D is off, unsupported, or broken, the existing 2D club
 * visual takes its place unchanged.
 */

const BUILDING_LABEL: Record<SceneBuilding["kind"], string> = {
  STADIUM: "Stadium",
  TRAINING: "Training ground",
  ACADEMY: "Academy",
  MEDICAL: "Medical centre",
  OFFICES: "Club offices",
};

export const ClubEnvironmentScene = ({
  profile,
  fallback,
  onOpenReference,
}: {
  profile: ClubProfile;
  /** The established 2D club visual, used whenever 3D cannot run. */
  fallback: React.ReactNode;
  /** Opens a real canonical destination (an in-progress project, say). */
  onOpenReference?: (reference: EntityReference) => void;
}): React.ReactElement => {
  const sceneProfile = useMemo(() => buildClubSceneProfile(profile), [profile]);
  const preferences = useMemo(() => readScenePreferences(), []);
  const motion = useMemo(
    () => effectiveMotion(preferences.motion, prefersReducedMotion()),
    [preferences.motion],
  );
  const quality = useMemo(() => qualitySettings(preferences.quality), [preferences.quality]);
  const render3d = useMemo(() => shouldRender3d(preferences), [preferences]);

  const factory = useCallback(
    async (qualityInput: ReturnType<typeof qualitySettings>, motionInput: typeof motion): Promise<SceneHandle> => {
      const { buildClubScene } = await import("./clubSceneBuilder.js");
      return buildClubScene(sceneProfile, qualityInput, motionInput) as unknown as SceneHandle;
    },
    [sceneProfile],
  );

  /** Clicking a building opens the same destination its DOM button does —
   * only ever a real project reference that genuinely exists. */
  const openBuilding = useCallback(
    (kind: string) => {
      const building = sceneProfile.buildings.find((entry) => entry.kind === kind);
      const reference = building?.project?.reference;
      if (reference?.visible) onOpenReference?.(reference);
    },
    [sceneProfile, onOpenReference],
  );

  const clickableProjects = sceneProfile.buildings.filter((building) => building.project?.reference.visible);

  return (
    <section className="club-scene" aria-label={`${sceneProfile.clubName} club environment`}>
      {render3d ? (
        <SceneErrorBoundary fallback={<div className="club-scene-fallback">{fallback}</div>}>
          <SceneCanvas
            factory={factory}
            quality={quality}
            motion={motion}
            ariaLabel={`${sceneProfile.clubName}: ${sceneProfile.stadium.label}`}
            onPick={openBuilding}
            fallback={<div className="club-scene-fallback">{fallback}</div>}
          />
        </SceneErrorBoundary>
      ) : (
        <div className="club-scene-fallback">{fallback}</div>
      )}

      {/* Everything the scene depicts, in words. The canvas never carries
          information that is not also here. */}
      <div className="club-scene-readout">
        <h4>Club environment</h4>
        <ul className="report-list">
          {sceneProfile.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {sceneProfile.stadium.provisionalVenue && (
          <p className="subtle">
            This is the nearest known venue on record, not a confirmed home ground — the view reflects that
            uncertainty rather than claiming ownership.
          </p>
        )}
        <p className="subtle">
          The view is generated from this club&apos;s recorded stadium, facility and reputation data. Club colours
          shown are simulation-only accents, not the club&apos;s real kit colours.
        </p>
        {clickableProjects.length > 0 && onOpenReference && (
          <div className="button-row">
            {clickableProjects.map((building) => (
              <button
                key={building.kind}
                className="ghost small"
                onClick={() => onOpenReference(building.project!.reference)}
              >
                {`Open ${BUILDING_LABEL[building.kind].toLowerCase()} project`}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export { facilityTierLabel };
