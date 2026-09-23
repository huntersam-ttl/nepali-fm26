import React from "react";
import type { EntityId, EntityReferenceType, MediaDirectoryView } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Panel, useRuntimeData } from "../ui.js";
import { EntityRefLink } from "../RoleDetailScreen.js";

/**
 * Phase 7A — Media Outlets.
 * Persisted outlets with canonical MEDIA_OUTLET references and published-story
 * counts. Public facts only — internal reach/bias/reputation stay server-side.
 */

export const outlets = (view: MediaDirectoryView): MediaDirectoryView["outlets"] => view.outlets;

export const MediaOutletsScreen = ({
  onOpenEntity,
}: {
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void;
}): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getMediaDirectory(), []);
  return (
    <AsyncPanel state={state}>
      {(view) => {
        const list = outlets(view);
        return (
          <Panel title="Media Outlets" className="panel-wide">
            {list.length === 0 ? (
              <p className="empty-state">No media outlets are on record.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Outlet</th>
                      <th>Scope</th>
                      <th>Published stories</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((outlet) => (
                      <tr key={outlet.reference.id}>
                        <td>
                          <EntityRefLink reference={outlet.reference} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
                        </td>
                        <td>{outlet.scope.replaceAll("_", " ").toLowerCase()}</td>
                        <td>{outlet.storyCount}</td>
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