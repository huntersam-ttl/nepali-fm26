import React, { useState } from "react";
import {
  prefersReducedMotion,
  readScenePreferences,
  supportsWebgl,
  writeScenePreferences,
  type SceneMotion,
  type SceneQuality,
  type ScenePreferences,
} from "./scenePreferences.js";

/**
 * Graphics and animation preferences for the 3D presentation layer.
 *
 * These deliberately sit outside the football save: they describe this
 * machine, not the world. Changing them never alters simulation state, and a
 * save made on a high-end machine opens correctly on a low-end one.
 */

const QUALITY_OPTIONS: Array<{ value: SceneQuality; label: string; detail: string }> = [
  { value: "LOW", label: "Low", detail: "No shadows or extra scenery. Best on modest hardware." },
  { value: "MEDIUM", label: "Medium", detail: "Balanced detail. The default." },
  { value: "HIGH", label: "High", detail: "Shadows and fuller scenery. Needs a capable GPU." },
];

const MOTION_OPTIONS: Array<{ value: SceneMotion; label: string; detail: string }> = [
  { value: "FULL", label: "Full", detail: "Gentle camera movement and ambient motion." },
  { value: "REDUCED", label: "Reduced", detail: "No camera movement; only small on-site motion." },
  { value: "OFF", label: "Off", detail: "Completely still scenes." },
];

export const PresentationSettingsPanel = ({ onClose }: { onClose: () => void }): React.ReactElement => {
  const [preferences, setPreferences] = useState<ScenePreferences>(() => readScenePreferences());
  const systemReducedMotion = prefersReducedMotion();
  const webgl = supportsWebgl();

  const apply = (next: ScenePreferences): void => {
    setPreferences(next);
    writeScenePreferences(next);
  };

  return (
    <section className="career-panel" role="dialog" aria-label="Presentation settings">
      <div className="panel-head">
        <h2>Presentation</h2>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>

        {!webgl && (
          <p className="warning" role="status">
            3D scenes are unavailable on this machine, so the game is using its 2D club views. Everything remains
            fully playable.
          </p>
        )}

        <fieldset className="settings-group">
          <legend>3D scenes</legend>
          <label>
            <input
              type="checkbox"
              checked={preferences.enabled3d}
              onChange={(event) => apply({ ...preferences, enabled3d: event.target.checked })}
            />{" "}
            Show 3D club and stadium views
          </label>
          <p className="subtle">Turning this off uses the 2D views everywhere. No gameplay is affected either way.</p>
        </fieldset>

        <fieldset className="settings-group">
          <legend>Graphics quality</legend>
          {QUALITY_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="scene-quality"
                value={option.value}
                checked={preferences.quality === option.value}
                disabled={!preferences.enabled3d}
                onChange={() => apply({ ...preferences, quality: option.value })}
              />{" "}
              {option.label} <span className="subtle">— {option.detail}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="settings-group">
          <legend>Animation</legend>
          {MOTION_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="scene-motion"
                value={option.value}
                checked={preferences.motion === option.value}
                onChange={() => apply({ ...preferences, motion: option.value })}
              />{" "}
              {option.label} <span className="subtle">— {option.detail}</span>
            </label>
          ))}
          {systemReducedMotion && (
            <p className="subtle">
              Your system asks for reduced motion, so motion stays reduced even on the Full setting.
            </p>
          )}
        </fieldset>

      <p className="subtle">These settings apply to this machine only and are never stored in a career save.</p>
    </section>
  );
};
