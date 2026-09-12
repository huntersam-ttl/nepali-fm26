// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { SceneCanvas, SceneErrorBoundary, type SceneHandle } from "./SceneCanvas.js";
import { qualitySettings } from "./scenePreferences.js";

/**
 * A broken 3D scene is a cosmetic problem. It must never take the surrounding
 * screen — the club's finances, squad and navigation — down with it, and it
 * must never leave the player staring at an empty rectangle with no way to
 * read the same information. Both failure paths are covered here because
 * neither can be checked by looking at a screenshot of a working machine.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const fallback = <p>Club overview, in text</p>;

// Each of these paths first does `await import("three")`, and loading a module
// that size in a cold worker under parallel test load comfortably exceeds
// waitFor's one-second default. The wait is for the module, not the assertion.
const THREE_LOAD = { timeout: 20000 };

describe("SceneCanvas failure handling", () => {
  it("shows the 2D fallback when the renderer cannot start", async () => {
    // happy-dom has no WebGL, so constructing the real renderer throws — the
    // same thing that happens to a player whose driver refuses a context.
    render(
      <SceneCanvas
        factory={async () => ({ scene: {}, camera: {}, update: () => {}, pickables: [], dispose: () => {} })}
        quality={qualitySettings("MEDIUM")}
        motion="OFF"
        ariaLabel="Club campus"
        fallback={fallback}
      />,
    );
    await waitFor(() => expect(screen.getByText("Club overview, in text")).toBeTruthy(), THREE_LOAD);
  });

  it("shows the 2D fallback when building the scene itself fails", async () => {
    render(
      <SceneCanvas
        factory={async () => {
          throw new Error("scene build failed");
        }}
        quality={qualitySettings("MEDIUM")}
        motion="OFF"
        ariaLabel="Club campus"
        fallback={fallback}
      />,
    );
    await waitFor(() => expect(screen.getByText("Club overview, in text")).toBeTruthy(), THREE_LOAD);
  });

  it("disposes the scene it built when it unmounts", async () => {
    const dispose = vi.fn();
    const handle: SceneHandle = {
      scene: {},
      camera: {},
      update: () => {},
      pickables: [],
      dispose,
    };
    const view = render(
      <SceneCanvas
        factory={async () => handle}
        quality={qualitySettings("MEDIUM")}
        motion="OFF"
        ariaLabel="Club campus"
        fallback={fallback}
      />,
    );
    await waitFor(() => expect(screen.getByText("Club overview, in text")).toBeTruthy(), THREE_LOAD);
    view.unmount();
    expect(dispose).toHaveBeenCalled();
  });
});

describe("SceneErrorBoundary", () => {
  const Exploding = (): React.ReactElement => {
    throw new Error("scene threw during render");
  };

  it("keeps the rest of the screen usable when a scene throws during render", () => {
    // React logs the caught error; silence it so a passing run stays readable.
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <SceneErrorBoundary fallback={fallback}>
          <Exploding />
        </SceneErrorBoundary>
        <button type="button">Open squad</button>
      </div>,
    );
    expect(screen.getByText("Club overview, in text")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open squad" })).toBeTruthy();
  });

  it("stays out of the way when the scene renders fine", () => {
    render(
      <SceneErrorBoundary fallback={fallback}>
        <p>3D club campus</p>
      </SceneErrorBoundary>,
    );
    expect(screen.getByText("3D club campus")).toBeTruthy();
    expect(screen.queryByText("Club overview, in text")).toBeNull();
  });
});
