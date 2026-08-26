import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AppResult,
  EntityId,
  LiveMatchView,
  MatchCommentaryLine,
} from "@nepal-football-sim/shared-types";
import type { AppError } from "../../appBridge.js";
import { managerBridge } from "../managerBridge.js";

export type PlaybackSpeed = 1 | 2 | 4 | 8;

/** Delay between auto-advance commands. Presentation pacing only. */
const SPEED_DELAY_MS: Record<PlaybackSpeed, number> = { 1: 1400, 2: 700, 4: 400, 8: 250 };

/**
 * Match minutes per tick. Faster speeds take bigger steps rather than firing
 * ever more round-trips, so 8x does not mean ninety commands.
 */
const SPEED_STEP_MINUTES: Record<PlaybackSpeed, number> = { 1: 1, 2: 1, 4: 3, 8: 6 };

export type MatchControllerState = {
  view?: LiveMatchView;
  /** Accumulated commentary; the cursor means we never refetch the whole feed. */
  commentary: MatchCommentaryLine[];
  error?: AppError;
  busy: boolean;
  playing: boolean;
  speed: PlaybackSpeed;
  finished: boolean;
};

/**
 * Owns all live-match command traffic for a fixture.
 *
 * Two rules it enforces: exactly one command is in flight at a time, and
 * playback is a chain of bounded commands driven by timers — never a loop that
 * blocks the UI thread.
 */
export const useMatchController = (fixtureId: EntityId) => {
  const [state, setState] = useState<MatchControllerState>({
    commentary: [],
    busy: false,
    playing: false,
    speed: 2,
    finished: false,
  });

  // Single-flight guard: a ref so concurrent callers see it synchronously.
  const inFlight = useRef(false);
  const playingRef = useRef(false);
  const speedRef = useRef<PlaybackSpeed>(2);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursor = useRef<number>(-1);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const absorb = useCallback((view: LiveMatchView, replaceFeed: boolean) => {
    cursor.current = view.cursor;
    setState((previous) => ({
      ...previous,
      view,
      error: undefined,
      finished: view.period === "FULL_TIME",
      commentary: replaceFeed
        ? view.commentary
        : mergeCommentary(previous.commentary, view.commentary),
    }));
  }, []);

  /**
   * Runs one command. Returns undefined if another command is already running,
   * which is how rapid double-clicks are absorbed.
   */
  const run = useCallback(
    async (
      command: () => Promise<AppResult<LiveMatchView | undefined>>,
      options: { replaceFeed?: boolean } = {},
    ): Promise<LiveMatchView | undefined> => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setState((previous) => ({ ...previous, busy: true }));
      try {
        const result = await command();
        if (!mounted.current) return undefined;
        if (!result.ok) {
          // A failed command stops playback so the player can read the reason.
          playingRef.current = false;
          setState((previous) => ({
            ...previous,
            error: result.error,
            busy: false,
            playing: false,
          }));
          return undefined;
        }
        if (result.data) absorb(result.data, Boolean(options.replaceFeed));
        setState((previous) => ({ ...previous, busy: false }));
        return result.data;
      } finally {
        inFlight.current = false;
      }
    },
    [absorb],
  );

  const stopPlayback = useCallback(() => {
    playingRef.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setState((previous) => ({ ...previous, playing: false }));
  }, []);

  // --- commands -------------------------------------------------------------

  const start = useCallback(
    (viewMode: LiveMatchView["viewMode"]) =>
      run(() => managerBridge.startMatch({ fixtureId, viewMode }), { replaceFeed: true }),
    [fixtureId, run],
  );

  const resume = useCallback(
    () => run(() => managerBridge.getLiveMatch(fixtureId), { replaceFeed: true }),
    [fixtureId, run],
  );

  const advanceMinutes = useCallback(
    (minutes: number) =>
      run(() =>
        managerBridge.advanceMatch(
          { minutes, since: cursor.current >= 0 ? cursor.current : undefined },
          fixtureId,
        ),
      ),
    [fixtureId, run],
  );

  const advanceToNextEvent = useCallback(
    (minImportance: "NOTABLE" | "MAJOR" = "MAJOR") =>
      run(() =>
        managerBridge.advanceMatch(
          {
            toNextEvent: true,
            minImportance,
            since: cursor.current >= 0 ? cursor.current : undefined,
          },
          fixtureId,
        ),
      ),
    [fixtureId, run],
  );

  const continueSecondHalf = useCallback(
    () => run(() => managerBridge.continueFromHalfTime(fixtureId)),
    [fixtureId, run],
  );

  const substitute = useCallback(
    (playerOffId: EntityId, playerOnId: EntityId) =>
      run(() => managerBridge.makeSubstitution({ playerOffId, playerOnId }, fixtureId), {
        replaceFeed: true,
      }),
    [fixtureId, run],
  );

  const changeTactics = useCallback(
    (command: Parameters<typeof managerBridge.updateLiveTactics>[0]) =>
      run(() => managerBridge.updateLiveTactics(command, fixtureId), { replaceFeed: true }),
    [fixtureId, run],
  );

  const quickSimRest = useCallback(async () => {
    stopPlayback();
    return run(() => managerBridge.quickSimCurrentMatch(fixtureId), { replaceFeed: true });
  }, [fixtureId, run, stopPlayback]);

  // --- playback -------------------------------------------------------------

  /**
   * Schedules the next advance. Each tick is one bounded command; the timer is
   * only re-armed after the previous command resolves, so commands cannot pile
   * up if the runtime is slow.
   */
  const scheduleTick = useCallback(
    (mode: LiveMatchView["viewMode"]) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!playingRef.current || !mounted.current) return;
        const step =
          mode === "KEY_EVENTS"
            ? advanceToNextEvent("MAJOR")
            : advanceMinutes(SPEED_STEP_MINUTES[speedRef.current]);
        void step.then((view) => {
          if (!mounted.current) return;
          // The backend decides when the manager must stop.
          if (!view || view.period === "FULL_TIME" || view.pauseReason) {
            stopPlayback();
            return;
          }
          if (playingRef.current) scheduleTick(mode);
        });
      }, SPEED_DELAY_MS[speedRef.current]);
    },
    [advanceMinutes, advanceToNextEvent, stopPlayback],
  );

  const play = useCallback(
    (mode: LiveMatchView["viewMode"]) => {
      if (playingRef.current) return;
      playingRef.current = true;
      setState((previous) => ({ ...previous, playing: true }));
      scheduleTick(mode);
    },
    [scheduleTick],
  );

  const setSpeed = useCallback((speed: PlaybackSpeed) => {
    speedRef.current = speed;
    setState((previous) => ({ ...previous, speed }));
  }, []);

  const clearError = useCallback(
    () => setState((previous) => ({ ...previous, error: undefined })),
    [],
  );

  return {
    state,
    start,
    resume,
    advanceMinutes,
    advanceToNextEvent,
    continueSecondHalf,
    substitute,
    changeTactics,
    quickSimRest,
    play,
    pause: stopPlayback,
    setSpeed,
    clearError,
  };
};

/** Appends only genuinely new lines, keyed by sequence. */
const mergeCommentary = (
  existing: MatchCommentaryLine[],
  incoming: MatchCommentaryLine[],
): MatchCommentaryLine[] => {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((line) => line.sequence));
  const additions = incoming.filter((line) => !seen.has(line.sequence));
  return additions.length === 0 ? existing : [...existing, ...additions];
};
