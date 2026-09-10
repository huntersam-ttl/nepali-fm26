import type React from "react";
import { useEffect, useRef } from "react";

/**
 * Keyboard/screen-reader plumbing every modal overlay needs but that a bare
 * `<div role="dialog" aria-modal="true">` does not provide on its own:
 *
 *  - moves focus into the dialog on open (so the next Tab lands on a control
 *    inside it, not somewhere on the page behind it),
 *  - keeps Tab / Shift+Tab cycling within the dialog while it is open,
 *  - closes it on Escape,
 *  - restores focus to whatever was focused before it opened, on close.
 *
 * Attach the returned ref to the dialog container element. `onClose` is the
 * same handler the dialog's Close button already calls.
 */
export const useDialogFocus = <T extends HTMLElement>(onClose: () => void): React.RefObject<T> => {
  const containerRef = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      [
        ...container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null || el === document.activeElement);

    const initial = focusables()[0];
    if (initial) initial.focus();
    else {
      container.setAttribute("tabindex", "-1");
      container.focus();
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, []);

  return containerRef as React.RefObject<T>;
};
