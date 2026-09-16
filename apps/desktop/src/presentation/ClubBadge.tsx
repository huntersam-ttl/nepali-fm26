import React from "react";
import type { ClubBadgeDesign } from "./clubVisualIdentity.js";

/**
 * The single canonical club-badge renderer — plain SVG, deterministic, no
 * external logo assets. Original, generic geometry only (never a copied
 * real club mark): a handful of shape outlines and a small symbol library
 * built from basic paths.
 */

export type BadgeSize = "small" | "medium" | "large";

const SIZE_PX: Record<BadgeSize, number> = { small: 24, medium: 48, large: 96 };

const shapeClipPath = (shape: ClubBadgeDesign["shape"]): string => {
  switch (shape) {
    case "ROUND":
      return "circle(46% at 50% 50%)";
    case "DIAMOND":
      return "polygon(50% 2%, 98% 50%, 50% 98%, 2% 50%)";
    case "OVAL":
      return "ellipse(42% 48% at 50% 50%)";
    case "MODERN":
      return "polygon(50% 2%, 92% 22%, 92% 78%, 50% 98%, 8% 78%, 8% 22%)";
    case "CREST":
      return "polygon(50% 2%, 90% 15%, 90% 55%, 50% 98%, 10% 55%, 10% 15%)";
    case "SHIELD":
    default:
      return "polygon(4% 6%, 96% 6%, 96% 55%, 50% 98%, 4% 55%)";
  }
};

const SymbolMark = ({ symbol, colour }: { symbol: ClubBadgeDesign["symbol"]; colour: string }): React.ReactElement => {
  switch (symbol) {
    case "STAR":
      return <path d="M32 12 L37 26 L52 26 L40 35 L44 50 L32 41 L20 50 L24 35 L12 26 L27 26 Z" fill={colour} />;
    case "MOUNTAIN":
      return <path d="M8 46 L24 20 L34 34 L42 22 L56 46 Z" fill={colour} />;
    case "STRIPES":
      return (
        <>
          <rect x="14" y="14" width="8" height="36" fill={colour} />
          <rect x="28" y="14" width="8" height="36" fill={colour} />
          <rect x="42" y="14" width="8" height="36" fill={colour} />
        </>
      );
    case "GEOMETRIC":
      return <polygon points="32,12 52,32 32,52 12,32" fill={colour} />;
    case "FOOTBALL":
      return (
        <>
          <circle cx="32" cy="32" r="16" fill="none" stroke={colour} strokeWidth="3" />
          <polygon points="32,22 40,28 37,37 27,37 24,28" fill={colour} />
        </>
      );
    case "MONOGRAM":
    default:
      return <></>;
  }
};

export const ClubBadge = ({
  design,
  size,
  clubName,
  className,
}: {
  design: ClubBadgeDesign;
  size: BadgeSize;
  /** Used only for the alt/aria text; omit when a surrounding heading
   * already names the club, to avoid redundant repetition. */
  clubName?: string;
  className?: string;
}): React.ReactElement => {
  const px = SIZE_PX[size];
  const label = clubName ? `${clubName} badge` : "Club badge";
  const showMonogramOrInitials = design.symbol === "MONOGRAM" || size === "small";

  return (
    <svg
      viewBox="0 0 64 64"
      width={px}
      height={px}
      role="img"
      aria-label={label}
      className={className ? `club-badge ${className}` : "club-badge"}
    >
      <g style={{ clipPath: shapeClipPath(design.shape) }}>
        <rect x="0" y="0" width="64" height="64" fill={design.primaryColour} />
        <rect x="0" y="32" width="64" height="32" fill={design.secondaryColour} opacity="0.35" />
        {!showMonogramOrInitials && <SymbolMark symbol={design.symbol} colour={design.accentColour} />}
      </g>
      <g style={{ clipPath: shapeClipPath(design.shape) }} fill="none" stroke={design.accentColour} strokeWidth="2">
        <rect x="1" y="1" width="62" height="62" />
      </g>
      {showMonogramOrInitials && (
        <text
          x="32"
          y="40"
          textAnchor="middle"
          fontSize={size === "small" ? 22 : 18}
          fontWeight={700}
          fill={design.secondaryColour}
        >
          {design.initials}
        </text>
      )}
    </svg>
  );
};
