import React from "react";
import type { PersonRole, PersonVisualIdentity } from "./personVisualIdentity.js";

/**
 * The single canonical portrait renderer — plain SVG/CSS, deterministic,
 * cheap (no WebGL, no Three.js, no per-frame work). Every profile/list
 * surface that shows a person's identity should render through this one
 * component rather than inventing a second portrait system. Deliberately
 * simple, stylised geometry — not an attempt at photoreal likeness, and
 * never a claim to depict a real person's actual appearance (see
 * personVisualIdentity.ts's fairness note).
 */

export type PortraitSize = "small" | "medium" | "large";

const SIZE_PX: Record<PortraitSize, number> = { small: 28, medium: 64, large: 128 };

/** Attire colour by role. Player attire uses the club's real kit colours
 * when supplied; every other role reads its own fixed, role-appropriate
 * palette (business attire for owners/executives, a neutral institutional
 * tone for federation presidents, a club-accented tracksuit for managers/
 * staff) rather than inventing per-person clothing. */
const roleAttireColour = (role: PersonRole, clubPrimaryColour?: string): string => {
  switch (role) {
    case "PLAYER":
      return clubPrimaryColour ?? "#3a4a7a";
    case "MANAGER":
    case "STAFF":
      return clubPrimaryColour ?? "#2b2f38";
    case "OWNER":
    case "EXECUTIVE":
      return "#1f2430";
    case "PRESIDENT":
      return "#3a2f1f";
    default:
      return "#2b2f38";
  }
};

const FACE_SHAPE_RADII: Record<PersonVisualIdentity["faceShape"], { rx: number; ry: number }> = {
  OVAL: { rx: 17, ry: 21 },
  ROUND: { rx: 19, ry: 19 },
  SQUARE: { rx: 18, ry: 18 },
  LONG: { rx: 15, ry: 23 },
};

export const PersonPortrait = ({
  identity,
  role,
  size,
  clubPrimaryColour,
  clubSecondaryColour,
  name,
  decorative,
  className,
}: {
  identity: PersonVisualIdentity;
  role: PersonRole;
  size: PortraitSize;
  /** The person's real club/organisation colour, when one exists — never
   * fabricated here; pass undefined and the role's own neutral default is
   * used instead. */
  clubPrimaryColour?: string;
  /** A second real club colour shown as a small collar/trim detail on
   * PLAYER attire only — every other role keeps its single-tone attire
   * unchanged. Never fabricated: pass undefined (e.g. no resolved club
   * identity in scope) and no trim renders at all, same as
   * `clubPrimaryColour`. */
  clubSecondaryColour?: string;
  /** Used only to build the alt/aria text; the surrounding heading may
   * already name the person, in which case pass undefined to avoid
   * redundant repetition (see PersonPortrait's accessibility contract). */
  name?: string;
  /** True in a list row where adjacent text already names the person —
   * hides the portrait from assistive tech entirely (`aria-hidden`, no
   * `role="img"`/`aria-label`) instead of a screen reader announcing the
   * same name twice back to back. Use on standalone profile/header
   * portraits only when nothing nearby already names the person. */
  decorative?: boolean;
  className?: string;
}): React.ReactElement => {
  const px = SIZE_PX[size];
  const { rx, ry } = FACE_SHAPE_RADII[identity.faceShape];
  const attire = roleAttireColour(role, clubPrimaryColour);
  const showFacialHair = identity.facialHairStyle !== "NONE" && identity.ageBand !== "YOUTH";
  const label = name ? `${name} portrait` : "Portrait";
  const accessibleProps = decorative
    ? { "aria-hidden": true as const }
    : { role: "img" as const, "aria-label": label };

  return (
    <svg
      viewBox="0 0 64 64"
      width={px}
      height={px}
      {...accessibleProps}
      className={className ? `person-portrait ${className}` : "person-portrait"}
    >
      <circle cx="32" cy="32" r="31" className="person-portrait-ring" />
      {/* Shoulders / attire */}
      <path d="M 8 64 Q 32 40 56 64 Z" fill={attire} />
      {/* A small collar/trim detail in the club's secondary colour —
          player attire only, deliberately just one extra shape rather than
          the full ClubKit renderer. */}
      {role === "PLAYER" && clubSecondaryColour && (
        <path d="M 24 42 Q 32 48 40 42 L 37 52 Q 32 54 27 52 Z" fill={clubSecondaryColour} />
      )}
      {/* Neck */}
      <rect x="27" y="38" width="10" height="10" fill={identity.skinTone} />
      {/* Face */}
      <ellipse cx="32" cy="28" rx={rx} ry={ry} fill={identity.skinTone} />
      {/* Hair */}
      {identity.hairStyle !== "BALD" && identity.hairStyle !== "SHAVED" && (
        <path
          d={
            identity.hairStyle === "LONG"
              ? "M 12 20 Q 32 -2 52 20 L 52 42 Q 44 24 32 24 Q 20 24 12 42 Z"
              : identity.hairStyle === "MEDIUM"
                ? "M 13 22 Q 32 2 51 22 L 50 30 Q 32 16 14 30 Z"
                : "M 15 20 Q 32 6 49 20 L 48 26 Q 32 16 16 26 Z"
          }
          fill={identity.hairColour}
        />
      )}
      {identity.hairStyle === "SHAVED" && (
        <path d="M 15 20 Q 32 12 49 20 L 48 23 Q 32 17 16 23 Z" fill={identity.hairColour} opacity={0.5} />
      )}
      {/* Eyes */}
      <circle cx="25" cy="29" r="1.6" fill="#1a1a1a" />
      <circle cx="39" cy="29" r="1.6" fill="#1a1a1a" />
      {/* Facial hair */}
      {showFacialHair && (
        <path
          d={
            identity.facialHairStyle === "FULL_BEARD"
              ? "M 18 30 Q 18 46 32 46 Q 46 46 46 30 L 44 38 Q 32 44 20 38 Z"
              : identity.facialHairStyle === "BEARD"
                ? "M 20 33 Q 20 44 32 45 Q 44 44 44 33 L 42 40 Q 32 43 22 40 Z"
                : identity.facialHairStyle === "MOUSTACHE"
                  ? "M 26 34 Q 32 37 38 34 L 37 36 Q 32 38 27 36 Z"
                  : "M 22 34 L 42 34 L 42 36 L 22 36 Z"
          }
          fill={identity.hairColour}
        />
      )}
    </svg>
  );
};
