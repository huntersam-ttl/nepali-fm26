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

  it("exposes a stable, role-independent face signature that automated tests can compare instead of diffing screenshots", () => {
    const personA = buildPersonVisualIdentity("face-signature-person-a");
    const personB = buildPersonVisualIdentity("face-signature-person-b");

    const asManager = render(<PersonPortrait identity={personA} role="MANAGER" size="small" />);
    const managerSignature = asManager.container.querySelector("svg")!.getAttribute("data-face-signature");
    asManager.unmount();

    // Same person, different role/attire -> same signature (identity is
    // seeded from personId alone, never role).
    const asOwner = render(<PersonPortrait identity={personA} role="OWNER" size="large" />);
    expect(asOwner.container.querySelector("svg")!.getAttribute("data-face-signature")).toBe(managerSignature);
    asOwner.unmount();

    // A different person -> a different signature.
    const otherPerson = render(<PersonPortrait identity={personB} role="MANAGER" size="small" />);
    expect(otherPerson.container.querySelector("svg")!.getAttribute("data-face-signature")).not.toBe(
      managerSignature,
    );

    // Never the raw person id itself.
    expect(managerSignature).not.toBe("face-signature-person-a");
  });
});
