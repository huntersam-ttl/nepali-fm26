import { createStableEntityId, type EntityId } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "@nepal-football-sim/database";
import { countryPack, type NationalTeamDefinition } from "./country-pack.js";
import { findHomeFootballContext, homeNationalTeams } from "./home-context.js";

export type NationalTeamRow = { id: EntityId; federationId: EntityId; name: string; canonicalExternalId: string; level: string; gender: "men" | "women" };

/** The `teams` rows of one federation's national teams, derived from its country and the structure definitions. Pure. */
export const nationalTeamIdentities = (input: {
  federationId: EntityId;
  countryName: string;
  codePrefix: string;
  definitions: readonly NationalTeamDefinition[];
}): NationalTeamRow[] =>
  input.definitions.map((definition) => ({
    id: createStableEntityId("team", `${input.federationId}:${definition.level}-${definition.gender}`),
    federationId: input.federationId,
    name: `${input.countryName} ${definition.label}`,
    canonicalExternalId: `${input.codePrefix}-NT-${definition.level.toUpperCase()}-${definition.gender.toUpperCase()}`,
    level: definition.level,
    gender: definition.gender,
  }));

/** Inserts (idempotently) the national teams of a federation, named after the federation's own country. */
export const ensureNationalTeamRows = (db: GameDatabase, federationId: EntityId): void => {
  const country = db
    .prepare("SELECT c.id AS id, c.name AS name, c.iso_code AS iso FROM federations f JOIN countries c ON c.id = f.country_id WHERE f.id = ?")
    .get(federationId) as { id: EntityId; name: string; iso: string } | undefined;
  if (!country) throw new Error("The federation's country is missing from the save.");
  const home = findHomeFootballContext(db);
  const isHome = home?.countryId === country.id;
  const codePrefix = isHome
    ? countryPack(home!.packId).nationalTeamCodePrefix ?? country.iso.replace(/^X-/, "")
    : country.iso.replace(/^X-/, "").slice(0, 3);
  for (const team of nationalTeamIdentities({ federationId, countryName: country.name, codePrefix: codePrefix.toUpperCase(), definitions: homeNationalTeams(db) })) {
    db.prepare(
      `INSERT INTO teams (id, club_id, federation_id, name, canonical_external_id, level, gender)
       VALUES (?, NULL, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(team.id, federationId, team.name, team.canonicalExternalId, team.level, team.gender);
  }
};
