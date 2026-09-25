import type { EntityId, InteractionMemory, UniversalInteraction } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";
const map=(r:any):UniversalInteraction=>({...JSON.parse(r.data_json),id:r.id});
const mapMemory=(r:any):InteractionMemory=>({...JSON.parse(r.data_json),id:r.id});
const byWorldDateThenId=(a:UniversalInteraction,b:UniversalInteraction)=>a.worldDate.localeCompare(b.worldDate)||a.id.localeCompare(b.id);
const indexed=new WeakSet<GameDatabase>();
/**
 * Interactions are stored as JSON, and lookups used to read and parse every row ever
 * written. Two virtual columns over the JSON plus an index let a lookup by type (and
 * linked record) read only the rows it needs; the JSON stays the single source of truth.
 */
const ensureLookupIndex=(db:GameDatabase)=>{
  if(indexed.has(db))return;
  const columns=(db.prepare("PRAGMA table_xinfo(universal_interactions)").all() as Array<{name:string}>).map((c)=>c.name);
  if(!columns.includes("interaction_type"))db.exec("ALTER TABLE universal_interactions ADD COLUMN interaction_type TEXT GENERATED ALWAYS AS (json_extract(data_json,'$.interactionType')) VIRTUAL;");
  if(!columns.includes("linked_id"))db.exec("ALTER TABLE universal_interactions ADD COLUMN linked_id TEXT GENERATED ALWAYS AS (json_extract(data_json,'$.linkedReference.canonicalId')) VIRTUAL;");
  db.exec("CREATE INDEX IF NOT EXISTS idx_universal_interactions_type_linked ON universal_interactions(interaction_type, linked_id);");
  indexed.add(db);
};
export class UniversalInteractionRepository { constructor(private readonly db:GameDatabase){db.exec(`CREATE TABLE IF NOT EXISTS universal_interactions (id TEXT PRIMARY KEY,data_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS interaction_memories (id TEXT PRIMARY KEY,participant_id TEXT NOT NULL,counterpart_id TEXT NOT NULL,data_json TEXT NOT NULL);`);ensureLookupIndex(db);}
 upsert(v:UniversalInteraction){this.db.prepare("INSERT INTO universal_interactions (id,data_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json").run(v.id,JSON.stringify(v));}
 session(id:EntityId){const r=this.db.prepare("SELECT * FROM universal_interactions WHERE id=?").get(id) as any;return r?map(r):undefined;}
 active(){return (this.db.prepare("SELECT id,data_json FROM universal_interactions WHERE json_extract(data_json,'$.stage') IS NULL OR json_extract(data_json,'$.stage') NOT IN ('ACCEPTED','REJECTED','WALKED_AWAY','COMPLETED','CANCELLED')").all() as any[]).map(map).sort(byWorldDateThenId);}
 all(){return (this.db.prepare("SELECT id,data_json FROM universal_interactions").all() as any[]).map(map).sort(byWorldDateThenId);}
 /** The same rows, in the same order, as all() narrowed to one interaction type (and optionally one linked record). */
 ofType(interactionType:string,linkedId?:EntityId){return (this.db.prepare(linkedId===undefined?"SELECT id,data_json FROM universal_interactions WHERE interaction_type=?":"SELECT id,data_json FROM universal_interactions WHERE interaction_type=? AND linked_id=?").all(...(linkedId===undefined?[interactionType]:[interactionType,linkedId])) as any[]).map(map).sort(byWorldDateThenId);}
 insertMemory(v:InteractionMemory){this.db.prepare("INSERT OR IGNORE INTO interaction_memories VALUES (?,?,?,?)").run(v.id,v.participantId,v.counterpartId,JSON.stringify(v));}
 memories(participantId?:EntityId){return (this.db.prepare(participantId?"SELECT * FROM interaction_memories WHERE participant_id=?":"SELECT * FROM interaction_memories").all(...(participantId?[participantId]:[])) as any[]).map(mapMemory).sort((a,b)=>a.occurredOn.localeCompare(b.occurredOn)||a.id.localeCompare(b.id));}
}
