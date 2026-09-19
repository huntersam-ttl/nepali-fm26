// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StatusChip } from "./StatusChip.js";

describe("StatusChip", () => {
  it("renders a status chip with the derived tone class", () => {
    const { container } = render(<StatusChip status="VERIFIED" label="Verified" />);
    const chip = container.querySelector(".chip");
    expect(chip?.classList.contains("chip--status")).toBe(true);
    expect(chip?.classList.contains("chip--ok")).toBe(true);
  });

  it("reads unknown/provenance values as neutral, not an error", () => {
    const { container } = render(<StatusChip status="SIMULATION_ONLY" label="Simulated" />);
    expect(container.querySelector(".chip--neutral")).toBeTruthy();
    expect(container.querySelector(".chip--bad")).toBeNull();
  });

  it("supports tab/filter kinds and the active state", () => {
    const { container } = render(<StatusChip status="INJURED" label="First Team" kind="tab" active />);
    const chip = container.querySelector(".chip");
    expect(chip?.classList.contains("chip--tab")).toBe(true);
    expect(chip?.classList.contains("chip--active")).toBe(true);
  });
});