import { createEntityId } from "@nepal-football-sim/shared-types";
import type { EntityId, SaveMetadata } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";
import { CURRENT_DATABASE_VERSION, migrateDatabase } from "./migrations.js";
import { SaveRepository } from "./repositories.js";

export type NewSaveInput = {
  name: string;
  worldDate: string;
  gameVersion: string;
  randomSeed: string;
  playerCharacterId?: EntityId;
};

export const createNewSave = (db: GameDatabase, input: NewSaveInput): SaveMetadata => {
  migrateDatabase(db);
  const now = new Date().toISOString();
  const save: SaveMetadata = {
    id: createEntityId(),
    name: input.name,
    worldDate: input.worldDate,
    databaseVersion: CURRENT_DATABASE_VERSION,
    gameVersion: input.gameVersion,
    randomSeed: input.randomSeed,
    createdAt: now,
    lastSavedAt: now,
    playerCharacterId: input.playerCharacterId,
  };
  new SaveRepository(db).upsert(save);
  return save;
};

export const loadSave = (db: GameDatabase, saveId?: EntityId): SaveMetadata => {
  migrateDatabase(db);
  const repository = new SaveRepository(db);
  const save = saveId ? repository.get(saveId) : repository.first();
  if (!save) {
    throw new Error("No save found in database");
  }
  return save;
};

export const updateSaveWorldDate = (
  db: GameDatabase,
  save: SaveMetadata,
  worldDate: string,
): SaveMetadata => {
  const updated = { ...save, worldDate, lastSavedAt: new Date().toISOString() };
  new SaveRepository(db).upsert(updated);
  return updated;
};
