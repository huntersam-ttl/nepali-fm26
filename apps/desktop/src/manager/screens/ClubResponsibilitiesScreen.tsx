import React, { useState } from "react";
import type { ClubResponsibilitiesView, ClubResponsibilityRowView, EntityId, StaffResponsibilityDomain, StaffResponsibilityOwnerType } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Panel, useRuntimeData } from "../ui.js";

/**
 * Phase 6B — Club Responsibilities (delegation control surface).
 *
 * Makes role authority visible from the canonical StaffMarket responsibility
 * rows: who owns each responsibility today, and the valid assignees the
 * Manager may delegate to. Reassignment goes through the canonical
 * `assignStaffResponsibility` command (persisted), never a frontend-only toggle.
 *
 * Authority vs delegation: the board / institution retains ultimate authority;
 * the responsibility row records who *currently handles* a domain. Assigning a
 * responsibility to a staff member never removes institutional authority.
 */

const DOMAIN_LABEL: Record<string, string> = {
  TRANSFERS: "Transfers",
  SCOUTING: "Scouting",
  CONTRACTS: "Contracts",
  YOUTH: "Youth development",
  TRAINING: "Training",
  MEDICAL: "Medical",
};

const DOMAIN_CATEGORY: Record<string, string> = {
  TRANSFERS: "Football",
  SCOUTING: "Football",
  CONTRACTS: "Football",
  TRAINING: "Football",
  YOUTH: "Youth",
  MEDICAL: "Medical",
};

const CATEGORY_ORDER = ["Football", "Youth", "Medical"];

export const humanizeDomain = (domain: string): string =>
  DOMAIN_LABEL[domain] ?? domain.replaceAll("_", " ").toLowerCase();

const ownerLabel = (row: ClubResponsibilityRowView): string => {
  switch (row.currentOwnerType) {
    case "STAFF":
      return row.currentOwnerName ?? "Staff";
    case "BOARD":
      return "Board";
    case "MANAGER":
      return "Manager";
    default:
      return "Unassigned";
  }
};

const ownerTone = (ownerType: string): "ok" | "warn" | "bad" | "info" =>
  ownerType === "MANAGER" ? "info" : ownerType === "STAFF" ? "ok" : ownerType === "BOARD" ? "warn" : "bad";

/** Encodes an assignee option value into `OWNER_TYPE[:appointmentId]`. */
export const assigneeOptionValue = (ownerType: string, appointmentId?: string): string =>
  ownerType === "STAFF" && appointmentId ? `STAFF:${appointmentId}` : ownerType;

export const parseAssigneeValue = (value: string): { ownerType: StaffResponsibilityOwnerType; appointmentId?: EntityId } => {
  if (value.startsWith("STAFF:")) return { ownerType: "STAFF", appointmentId: value.slice("STAFF:".length) as EntityId };
  return { ownerType: value as StaffResponsibilityOwnerType };
};

/** Groups the canonical rows by presentation category, ordered sensibly. */
export const groupRows = (view: ClubResponsibilitiesView): Array<{ category: string; rows: ClubResponsibilityRowView[] }> => {
  const byCategory: Record<string, ClubResponsibilityRowView[]> = {};
  for (const row of view.rows) {
    const category = DOMAIN_CATEGORY[row.domain] ?? "Other";
    (byCategory[category] ??= []).push(row);
  }
  const rank = (category: string): number => {
    const index = CATEGORY_ORDER.indexOf(category);
    return index < 0 ? 99 : index;
  };
  const ordered = (Object.keys(byCategory) as string[]).sort((a, b) => rank(a) - rank(b));
  return ordered.map((category) => ({ category, rows: byCategory[category]! }));
};

const assigneeLabel = (assignee: { ownerType: string; personName?: string }): string =>
  assignee.ownerType === "MANAGER"
    ? "Manager"
    : assignee.ownerType === "BOARD"
      ? "Board"
      : assignee.personName ?? "Staff";
export const ClubResponsibilitiesScreen = (): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => managerBridge.getClubResponsibilities(), []);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const assign = async (domain: StaffResponsibilityDomain): Promise<void> => {
    const raw = drafts[domain];
    if (!raw) return;
    const { ownerType, appointmentId } = parseAssigneeValue(raw);
    setBusy(domain);
    setMessage(null);
    const result = await managerBridge.assignStaffResponsibility(domain, ownerType, appointmentId);
    setBusy(null);
    if (!result.ok) {
      setMessage({ tone: "warn", text: result.error?.message ?? "That assignment was refused." });
      return;
    }
    setMessage({ tone: "ok", text: "Responsibility reassigned — the change is saved." });
    await refresh();
  };

  const requestApproval = async (domain: StaffResponsibilityDomain): Promise<void> => {
    setBusy(domain);
    setMessage(null);
    const result = await managerBridge.requestStaffBoardApproval(domain);
    setBusy(null);
    if (!result.ok) {
      setMessage({ tone: "warn", text: result.error?.message ?? "The board did not grant approval." });
      return;
    }
    setMessage({ tone: "ok", text: "Board approval requested — check the responsibility for the granted window." });
    await refresh();
  };

  return (
    <AsyncPanel state={state}>
      {(view) => {
        const groups = groupRows(view);
        return (
          <>
            <Panel title="Delegation" className="panel-wide">
              <p className="subtle">
                Each row shows one responsibility and who currently handles it. Authority stays with the
                institution — delegating a task to a staff member does not transfer institutional authority.
                Use the select to reassign a responsibility; the change is saved immediately.
              </p>
              {message && (
                <p className={`notice ${message.tone === "warn" ? "warning" : ""}`} role="status">
                  {message.text}
                </p>
              )}
              {groups.map((group) => (
                <div key={group.category} className="responsibility-group">
                  <h3 className="responsible-group-title">{group.category}</h3>
<div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Responsibility</th>
                          <th>Current owner</th>
                          <th>Reassign to</th>
                          <th>Board</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr key={row.domain}>
                            <td>{humanizeDomain(row.domain)}</td>
                            <td>
                              <Badge tone={ownerTone(row.currentOwnerType)}>{ownerLabel(row)}</Badge>
                            </td>
                            <td>
                              <div className="button-row">
                                <select
                                  aria-label={`Assign ${humanizeDomain(row.domain)} to`}
                                  value={drafts[row.domain] ?? "MANAGER"}
                                  onChange={(event) => setDrafts({ ...drafts, [row.domain]: event.target.value })}
                                >
                                  {row.assignees.map((assignee) => (
                                    <option
                                      key={assigneeOptionValue(assignee.ownerType, assignee.appointmentId)}
                                      value={assigneeOptionValue(assignee.ownerType, assignee.appointmentId)}
                                    >
                                      {assigneeLabel(assignee)}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="primary small"
                                  disabled={busy !== null}
                                  onClick={() => void assign(row.domain as StaffResponsibilityDomain)}
                                >
                                  Assign
                                </button>
                              </div>
                            </td>
                            <td>
                              {row.currentOwnerType === "BOARD" && (
                                <button
                                  className="ghost small"
                                  disabled={busy !== null}
                                  onClick={() => void requestApproval(row.domain as StaffResponsibilityDomain)}
                                >
                                  {row.boardApprovalGrantedUntil ? "Renew approval" : "Request approval"}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </Panel>
          </>
        );
      }}
    </AsyncPanel>
  );
};