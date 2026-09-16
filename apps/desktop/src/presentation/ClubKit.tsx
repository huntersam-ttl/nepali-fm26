import React from "react";
import type { ClubKitDesign } from "./clubVisualIdentity.js";

/**
 * The single canonical kit renderer — shirt, shorts, and socks as plain
 * SVG shapes. Reused everywhere a kit needs to appear (club profile, kit
 * previews, player portrait attire) rather than drawing a shirt more than
 * once. A structured pattern library, not freehand art.
 */

export type KitSize = "small" | "medium" | "large";

const SIZE_PX: Record<KitSize, { width: number; height: number }> = {
  small: { width: 36, height: 44 },
  medium: { width: 64, height: 78 },
  large: { width: 120, height: 146 },
};

const PATTERN_LABEL: Record<ClubKitDesign["pattern"], string> = {
  PLAIN: "plain",
  VERTICAL_STRIPES: "vertical stripes",
  HORIZONTAL_HOOPS: "horizontal hoops",
  SASH: "a sash",
  CENTRE_STRIPE: "a centre stripe",
  HALVES: "halves",
};

const PatternFill = ({ design, patternId }: { design: ClubKitDesign; patternId: string }): React.ReactElement => {
  switch (design.pattern) {
    case "VERTICAL_STRIPES":
      return (
        <pattern id={patternId} width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="10" height="10" fill={design.baseColour} />
          <rect x="0" width="5" height="10" fill={design.secondaryColour} />
        </pattern>
      );
    case "HORIZONTAL_HOOPS":
      return (
        <pattern id={patternId} width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="10" height="10" fill={design.baseColour} />
          <rect y="0" width="10" height="5" fill={design.secondaryColour} />
        </pattern>
      );
    default:
      return (
        <pattern id={patternId} width="1" height="1">
          <rect width="1" height="1" fill={design.baseColour} />
        </pattern>
      );
  }
};

/** Alt-text-carrying textual description — colour-independent, since a
 * screen reader (or a colour-blind player) must be able to tell kits apart
 * without relying on hue alone. */
export const kitDescription = (design: ClubKitDesign, label: string): string =>
  `${label} kit — ${design.pattern === "PLAIN" ? "plain" : PATTERN_LABEL[design.pattern] + ","} shirt with shorts and socks in the club's real colours.`;

export const ClubKit = ({
  design,
  size,
  label,
  className,
}: {
  design: ClubKitDesign;
  size: KitSize;
  /** Home / Away / Third — used to build the alt text. */
  label: string;
  className?: string;
}): React.ReactElement => {
  const { width, height } = SIZE_PX[size];
  const patternId = `kit-pattern-${design.slot}-${design.baseColour.replace("#", "")}`;
  const shirtFill =
    design.pattern === "PLAIN"
      ? design.baseColour
      : design.pattern === "SASH"
        ? design.baseColour
        : design.pattern === "CENTRE_STRIPE"
          ? design.baseColour
          : design.pattern === "HALVES"
            ? design.baseColour
            : `url(#${patternId})`;

  return (
    <svg
      viewBox="0 0 48 58"
      width={width}
      height={height}
      role="img"
      aria-label={kitDescription(design, label)}
      className={className ? `club-kit ${className}` : "club-kit"}
    >
      <defs>
        <PatternFill design={design} patternId={patternId} />
      </defs>
      {/* Shirt body */}
      <path
        d="M14 6 L20 2 L24 6 L28 2 L34 6 L40 12 L36 18 L32 16 L32 40 L16 40 L16 16 L12 18 L8 12 Z"
        fill={shirtFill}
      />
      {design.pattern === "HALVES" && <path d="M24 2 L24 40 L16 40 L16 16 L12 18 L8 12 L14 6 L20 2 Z" fill={design.secondaryColour} />}
      {design.pattern === "SASH" && <path d="M10 12 L38 34 L34 40 L8 16 Z" fill={design.secondaryColour} />}
      {design.pattern === "CENTRE_STRIPE" && <rect x="21" y="4" width="6" height="36" fill={design.secondaryColour} />}
      {/* Collar / trim */}
      <path d="M20 2 L24 6 L28 2 L26 6 L22 6 Z" fill={design.trimColour} />
      {/* Shorts */}
      <rect x="14" y="42" width="20" height="10" rx="1.5" fill={design.shortsColour} />
      {/* Socks */}
      <rect x="14" y="53" width="6" height="5" fill={design.socksColour} />
      <rect x="28" y="53" width="6" height="5" fill={design.socksColour} />
    </svg>
  );
};
