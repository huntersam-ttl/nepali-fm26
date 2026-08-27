import type { SaveMetadata, ScheduledEvent } from "@nepal-football-sim/shared-types";
import { createEntityId } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "@nepal-football-sim/database";
import { EventRepository, updateSaveWorldDate } from "@nepal-football-sim/database";
import { advanceMacroEconomyForWorldDate } from "./macro-economy.js";

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

export type SimulationClockOptions = {
  onAdvanceDay?: (worldDate: string) => void;
};

export class SimulationClock {
  private save: SaveMetadata;
  private readonly events: EventRepository;

  constructor(
    private readonly db: GameDatabase,
    save: SaveMetadata,
    private readonly options: SimulationClockOptions = {},
  ) {
    this.save = save;
    this.events = new EventRepository(db);
  }

  get worldDate(): string {
    return this.save.worldDate;
  }

  schedule(event: Omit<ScheduledEvent, "id" | "status"> & { id?: string }): ScheduledEvent {
    const scheduled: ScheduledEvent = {
      id: (event.id ?? createEntityId()) as ScheduledEvent["id"],
      dueOn: event.dueOn,
      eventType: event.eventType,
      payload: event.payload,
      status: "pending",
      processedOn: event.processedOn,
    };
    this.events.schedule(scheduled);
    return scheduled;
  }

  advanceDay(): void {
    this.save = updateSaveWorldDate(this.db, this.save, addDays(this.save.worldDate, 1));
    advanceMacroEconomyForWorldDate(this.db, {
      date: this.save.worldDate,
      seed: this.save.randomSeed,
    });
    this.options.onAdvanceDay?.(this.save.worldDate);
    this.processDueEvents();
  }

  advanceDays(days: number): void {
    if (!Number.isInteger(days) || days < 0) {
      throw new Error("advanceDays expects a non-negative integer");
    }
    for (let i = 0; i < days; i += 1) {
      this.advanceDay();
    }
  }

  simulateUntil(targetDate: string): void {
    while (this.worldDate < targetDate) {
      this.advanceDay();
    }
  }

  private processDueEvents(): void {
    for (const event of this.events.dueEvents(this.worldDate)) {
      this.events.insertHistoricalEvent({
        id: createEntityId(),
        occurredOn: this.worldDate,
        eventType: event.eventType,
        involvedEntities: [],
        title: `Scheduled event processed: ${event.eventType}`,
        data: event.payload,
        importance: "low",
        scope: "world",
      });
      this.events.markProcessed(event.id, this.worldDate);
    }
  }
}
