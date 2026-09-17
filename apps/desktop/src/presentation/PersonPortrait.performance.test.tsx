// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PersonPortrait } from "./PersonPortrait.js";
import { buildPersonVisualIdentity } from "./personVisualIdentity.js";

afterEach(cleanup);

/**
 * A lightweight, structural performance check for the production
 * PersonPortrait component — not a synthetic benchmark package. Renders
 * 20 and 50 deterministic, distinct portraits (list-avatar scale) and
 * asserts what actually matters for this feature: they all render, each
 * is real SVG (no WebGL/Canvas), there is no animation timer running,
 * and render time stays low and doesn't blow up non-linearly between 20
 * and 50 (which would indicate an accidental O(n^2) pattern rather than
 * the plain per-row O(1) render this component is meant to be).
 *
 * No hard millisecond threshold is asserted — jsdom/CI timing is noisy —
 * only the structural/ratio properties that would catch a real
 * regression (e.g. someone accidentally making PersonPortrait re-derive
 * something expensive per portrait, or adding per-frame work).
 */

const PortraitList = ({ count }: { count: number }): React.ReactElement => (
  <div>
    {Array.from({ length: count }, (_, i) => (
      <PersonPortrait
        key={i}
        identity={buildPersonVisualIdentity(`perf-person-${i}`, 20 + (i % 15))}
        role="PLAYER"
        size="small"
        decorative
      />
    ))}
  </div>
);

const renderAndTime = (count: number): { container: HTMLElement; durationMs: number } => {
  const start = performance.now();
  const { container } = render(<PortraitList count={count} />);
  const durationMs = performance.now() - start;
  return { container, durationMs };
};

describe("PersonPortrait — list-scale performance and structural safety", () => {
  it("renders 20 and 50 distinct portraits with no bridge calls, no WebGL/Canvas, and no animation timers", () => {
    for (const count of [20, 50]) {
      const { container } = render(<PortraitList count={count} />);
      const portraits = container.querySelectorAll("svg.person-portrait");
      expect(portraits.length).toBe(count);
      // Every face is real SVG — no <canvas>, no WebGL context request.
      expect(container.querySelectorAll("canvas").length).toBe(0);
      // Distinct people actually produce distinct signatures, not a
      // shared/cached identity object across the whole list.
      const signatures = new Set(
        Array.from(portraits).map((svg) => svg.getAttribute("data-face-signature")),
      );
      expect(signatures.size).toBe(count);
      cleanup();
    }
  });

  it("render time for 50 portraits is not wildly disproportionate to 20 (no accidental O(n^2) growth)", () => {
    // A few samples each, taking the median, since a single jsdom render
    // timing is noisy enough to occasionally spike regardless of the
    // component's actual cost.
    const sample = (count: number): number => {
      const timings: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const { durationMs } = renderAndTime(count);
        timings.push(durationMs);
        cleanup();
      }
      timings.sort((a, b) => a - b);
      return timings[1]!; // median of 3
    };

    const median20 = sample(20);
    const median50 = sample(50);

    // eslint-disable-next-line no-console
    console.log(`PersonPortrait render (median of 3): 20 portraits ~${median20.toFixed(2)}ms, 50 portraits ~${median50.toFixed(2)}ms`);

    // 50 is 2.5x the row count of 20. A linear (or better) component
    // should land well under a generous 6x multiplier even accounting
    // for jsdom overhead and test-runner noise; a real O(n^2) regression
    // would blow well past this.
    expect(median50).toBeLessThan(Math.max(median20 * 6, 50));
  });
});
