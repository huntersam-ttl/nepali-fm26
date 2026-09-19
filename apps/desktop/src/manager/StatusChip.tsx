import React from "react";
import { statusTone } from "./appearance.js";

/**
 * Phase 2A reusable status chip. One small primitive for STATUS vs NAVIGATION
 * TAB vs FILTER CHIP (via `kind`), each with its own visual grammar in CSS — so
 * a status pill is never confused with a tab or a filter. Tones are derived
 * from the shared `statusTone` mapping (unknown/provenance values read neutral,
 * not red).
 */
export type ChipKind = "status" | "tab" | "filter";

export const StatusChip = ({
  status,
  label,
  kind = "status",
  active = false,
}: {
  /** Optional domain status (e.g. INJURED, VERIFIED, UNKNOWN). */
  status?: string;
  label: string;
  kind?: ChipKind;
  /** For kind="tab"/"filter": whether this is the selected state. */
  active?: boolean;
}): React.ReactElement => (
  <span
    className={`chip chip--${kind} chip--${statusTone(status)}${active ? " chip--active" : ""}`}
    role={kind === "tab" ? "presentation" : undefined}
  >
    {label}
  </span>
);