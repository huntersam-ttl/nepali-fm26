import { createHash, randomUUID } from "node:crypto";

export type EntityId = string & { readonly __brand: "EntityId" };

export const createEntityId = (): EntityId => randomUUID() as EntityId;

export const createStableEntityId = (namespace: string, key: string): EntityId => {
  const hex = createHash("sha256").update(`${namespace}:${key}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join("-") as EntityId;
};
