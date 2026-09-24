import React from "react";
import type {
  CareerOverviewView,
  FederationPresidentDashboard,
} from "@nepal-football-sim/shared-types";
import type { DesktopRuntimeApi } from "../../appBridge.js";
import { humanizeToken } from "../storyHumanizer.js";
import { AsyncPanel, Badge, Metrics, Panel, useRuntimeData } from "../ui.js";

/**
 * Phase 9A — Federation Overview (President, read-only).
 *
 * The institutional counterpart of the President Home: who governs, the
 * current term, what needs a decision, and the shape of the national system.
 * Everything is derived from the existing FederationPresidentDashboard and the
 * persistent Career overview; nothing here is a second copy of federation
 * state. Election odds, coalition support, committee influence and the
 * federation's simulation profile are hidden and never shown.
 */

export type FederationTarget = "governance" | "federation-projects" | "national-teams";

export type AttentionItem = { key: string; text: string; target: FederationTarget };

const TERMINAL_PROJECT = new Set(["COMPLETED", "CANCELLED"]);

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export const isActiveProject = (project: { status: string }): boolean => !TERMINAL_PROJECT.has(project.status);

export const attentionItems = (
  dashboard: Pick<FederationPresidentDashboard, "proposals" | "projects">,
): AttentionItem[] => {
  const items: AttentionItem[] = [];
  const approved = dashboard.proposals.filter((proposal) => proposal.status === "APPROVED").length;
  if (approved > 0)
    items.push({
      key: "approved",
      text: `${plural(approved, "approved proposal", "approved proposals")} awaiting implementation`,
      target: "governance",
    });
  const inReview = dashboard.proposals.filter(
    (proposal) => proposal.status === "PROPOSED" || proposal.status === "COMMITTEE_REVIEW",
  ).length;
  if (inReview > 0)
    items.push({
      key: "review",
      text: `${plural(inReview, "proposal", "proposals")} under committee review`,
      target: "governance",
    });
  const active = dashboard.projects.filter(isActiveProject);
  const behind = active.filter((project) => (project.delayDays ?? 0) > 0).length;
  if (behind > 0)
    items.push({
      key: "behind",
      text: `${plural(behind, "programme", "programmes")} running behind schedule`,
      target: "federation-projects",
    });
  const unfunded = active.filter(
    (project) => project.fundingStatus === "UNFUNDED" || project.fundingStatus === "PARTIALLY_FUNDED",
  ).length;
  if (unfunded > 0)
    items.push({
      key: "unfunded",
      text: `${plural(unfunded, "programme", "programmes")} not yet fully funded`,
      target: "federation-projects",
    });
  return items;
};

const roleName = (role: string): string =>
  role === "MANAGER" ? "Manager" : role === "CHAIRMAN_OWNER" ? "Club Owner" : humanizeToken(role);

/** The base career that the temporary presidency layers on top of. */
export const baseCareerLine = (overview: CareerOverviewView): string => {
  if (!overview.baseRole) return "No base career is on record.";
  const held = overview.heldRoles.find((entry) => entry.role === overview.baseRole);
  const where = held?.organization?.label ? ` at ${held.organization.label}` : "";
  return overview.isTemporaryPresidentOffice
    ? `Your base career as ${roleName(overview.baseRole)}${where} is preserved and resumes when this term ends.`
    : `Base career: ${roleName(overview.baseRole)}${where}.`;
};

export const FederationOverviewScreen = ({
  dashboard,
  bridge,
  onNavigate,
}: {
  dashboard: FederationPresidentDashboard;
  bridge: Pick<DesktopRuntimeApi, "getCareerOverview">;
  onNavigate: (target: FederationTarget | "commercial" | "government-relations") => void;
}): React.ReactElement => {
  const [career] = useRuntimeData(() => bridge.getCareerOverview(), []);
  const attention = attentionItems(dashboard);
  const programmes = dashboard.projects;
  const term = dashboard.tenure
    ? `${dashboard.tenure.termStart} – ${dashboard.tenure.termEnd ?? "current"}`
    : "Not recorded";

  return (
    <>
      <Panel title="Federation and presidency" className="panel-wide">
        <Metrics
          items={[
            { label: "Federation", value: dashboard.federation.name },
            { label: "Current term", value: term },
            { label: "Status", value: humanizeToken(dashboard.tenure?.status ?? "UNKNOWN") },
          ]}
        />
        {dashboard.tenure?.status === "INTERIM" && (
          <p className="subtle">
            You hold this office on an interim basis, and interim presidents cannot implement governance proposals.
          </p>
        )}
        <AsyncPanel state={career}>
          {(overview: CareerOverviewView) => (
            <p className="subtle">
              <strong>{overview.name}</strong> is the same person across every role. {baseCareerLine(overview)}
            </p>
          )}
        </AsyncPanel>
        <p className="subtle">
          <Badge tone="info">simulated</Badge> Federation figures are generated by the simulation, not real-world
          records.
        </p>
      </Panel>

      <Panel title="Needs your attention" className="panel-wide">
        {attention.length === 0 ? (
          <p className="empty-state">Nothing currently needs a decision from the President.</p>
        ) : (
          <ul className="report-list">
            {attention.map((item) => (
              <li key={item.key}>
                {item.text}{" "}
                <button className="ghost small" onClick={() => onNavigate(item.target)}>
                  {item.target === "governance" ? "Open Governance" : "Open Projects"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="National football system" className="panel-wide">
        <Metrics
          items={[
            { label: "National teams", value: dashboard.nationalTeams.length },
            { label: "Programmes in progress", value: programmes.filter(isActiveProject).length },
            { label: "Programmes completed", value: programmes.filter((p) => p.status === "COMPLETED").length },
          ]}
        />
        {dashboard.nationalTeams.length === 0 ? (
          <p className="empty-state">No national teams are recorded for this federation.</p>
        ) : (
          <div className="table-scroll" role="region" aria-label="National teams" tabIndex={0}>
            <table>
              <caption className="visually-hidden">National teams</caption>
              <thead>
                <tr>
                  <th scope="col">Team</th>
                  <th scope="col">Level</th>
                  <th scope="col">Head coach</th>
                  <th scope="col">Squad</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.nationalTeams.map((team) => (
                  <tr key={team.id}>
                    <th scope="row">{team.name}</th>
                    <td>{humanizeToken(team.level)}</td>
                    <td>{team.headCoach || "None recorded"}</td>
                    <td>{team.squadSize}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="button-row">
          <button className="ghost small" onClick={() => onNavigate("national-teams")}>
            Open National Teams
          </button>
        </div>
      </Panel>

      <Panel title="What this office governs" className="panel-wide">
        <p className="subtle">
          The Federation governs the national competitions and programmes. Clubs are owned and run by their owners
          and managers.
        </p>
        <ul className="report-list">
          <li>
            Implement approved governance proposals{" "}
            <button className="ghost small" onClick={() => onNavigate("governance")}>
              Governance
            </button>
          </li>
          <li>
            Negotiate the federation&rsquo;s commercial agreements{" "}
            <button className="ghost small" onClick={() => onNavigate("commercial")}>
              Commercial
            </button>
          </li>
          <li>
            Request government funding{" "}
            <button className="ghost small" onClick={() => onNavigate("government-relations")}>
              Government
            </button>
          </li>
          <li>Review national team squads (read-only)</li>
        </ul>
      </Panel>

      {dashboard.latestStory && (
        <Panel title="Latest" className="panel-wide">
          <p>
            {dashboard.latestStory.headline}{" "}
            <span className="subtle">{dashboard.latestStory.occurredOn}</span>
          </p>
        </Panel>
      )}
    </>
  );
};
