import React, { useState } from "react";
import type { EntityId, ShortlistEntry } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Panel, useRuntimeData } from "../ui.js";
import type { AppError } from "../../appBridge.js";
import { EntityRefLink } from "../RoleDetailScreen.js";
import {
  knowledgeText,
  knowledgeTone,
  rangeText,
  shortlistSortRows,
  type ShortlistSortKey,
} from "../recruitment.js";

export const ShortlistsScreen = ({
  onSelectPlayer,
  onOpenClub,
}: {
  onSelectPlayer: (playerId: EntityId) => void;
  onOpenClub: (clubId: EntityId) => void;
}): React.ReactElement => {
  const [dashboard, refreshDashboard, replaceDashboard] = useRuntimeData(() => managerBridge.getScoutingDashboard());
  const [sortKey, setSortKey] = useState<ShortlistSortKey>("added");
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (action: () => Promise<Awaited<ReturnType<typeof managerBridge.toggleShortlist>>>) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      replaceDashboard(result.data);
      setError(null);
    } else setError(result.error);
  };

  return (
    <section className="dashboard">
      {error && <ErrorBanner error={error} />}

      <Panel title="Shortlists" className="panel-wide">
        <p className="subtle">
          Curated comparison of recruitment targets — one canonical shortlist shared with the Player Database. Ranges
          stay ranges and unknown stays unknown.
        </p>
        <label>
          Sort
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as ShortlistSortKey)}>
            <option value="added">Recently added</option>
            <option value="player">Player</option>
            <option value="club">Club</option>
            <option value="knowledge">Knowledge</option>
            <option value="ability">Est. ability</option>
          </select>
        </label>

        <AsyncPanel
          state={dashboard}
          isEmpty={(view) => view.shortlist.length === 0}
          empty="No players shortlisted. Use the Shortlist action in the Player Database."
        >
          {(view) => (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Club</th>
                    <th>Knowledge</th>
                    <th>Est. ability</th>
                    <th>Scout status</th>
                    <th>Added</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shortlistSortRows(view.shortlist, sortKey).map((entry: ShortlistEntry) => (
                    <tr key={entry.playerId}>
                      <td>
                        {entry.playerName ? (
                          <button className="link" onClick={() => onSelectPlayer(entry.playerId)}>
                            {entry.playerName}
                          </button>
                        ) : (
                          <span className="unknown">Unknown player</span>
                        )}
                      </td>
                      <td>
                        {entry.club ? (
                          <EntityRefLink reference={entry.club} onOpen={(reference) => onOpenClub(reference.id)} />
                        ) : (
                          (entry.clubName ?? "Free agent")
                        )}
                      </td>
                      <td>
                        <Badge tone={knowledgeTone(entry.knowledge)}>{knowledgeText(entry.knowledge)}</Badge>
                      </td>
                      <td>{rangeText(entry.estimatedAbility)}</td>
                      <td>{entry.scoutingStatus.toLowerCase()}</td>
                      <td>{entry.addedAt}</td>
                      <td>
                        <button
                          className="ghost small"
                          disabled={busy}
                          onClick={() => void act(() => managerBridge.createScoutingAssignment({ targetPlayerId: entry.playerId, priority: "HIGH" }))}
                        >
                          Scout
                        </button>
                        <button
                          className="ghost small"
                          disabled={busy}
                          onClick={() => void act(() => managerBridge.toggleShortlist(entry.playerId))}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AsyncPanel>
        <button className="ghost" onClick={refreshDashboard}>
          Refresh
        </button>
      </Panel>
    </section>
  );
};