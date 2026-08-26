import type { EntityId, InteractionMemory, UniversalInteraction } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";
const map=(r:any):UniversalInteraction=>({...JSON.parse(r.data_json),id:r.id});
const mapMemory=(r:any):InteractionMemory=>({...JSON.parse(r.data_json),id:r.id});
export class UniversalInteractionRepository { constructor(private readonly db:GameDatabase){db.exec(`CREATE TABLE IF NOT EXISTS universal_interactions (id TEXT PRIMARY KEY,data_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS interaction_memories (id TEXT PRIMARY KEY,participant_id TEXT NOT NULL,counterpart_id TEXT NOT NULL,data_json TEXT NOT NULL);`);}
 upsert(v:UniversalInteraction){this.db.prepare("INSERT INTO universal_interactions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json").run(v.id,JSON.stringify(v));}
 session(id:EntityId){const r=this.db.prepare("SELECT * FROM universal_interactions WHERE id=?").get(id) as any;return r?map(r):undefined;}
 active(){return (this.db.prepare("SELECT * FROM universal_interactions").all() as any[]).map(map).filter((v)=>!["ACCEPTED","REJECTED","WALKED_AWAY","COMPLETED","CANCELLED"].includes(v.stage)).sort((a,b)=>a.worldDate.localeCompare(b.worldDate)||a.id.localeCompare(b.id));}
 all(){return (this.db.prepare("SELECT * FROM universal_interactions ORDER BY worldDate,id").all() as any[]).map(map);}
 insertMemory(v:InteractionMemory){this.db.prepare("INSERT OR IGNORE INTO interaction_memories VALUES (?,?,?,?)").run(v.id,v.participantId,v.counterpartId,JSON.stringify(v));}
 memories(participantId?:EntityId){return (this.db.prepare(participantId?"SELECT * FROM interaction_memories WHERE participant_id=? ORDER BY occurred_on,id":"SELECT * FROM interaction_memories ORDER BY occurred_on,id").all(...(participantId?[participantId]:[])) as any[]).map(mapMemory);}
}
