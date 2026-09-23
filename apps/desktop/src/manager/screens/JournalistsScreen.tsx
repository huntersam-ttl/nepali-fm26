import React from "react";
import type { EntityId, EntityReferenceType, MediaDirectoryView } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Panel, useRuntimeData } from "../ui.js";
import { EntityRefLink } from "../RoleDetailScreen.js";

/**
 * Phase 7A — Journalists.
 * Persisted journalists with canonical JOURNALIST references, their outlet and
 * beat. Public facts only — temperament/trust/agenda stay server-side.
 */

export const journalists = (view: MediaDirectoryView): MediaDirectoryView["journalists"] => view.journalists;

export const JournalistsScreen = ({
  onOpenEntity,
}: {
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void;
}): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getMediaDirectory(), []);
  return (
    <AsyncPanel state={state}>
      {(view) => {
        const list = journalists(view);
        return (
          <Panel title="Journalists" className="panel-wide">
            {list.length === 0 ? (
              <p className="empty-state">No journalists are on record.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Journalist</th>
                      <th>Outlet</th>
                      <th>Beat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((entry) => (
                      <tr key={entry.reference.id}>
                        <td>
                          <EntityRefLink reference={entry.reference} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
                        </td>
                        <td>{entry.outletName}</td>
                        <td>{entry.beat.replaceAll("_", " ").toLowerCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        );
      }}
    </AsyncPanel>
  );
};