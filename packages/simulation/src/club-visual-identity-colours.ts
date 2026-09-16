/**
 * Server-side mirror of the deterministic colour half of
 * apps/desktop/src/presentation/clubVisualIdentity.ts's buildClubColours —
 * duplicated intentionally rather than imported, since apps/desktop is a
 * browser bundle and packages/simulation is a Node package with no shared
 * "pure presentation logic" package between them (the same
 * independently-reimplemented-hash pattern already exists across
 * clubScenePresentation.ts/meetingSceneBuilder.ts/
 * federationScenePresentation.ts in the desktop app). Both copies must stay
 * numerically identical: this exists so getClubVisualIdentity can report
 * the exact same SIMULATION_ONLY fallback colours the client would
 * otherwise compute on its own, for a club with no saved override.
 */

const stableSeed = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
};

const HUES = [4, 24, 44, 84, 140, 168, 200, 220, 260, 290, 320, 350];

const hslHex = (hue: number, saturation: number, lightness: number): string => {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  const toHex = (channel: number): string =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export const deterministicClubColours = (
  clubId: string,
): { primaryColour: string; secondaryColour: string; accentColour: string } => {
  const seed = stableSeed(clubId);
  const primaryHue = HUES[seed % HUES.length]!;
  const secondaryHue = (primaryHue + 150 + (seed % 60)) % 360;
  const accentHue = (primaryHue + 30 + (seed % 20)) % 360;
  return {
    primaryColour: hslHex(primaryHue, 55, 32),
    secondaryColour: hslHex(secondaryHue, 20, 92),
    accentColour: hslHex(accentHue, 70, 55),
  };
};

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

export const isValidHexColour = (value: string): boolean => HEX_COLOUR.test(value);

/** Mirrors apps/desktop/src/presentation/clubVisualIdentity.ts's BadgeShape/
 * BadgeSymbol value sets — the server only needs the valid-value lists to
 * validate a save, not the renderer itself. */
export const BADGE_SHAPES = ["SHIELD", "ROUND", "DIAMOND", "OVAL", "MODERN", "CREST"] as const;
export const BADGE_SYMBOLS = ["FOOTBALL", "MOUNTAIN", "STAR", "STRIPES", "MONOGRAM", "GEOMETRIC"] as const;

/** Mirrors apps/desktop/src/presentation/clubVisualIdentity.ts's KitPattern
 * value set — only patterns the SVG kit renderer actually differentiates
 * visually. */
export const KIT_PATTERNS = [
  "PLAIN",
  "VERTICAL_STRIPES",
  "HORIZONTAL_HOOPS",
  "SASH",
  "CENTRE_STRIPE",
  "HALVES",
] as const;

export type DeterministicKitFields = {
  baseColour: string;
  secondaryColour: string;
  trimColour: string;
  pattern: (typeof KIT_PATTERNS)[number];
  shortsColour: string;
  socksColour: string;
};

const pick = <T,>(options: readonly T[], seed: number, salt: number): T => options[(seed + salt) % options.length] as T;

/**
 * Server-side mirror of clubVisualIdentity.ts's private kitDesignFor —
 * needed so a club's kit history can be snapshotted with its real,
 * structured fallback kit design (not just colours) for a club that has
 * never saved a custom kit override for a given slot. Must stay
 * numerically identical to the client copy: same seed, same salts, same
 * per-slot field mapping.
 */
export const deterministicClubKits = (
  clubId: string,
  colours: { primaryColour: string; secondaryColour: string; accentColour: string },
): { home: DeterministicKitFields; away: DeterministicKitFields; third: DeterministicKitFields } => {
  const seed = stableSeed(clubId);
  return {
    home: {
      baseColour: colours.primaryColour,
      secondaryColour: colours.secondaryColour,
      trimColour: colours.secondaryColour,
      pattern: pick(KIT_PATTERNS, seed, 1),
      shortsColour: colours.primaryColour,
      socksColour: colours.primaryColour,
    },
    away: {
      baseColour: colours.secondaryColour,
      secondaryColour: colours.primaryColour,
      trimColour: colours.primaryColour,
      pattern: pick(KIT_PATTERNS, seed, 2),
      shortsColour: colours.secondaryColour,
      socksColour: colours.secondaryColour,
    },
    third: {
      baseColour: colours.accentColour,
      secondaryColour: colours.primaryColour,
      trimColour: colours.secondaryColour,
      pattern: pick(KIT_PATTERNS, seed, 4),
      shortsColour: "#16181d",
      socksColour: colours.accentColour,
    },
  };
};
