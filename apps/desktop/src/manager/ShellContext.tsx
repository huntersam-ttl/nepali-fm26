import React, { useEffect, useRef, useState } from "react";
import type { EntityId, EntityReference, EntityReferenceType } from "@nepal-football-sim/shared-types";
import type { DesktopRuntimeApi } from "../appBridge.js";
import type { AppDestination } from "../navigation.js";
import type { ContextualNavItem } from "./navigationLabels.js";

/**
 * Phase 1D — reusable shell-context building blocks.
 *
 * Breadcrumbs render a bounded context trail as semantic navigation; the
 * contextual secondary nav lists the current workspace family's navigable
 * siblings; useEntityReferenceLabels cheaply resolves entity breadcrumb names
 * via the lightweight getEntityReference read model (single-row, not a full
 * profile refetch) with the entity-category label as an immediate fallback.
 */

export const Breadcrumbs = ({
  items,
  onNavigate,
}: {
  items: Array<{ destination: AppDestination; label: string; current: boolean }>;
  onNavigate: (destination: AppDestination) => void;
}): React.ReactElement | null => {
  if (items.length <= 1) return null;
  return (
    <nav aria-label="Breadcrumb">
      <ol className="breadcrumb-list">
        {items.map((item, index) => (
          <li key={index}>
            {item.current ? (
              <span aria-current="page">{item.label}</span>
            ) : (
              <button type="button" className="link" onClick={() => onNavigate(item.destination)}>
                {item.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
};

export const ContextualNav = ({
  items,
  onNavigate,
}: {
  items: ContextualNavItem[];
  onNavigate: (id: string) => void;
}): React.ReactElement | null => {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Workspace sections">
      <div className="contextual-nav">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.current ? "active" : ""}
            aria-current={item.current ? "true" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
};

/** Resolves entity labels for a set of `type:id` keys using getEntityReference,
 * cached for the lifetime of the shell. Returns the current cache. */
export const useEntityReferenceLabels = (
  keys: string[],
  bridge: DesktopRuntimeApi,
): Map<string, string> => {
  const cache = useRef<Map<string, string>>(new Map());
  const [, setTick] = useState(0);
  const joined = keys.join("|");
  useEffect(() => {
    let mounted = true;
    for (const key of keys) {
      if (cache.current.has(key)) continue;
      const [type, id] = key.split("::");
      void bridge.getEntityReference?.(type as EntityReferenceType, id as EntityId).then((result) => {
        if (mounted && result.ok && !cache.current.has(key)) {
          const reference = (result as { ok: true; data: EntityReference }).data;
          cache.current.set(key, reference.label);
          setTick((value) => value + 1);
        }
      });
    }
    return () => {
      mounted = false;
    };
    // Re-resolve only when the set of entity crumbs changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, bridge]);
  return cache.current;
};