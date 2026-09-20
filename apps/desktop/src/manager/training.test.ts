import { describe, expect, it } from "vitest";
import { readiness, sessionDayLabel, weekSessions } from "./training.js";
import type { TrainingSession, TrainingView } from "@nepal-football-sim/shared-types";

const session = (day: TrainingSession["day"], slot: number, category = "TACTICAL"): TrainingSession =>
  ({ day, slot, category, intensity: "NORMAL", targetGroup: "FIRST_TEAM" }) as unknown as TrainingSession;

describe("weekly training planner", () => {
  it("2. orders sessions by slot within a day", () => {
    const sessions = [
      session("MONDAY", 2),
      session("MONDAY", 1),
      session("TUESDAY", 1),
    ];
    const week = weekSessions(sessions);
    expect(week[0].day).toBe("MONDAY");
    expect(week[0].sessions.map((s) => s.slot)).toEqual([1, 2]);
    expect(week[1].sessions).toHaveLength(1);
  });

  it("4. empty sessions yield a genuinely empty week (no fake sessions)", () => {
    const week = weekSessions([]);
    expect(week).toHaveLength(7);
    expect(week.every((day) => day.sessions.length === 0)).toBe(true);
  });

  it("session day labels are short and deterministic", () => {
    expect(sessionDayLabel("MONDAY")).toBe("MON");
    expect(sessionDayLabel("SUNDAY")).toBe("SUN");
  });

  it("5/6. readiness derives only from real development fields, absent when empty", () => {
    expect(readiness({ squadDevelopment: [] } as unknown as TrainingView)).toBeUndefined();
    const view = {
      squadDevelopment: [
        { personId: "p1", name: "a", phase: "X", momentum: 0, fatigue: 60, matchSharpness: 70 },
        { personId: "p2", name: "b", phase: "X", momentum: 0, fatigue: 40, matchSharpness: 90 },
      ],
    } as unknown as TrainingView;
    const r = readiness(view);
    expect(r?.averageFatigue).toBe(50);
    expect(r?.averageSharpness).toBe(80);
    expect(r?.count).toBe(2);
  });
});