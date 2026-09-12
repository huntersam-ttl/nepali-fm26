// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MotionEnter, MotionValue, useEntranceClass, useNewlyArrived } from "./MotionPrimitives.js";
import { writeScenePreferences } from "./scenePreferences.js";

/**
 * The wired micro-animations, checked through the same preference the player
 * actually sets. A motion setting that the components quietly ignore is worse
 * than no setting at all, so each one is asserted at Full, Reduced and Off.
 */

beforeEach(() => {
  globalThis.localStorage?.clear();
});
afterEach(cleanup);

const setMotion = (motion: "FULL" | "REDUCED" | "OFF"): void =>
  writeScenePreferences({ enabled3d: true, quality: "HIGH", motion });

const EntranceProbe = (): React.ReactElement => {
  const entrance = useEntranceClass();
  return <div data-testid="probe" className={entrance} />;
};

describe("useEntranceClass", () => {
  it("applies the entrance at Full", () => {
    setMotion("FULL");
    render(<EntranceProbe />);
    expect(screen.getByTestId("probe").className).toBe("motion-enter");
  });

  it("applies nothing at all at Reduced or Off — an entrance carries no information", () => {
    for (const motion of ["REDUCED", "OFF"] as const) {
      setMotion(motion);
      const view = render(<EntranceProbe />);
      expect(screen.getByTestId("probe").className).toBe("");
      view.unmount();
    }
  });

  it("never hides the element it decorates, so a suspended animation cannot blank the UI", () => {
    // The entrance must be expressible as a class alone. An inline opacity:0
    // awaiting a requestAnimationFrame would leave panels invisible in a
    // window WebKit has suspended, which is the failure this guards.
    setMotion("FULL");
    render(<EntranceProbe />);
    expect(screen.getByTestId("probe").getAttribute("style")).toBeNull();
  });
});

describe("MotionEnter", () => {
  it("renders its children in every motion mode", () => {
    for (const motion of ["FULL", "REDUCED", "OFF"] as const) {
      setMotion(motion);
      const view = render(<MotionEnter>Squad depth</MotionEnter>);
      expect(screen.getByText("Squad depth")).toBeTruthy();
      view.unmount();
    }
  });
});

const ArrivalProbe = ({ ids }: { ids: string[] }): React.ReactElement => {
  const arrived = useNewlyArrived(ids);
  return (
    <ul>
      {ids.map((id) => (
        <li key={id} data-testid={id} className={arrived.has(id) ? "inbox-item-new" : "inbox-item"} />
      ))}
    </ul>
  );
};

describe("useNewlyArrived", () => {
  it("marks nothing on first render — on open every item is new, which is not information", () => {
    setMotion("FULL");
    render(<ArrivalProbe ids={["a", "b"]} />);
    expect(screen.getByTestId("a").className).toBe("inbox-item");
    expect(screen.getByTestId("b").className).toBe("inbox-item");
  });

  it("marks only the item that actually arrived", () => {
    setMotion("FULL");
    const view = render(<ArrivalProbe ids={["a", "b"]} />);
    act(() => {
      view.rerender(<ArrivalProbe ids={["a", "b", "c"]} />);
    });
    expect(screen.getByTestId("a").className).toBe("inbox-item");
    expect(screen.getByTestId("c").className).toBe("inbox-item-new");
  });

  it("marks nothing when the player has reduced or turned off motion", () => {
    for (const motion of ["REDUCED", "OFF"] as const) {
      setMotion(motion);
      const view = render(<ArrivalProbe ids={["a"]} />);
      act(() => {
        view.rerender(<ArrivalProbe ids={["a", "b"]} />);
      });
      expect(screen.getByTestId("b").className).toBe("inbox-item");
      view.unmount();
    }
  });

  it("does not re-mark an item that merely moved position in the list", () => {
    setMotion("FULL");
    const view = render(<ArrivalProbe ids={["a", "b"]} />);
    act(() => {
      view.rerender(<ArrivalProbe ids={["b", "a"]} />);
    });
    expect(screen.getByTestId("a").className).toBe("inbox-item");
    expect(screen.getByTestId("b").className).toBe("inbox-item");
  });
});

describe("MotionValue", () => {
  it("states a change as text, never by colour or movement alone", () => {
    setMotion("FULL");
    const view = render(<MotionValue value={40} label="squad morale" />);
    act(() => {
      view.rerender(<MotionValue value={44} label="squad morale" />);
    });
    expect(screen.getByText(/squad morale increased/i)).toBeTruthy();
  });

  it("says nothing when the number did not change", () => {
    setMotion("FULL");
    const view = render(<MotionValue value={40} label="squad morale" />);
    act(() => {
      view.rerender(<MotionValue value={40} label="squad morale" />);
    });
    expect(screen.queryByText(/increased|decreased/i)).toBeNull();
  });

  it("still shows the number itself when motion is off", () => {
    setMotion("OFF");
    const view = render(<MotionValue value={40} format={(value) => `${value}%`} />);
    act(() => {
      view.rerender(<MotionValue value={44} format={(value) => `${value}%`} />);
    });
    expect(screen.getByText("44%")).toBeTruthy();
    expect(screen.queryByText(/increased/i)).toBeNull();
  });
});
