/**
 * Deterministic, persistent visual identity for a club — colours, badge
 * design, and home/away/third kit designs. Same pattern as
 * personVisualIdentity.ts and the existing club-scene accentHue: a pure
 * function of the club's own real id (and name, for the badge's initials),
 * so every club — including every legacy save with no visual-identity data
 * at all — resolves a stable identity with no migration and no risk of
 * randomizing on reload.
 *
 * This is an unedited, deterministic DEFAULT identity, not yet a
 * player-editable one: there is no badge/kit creator UI and no persisted
 * override in this pass (see docs/game-design/VISUAL_IDENTITY.md for the
 * honest list of what remains). A future editable layer can store a real
 * override record and fall back to this generator whenever one doesn't
 * exist — the generator itself doesn't need to change for that.
 *
 * Provenance: every design produced here is SIMULATION_ONLY. This project
 * holds no licensed real club branding, so no output of this module may
 * ever be presented as verified real-world colours, crest, or kit design.
 */

export type BadgeShape = "SHIELD" | "ROUND" | "DIAMOND" | "OVAL" | "MODERN" | "CREST";
export type BadgeSymbol = "FOOTBALL" | "MOUNTAIN" | "STAR" | "STRIPES" | "MONOGRAM" | "GEOMETRIC";
export type KitPattern =
  | "PLAIN"
  | "VERTICAL_STRIPES"
  | "HORIZONTAL_HOOPS"
  | "SASH"
  | "CENTRE_STRIPE"
  | "HALVES";
export type KitSlot = "HOME" | "AWAY" | "THIRD";

export type ClubColours = {
  primaryColour: string;
  secondaryColour: string;
  accentColour: string;
};

export type ClubBadgeDesign = ClubColours & {
  shape: BadgeShape;
  symbol: BadgeSymbol;
  initials: string;
  provenanceStatus: "SIMULATION_ONLY";
};

export type ClubKitDesign = {
  slot: KitSlot;
  baseColour: string;
  secondaryColour: string;
  trimColour: string;
  pattern: KitPattern;
  shortsColour: string;
  socksColour: string;
  provenanceStatus: "SIMULATION_ONLY";
};

export type ClubVisualIdentity = ClubColours & {
  badge: ClubBadgeDesign;
  home: ClubKitDesign;
  away: ClubKitDesign;
  third: ClubKitDesign;
};

const stableSeed = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
};

const pick = <T,>(options: readonly T[], seed: number, salt: number): T =>
  options[(seed + salt) % options.length] as T;

/** A fixed, hand-picked hue/saturation/lightness palette — never an
 * arbitrary random RGB triple, so every generated colour reads as a
 * plausible kit/badge colour rather than mud. */
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

const initialsFor = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "FC";

const BADGE_SHAPES: BadgeShape[] = ["SHIELD", "ROUND", "DIAMOND", "OVAL", "MODERN", "CREST"];
const BADGE_SYMBOLS: BadgeSymbol[] = ["FOOTBALL", "MOUNTAIN", "STAR", "STRIPES", "MONOGRAM", "GEOMETRIC"];
const KIT_PATTERNS: KitPattern[] = [
  "PLAIN",
  "VERTICAL_STRIPES",
  "HORIZONTAL_HOOPS",
  "SASH",
  "CENTRE_STRIPE",
  "HALVES",
];

/** The club's own real primary/secondary/accent colours — a deterministic
 * hue triple with real contrast between the three (120°/240° apart), never
 * three near-identical shades. */
export const buildClubColours = (clubId: string): ClubColours => {
  const seed = stableSeed(clubId);
  const primaryHue = pick(HUES, seed, 0);
  const secondaryHue = (primaryHue + 150 + (seed % 60)) % 360;
  const accentHue = (primaryHue + 30 + (seed % 20)) % 360;
  return {
    primaryColour: hslHex(primaryHue, 55, 32),
    secondaryColour: hslHex(secondaryHue, 20, 92),
    accentColour: hslHex(accentHue, 70, 55),
  };
};

export const buildClubBadgeDesign = (clubId: string, clubName: string): ClubBadgeDesign => {
  const seed = stableSeed(clubId);
  const colours = buildClubColours(clubId);
  return {
    ...colours,
    shape: pick(BADGE_SHAPES, seed, 5),
    symbol: pick(BADGE_SYMBOLS, seed, 9),
    initials: initialsFor(clubName),
    provenanceStatus: "SIMULATION_ONLY",
  };
};

const kitDesignFor = (clubId: string, slot: KitSlot, colours: ClubColours, seed: number): ClubKitDesign => {
  // Home wears the club's own primary/secondary; away swaps the roles and
  // shifts pattern so it never reads as a re-tinted home shirt; third
  // leans on the accent colour with a distinct pattern again — three
  // genuinely different combinations, not fee cosmetic variants.
  if (slot === "HOME") {
    return {
      slot,
      baseColour: colours.primaryColour,
      secondaryColour: colours.secondaryColour,
      trimColour: colours.secondaryColour,
      pattern: pick(KIT_PATTERNS, seed, 1),
      shortsColour: colours.primaryColour,
      socksColour: colours.primaryColour,
      provenanceStatus: "SIMULATION_ONLY",
    };
  }
  if (slot === "AWAY") {
    return {
      slot,
      baseColour: colours.secondaryColour,
      secondaryColour: colours.primaryColour,
      trimColour: colours.primaryColour,
      pattern: pick(KIT_PATTERNS, seed, 2),
      shortsColour: colours.secondaryColour,
      socksColour: colours.secondaryColour,
      provenanceStatus: "SIMULATION_ONLY",
    };
  }
  return {
    slot,
    baseColour: colours.accentColour,
    secondaryColour: colours.primaryColour,
    trimColour: colours.secondaryColour,
    pattern: pick(KIT_PATTERNS, seed, 4),
    shortsColour: "#16181d",
    socksColour: colours.accentColour,
    provenanceStatus: "SIMULATION_ONLY",
  };
};

/** The club's full visual identity: colours, badge, and all three kits —
 * one call, always the same result for the same club id/name. Pass
 * `colourOverride` (from `getClubVisualIdentity`'s real saved colours, when
 * `isCustom` is true) to re-derive the badge/kits from the club's actual
 * saved colours instead of the deterministic default; badge shape/symbol
 * and kit pattern selection stay tied to the club id either way — only the
 * colours a player can currently edit change. */
export const buildClubVisualIdentity = (
  clubId: string,
  clubName: string,
  colourOverride?: ClubColours,
): ClubVisualIdentity => {
  const seed = stableSeed(clubId);
  const colours = colourOverride ?? buildClubColours(clubId);
  return {
    ...colours,
    badge: { ...buildClubBadgeDesign(clubId, clubName), ...colours },
    home: kitDesignFor(clubId, "HOME", colours, seed),
    away: kitDesignFor(clubId, "AWAY", colours, seed),
    third: kitDesignFor(clubId, "THIRD", colours, seed),
  };
};
