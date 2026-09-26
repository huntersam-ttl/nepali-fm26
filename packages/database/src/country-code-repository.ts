import type { CountryCodeAlias, CountryCodeSystem, EntityId } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

/*
 * Country identity. `countries.id` is the identity of a country. `countries.iso_code` is the one
 * code the row was created with, in whatever code system its source used (the Nepal dataset and
 * the international registry use ISO alpha-2, the global import mixes ISO alpha-3, FIFA-style
 * codes and generated "X-…" codes). It is unique, and it is never rewritten. Every other code a
 * country is known by lives in `country_codes`, tagged with its system.
 */

export class CountryCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CountryCodeError";
  }
}

export const normalizeCountryCode = (code: string): string => code.trim().toUpperCase();

export class CountryCodeRepository {
  constructor(private readonly db: GameDatabase) {}

  /**
   * The country a code refers to: the country whose stored code it is, else the single country
   * that has it as a registered alias. Undefined when nothing has the code; an error when
   * several countries claim it as an alias.
   */
  resolveByCode(code: string): EntityId | undefined {
    const normalized = normalizeCountryCode(code);
    const stored = this.db.prepare("SELECT id FROM countries WHERE upper(iso_code) = ?").get(normalized) as { id: EntityId } | undefined;
    if (stored) return stored.id;
    const aliased = this.db.prepare("SELECT DISTINCT country_id FROM country_codes WHERE code = ? ORDER BY country_id").all(normalized) as Array<{ country_id: EntityId }>;
    if (aliased.length > 1) throw new CountryCodeError(`Country code "${normalized}" is ambiguous: it is registered for ${aliased.length} countries.`);
    return aliased[0]?.country_id;
  }

  /** The first of `codes`, in the order given, that resolves to a country. */
  resolveByAnyCode(codes: readonly string[]): EntityId | undefined {
    for (const code of codes) {
      const id = this.resolveByCode(code);
      if (id) return id;
    }
    return undefined;
  }

  /** A country by exact name, only when exactly one country has it. A last resort, never a first lookup. */
  resolveByExactName(name: string): EntityId | undefined {
    const rows = this.db.prepare("SELECT id FROM countries WHERE lower(name) = lower(?) ORDER BY id").all(name.trim()) as Array<{ id: EntityId }>;
    if (rows.length > 1) throw new CountryCodeError(`Country name "${name}" is ambiguous: ${rows.length} countries have it.`);
    return rows[0]?.id;
  }

  aliases(countryId: EntityId): CountryCodeAlias[] {
    return (this.db.prepare("SELECT country_id, code, code_system, source FROM country_codes WHERE country_id = ? ORDER BY code_system, code").all(countryId) as Array<{
      country_id: EntityId;
      code: string;
      code_system: CountryCodeSystem;
      source: string | null;
    }>).map((row) => ({ countryId: row.country_id, code: row.code, system: row.code_system, source: row.source ?? undefined }));
  }

  /**
   * Registers `code` as another name for a country. Returns false when the country already has
   * the code. A code that already belongs to a different country, as its stored code or as an alias, is refused.
   */
  addAlias(input: { countryId: EntityId; code: string; system: CountryCodeSystem; source?: string }): boolean {
    const code = normalizeCountryCode(input.code);
    if (!code) throw new CountryCodeError("A country code cannot be empty.");
    const stored = this.db.prepare("SELECT id FROM countries WHERE upper(iso_code) = ?").get(code) as { id: EntityId } | undefined;
    if (stored) {
      if (stored.id === input.countryId) return false;
      throw new CountryCodeError(`Country code "${code}" is already the stored code of another country.`);
    }
    const owners = this.db.prepare("SELECT DISTINCT country_id FROM country_codes WHERE code = ?").all(code) as Array<{ country_id: EntityId }>;
    if (owners.some((owner) => owner.country_id !== input.countryId)) throw new CountryCodeError(`Country code "${code}" is already registered for another country.`);
    if (owners.length > 0) return false;
    const result = this.db
      .prepare("INSERT OR IGNORE INTO country_codes (country_id, code, code_system, source) VALUES (?, ?, ?, ?)")
      .run(input.countryId, code, input.system, input.source ?? null);
    return Number(result.changes) > 0;
  }

  /** Like `addAlias`, but skips a code another country already owns instead of failing (for saves that already hold duplicate country rows). */
  addAliasIfFree(input: { countryId: EntityId; code: string; system: CountryCodeSystem; source?: string }): boolean {
    try {
      return this.addAlias(input);
    } catch (error) {
      if (error instanceof CountryCodeError) return false;
      throw error;
    }
  }
}
