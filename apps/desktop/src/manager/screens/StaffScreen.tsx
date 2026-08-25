import React from "react";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Panel, useRuntimeData } from "../ui.js";

export const StaffScreen = (): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getStaff());
  return (
    <section className="dashboard">
      <AsyncPanel state={state}>
        {(list) => (
          <>
            <Panel title="Staff">
              {list.staff.length === 0 ? (
                <p className="empty-state">
                  No staff records exist for this club. The Nepal registry does not yet include
                  researched staff, and the game does not invent them.
                </p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Area</th>
                        <th>Licence</th>
                        <th>Since</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.staff.map((member) => (
                        <tr key={member.appointmentId}>
                          <td>{member.name}</td>
                          <td>{member.role.replace(/_/g, " ").toLowerCase()}</td>
                          <td>{member.category.toLowerCase()}</td>
                          <td>{member.licence ?? "Unknown"}</td>
                          <td>{member.startDate ?? "Unknown"}</td>
                          <td>{member.employmentStatus.toLowerCase()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="Vacancies">
              {list.vacancies.length === 0 ? (
                <p className="empty-state">No open staff positions.</p>
              ) : (
                <ul>
                  {list.vacancies.map((vacancy) => (
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
              {list.candidates.length === 0 ? (
                <p className="empty-state">
                  No unattached staff in the world. Hiring becomes available once a researched staff
                  market is imported.
                </p>
              ) : (
                <ul>
                  {list.candidates.map((candidate) => (
                    <li key={candidate.personId}>
                      {candidate.name}{" "}
                      <span className="subtle">{candidate.preferredRole ?? "role unknown"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        )}
      </AsyncPanel>
    </section>
  );
};
