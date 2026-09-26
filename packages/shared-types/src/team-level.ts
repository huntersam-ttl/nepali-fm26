/** The team levels the built-in datasets use. A dataset may define others (see TeamLevel). */
export type KnownTeamLevel = "senior" | "u23" | "u20" | "u17" | "reserve" | "academy";

/** A team's level. The known values autocomplete; any other well-formed value is storable, and systems that cannot play it say so through isSimulatedTeamLevel. */
export type TeamLevel = KnownTeamLevel | (string & {});

/** The levels the national-team simulation (call-ups, age rules, programmes, fixtures) plays. */
export const SIMULATED_TEAM_LEVELS: readonly TeamLevel[] = ["senior", "u23", "u20", "u17"];

export const isSimulatedTeamLevel = (level: TeamLevel): boolean => SIMULATED_TEAM_LEVELS.includes(level);

export const isSeniorTeamLevel = (level: TeamLevel): boolean => level === "senior";

/** The age cap of an under-N level ("u19" is 19), or undefined for a level with no age cap. */
export const teamLevelAgeCap = (level: TeamLevel): number | undefined => {
  const match = /^u(\d{1,2})$/.exec(level);
  return match ? Number(match[1]) : undefined;
};

/** Whether a level is well-formed enough to store: lower-case letters, digits and underscores, starting with a letter. */
export const isValidTeamLevel = (level: string): boolean => /^[a-z][a-z0-9_]{0,31}$/.test(level);

/** A short display label for a level: "Senior", "U19", or the level itself for one the UI does not know. */
export const teamLevelLabel = (level: TeamLevel): string => {
  if (level === "senior") return "Senior";
  const cap = teamLevelAgeCap(level);
  return cap !== undefined ? `U${cap}` : level.replace(/_/g, " ");
};
