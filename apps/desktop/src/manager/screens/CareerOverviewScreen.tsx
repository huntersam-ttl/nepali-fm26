import React from "react";
import type {
  CareerOverviewView,
  EntityId,
  EntityReference,
  EntityReferenceType,
  ManagerCareerHistoryView,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Metrics, Panel, useRuntimeData } from "../ui.js";
import { EntityRefLink } from "../RoleDetailScreen.js";

/**
 * Phase 8A — Career Overview (human-player person).
 *
 * Summarises the persistent human person: identity, current role, the base
 * career role vs a temporary Presidency, current organisation + tenure, and a
 * career snapshot. The base career persists across a temporary presidency.
 * Never exposes hidden reputation / board / ownership-financial state.
 */

export const roleDisplay = (role: string): string =>
  role === "MANAGER"
    ? "Manager"
    : role === "CHAIRMAN_OWNER"
      ? "Club Owner"
      : role === "FEDERATION_PRESIDENT"
        ? "Federation President"
        : role.replaceAll("_", " ").toLowerCase();

const baseRoleLabel = (view: CareerOverviewView): string =>
  view.baseRole ? roleDisplay(view.baseRole) : "No base role";

export const CareerOverviewScreen = ({
  onOpenEntity,
}: {
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void;
}): React.ReactElement => {
  const [overview] = useRuntimeData(() => managerBridge.getCareerOverview(), []);
  const [historyState] = useRuntimeData(() => managerBridge.getCareerHistory(), []);

  return (
    <AsyncPanel state={overview}>
      {(view) => {
        return (
          <>
            <Panel title="Identity" className="panel-wide">
              <h2 className="facility-title">{view.name}</h2>
              <p className="subtle">
                Current role: <strong>{roleDisplay(view.activeRole)}</strong>
                {view.currentOrganization ? (
                  <> at {renderOrganization(view.currentOrganization, onOpenEntity)}</>
                ) : null}
              </p>
            </Panel>

            <Panel title="Base career vs elected office" className="panel-wide">
              {view.isTemporaryPresidentOffice ? (
                <>
                  <p className="subtle">
                    Base career: <strong>{baseRoleLabel(view)}</strong>
                    {view.currentOrganization && view.currentOrganization.label ? (
                      <> — {view.currentOrganization.label}</>
                    ) : null}
                  </p>
                  <p className="subtle">
                    Current elected office: <strong>Federation President</strong>
                    <Badge tone="info">temporary elected office</Badge>
                  </p>
                  <p className="subtle">The base career persists and resumes when the term ends.</p>
                </>
              ) : (
                <p className="subtle">
                  Base career role: <strong>{baseRoleLabel(view)}</strong>
                  <Badge tone="info">base career</Badge>
                  {view.currentOrganization?.label ? (
                    <span className="subtle"> — {view.currentOrganization.label}</span>
                  ) : null}
                </p>
              )}
            </Panel>

            <Panel title="Current status" className="panel-wide">
              <Metrics
                items={[
                  { label: "Organisation", value: renderOrganization(view.currentOrganization, onOpenEntity) },
                  { label: "Tenure start", value: view.tenureStart ?? "—" },
                  { label: "Tenure end", value: view.tenureEnd ?? "—" },
                  { label: "Roles held", value: `${view.heldRoles.length}` },
                ]}
              />
              {view.heldRoles.length > 0 && (
                <p className="subtle">
                  Roles:{" "}
                  {view.heldRoles
                    .map((entry) => {
                      const org = entry.organization?.label ? ` (${entry.organization.label})` : "";
                      return `${entry.role.replaceAll("_", " ").toLowerCase()}${org}`;
                    })
                    .join(" · ")}
                </p>
              )}
            </Panel>

            <Panel title="Career snapshot" className="panel-wide">
              <AsyncPanel state={historyState} isEmpty={(h) => !h} empty="No career record yet.">
                {(history: ManagerCareerHistoryView) => (
                  <Metrics
                    items={[
                      { label: "Roles / jobs held", value: `${history.history.length}` },
                      { label: "Honours", value: `${history.trophies.length}` },
                    ]}
                  />
                )}
              </AsyncPanel>
            </Panel>
          </>
        );
      }}
    </AsyncPanel>
  );
};

export const renderOrganization = (
  organization: { label: string; reference?: EntityReference } | undefined,
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void,
): React.ReactNode =>
  !organization
    ? <span>None</span>
    : organization.reference
      ? <EntityRefLink reference={organization.reference} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
      : <span>{organization.label}</span>;