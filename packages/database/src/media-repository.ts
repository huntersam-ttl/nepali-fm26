import type { EntityId, MediaOutlet, MediaStory } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

export class MediaRepository {
  constructor(private readonly db: GameDatabase) {}
  upsertOutlet(x: MediaOutlet): void { this.db.prepare(`INSERT INTO media_outlets (id,name,scope,reputation,reach,bias,style,status) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET reputation=excluded.reputation,reach=excluded.reach`).run(x.id,x.name,x.scope,x.reputation,x.reach,x.bias,x.style,x.status); }
  outlets(): MediaOutlet[] { return (this.db.prepare("SELECT * FROM media_outlets ORDER BY id").all() as any[]).map(r=>({id:r.id,name:r.name,scope:r.scope,reputation:r.reputation,reach:r.reach,bias:r.bias,style:r.style,status:r.status})); }
  upsertStory(x: MediaStory): void { this.db.prepare(`INSERT INTO media_stories (id,outlet_id,event_type,source_entity_id,published_on,importance,headline,summary,subject_ids_json,reputation_effect,status,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status`).run(x.id,x.outletId,x.eventType,x.sourceEntityId,x.publishedOn,x.importance,x.headline,x.summary,JSON.stringify(x.subjectIds),x.reputationEffect,x.status,x.provenanceStatus); }
  stories(publishedOn?: string): MediaStory[] { const rows=(publishedOn?this.db.prepare("SELECT * FROM media_stories WHERE published_on=? ORDER BY importance DESC,id").all(publishedOn):this.db.prepare("SELECT * FROM media_stories ORDER BY published_on,importance DESC,id").all()) as any[]; return rows.map(r=>({id:r.id,outletId:r.outlet_id,eventType:r.event_type,sourceEntityId:r.source_entity_id,publishedOn:r.published_on,importance:r.importance,headline:r.headline,summary:r.summary,subjectIds:JSON.parse(r.subject_ids_json),reputationEffect:r.reputation_effect,status:r.status,provenanceStatus:r.provenance_status})); }
  hasStory(sourceEntityId: EntityId): boolean { return Boolean(this.db.prepare("SELECT 1 FROM media_stories WHERE source_entity_id=? LIMIT 1").get(sourceEntityId)); }
}
