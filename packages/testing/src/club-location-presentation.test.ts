import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, PLAUSIBLE_CLUB_LOCALITY_HUBS, presentClubLocation, resolveClubStadium } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * Club location/stadium presentation must never surface a raw UNKNOWN,
 * a null, or a fabricated precise address — only real place/venue names
 * already in the dataset, with an honest confirmedHomeGround flag when the
 * venue is a same-country capacity fallback rather than a real relationship.
 */
describe("club location and stadium presentation", () => {
  const setup = () => {
    const directory = mkdtempSync(join(tmpdir(), "club-location-"));
    const path = join(directory, "career.sqlite");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8")) as unknown,
      saveName: "club location",
      gameVersion: "test",
      randomSeed: "club location",
    });
    const db = openGameDatabase(path);
    return { directory, db };
  };

  it("resolves a real district-level label for a club with a location on record", () => {
    const { db, directory } = setup();
    const clubId = db
      .prepare(
        "SELECT clubs.id FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE countries.iso_code IN ('NP', 'NPL') AND clubs.location_id IS NOT NULL ORDER BY clubs.id LIMIT 1",
      )
      .get() as { id: EntityId };
    const label = presentClubLocation(db, clubId.id);
    expect(label).toBeDefined();
    expect(label).not.toMatch(/unknown/i);
    expect(label).not.toBe("");
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("gives a club with no location on record a bounded, honestly-labelled SIMULATION_ONLY estimate rather than a bare placeholder", () => {
    const { db, directory } = setup();
    const clubId = db.prepare("SELECT id FROM clubs WHERE location_id IS NULL ORDER BY id LIMIT 1").get() as
      | { id: EntityId }
      | undefined;
    if (clubId) {
      const label = presentClubLocation(db, clubId.id);
      expect(label).not.toMatch(/unknown|not on record/i);
      expect(label).toMatch(/\(estimated\)$/);
      expect(PLAUSIBLE_CLUB_LOCALITY_HUBS.some((hub) => label.startsWith(hub))).toBe(true);
      // Deterministic: the same club always gets the same estimate, never a
      // different one each call — never presented as a precise fabricated address.
      expect(presentClubLocation(db, clubId.id)).toBe(label);
    }
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("marks a same-country capacity fallback venue as not a confirmed home ground", () => {
    const { db, directory } = setup();
    const clubWithoutRelationship = db
      .prepare(
        `SELECT c.id FROM clubs c
         WHERE NOT EXISTS (SELECT 1 FROM venue_relationships vr WHERE vr.club_id = c.id AND vr.status != 'unavailable')
           AND EXISTS (SELECT 1 FROM venues v WHERE v.country_id = c.country_id AND v.status != 'CLOSED')
         ORDER BY c.id LIMIT 1`,
      )
      .get() as { id: EntityId } | undefined;
    if (clubWithoutRelationship) {
      const stadium = resolveClubStadium(db, clubWithoutRelationship.id);
      expect(stadium).toBeDefined();
      expect(stadium!.confirmedHomeGround).toBe(false);
      expect(stadium!.name).not.toMatch(/unknown/i);
    }
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("marks a real venue_relationships-backed venue as a confirmed home ground", () => {
    const { db, directory } = setup();
    const confirmed = db
      .prepare("SELECT club_id, venue_id FROM venue_relationships WHERE status != 'unavailable' ORDER BY id LIMIT 1")
      .get() as { club_id: EntityId; venue_id: EntityId } | undefined;
    if (confirmed) {
      const stadium = resolveClubStadium(db, confirmed.club_id);
      expect(stadium).toBeDefined();
      expect(stadium!.venueId).toBe(confirmed.venue_id);
      expect(stadium!.confirmedHomeGround).toBe(true);
    }
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
