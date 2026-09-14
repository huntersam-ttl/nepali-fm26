import { EventRepository, type GameDatabase } from "@nepal-football-sim/database";
import type { HistoricalEvent } from "@nepal-football-sim/shared-types";

/**
 * The one canonical write path for a real, exact-once historical event —
 * the shared fact table every Story surface (press, transfer, ownership,
 * federation governance, infrastructure, match history, and everything
 * else in this file's own call-site audit) ultimately reads from.
 *
 * `insertHistoricalEvent` itself is a plain INSERT with no ON CONFLICT, so
 * calling it twice for the same stable id throws a real SQL constraint
 * error rather than silently duplicating — several producers relied
 * entirely on their own business key genuinely never recurring rather
 * than checking first. That held in practice, but a producer whose
 * upstream guarantee ever weakens (a retried command, a replayed event
 * handler) would crash instead of no-op. This makes exact-once the
 * publisher's own guarantee instead of every call site's, via a single
 * indexed existence check — never a full-table scan-and-parse, which is
 * what re-deriving `historicalEvents()` just to check one id would cost
 * at real save-file scale.
 *
 * Idempotent: a second call with the same `event.id` is a genuine no-op
 * (the row already on record is left untouched), so a caller only needs
 * to construct its stable id correctly — never track "have I already
 * published this?" state of its own.
 */
export const publishHistoricalEvent = (db: GameDatabase, event: HistoricalEvent): void => {
  const existing = db.prepare("SELECT 1 FROM historical_events WHERE id = ?").get(event.id);
  if (existing) return;
  new EventRepository(db).insertHistoricalEvent(event);
};
