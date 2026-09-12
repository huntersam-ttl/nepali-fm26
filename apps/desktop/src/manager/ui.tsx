import React, { useCallback, useEffect, useState } from "react";
import type { AppResult, Fact } from "@nepal-football-sim/shared-types";
import type { AppError } from "../appBridge.js";
import { useEntranceClass } from "../presentation/MotionPrimitives.js";

/**
 * Every save-backed screen goes through this: one place that handles the
 * loading / error / empty / success states the runtime can return.
 */
export type Async<T> =
  { status: "loading" } | { status: "error"; error: AppError } | { status: "ready"; data: T };

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
