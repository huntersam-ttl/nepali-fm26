import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AppResult, Fact } from "@nepal-football-sim/shared-types";
import type { AppError } from "../appBridge.js";
import { useEntranceClass } from "../presentation/MotionPrimitives.js";

/**
 * Every save-backed screen goes through this: one place that handles the
 * loading / error / empty / success states the runtime can return.
 */
export type Async<T> =
  { status: "loading" } | { status: "error"; error: AppError } | { status: "ready"; data: T };

/**
 * Keyboard-accessibility helper for any "open an overlay panel from a
 * triggering button" flow (a press conference opened from an Inbox item,
 * an organization profile, a player context panel, ...). Without this, a
 * panel that unmounts on close leaves the browser's default behavior to
 * move focus to <body> — invisible to a sighted user, but a real dead end
 * for anyone navigating by keyboard, since the next Tab press restarts
 * from the top of the page instead of continuing where they were.
 * `capture()` records the currently-focused element when the panel opens;
 * `restore()` re-focuses it once the panel unmounts, if it's still
 * attached to the document — but the exact triggering element is often
 * gone by then (e.g. an Inbox row that disappeared because the very
 * interview being closed just completed), so this always falls back to
 * the page's own role heading (every role dashboard renders exactly one
 * <h1>), never leaving focus stranded on <body>.
 */
export const useReturnFocusOnClose = (): { capture: () => void; restore: () => void } => {
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const capture = useCallback(() => {
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  const restore = useCallback(() => {
    const target = previouslyFocused.current;
    previouslyFocused.current = null;
    // The caller (onClose) typically also triggers a data refresh, which
    // itself briefly unmounts/remounts the whole dashboard subtree (see
    // useRuntimeData/AsyncPanel) — including the very <h1> fallback this
    // is trying to focus. A single deferred call can lose the race against
    // that remount, so this polls briefly (a real DOM mutation settling,
    // not an arbitrary fixed delay) until a focus actually sticks.
    let attempts = 0;
    const attempt = (): void => {
      attempts += 1;
      // Scoped to the specific programmatically-focusable heading
      // (tabIndex=-1) this hook owns — a bare "h1" selector can match an
      // unrelated, non-focusable heading rendered earlier in the DOM (e.g.
      // the sidebar's own club-name <h1>), on which .focus() is silently a
      // no-op.
      const fallback = document.querySelector<HTMLElement>('h1[tabindex="-1"]');
      const restoreTarget = target && target.isConnected ? target : fallback;
      restoreTarget?.focus();
      if (document.activeElement === restoreTarget && restoreTarget) return;
      if (attempts < 20) setTimeout(attempt, 50);
    };
    setTimeout(attempt, 0);
  }, []);
  return { capture, restore };
};

export const useRuntimeData = <T,>(
  load: () => Promise<AppResult<T>>,
  deps: React.DependencyList = [],
): [Async<T>, () => void, (data: T) => void] => {
  const [state, setState] = useState<Async<T>>({ status: "loading" });

  const refresh = useCallback(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void load().then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { status: "ready", data: result.data }
          : { status: "error", error: result.error },
      );
    });
    return () => {
      cancelled = true;
    };
    // `deps` is the caller-supplied dependency list for the loader.
  }, deps);

  useEffect(() => refresh(), [refresh]);

  const replace = useCallback((data: T) => setState({ status: "ready", data }), []);
  return [state, refresh, replace];
};

export const AsyncPanel = <T,>({
  state,
  children,
  empty,
  isEmpty,
}: {
  state: Async<T>;
  children: (data: T) => React.ReactNode;
  empty?: React.ReactNode;
  isEmpty?: (data: T) => boolean;
}): React.ReactElement => {
  if (state.status === "loading") return <p className="muted">Loading…</p>;
  if (state.status === "error") return <ErrorBanner error={state.error} />;
  if (isEmpty?.(state.data)) return <EmptyState>{empty ?? "Nothing to show."}</EmptyState>;
  return <>{children(state.data)}</>;
};

export const ErrorBanner = ({ error }: { error: AppError }): React.ReactElement => (
  <div className="warning" role="alert">
    <strong>{error.code === "SIMULATION_ERROR" ? "Could not complete that action" : error.code}</strong>{" "}{error.message}
    {error.detail && <details><summary>Show details</summary><code>{error.detail}</code></details>}
  </div>
);

export const EmptyState = ({ children }: { children: React.ReactNode }): React.ReactElement => (
  <p className="empty-state">{children}</p>
);

export const Panel = ({
  title,
  actions,
  className,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  /** Lets a panel opt out of the dashboard's auto-fit column, e.g. a wide table. */
  className?: string;
  children: React.ReactNode;
}): React.ReactElement => {
  // Every panel in the game is built from this one component, so the entrance
  // is wired here rather than repeated per screen. Panels remount when the
  // player changes section, which is what makes a section change read as a
  // change rather than an instant swap. Reduced/Off get no transition at all.
  const entrance = useEntranceClass();
  const classes = ["panel", className, entrance].filter(Boolean).join(" ");
  return (
    <article className={classes}>
      <header className="panel-head">
        <h2>{title}</h2>
        {actions}
      </header>
      {children}
    </article>
  );
};

/** Renders an unknown fact honestly instead of inventing a value. */
export const FactValue = <T,>({
  fact,
  render,
}: {
  fact: Fact<T>;
  render?: (value: T) => React.ReactNode;
}): React.ReactElement => {
  if (fact.value === undefined) return <span className="unknown">Unknown</span>;
  const body = render ? render(fact.value) : String(fact.value);
  return fact.status === "SIMULATION_ONLY" ? (
    <span title="Simulated value, not a researched real-world fact">
      {body} <span className="sim-tag">sim</span>
    </span>
  ) : (
    <span>{body}</span>
  );
};

export const Badge = ({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "info";
  children: React.ReactNode;
}): React.ReactElement => <span className={`badge badge-${tone}`}>{children}</span>;

export const availabilityTone = (availability: string): "ok" | "warn" | "bad" | "info" => {
  switch (availability) {
    case "AVAILABLE":
      return "ok";
    case "INJURED":
      return "bad";
    case "SUSPENDED":
      return "warn";
    default:
      return "info";
  }
};

export const Metrics = ({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode }>;
}): React.ReactElement => (
  <dl className="metrics">
    {items.map((item) => (
      <div key={item.label}>
        <dt>{item.label}</dt>
        <dd>{item.value}</dd>
      </div>
    ))}
  </dl>
);

export const FormRun = ({ form }: { form: string[] }): React.ReactElement => (
  <span className="form-run">
    {form.length === 0 ? (
      <span className="muted">No results yet</span>
    ) : (
      form.map((result, index) => (
        <span key={`${result}-${index}`} className={`form-pip form-${result}`}>
          {result}
        </span>
      ))
    )}
  </span>
);

export const money = (amount?: number, currency = "NPR"): string =>
  amount === undefined ? "—" : `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
