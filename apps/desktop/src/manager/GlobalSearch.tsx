import React, { useRef, useState } from "react";
import type { EntityReference, EntityReferenceType, GlobalSearchResult } from "@nepal-football-sim/shared-types";
import type { DesktopRuntimeApi } from "../appBridge.js";
import { entityTypeTitle } from "../navigation.js";

/**
 * Phase 1C — persistent global football-world search.
 *
 * A single control on the shell (available to every role) that opens a focused
 * search palette. Typing runs the bounded server-side search; results are
 * group-labelled by entity type; activating a result navigates through the
 * Phase 1B canonical entity destination system (ManagerCareer maps the
 * reference via referenceToDestination). This component never fetches full
 * entity records and never renders profile data — it is navigation only.
 *
 * Accessibility: a labelled input + semantic listbox/option buttons, no focus
 * trap, Escape to close, arrow/Enter keyboard control, and a polite live region
 * that announces the result count.
 */
export const GlobalSearch = ({
  bridge,
  onNavigateEntity,
}: {
  bridge: DesktopRuntimeApi;
  onNavigateEntity: (reference: EntityReference) => void;
}): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openSearch = (): void => {
    setOpen(true);
    setQuery("");
    setResults([]);
    setStatus("idle");
    setErrorMsg(null);
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const closeSearch = (): void => {
    setOpen(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    seqRef.current += 1; // invalidate any in-flight response
  };

  const runSearch = (value: string): void => {
    const q = value.trim();
    const sequence = ++seqRef.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q) {
      setStatus("idle");
      setResults([]);
      setActiveIndex(0);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setStatus("loading");
      setActiveIndex(0);
      void bridge.searchFootballWorld?.({ query: q, limit: 20 }).then((result) => {
        if (sequence !== seqRef.current) return; // stale request
        if (result.ok) {
          setResults(result.data);
          setStatus("ready");
          setErrorMsg(null);
        } else {
          setResults([]);
          setStatus("error");
          setErrorMsg(result.error.message);
        }
      });
    }, 200);
  };

  const onQueryChange = (value: string): void => {
    setQuery(value);
    runSearch(value);
  };

  const selectResult = (result: GlobalSearchResult): void => {
    onNavigateEntity(result.reference);
    closeSearch();
  };

  const flat = results;

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, flat.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      const result = flat[activeIndex];
      if (result) {
        event.preventDefault();
        selectResult(result);
      }
    }
  };

  const groups = new Map<EntityReferenceType, GlobalSearchResult[]>();
  let flattened: GlobalSearchResult[] = [];
  for (const result of results) {
    flattened = [...flattened, result];
    const list = groups.get(result.entityType) ?? [];
    list.push(result);
    groups.set(result.entityType, list);
  }

  return (
    <>
      <button type="button" className="global-search-trigger" aria-label="Search football world" onClick={openSearch}>
        Search
      </button>
      {open && (
        <div className="global-search-layer" onMouseDown={closeSearch}>
          <div
            className="global-search"
            role="dialog"
            aria-label="Search football world"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="global-search-header">
              <label className="global-search-field">
                <span>Search football world</span>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Club, player, staff, competition…"
                  aria-label="Search football world"
                  autoComplete="off"
                />
              </label>
              <button type="button" className="ghost small" onClick={closeSearch}>
                Close
              </button>
            </div>

            <div className="global-search-body" aria-label="Search results">
              {status === "idle" && <p className="subtle">Type to search clubs, players, staff and competitions.</p>}
              {status === "loading" && (
                <p className="subtle" role="status">
                  Searching…
                </p>
              )}
              {status === "error" && (
                <p className="warning" role="alert">
                  {errorMsg}
                </p>
              )}
              {status === "ready" && results.length === 0 && (
                <p className="subtle">No matches for “{query.trim()}”.</p>
              )}
              {status === "ready" && results.length > 0 && (
                <>
                  {[...groups.entries()].map(([entityType, groupResults]) => (
                    <div className="global-search-group" key={entityType}>
                      <h3>{entityTypeTitle(entityType)}</h3>
                      {groupResults.map((result) => {
                        const flatIndex = flattened.indexOf(result);
                        return (
                          <button
                            key={`${result.entityType}:${result.reference.id}`}
                            type="button"
                            className={`global-search-result${flatIndex === activeIndex ? " active" : ""}`}
                            aria-current={flatIndex === activeIndex ? "true" : undefined}
                            onMouseDown={() => selectResult(result)}
                          >
                            <span className="global-search-result-name">{result.displayName}</span>
                            {result.secondaryLabel && (
                              <span className="global-search-result-context">{result.secondaryLabel}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </>
              )}
            </div>
            <p className="sr-only" role="status" aria-live="polite">
              {status === "ready" ? `${results.length} result${results.length === 1 ? "" : "s"}` : ""}
            </p>
          </div>
        </div>
      )}
    </>
  );
};