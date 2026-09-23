import React from "react";
import type { ClubCampusProject, ClubProfile, EntityId, EntityReference, EntityReferenceType } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Panel, useRuntimeData } from "../ui.js";
import { EntityRefLink } from "../RoleDetailScreen.js";

/**
 * Phase 6C — Infrastructure Projects (Manager read-only view).
 *
 * Active projects and the persisted infrastructure history for the club, drawn
 * from the canonical `ClubProfile` campus project rows + story entries. Project
 * detail (cost, funding, components) lives on the canonical Infrastructure
 * Project destination, reached by link — never duplicated in a local profile.
 * The Manager has no project approval/funding commands; those are Owner
 * institutional authority.
 */

export const humanizeProjectType = (type: string): string =>
  type.replaceAll("_", " ").toLowerCase();

export const humanizeProjectStatus = (status: string): string =>
  status.replaceAll("_", " ").toLowerCase();

/** Active (non-completed/cancelled) projects, already expected-completion ordered. */
export const activeProjects = (profile: ClubProfile | undefined): ClubCampusProject[] =>
  profile?.campusProjects ?? [];

/** Persisted infrastructure history entries (newest first, canonical). */
export const historyEntries = (
  profile: ClubProfile | undefined,
): ClubProfile["infrastructureHistory"] =>
  profile?.infrastructureHistory ?? [];

const projectStatusTone = (status: string): "ok" | "warn" | "bad" | "info" =>
  status === "COMPLETED"
    ? "ok"
    : status === "CANCELLED"
      ? "bad"
      : status === "CONSTRUCTION"
        ? "info"
        : "warn";

export const ClubProjectsScreen = ({
  clubId,
  onOpenEntity,
}: {
  clubId?: EntityId;
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void;
}): React.ReactElement => {
  const [profile] = useRuntimeData(
    (): Promise<Awaited<ReturnType<typeof managerBridge.getClubProfile>>> =>
      clubId ? managerBridge.getClubProfile(clubId) : Promise.resolve({ ok: false, error: "No club" } as never),
  );

  if (!clubId) {
    return (
      <section className="dashboard">
        <Panel title="Infrastructure Projects">
          <p className="subtle">Join a club as Manager to view its infrastructure projects here.</p>
        </Panel>
      </section>
    );
  }

  return (
    <AsyncPanel state={profile}>
      {(view) => {
        const projects = activeProjects(view);
        const history = historyEntries(view);
        return (
          <>
            <Panel title="Active projects" className="panel-wide">
{projects.length === 0 ? (
                <p className="empty-state">No active infrastructure projects are underway.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Expected completion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projects.map((project) => (
                        <tr key={project.id}>
                          <td>
                            <EntityRefLink
                              reference={project.reference}
                              onOpen={(r) => onOpenEntity(r.entityType, r.id)}
                            />
                          </td>
                          <td>{humanizeProjectType(project.projectType)}</td>
                          <td>
                            <Badge tone={projectStatusTone(project.status)}>
                              {humanizeProjectStatus(project.status)}
                            </Badge>
                          </td>
                          <td>{project.expectedCompletion ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="subtle">
                Cost and funding detail is shown on each project&rsquo;s own page — a project here links to its
                canonical Infrastructure Project record rather than duplicating its figures.
              </p>
            </Panel>
<Panel title="Infrastructure history" className="panel-wide">
              {history.length === 0 ? (
                <p className="empty-state">No infrastructure history has been recorded for this club.</p>
              ) : (
                <ul className="report-list">
                  {history.map((entry, index) => (
                    <li key={`${entry.occurredOn}-${index}`}>
                      <Badge tone={entry.tone as "ok" | "warn" | "bad" | "info"}>{entry.tone}</Badge>{" "}
                      {entry.headline} <span className="subtle">{entry.occurredOn}</span>
                      {entry.entities.length > 0 && (
                        <span className="subtle"> · {renderEntityLinks(entry.entities, onOpenEntity)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Authority">
              <p className="subtle">
                Approving and funding infrastructure projects is institutional authority held by the board /
                owner (Owner workspace). The Manager views projects and their operational context here.
              </p>
            </Panel>
          </>
        );
      }}
    </AsyncPanel>
  );
};

const renderEntityLinks = (
  entities: EntityReference[],
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void,
): React.ReactNode =>
  entities
    .filter((ref) => ref.visible)
    .map((ref, index) => (
      <span key={`${ref.id}-${index}`}>
        {index > 0 ? " · " : null}
        <EntityRefLink reference={ref} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
      </span>
    ));