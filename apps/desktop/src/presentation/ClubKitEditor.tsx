import React, { useState } from "react";
import { ClubKit } from "./ClubKit.js";
import type { ClubKitDesignFields } from "./clubVisualIdentity.js";
import type { KitPattern, KitSlot } from "./clubVisualIdentity.js";

/**
 * The single reusable kit editor — one component, three tabs (Home/Away/
 * Third), not three separate editors. Editing one slot never mutates the
 * others: each slot's fields live in the caller's own state, keyed by
 * slot, and this component only ever calls back with the one slot being
 * edited.
 *
 * Only fields the ClubKit SVG renderer actually differentiates visually
 * are exposed (base/secondary/trim/shorts/socks colour and pattern) —
 * collar, sleeve style, and shirt number colour are not yet rendered
 * distinctly, so no dropdown for them exists here (that would be a fake
 * choice that renders identically regardless of selection).
 */

const PATTERNS: readonly KitPattern[] = [
  "PLAIN",
  "VERTICAL_STRIPES",
  "HORIZONTAL_HOOPS",
  "SASH",
  "CENTRE_STRIPE",
  "HALVES",
];

const PATTERN_LABEL: Record<KitPattern, string> = {
  PLAIN: "Plain",
  VERTICAL_STRIPES: "Vertical stripes",
  HORIZONTAL_HOOPS: "Horizontal hoops",
  SASH: "Sash",
  CENTRE_STRIPE: "Centre stripe",
  HALVES: "Halves",
};

const SLOT_LABEL: Record<KitSlot, string> = { HOME: "Home", AWAY: "Away", THIRD: "Third" };

export const ClubKitEditor = ({
  kits,
  onChange,
}: {
  kits: Record<KitSlot, ClubKitDesignFields>;
  onChange: (slot: KitSlot, fields: ClubKitDesignFields) => void;
}): React.ReactElement => {
  const [activeSlot, setActiveSlot] = useState<KitSlot>("HOME");
  const active = kits[activeSlot];

  const setField = <K extends keyof ClubKitDesignFields>(field: K, value: ClubKitDesignFields[K]): void => {
    onChange(activeSlot, { ...active, [field]: value });
  };

  return (
    <div className="club-kit-editor">
      <div className="tab-row" role="tablist" aria-label="Kit slot">
        {(["HOME", "AWAY", "THIRD"] as const).map((slot) => (
          <button
            key={slot}
            type="button"
            role="tab"
            aria-selected={activeSlot === slot}
            className={activeSlot === slot ? "active" : ""}
            onClick={() => setActiveSlot(slot)}
          >
            {SLOT_LABEL[slot]}
          </button>
        ))}
      </div>
      <div className="club-identity-editor">
        <div className="club-identity-controls">
          <label>
            Base colour
            <input
              type="color"
              aria-label={`${SLOT_LABEL[activeSlot]} kit base colour`}
              value={active.baseColour}
              onChange={(event) => setField("baseColour", event.target.value)}
            />
            <span className="subtle">{active.baseColour}</span>
          </label>
          <label>
            Secondary colour
            <input
              type="color"
              aria-label={`${SLOT_LABEL[activeSlot]} kit secondary colour`}
              value={active.secondaryColour}
              onChange={(event) => setField("secondaryColour", event.target.value)}
            />
            <span className="subtle">{active.secondaryColour}</span>
          </label>
          <label>
            Trim colour
            <input
              type="color"
              aria-label={`${SLOT_LABEL[activeSlot]} kit trim colour`}
              value={active.trimColour}
              onChange={(event) => setField("trimColour", event.target.value)}
            />
            <span className="subtle">{active.trimColour}</span>
          </label>
          <label>
            Pattern
            <select
              aria-label={`${SLOT_LABEL[activeSlot]} kit pattern`}
              value={active.pattern}
              onChange={(event) => setField("pattern", event.target.value as KitPattern)}
            >
              {PATTERNS.map((pattern) => (
                <option key={pattern} value={pattern}>
                  {PATTERN_LABEL[pattern]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Shorts colour
            <input
              type="color"
              aria-label={`${SLOT_LABEL[activeSlot]} shorts colour`}
              value={active.shortsColour}
              onChange={(event) => setField("shortsColour", event.target.value)}
            />
            <span className="subtle">{active.shortsColour}</span>
          </label>
          <label>
            Socks colour
            <input
              type="color"
              aria-label={`${SLOT_LABEL[activeSlot]} socks colour`}
              value={active.socksColour}
              onChange={(event) => setField("socksColour", event.target.value)}
            />
            <span className="subtle">{active.socksColour}</span>
          </label>
        </div>
        <div className="club-identity-preview">
          <ClubKit
            design={{ slot: activeSlot, ...active, provenanceStatus: "SIMULATION_ONLY" }}
            size="large"
            label={SLOT_LABEL[activeSlot]}
          />
        </div>
      </div>
    </div>
  );
};
