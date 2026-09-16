// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PersonPortrait } from "./PersonPortrait.js";
import { buildPersonVisualIdentity } from "./personVisualIdentity.js";

afterEach(cleanup);

const identity = buildPersonVisualIdentity("portrait-test-person");

describe("PersonPortrait", () => {
  it("labels itself with an accessible name when one is given", () => {
    const { container } = render(<PersonPortrait identity={identity} role="PLAYER" size="large" name="Arik Bista" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Arik Bista portrait");
    expect(svg.hasAttribute("aria-hidden")).toBe(false);
  });

  it("falls back to a generic accessible name when none is given", () => {
    const { container } = render(<PersonPortrait identity={identity} role="PLAYER" size="large" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-label")).toBe("Portrait");
  });

  it("is hidden from assistive tech when decorative — for a list row whose adjacent text already names the person", () => {
    const { container } = render(
      <PersonPortrait identity={identity} role="PLAYER" size="small" name="Arik Bista" decorative />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.hasAttribute("role")).toBe(false);
    expect(svg.hasAttribute("aria-label")).toBe(false);
  });

  it("renders a secondary-colour collar detail only for PLAYER attire, and only when a secondary colour is supplied", () => {
    const withSecondary = render(
      <PersonPortrait
        identity={identity}
        role="PLAYER"
        size="large"
        clubPrimaryColour="#112233"
        clubSecondaryColour="#ffcc00"
      />,
    );
    const trim = withSecondary.container.querySelector('path[fill="#ffcc00"]');
    expect(trim).not.toBeNull();
    withSecondary.unmount();

    const withoutSecondary = render(<PersonPortrait identity={identity} role="PLAYER" size="large" clubPrimaryColour="#112233" />);
    expect(withoutSecondary.container.querySelector('path[fill="#ffcc00"]')).toBeNull();
    withoutSecondary.unmount();

    // Never applied outside PLAYER attire — an Owner/Manager/President
    // keeps their single-tone attire even when a secondary colour is
    // passed, since that prop's own contract is "player attire only".
    const owner = render(
      <PersonPortrait
        identity={identity}
        role="OWNER"
        size="large"
        clubPrimaryColour="#112233"
        clubSecondaryColour="#ffcc00"
      />,
    );
    expect(owner.container.querySelector('path[fill="#ffcc00"]')).toBeNull();
  });
});
