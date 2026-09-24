import React, { useState } from "react";
import type {
  EntityId,
  JobApplicationView,
  JobCentreView,
  JobVacancyView,
  ManagerDashboard,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { humanizeToken } from "../storyHumanizer.js";
import { AsyncPanel, Badge, Panel, useRuntimeData } from "../ui.js";

/**
 * Phase 8C — Career Jobs (Manager).
 *
 * Presents the canonical manager job market (getJobCentre) and the player's own
 * applications, and wires only the existing commands: apply, accept, decline.
 * Every status shown is the persisted application status; nothing here is
 * React-only state. Interview scoring and candidate ranking are backend-only and
 * hidden. Salary is not shown: the read model carries an unlabelled amount.
 *
 * Apply and Accept are offered only while unemployed. The backend does not close
 * a current contract when an offer is accepted, so a move while employed is not
 * a supported transition.
 */

export const sortedVacancies = (vacancies: JobVacancyView[]): JobVacancyView[] =>
  [...vacancies].sort(
    (a, b) => b.openedOn.localeCompare(a.openedOn) || a.clubName.localeCompare(b.clubName) || a.id.localeCompare(b.id),
  );

export const sortedApplications = (applications: JobApplicationView[]): JobApplicationView[] =>
  [...applications].sort((a, b) => b.createdOn.localeCompare(a.createdOn) || a.id.localeCompare(b.id));

export const statusLabel = (status: string): string => humanizeToken(status);

export const statusTone = (status: string): "ok" | "warn" | "bad" | "info" =>
  status === "OFFERED" || status === "ACCEPTED" ? "ok" : status === "PENDING" ? "info" : "bad";

/** The most recent application for each vacancy, by creation date. */
export const latestApplicationByVacancy = (
  applications: JobApplicationView[],
): Map<string, JobApplicationView> => {
  const latest = new Map<string, JobApplicationView>();
  for (const application of sortedApplications(applications)) {
    if (!latest.has(application.vacancyId)) latest.set(application.vacancyId, application);
  }
  return latest;
};

export const CareerJobsScreen = ({
  refreshKey,
  onCareerChanged,
}: {
  refreshKey: number;
  onCareerChanged: () => Promise<void>;
}): React.ReactElement => {
  const [centre, reloadCentre] = useRuntimeData(() => managerBridge.getJobCentre(), [refreshKey]);
  const [dashboard, reloadDashboard] = useRuntimeData(() => managerBridge.getManagerDashboard(), [refreshKey]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (
    key: string,
    command: () => Promise<{ ok: boolean; error?: { message: string } }>,
  ): Promise<void> => {
    setBusy(key);
    setError(null);
    const result = await command();
    setBusy(null);
    if (!result.ok) {
      setError(result.error?.message ?? "That action failed.");
      return;
    }
    reloadCentre();
    reloadDashboard();
    await onCareerChanged();
  };

  return (
    <>
      {error && (
        <div className="warning" role="alert">
          {error}
        </div>
      )}

      <Panel title="Your situation" className="panel-wide">
        <AsyncPanel state={dashboard}>
          {(view: ManagerDashboard) =>
            view.employmentStatus === "UNEMPLOYED" ? (
              <p>
                You are currently unemployed. You can apply for open vacancies and respond to offers.
              </p>
            ) : (
              <p>
                You are currently employed{view.clubName ? ` at ${view.clubName}` : ""}. The market is shown for
                reference. Applications and offers are available between appointments.
              </p>
            )
          }
        </AsyncPanel>
        <AsyncPanel state={centre}>
          {(view: JobCentreView) => (
            <p className="subtle">
              Professional standing: <strong>{humanizeToken(view.reputationProfile)}</strong>
            </p>
          )}
        </AsyncPanel>
      </Panel>

      <AsyncPanel state={centre}>
        {(view: JobCentreView) => {
          const employed = dashboard.status === "ready" && dashboard.data.employmentStatus === "EMPLOYED";
          const latest = latestApplicationByVacancy(view.applications);
          const vacancies = sortedVacancies(view.vacancies);
          const applications = sortedApplications(view.applications);
          return (
            <>
              <Panel title="Open vacancies" className="panel-wide">
                {vacancies.length === 0 ? (
                  <p className="empty-state">No manager vacancies are open right now.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <caption className="visually-hidden">Open manager vacancies</caption>
                      <thead>
                        <tr>
                          <th scope="col">Club</th>
                          <th scope="col">Competition</th>
                          <th scope="col">Board expects</th>
                          <th scope="col">Opened</th>
                          <th scope="col">Eligibility</th>
                          <th scope="col">Your application</th>
                          <th scope="col">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vacancies.map((vacancy) => {
                          const application = latest.get(vacancy.id);
                          const hasOffer = application?.status === "OFFERED";
                          return (
                            <tr key={vacancy.id}>
                              <th scope="row">
                                {vacancy.clubName}
                                {vacancy.teamName && vacancy.teamName !== vacancy.clubName ? (
                                  <span className="subtle"> · {vacancy.teamName}</span>
                                ) : null}
                              </th>
                              <td>{vacancy.competitionName}</td>
                              <td>{humanizeToken(vacancy.boardExpectation)}</td>
                              <td>{vacancy.openedOn}</td>
                              <td>
                                <Badge tone={vacancy.eligible ? "ok" : "warn"}>
                                  {vacancy.eligible ? "Eligible" : "Not eligible"}
                                </Badge>
                                {!vacancy.eligible && vacancy.eligibilityNote ? (
                                  <div className="subtle">{vacancy.eligibilityNote}</div>
                                ) : null}
                              </td>
                              <td>
                                {application ? (
                                  <Badge tone={statusTone(application.status)}>{statusLabel(application.status)}</Badge>
                                ) : (
                                  <span className="subtle">Not applied</span>
                                )}
                              </td>
                              <td>
                                <button
                                  className="ghost small"
                                  aria-label={`Apply to ${vacancy.clubName}`}
                                  disabled={!vacancy.eligible || employed || hasOffer || busy !== null}
                                  onClick={() =>
                                    void run(`apply-${vacancy.id}`, () => managerBridge.applyForJob(vacancy.id as EntityId))
                                  }
                                >
                                  {busy === `apply-${vacancy.id}` ? "Applying…" : "Apply"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              <Panel title="My applications" className="panel-wide">
                {applications.length === 0 ? (
                  <p className="empty-state">You have not applied anywhere yet.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <caption className="visually-hidden">My job applications</caption>
                      <thead>
                        <tr>
                          <th scope="col">Club</th>
                          <th scope="col">Applied</th>
                          <th scope="col">Status</th>
                          <th scope="col">Decided</th>
                          <th scope="col">Contract to</th>
                          <th scope="col">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {applications.map((application) => (
                          <tr key={application.id}>
                            <th scope="row">
                              {application.clubName}
                              {application.teamName && application.teamName !== application.clubName ? (
                                <span className="subtle"> · {application.teamName}</span>
                              ) : null}
                            </th>
                            <td>{application.createdOn}</td>
                            <td>
                              <Badge tone={statusTone(application.status)}>{statusLabel(application.status)}</Badge>
                            </td>
                            <td>{application.decidedOn ?? "—"}</td>
                            <td>{application.status === "OFFERED" ? (application.offeredContractEnd ?? "—") : "—"}</td>
                            <td>
                              {application.status === "OFFERED" ? (
                                <div className="button-row">
                                  <button
                                    className="primary small"
                                    aria-label={`Accept offer from ${application.clubName}`}
                                    disabled={employed || busy !== null}
                                    onClick={() =>
                                      void run(`accept-${application.id}`, () =>
                                        managerBridge.acceptJobOffer(application.id as EntityId),
                                      )
                                    }
                                  >
                                    {busy === `accept-${application.id}` ? "Accepting…" : "Accept"}
                                  </button>
                                  <button
                                    className="ghost small"
                                    aria-label={`Decline offer from ${application.clubName}`}
                                    disabled={busy !== null}
                                    onClick={() =>
                                      void run(`decline-${application.id}`, () =>
                                        managerBridge.declineJobOffer(application.id as EntityId),
                                      )
                                    }
                                  >
                                    Decline
                                  </button>
                                </div>
                              ) : (
                                <span className="subtle">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </>
          );
        }}
      </AsyncPanel>
    </>
  );
};
