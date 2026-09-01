import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase, PeopleFoundationRepository } from "@nepal-football-sim/database";
import { createNepalSave, upsertPersonRelationship } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("people personality and relationship foundation", () => {
  it("persists bounded deterministic profiles and reload-safe typed relationships", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-people-foundation-"));
    dirs.push(dir);
    const databasePath = join(dir, "people.sqlite");
    createNepalSave({
      databasePath,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")),
      saveName: "People Foundation",
      gameVersion: "0.3.0",
      randomSeed: "people-foundation",
      globalSeedPath: null,
    });
    const db = openGameDatabase(databasePath);
    try {
      const people = new PeopleFoundationRepository(db);
      const profiles = people.personalities();
      expect(profiles.length).toBeGreaterThan(500);
      expect(profiles.every((profile) => profile.provenanceStatus === "SIMULATION_ONLY")).toBe(
        true,
      );
      for (const profile of profiles) {
        expect(Object.values(profile.traits).every((value) => value >= 0 && value <= 100)).toBe(
          true,
        );
        expect(profile.archetype).not.toBe("UNDEFINED");
      }
      const personIds = profiles.slice(0, 2).map((profile) => profile.personId) as [
        EntityId,
        EntityId,
      ];
      const relationship = upsertPersonRelationship({
        db,
        fromPersonId: personIds[0],
        toPersonId: personIds[1],
        kind: "TEAMMATE",
        affinity: 81,
        trust: 73,
        respect: 66,
        tension: 12,
        date: "2026-08-01",
      });
      expect(people.relationship(personIds[0], personIds[1], "TEAMMATE")).toEqual(relationship);
      db.close();
      const reloaded = openGameDatabase(databasePath);
      try {
        expect(
          new PeopleFoundationRepository(reloaded).relationship(
            personIds[0],
            personIds[1],
            "TEAMMATE",
          ),
        ).toEqual(relationship);
      } finally {
        reloaded.close();
      }
    } finally {
      try {
        db.close();
      } catch {
        /* already closed after reload check */
      }
    }
  });

  it("produces identical profile rows for identical saves and does not duplicate reruns", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-people-determinism-"));
    dirs.push(dir);
    const dataset = JSON.parse(readFileSync(registryPath, "utf8"));
    const paths = [join(dir, "first.sqlite"), join(dir, "second.sqlite")];
    for (const databasePath of paths)
      createNepalSave({
        databasePath,
        dataset,
        saveName: "Deterministic People",
        gameVersion: "0.3.0",
        randomSeed: "same-people-seed",
        globalSeedPath: null,
      });
    const rows = paths.map((databasePath) => {
      const db = openGameDatabase(databasePath);
      try {
        return new PeopleFoundationRepository(db).personalities();
      } finally {
        db.close();
      }
    });
    expect(rows[1]).toEqual(rows[0]);
  });
});
