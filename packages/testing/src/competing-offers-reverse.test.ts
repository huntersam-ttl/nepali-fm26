import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, TransferMarketRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  acceptTransferOffer,
  createNepalSave,
  createTransferOffer,
  initializeTransferMarketForSave,
  initializeForeignFootballWorldForSave,
  negotiatePlayerTerms,
  resolveCompetingPlayerOffers,
  simulateTransferWindow,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const save = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-competing-"));
  dirs.push(dir);
  const databasePath = join(dir, "save.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: seed,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  const db = openGameDatabase(databasePath);
  initializeTransferMarketForSave({ db, worldDate: "2026-08-01", seed });
  db.close();
  return databasePath;
};

const scenario = (seed: string): { path: string; playerId: EntityId; nepalClub: EntityId; foreignClub: EntityId } => {
  const path = save(seed);
  const db = openGameDatabase(path);
  initializeForeignFootballWorldForSave({ db, worldDate: "2026-08-01", seed });
  const player = db.prepare(`
    SELECT pfp.player_id AS playerId, pc.id AS contractId
    FROM player_factual_profiles pfp
    JOIN player_contracts pc ON pc.player_id = pfp.player_id
    WHERE pc.status = 'ACTIVE' ORDER BY pfp.player_id LIMIT 1
  `).get() as { playerId: EntityId; contractId: EntityId };
  const foreign = db.prepare("SELECT id FROM clubs WHERE canonical_external_id = 'SIM-FOREIGN-JP'").get() as { id: EntityId };
  const market = new TransferMarketRepository(db);
  market.markContractStatus(player.contractId, "TERMINATED");
  market.updatePlayerClub(player.playerId, foreign.id);
  const nepal = db.prepare("SELECT id FROM clubs WHERE canonical_external_id LIKE 'NEP-NSL-%' ORDER BY id LIMIT 1").get() as { id: EntityId };
  db.close();
  return { path, playerId: player.playerId, nepalClub: nepal.id, foreignClub: foreign.id };
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("competing offers and reverse foreign free-agent closure", () => {
  it("selects the best acceptable Nepal offer, closes the rival, and survives reload", () => {
    const input = scenario("reverse-nepal-wins");
    const db = openGameDatabase(input.path);
    const nepalOffer = createTransferOffer(db, { buyingClubId: input.nepalClub, playerId: input.playerId, submittedAt: "2026-08-02", fee: 0 });
    const foreignOffer = createTransferOffer(db, { buyingClubId: input.foreignClub, playerId: input.playerId, submittedAt: "2026-08-02", fee: 0 });
    acceptTransferOffer(db, nepalOffer, "2026-08-02");
    acceptTransferOffer(db, foreignOffer, "2026-08-02");
    negotiatePlayerTerms(db, nepalOffer, { worldDate: "2026-08-02", seed: "reverse-nepal-wins", proposal: { salary: 300_000, contractLengthMonths: 36, squadRole: "FIRST_TEAM" } });
    negotiatePlayerTerms(db, foreignOffer, { worldDate: "2026-08-02", seed: "reverse-nepal-wins", proposal: { salary: 80_000, contractLengthMonths: 12, squadRole: "BACKUP" } });

    const winner = resolveCompetingPlayerOffers(db, input.playerId, "2026-08-02", "reverse-nepal-wins", { preferredCountries: ["NP", "NPL"], expectedPlayingTime: "FIRST_TEAM", securityPreference: 8 });
    const market = new TransferMarketRepository(db);
    expect(winner?.buyingClubId).toBe(input.nepalClub);
    expect(market.activeContract(input.playerId, "2026-08-02")?.clubId).toBe(input.nepalClub);
    simulateTransferWindow({ db, worldDate: "2026-08-02", seed: "reverse-nepal-wins", maxClubActions: 0 });
    expect(market.competitionRegistrations().some((item) => item.playerId === input.playerId && item.clubId === input.nepalClub && item.status === "ACTIVE")).toBe(true);
    expect(new ClubEconomyRepository(db).ledgerEntries().filter((entry) => entry.relatedEntityId === nepalOffer.id)).toHaveLength(0);
    expect(market.transferHistory().filter((event) => event.playerId === input.playerId && event.eventType === "FREE_AGENT_SIGNED")).toHaveLength(1);
    expect(market.transferOffers().find((offer) => offer.id === foreignOffer.id)?.status).toBe("REJECTED");
    db.close();

    const reloaded = openGameDatabase(input.path);
    expect(new TransferMarketRepository(reloaded).activeContract(input.playerId, "2026-08-02")?.clubId).toBe(input.nepalClub);
    expect(new TransferMarketRepository(reloaded).transferHistory().filter((event) => event.playerId === input.playerId && event.eventType === "FREE_AGENT_SIGNED")).toHaveLength(1);
    reloaded.close();
  });

  it("lets a better foreign offer win instead of biasing Nepal", () => {
    const input = scenario("reverse-foreign-wins");
    const db = openGameDatabase(input.path);
    const nepalOffer = createTransferOffer(db, { buyingClubId: input.nepalClub, playerId: input.playerId, submittedAt: "2026-08-02", fee: 0 });
    const foreignOffer = createTransferOffer(db, { buyingClubId: input.foreignClub, playerId: input.playerId, submittedAt: "2026-08-02", fee: 0 });
    acceptTransferOffer(db, nepalOffer, "2026-08-02");
    acceptTransferOffer(db, foreignOffer, "2026-08-02");
    negotiatePlayerTerms(db, nepalOffer, { worldDate: "2026-08-02", seed: "reverse-foreign-wins", proposal: { salary: 80_000, contractLengthMonths: 12, squadRole: "BACKUP" } });
    negotiatePlayerTerms(db, foreignOffer, { worldDate: "2026-08-02", seed: "reverse-foreign-wins", proposal: { salary: 300_000, contractLengthMonths: 36, squadRole: "FIRST_TEAM" } });
    const winner = resolveCompetingPlayerOffers(db, input.playerId, "2026-08-02", "reverse-foreign-wins");
    expect(winner?.buyingClubId).toBe(input.foreignClub);
    expect(new TransferMarketRepository(db).activeContract(input.playerId, "2026-08-02")?.clubId).toBe(input.foreignClub);
    expect(new TransferMarketRepository(db).transferHistory().filter((event) => event.playerId === input.playerId && event.eventType === "FREE_AGENT_SIGNED")).toHaveLength(1);
    expect(new TransferMarketRepository(db).transferOffers().find((offer) => offer.id === nepalOffer.id)?.status).toBe("REJECTED");
    db.close();
  });
});
