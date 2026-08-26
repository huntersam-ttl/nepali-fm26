import React, { useState } from "react";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Panel, useRuntimeData } from "../ui.js";

const money = (minor?: number): string => (minor === undefined ? "—" : `NPR ${Math.round(minor / 1000)}k`);

export const StaffScreen = (): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => managerBridge.getStaffMarket());
  const [salaryDrafts, setSalaryDrafts] = useState<Record<string, string>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const draftFor = (key: string, fallback: string): string => salaryDrafts[key] ?? fallback;

  const runAction = async (key: string, run: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setActionBusy(key);
    setActionError(null);
    const result = await run();
    setActionBusy(null);
    if (!result.ok) {
      setActionError(result.error?.message ?? "That action failed.");
      return;
    }
    refresh();
  };

  return (
    <section className="dashboard">
      {actionError && (
        <div className="warning" role="alert">
          {actionError}
        </div>
      )}
      <AsyncPanel state={state}>
        {(market) => (
          <>
            <Panel title="Staff">
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
                      {market.staff.map((member) => (
                        <tr key={member.appointmentId}>
                          <td>{member.name}</td>
                          <td>{member.role.replace(/_/g, " ").toLowerCase()}</td>
                          <td>{member.licence ?? "Unknown"}</td>
                          <td>{money(member.salaryAmountMinor)}</td>
                          <td>{member.contractEnd ?? "Unknown"}</td>
                          <td>{member.lastPerformanceScore ?? "—"}</td>
                          <td>
                            <div className="button-row">
                              <input
                                inputMode="numeric"
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
                  {market.vacancies.map((vacancy) => (
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
                  {market.candidates.map((candidate) => {
                    const vacancy = market.vacancies.find(
                      (v) => v.status === "VACANT" && (!candidate.preferredRole || v.role === candidate.preferredRole),
                    ) ?? market.vacancies.find((v) => v.status === "VACANT");
                    return (
                      <li key={candidate.personId}>
                        {candidate.name} <span className="subtle">{candidate.preferredRole ?? "role unknown"}</span>
                        {vacancy && (
                          <div className="button-row">
                            <input
                              inputMode="numeric"
                              placeholder="Offer salary (k)"
                              value={draftFor(`hire-${candidate.personId}`, "")}
                              onChange={(e) =>
                                setSalaryDrafts({ ...salaryDrafts, [`hire-${candidate.personId}`]: e.target.value })
                              }
                              style={{ width: "7rem" }}
                            />
                            <button
                              className="ghost small"
                              disabled={actionBusy !== null}
                              onClick={() =>
                                void runAction(`apply-${candidate.personId}`, () =>
                                  managerBridge.applyForStaffRole(
                                    vacancy.id,
                                    candidate.personId,
                                    Number(draftFor(`hire-${candidate.personId}`, "0")) * 1000,
                                    24,
                                  ),
                                )
                              }
                            >
                              Propose terms for {vacancy.role.replace(/_/g, " ").toLowerCase()}
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
    </section>
  );
};

