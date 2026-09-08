import React, { useState } from "react";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Panel, useRuntimeData } from "../ui.js";

const money = (minor?: number): string => (minor === undefined ? "—" : `NPR ${Math.round(minor / 1000)}k`);

const DOMAINS = ["TRANSFERS", "SCOUTING", "CONTRACTS", "YOUTH", "TRAINING", "MEDICAL"] as const;

export const StaffScreen = ({ refreshKey }: { refreshKey: number }): React.ReactElement => {
  // Candidate/vacancy state changes from world events outside this screen's
  // own actions too (season-boundary staff-pool reconciliation, AI hiring on
  // every Continue) — without depending on refreshKey, a manager sitting on
  // this screen across a Continue never sees the club's actual current
  // staff market until they navigate away and back.
  const [state, refresh] = useRuntimeData(() => managerBridge.getStaffMarket(), [refreshKey]);
  const [hierarchyState, refreshHierarchy] = useRuntimeData(
    () => managerBridge.getStaffHierarchy(),
    [refreshKey],
  );
  const [salaryDrafts, setSalaryDrafts] = useState<Record<string, string>>({});
  const [roleDrafts, setRoleDrafts] = useState<Record<string, EntityId>>({});
  const [planDrafts, setPlanDrafts] = useState<Record<string, string>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(
    null,
  );
  const [search, setSearch] = useState("");

  const draftFor = (key: string, fallback: string): string => salaryDrafts[key] ?? fallback;
  const staffList = state.status === "ready" ? state.data.staff : [];
  const query = search.trim().toLowerCase();
  const matches = (name: string, role?: string): boolean =>
    !query || `${name} ${role ?? ""}`.toLowerCase().includes(query);

  const runAction = async (key: string, run: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setActionBusy(key);
    setActionError(null);
    setActionNotice(null);
    const result = await run();
    setActionBusy(null);
    if (!result.ok) {
      setActionError(result.error?.message ?? "That action failed.");
      return;
    }
    refresh();
    refreshHierarchy();
  };

  const hireCandidate = async (
    candidateId: EntityId,
    vacancyId: EntityId,
    vacancyRole: string,
  ) => {
    const key = `apply-${candidateId}`;
    setActionBusy(key);
    setActionError(null);
    setActionNotice(null);
    const result = await managerBridge.applyForStaffRole(
      vacancyId,
      candidateId,
      Number(draftFor(`hire-${candidateId}`, "0")) * 1000,
      24,
    );
    setActionBusy(null);
    if (!result.ok) {
      setActionError(result.error?.message ?? "That action failed.");
      return;
    }
    const { outcome } = result.data;
    const roleLabel = vacancyRole.replace(/_/g, " ").toLowerCase();
    // A REJECTED outcome is a real, well-formed business result (unqualified,
    // unaffordable, uninterested) — never a silent no-op. Surfacing it here
    // is the entire point: the request succeeded, the *hire* did not.
    if (outcome.status === "REJECTED") {
      setActionNotice({ tone: "warn", text: outcome.reason ?? `Not hired as ${roleLabel}.` });
    } else if (outcome.status === "COUNTERED") {
      setActionNotice({
        tone: "warn",
        text: `${outcome.reason ?? "Countered."} Review it under Applications below.`,
      });
    } else {
      setActionNotice({ tone: "ok", text: `Offer sent for ${roleLabel}.` });
    }
    refresh();
    refreshHierarchy();
  };

  return (
    <section className="staff-screen">
      {actionError && (
        <div className="warning" role="alert">
          {actionError}
        </div>
      )}
      {actionNotice && (
        <div className={actionNotice.tone === "ok" ? "ok" : "warning"} role="status">
          {actionNotice.text}
        </div>
      )}
      <AsyncPanel state={state}>
        {(market) => (
          <>
            {/* The workspace shell already titles this screen; a second page
                header here stacked two "Staff" headings on top of each other. */}
            <div className="metrics staff-metrics">
              <div><dt>Staff count</dt><dd>{market.staff.length}</dd></div>
              <div><dt>Open vacancies</dt><dd>{market.vacancies.filter((v) => v.status === "VACANT").length}</dd></div>
              <div><dt>Available candidates</dt><dd>{market.candidates.length}</dd></div>
              <div><dt>Applications</dt><dd>{market.applications.length}</dd></div>
            </div>
            <Panel title="Staff">
              <input aria-label="Search staff" placeholder="Search staff or role" value={search} onChange={(event) => setSearch(event.target.value)} />
              {market.staff.length === 0 ? (
                <p className="empty-state">No staff records exist for this club.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Licence</th>
                        <th>Salary</th>
                        <th>Contract ends</th>
                        <th>Performance</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {market.staff.filter((member) => matches(member.name, member.role)).map((member) => (
                        <tr key={member.appointmentId}>
                          <td>{member.name}</td>
                          <td>{member.role.replace(/_/g, " ").toLowerCase()}</td>
                          {/* Most staff roles (admin, scouting, medical) carry
                              no coaching licence at all — "Unknown" implied a
                              gap in recorded data rather than a role that
                              simply has nothing to show here. */}
                          <td>{member.licence ?? "—"}</td>
                          <td>{money(member.salaryAmountMinor)}</td>
                          <td>{member.contractEnd ?? "—"}</td>
                          <td>{member.lastPerformanceScore ?? "—"}</td>
                          <td>
                            <div className="button-row">
                              <input
                                inputMode="numeric"
                                aria-label={`New salary for ${member.name}`}
                                placeholder="New salary"
                                value={draftFor(`renew-${member.appointmentId}`, "")}
                                onChange={(e) =>
                                  setSalaryDrafts({ ...salaryDrafts, [`renew-${member.appointmentId}`]: e.target.value })
                                }
                                style={{ width: "6rem" }}
                              />
                              <button
                                className="ghost small"
                                disabled={actionBusy !== null}
                                onClick={() =>
                                  void runAction(`renew-${member.appointmentId}`, () =>
                                    managerBridge.offerStaffContractRenewal(
                                      member.appointmentId,
                                      Number(draftFor(`renew-${member.appointmentId}`, "0")) * 1000,
                                      24,
                                    ),
                                  )
                                }
                              >
                                Renew
                              </button>
                              <button
                                className="ghost small"
                                disabled={actionBusy !== null}
                                onClick={() =>
                                  void runAction(`licence-${member.personId}`, () =>
                                    managerBridge.enrolStaffLicenceCourse(member.personId, true),
                                  )
                                }
                              >
                                Fund licence course
                              </button>
                              <button
                                className="ghost small"
                                disabled={actionBusy !== null}
                                onClick={() => void runAction(`dismiss-${member.appointmentId}`, () => managerBridge.dismissStaffMember(member.appointmentId))}
                              >
                                Dismiss
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="Vacancies">
              {market.vacancies.length === 0 ? (
                <p className="empty-state">No open staff positions.</p>
              ) : (
                <ul className="report-list">
                  {market.vacancies.filter((vacancy) => matches(vacancy.role)).map((vacancy) => (
                    <li key={vacancy.id}>
                      {vacancy.role.replace(/_/g, " ").toLowerCase()}{" "}
                      {vacancy.required && <Badge tone="warn">required</Badge>}{" "}
                      <span className="subtle">{vacancy.status.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Available candidates">
              {market.candidates.length === 0 ? (
                <p className="empty-state">No unattached staff in the world.</p>
              ) : (
                <ul className="report-list">
                  {market.candidates
                    .filter((candidate) => matches(candidate.name, candidate.preferredRole))
                    .map((candidate) => {
                      // Server-authoritative: eligibleVacancyIds is the real
                      // intersection of this club's open vacancies and the
                      // candidate's actual qualification (licence rank), not
                      // a client-side guess. A candidate is never offered a
                      // Hire action for a role they cannot actually fill.
                      const eligibleVacancies = candidate.eligibleVacancyIds
                        .map((id) => market.vacancies.find((v) => v.id === id))
                        .filter((v): v is (typeof market.vacancies)[number] => Boolean(v));
                      const draftKey = `hire-role-${candidate.personId}`;
                      const selectedVacancyId =
                        (roleDrafts[draftKey] as EntityId | undefined) ?? eligibleVacancies[0]?.id;
                      const selectedVacancy = eligibleVacancies.find((v) => v.id === selectedVacancyId);
                      return (
                        <li key={candidate.personId}>
                          {candidate.name}{" "}
                          <span className="subtle">{candidate.preferredRole ?? "role unknown"}</span>
                          {eligibleVacancies.length === 0 ? (
                            <div className="subtle">
                              {candidate.blockedReason ?? "Not eligible for your current vacancies."}
                            </div>
                          ) : (
                            <div className="button-row">
                              {eligibleVacancies.length > 1 && (
                                <label className="sr-label">
                                  Role
                                  <select
                                    aria-label={`Vacancy role to hire ${candidate.name} into`}
                                    value={selectedVacancyId}
                                    disabled={actionBusy !== null}
                                    onChange={(event) =>
                                      setRoleDrafts({ ...roleDrafts, [draftKey]: event.target.value as EntityId })
                                    }
                                  >
                                    {eligibleVacancies.map((vacancy) => (
                                      <option key={vacancy.id} value={vacancy.id}>
                                        {vacancy.role.replace(/_/g, " ").toLowerCase()}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              <input
                                inputMode="numeric"
                                aria-label={`Offer salary for ${candidate.name}`}
                                placeholder="Offer salary (k)"
                                value={draftFor(`hire-${candidate.personId}`, "")}
                                onChange={(e) =>
                                  setSalaryDrafts({ ...salaryDrafts, [`hire-${candidate.personId}`]: e.target.value })
                                }
                                style={{ width: "7rem" }}
                              />
                              <button
                                className="ghost small"
                                disabled={actionBusy !== null || !selectedVacancy}
                                onClick={() =>
                                  selectedVacancy &&
                                  void hireCandidate(candidate.personId, selectedVacancy.id, selectedVacancy.role)
                                }
                              >
                                {eligibleVacancies.length > 1
                                  ? "Hire Staff"
                                  : `Hire Staff · ${eligibleVacancies[0]!.role.replace(/_/g, " ").toLowerCase()}`}
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                </ul>
              )}
            </Panel>

            {market.applications.length > 0 && (
              <Panel title="Applications">
                <ul className="report-list">
                  {market.applications.map((application) => (
                    <li key={application.id}>
                      {application.personName} · {application.role.replace(/_/g, " ").toLowerCase()} ·{" "}
                      <Badge tone={application.status === "COUNTERED" ? "warn" : "info"}>{application.status}</Badge>{" "}
                      {money(application.offeredSalaryMinor ?? application.counterSalaryMinor)}
                      {(application.status === "OFFERED" || application.status === "COUNTERED") && (
                        <div className="button-row">
                          <button
                            className="primary small"
                            disabled={actionBusy !== null}
                            onClick={() => void runAction(`app-accept-${application.id}`, () => managerBridge.respondToStaffApplication(application.id, true))}
                          >
                            Accept
                          </button>
                          <button
                            className="ghost small"
                            disabled={actionBusy !== null}
                            onClick={() => void runAction(`app-decline-${application.id}`, () => managerBridge.respondToStaffApplication(application.id, false))}
                          >
                            Decline
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {market.renewalOffers.length > 0 && (
              <Panel title="Renewal counters">
                <ul className="report-list">
                  {market.renewalOffers.map((offer) => (
                    <li key={offer.id}>
                      {offer.personName} wants {money(offer.counterSalaryMinor)} (offered {money(offer.proposedSalaryMinor)})
                      <div className="button-row">
                        <button
                          className="primary small"
                          disabled={actionBusy !== null}
                          onClick={() => void runAction(`renewal-accept-${offer.id}`, () => managerBridge.respondToStaffRenewal(offer.id, true))}
                        >
                          Accept counter
                        </button>
                        <button
                          className="ghost small"
                          disabled={actionBusy !== null}
                          onClick={() => void runAction(`renewal-decline-${offer.id}`, () => managerBridge.respondToStaffRenewal(offer.id, false))}
                        >
                          Decline
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {market.approaches.length > 0 && (
              <Panel title="Approaches from other clubs">
                <ul className="report-list">
                  {market.approaches.map((approach) => (
                    <li key={approach.id}>
                      {approach.fromClubName} approached {approach.personName} for {approach.role.replace(/_/g, " ").toLowerCase()} at{" "}
                      {money(approach.offeredSalaryMinor)} · <Badge tone={approach.status === "ACCEPTED" ? "bad" : "info"}>{approach.status}</Badge>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        )}
      </AsyncPanel>

      <AsyncPanel state={hierarchyState}>
        {(hierarchy) => (
          <>
            <Panel title="Backroom">
              <p>
                <Badge
                  tone={
                    hierarchy.backroom.atmosphere === "ALIGNED"
                      ? "ok"
                      : hierarchy.backroom.atmosphere === "CONFLICT"
                        ? "bad"
                        : hierarchy.backroom.atmosphere === "STRAINED"
                          ? "warn"
                          : "info"
                  }
                >
                  {hierarchy.backroom.atmosphere.toLowerCase()}
                </Badge>{" "}
                <span className="subtle">{hierarchy.backroom.clue}</span>
              </p>
              <p className="subtle">
                {hierarchy.backroom.activeStaff} active staff ·{" "}
                {hierarchy.backroom.alignedRelationships} aligned relationship
                {hierarchy.backroom.alignedRelationships === 1 ? "" : "s"} ·{" "}
                {hierarchy.backroom.strainedRelationships} strained relationship
                {hierarchy.backroom.strainedRelationships === 1 ? "" : "s"}
              </p>
            </Panel>
            <Panel title="Staff hierarchy">
              {hierarchy.hierarchy.length === 0 ? (
                <p className="empty-state">No staff appointments to chart.</p>
              ) : (
                <ul className="report-list">
                  {hierarchy.hierarchy.map((entry) => (
                    <li key={entry.appointmentId}>
                      {entry.personName} · {entry.role.replace(/_/g, " ").toLowerCase()}{" "}
                      <span className="subtle">rank {entry.seniorityRank}</span>{" "}
                      {entry.domains.length > 0 && (
                        <span className="subtle">[{entry.domains.join(", ").toLowerCase()}]</span>
                      )}{" "}
                      <Badge tone={entry.workload === "OVERLOADED" ? "bad" : entry.workload === "HEAVY" ? "warn" : "info"}>
                        {entry.workload.toLowerCase()}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Responsibilities">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Domain</th>
                      <th>Owner</th>
                      <th>Reassign to</th>
                      <th>Board</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DOMAINS.map((domain) => {
                      const responsibility = hierarchy.responsibilities.find((r) => r.domain === domain);
                      return (
                        <tr key={domain}>
                          <td>{domain.toLowerCase()}</td>
                          <td>
                            {responsibility?.ownerType === "STAFF"
                              ? responsibility.ownerName ?? "Staff"
                              : responsibility?.ownerType === "BOARD"
                                ? "Board"
                                : "Manager"}
                          </td>
                          <td>
                            <div className="button-row">
                              <button
                                className="ghost small"
                                disabled={actionBusy !== null}
                                onClick={() => void runAction(`resp-manager-${domain}`, () => managerBridge.assignStaffResponsibility(domain, "MANAGER"))}
                              >
                                Manager
                              </button>
                              {staffList.map((member) => (
                                <button
                                  key={member.appointmentId}
                                  className="ghost small"
                                  disabled={actionBusy !== null}
                                  onClick={() =>
                                    void runAction(`resp-staff-${domain}-${member.appointmentId}`, () =>
                                      managerBridge.assignStaffResponsibility(domain, "STAFF", member.appointmentId),
                                    )
                                  }
                                >
                                  {member.name}
                                </button>
                              ))}
                              <button
                                className="ghost small"
                                disabled={actionBusy !== null}
                                onClick={() => void runAction(`resp-board-${domain}`, () => managerBridge.assignStaffResponsibility(domain, "BOARD"))}
                              >
                                Board
                              </button>
                            </div>
                          </td>
                          <td>
                            {responsibility?.ownerType === "BOARD" && (
                              <button
                                className="ghost small"
                                disabled={actionBusy !== null}
                                onClick={() => void runAction(`resp-approve-${domain}`, () => managerBridge.requestStaffBoardApproval(domain))}
                              >
                                {responsibility.boardApprovalGrantedUntil ? "Renew approval" : "Request approval"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Development plans">
              {hierarchy.developmentPlans.length === 0 ? (
                <p className="empty-state">No development plans in progress.</p>
              ) : (
                <ul className="report-list">
                  {hierarchy.developmentPlans.map((plan) => (
                    <li key={plan.id}>
                      {plan.personName} · {plan.focus} <span className="subtle">{plan.targetDate}</span>{" "}
                      <Badge tone={plan.status === "COMPLETED" ? "info" : "warn"}>{plan.status.toLowerCase()}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              {staffList.length > 0 && (
                <div className="button-row">
                  <select
                    aria-label="Staff member for development plan"
                    value={draftFor("plan-person", staffList[0]!.personId)}
                    onChange={(e) => setPlanDrafts({ ...planDrafts, "plan-person": e.target.value })}
                  >
                    {staffList.map((member) => (
                      <option key={member.personId} value={member.personId}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Development plan focus"
                    placeholder="Focus"
                    value={planDrafts["plan-focus"] ?? ""}
                    onChange={(e) => setPlanDrafts({ ...planDrafts, "plan-focus": e.target.value })}
                    style={{ width: "10rem" }}
                  />
                  <button
                    className="primary small"
                    disabled={actionBusy !== null || !(planDrafts["plan-focus"] ?? "").trim()}
                    onClick={() =>
                      void runAction("create-plan", () =>
                        managerBridge.createStaffDevelopmentPlan(
                          (planDrafts["plan-person"] ?? staffList[0]!.personId) as EntityId,
                          planDrafts["plan-focus"] ?? "",
                        ),
                      )
                    }
                  >
                    Create plan
                  </button>
                </div>
              )}
            </Panel>

            {hierarchy.successionPlans.length > 0 && (
              <Panel title="Succession planning">
                <ul className="report-list">
                  {hierarchy.successionPlans.map((plan) => (
                    <li key={plan.id}>
                      {plan.personName} · {plan.role.replace(/_/g, " ").toLowerCase()} ·{" "}
                      <Badge tone={plan.reason === "POACHING_RISK" ? "bad" : "warn"}>{plan.reason.toLowerCase()}</Badge>{" "}
                      {plan.candidateName ? `→ candidate: ${plan.candidateName}` : "no internal candidate found"}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        )}
      </AsyncPanel>
    </section>
  );
};
