import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase, OwnershipRepository } from "@nepal-football-sim/database";
import { createNepalSave, exitClubOwnership, initializeClubEconomyForSave, ownershipHistory, processOwnershipSuccession, runChairmanDemo } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("club ownership succession", () => {
  it("persists two deterministic ownership eras without changing club operations", () => {
    const dir = mkdtempSync(join(tmpdir(), "ownership-succession-"));
    dirs.push(dir);
    const path = join(dir, "save.sqlite");
    createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: "succession", gameVersion: "test", randomSeed: "succession" });
    const db = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2027-07-01", seed: "succession" });
    const club = db.prepare("SELECT id FROM clubs WHERE name='New Road Team'").get() as { id: EntityId };
    const firstOwner = runChairmanDemo({ db, seed: "succession", worldDate: "2027-07-01", clubId: club.id }).chairmanPersonId;
    const before = new ClubEconomyRepository(db).financialAccount(club.id)!;
    exitClubOwnership(db, { clubId: club.id, ownerPersonId: firstOwner, date: "2030-07-01" });
    const firstTransition = processOwnershipSuccession(db, { clubId: club.id, date: "2030-07-01", seed: "succession" });
    expect(firstTransition?.status).toBe("COMPLETED");
    expect(new OwnershipRepository(db).transactions(club.id)).toHaveLength(1);
    expect(ownershipHistory(db, club.id)).toHaveLength(3);
    expect(new ClubEconomyRepository(db).financialAccount(club.id)?.cashBalance).toBe(before.cashBalance);

    const secondOwner = new ClubEconomyRepository(db).ownershipStakes(club.id).find((stake) => stake.role === "MAJORITY_OWNER")?.holderId!;
    exitClubOwnership(db, { clubId: club.id, ownerPersonId: secondOwner, date: "2035-07-01" });
    const interim = processOwnershipSuccession(db, { clubId: club.id, date: "2035-07-01", seed: "succession", allowGeneratedCandidate: false });
    expect(interim?.status).toBe("INTERIM");
    const secondTransition = processOwnershipSuccession(db, { clubId: club.id, date: "2035-10-01", seed: "succession" });
    expect(secondTransition?.status).toBe("COMPLETED");
    expect(new OwnershipRepository(db).transactions(club.id)).toHaveLength(2);
    expect(ownershipHistory(db, club.id)).toHaveLength(4);
    const stable = processOwnershipSuccession(db, { clubId: club.id, date: "2035-10-01", seed: "succession" });
    expect(stable).toEqual(secondTransition);
    db.close();

    const reloaded = openGameDatabase(path);
    expect(new OwnershipRepository(reloaded).transactions(club.id)).toHaveLength(2);
    expect(ownershipHistory(reloaded, club.id)).toHaveLength(4);
    reloaded.close();
  });
});
