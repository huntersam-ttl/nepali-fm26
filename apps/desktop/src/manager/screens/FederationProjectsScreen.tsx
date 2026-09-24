import React from "react";
import type { FederationPresidentDashboard } from "@nepal-football-sim/shared-types";
import { humanizeToken } from "../storyHumanizer.js";
import { Badge, Panel, money } from "../ui.js";

/**
 * Phase 9A — Federation Projects (President, read-only).
 *
 * The federation's programme register from the canonical FederationProject
 * records. Status and funding are the exact stored values: there is no
 * progress bar, because the model has no numeric progress. Programmes appear
 * when an approved governance proposal is implemented. Funding and cancellation
 * decisions are not presidential commands in the current domain, so none are
 * offered here.
 */

type Project = FederationPresidentDashboard["projects"][number];

const TERMINAL = new Set(["COMPLETED", "CANCELLED"]);

export const isOpenProject = (project: Pick<Project, "status">): boolean => !TERMINAL.has(project.status);

/** Open programmes first by start date (newest first), then by name; deterministic. */
export const sortedProjects = (projects: Project[]): Project[] =>
  [...projects].sort(
    (a, b) => b.startDate.localeCompare(a.startDate) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );

export const statusTone = (status: string): "ok" | "warn" | "bad" | "info" =>
  status === "COMPLETED" ? "ok" : status === "CANCELLED" ? "bad" : "info";

export const scheduleNote = (project: Pick<Project, "delayDays" | "status">): string =>
  isOpenProject(project) && (project.delayDays ?? 0) > 0 ? `${project.delayDays} day(s) behind` : "—";

const ProjectTable = ({ projects, caption }: { projects: Project[]; caption: string }): React.ReactElement => (
  <div className="table-scroll" role="region" aria-label={caption} tabIndex={0}>
    <table>
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Programme</th>
          <th scope="col">Type</th>
          <th scope="col">Status</th>
          <th scope="col">Funding</th>
          <th scope="col">Capital cost</th>
          <th scope="col">Started</th>
          <th scope="col">{projects.every((p) => p.status === "COMPLETED") ? "Completed" : "Expected completion"}</th>
          <th scope="col">Schedule</th>
        </tr>
      </thead>
      <tbody>
        {projects.map((project) => (
          <tr key={project.id}>
            <th scope="row">{project.name}</th>
            <td>{humanizeToken(project.projectType)}</td>
            <td>
              <Badge tone={statusTone(project.status)}>{humanizeToken(project.status)}</Badge>
            </td>
            <td>{project.fundingStatus ? humanizeToken(project.fundingStatus) : "—"}</td>
            <td>{money(project.capitalCost, project.currency)}</td>
            <td>{project.startDate}</td>
            <td>{project.completedAt ?? project.expectedCompletion}</td>
            <td>{scheduleNote(project)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const FederationProjectsScreen = ({
  dashboard,
}: {
  dashboard: Pick<FederationPresidentDashboard, "projects">;
}): React.ReactElement => {
  const all = sortedProjects(dashboard.projects);
  const open = all.filter(isOpenProject);
  const closed = all.filter((project) => !isOpenProject(project));
  return (
    <>
      <Panel title="In progress" className="panel-wide">
        {open.length === 0 ? (
          <p className="empty-state">No federation programmes are currently in progress.</p>
        ) : (
          <ProjectTable projects={open} caption="Federation programmes in progress" />
        )}
        <p className="subtle">
          <Badge tone="info">simulated</Badge> Programmes appear here when the federation implements an approved
          governance proposal.
        </p>
      </Panel>
      <Panel title="Completed and cancelled" className="panel-wide">
        {closed.length === 0 ? (
          <p className="empty-state">No programmes have been completed or cancelled yet.</p>
        ) : (
          <ProjectTable projects={closed} caption="Completed and cancelled federation programmes" />
        )}
      </Panel>
    </>
  );
};
