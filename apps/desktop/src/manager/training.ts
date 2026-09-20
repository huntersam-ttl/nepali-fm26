import type { TrainingSession, TrainingView } from "@nepal-football-sim/shared-types";

/**
 * Phase 3B — Training helpers (pure, deterministic, real state only).
 * The weekly planner groups the real plan sessions into a MON–SUN timetable;
 * readiness derives only from real squad-development fields.
 */

export const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export type SessionDay = (typeof DAY_ORDER)[number];

export const sessionDayLabel = (day: SessionDay): string => day.slice(0, 3);

export type WeekDay = {
  day: SessionDay;
  sessions: TrainingSession[];
};

/** Group real plan sessions into a MON–SUN week, slot-ordered. Empty days are
 * genuinely empty — no fake sessions are added to fill the grid. */
export const weekSessions = (sessions: TrainingSession[]): WeekDay[] => {
  const byDay = new Map<SessionDay, TrainingSession[]>();
  for (const session of sessions) {
    const list = byDay.get(session.day as SessionDay) ?? [];
    list.push(session);
    byDay.set(session.day as SessionDay, list);
  }
  return DAY_ORDER.map((day) => ({
    day,
    sessions: (byDay.get(day) ?? []).sort((a, b) => a.slot - b.slot),
  }));
};

export type Readiness = { averageFatigue: number; averageSharpness: number; count: number };

/** Average fatigue / match sharpness across the real development view. Returns
 * undefined when there is no development list (no invented risk). */
export const readiness = (view: TrainingView): Readiness | undefined => {
  const list = view.squadDevelopment;
  if (!list || list.length === 0) return undefined;
  const fatigue = list.reduce((sum, player) => sum + (typeof player.fatigue === "number" ? player.fatigue : 0), 0);
  const sharpness = list.reduce((sum, player) => sum + (typeof player.matchSharpness === "number" ? player.matchSharpness : 0), 0);
  return {
    averageFatigue: Math.round(fatigue / list.length),
    averageSharpness: Math.round(sharpness / list.length),
    count: list.length,
  };
};