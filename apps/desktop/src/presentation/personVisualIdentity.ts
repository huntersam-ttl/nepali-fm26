/**
 * Deterministic, persistent visual identity for a person — players,
 * managers, owners, executives, and federation figures alike. Same
 * `personId` always yields the same identity: everything here is a pure
 * function of the id (and, for age presentation, the person's real age),
 * never `Math.random()` at render time. This is the same "state -> visual
 * descriptor" pattern clubScenePresentation.ts already uses for the 3D
 * layer, applied to a lightweight 2D portrait instead.
 *
 * Scope note: this is presentation-only. There is no new database column —
 * the identity is fully reconstructable from the person's own real id, so
 * "persistence" is free: it never drifts across reloads or renders because
 * it never depends on anything but stable inputs.
 *
 * Fairness note: for SIMULATION-GENERATED fictional people (every person in
 * this game), the palettes below are broad and deterministic — never an
 * attempt to infer skin tone, hair, or features from nationality. This
 * module has no nationality input at all, by design. This project holds no
 * licensed photos of real people, so no code path here ever claims to depict
 * a real individual's actual likeness.
 */

export type AgeBand = "YOUTH" | "YOUNG_ADULT" | "PRIME" | "VETERAN" | "OLDER";

export type HairStyle = "BALD" | "SHORT" | "MEDIUM" | "LONG" | "SHAVED";
export type FacialHairStyle = "NONE" | "STUBBLE" | "MOUSTACHE" | "BEARD" | "FULL_BEARD";
export type FaceShape = "OVAL" | "ROUND" | "SQUARE" | "LONG";

export type PersonRole = "PLAYER" | "MANAGER" | "STAFF" | "OWNER" | "EXECUTIVE" | "PRESIDENT";

export type PersonVisualIdentity = {
  seed: number;
  skinTone: string;
  hairStyle: HairStyle;
  hairColour: string;
  facialHairStyle: FacialHairStyle;
  faceShape: FaceShape;
  ageBand: AgeBand;
  /** 0-1: how much grey/white to mix into the hair/facial-hair colour at
   * this age — deterministic per person, not re-rolled every render. */
  greyingAmount: number;
};

/** FNV-1a-style stable string hash — the same pattern clubScenePresentation.ts
 * and the meeting/federation scene builders each already use locally. */
const stableSeed = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
};

/** A small, fixed set of broad deterministic skin-tone/hair-colour palettes
 * — never derived from nationality, never a stereotyped mapping. Every
 * fictional person in this game draws from the same shared palette. */
const SKIN_TONES = ["#f2d5b8", "#e8b98d", "#c98d5f", "#a3673f", "#7a4a2b", "#573521"];
const HAIR_COLOURS_YOUNG = ["#0c0c0c", "#2a1a10", "#4a2e18", "#6b4423", "#8a5a2b", "#c9a15a", "#3d2314"];
const HAIR_STYLES: HairStyle[] = ["BALD", "SHORT", "MEDIUM", "LONG", "SHAVED"];
const FACIAL_HAIR_STYLES: FacialHairStyle[] = ["NONE", "STUBBLE", "MOUSTACHE", "BEARD", "FULL_BEARD"];
const FACE_SHAPES: FaceShape[] = ["OVAL", "ROUND", "SQUARE", "LONG"];

const pick = <T,>(options: readonly T[], seed: number, salt: number): T =>
  options[(seed + salt) % options.length] as T;

/** Real age (when known) bands into a conservative five-stage presentation.
 * Undefined/unknown age (a player scouted only loosely) reads as PRIME — a
 * neutral default, never a guess dressed up as a real fact. */
export const ageBandForAge = (age: number | undefined): AgeBand => {
  if (age === undefined) return "PRIME";
  if (age < 18) return "YOUTH";
  if (age < 24) return "YOUNG_ADULT";
  if (age < 32) return "PRIME";
  if (age < 40) return "VETERAN";
  return "OLDER";
};

const GREYING_BY_BAND: Record<AgeBand, number> = {
  YOUTH: 0,
  YOUNG_ADULT: 0,
  PRIME: 0.15,
  VETERAN: 0.5,
  OLDER: 0.85,
};

/** Mixes a hex colour toward light grey by `amount` (0-1) — used for
 * age-driven hair/facial-hair greying, never a new random colour. */
const towardsGrey = (hex: string, amount: number): string => {
  if (amount <= 0) return hex;
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const grey = 200;
  const mix = (channel: number): string =>
    Math.round(channel + (grey - channel) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${mix(r)}${mix(g)}${mix(b)}`;
};

/**
 * Builds the full, stable identity for a person. `age` is optional and
 * real-only (never fabricated) — pass it whenever the caller already has a
 * knowledge-gated Fact<number> value; omit it (or pass undefined) when the
 * age isn't known, which reads as a neutral PRIME presentation rather than
 * guessing.
 */
export const buildPersonVisualIdentity = (personId: string, age?: number): PersonVisualIdentity => {
  const seed = stableSeed(personId);
  const ageBand = ageBandForAge(age);
  const greyingAmount = GREYING_BY_BAND[ageBand];
  const baseHairColour = pick(HAIR_COLOURS_YOUNG, seed, 3);
  const hairStyle = pick(HAIR_STYLES, seed, 7);
  return {
    seed,
    skinTone: pick(SKIN_TONES, seed, 1),
    hairStyle: ageBand === "OLDER" && hairStyle !== "BALD" && seed % 5 === 0 ? "BALD" : hairStyle,
    hairColour: towardsGrey(baseHairColour, greyingAmount),
    facialHairStyle: pick(FACIAL_HAIR_STYLES, seed, 11),
    faceShape: pick(FACE_SHAPES, seed, 13),
    ageBand,
    greyingAmount,
  };
};
