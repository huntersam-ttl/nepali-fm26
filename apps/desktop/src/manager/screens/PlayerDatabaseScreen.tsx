import React, { useState } from "react";
import type { EntityId, PlayerKnowledgeLevel, RecruitmentSearchPage } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Panel, useRuntimeData } from "../ui.js";
import type { AppError } from "../../appBridge.js";
import { EntityRefLink } from "../RoleDetailScreen.js";
import {
  knowledgeText,
  knowledgeTone,
  rangeText,
  rowName,
  rowPosition,
  sortRows,
  type RecruitmentSortKey,
} from "../recruitment.js";

const PAGE_SIZE = 25;

export const PlayerDatabaseScreen = ({
  onSelectPlayer,
  onOpenClub,
}: {
  onSelectPlayer: (playerId: EntityId) => void;
  onOpenClub: (clubId: EntityId) => void;
}): React.ReactElement => {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [knowledge, setKnowledge] = useState<PlayerKnowledgeLevel | "ALL">("ALL");
  const [sortKey, setSortKey] = useState<RecruitmentSortKey>("name");
  const [search, refreshSearch] = useRuntimeData(
    () => managerBridge.searchRecruitment({ query: query || undefined, page, pageSize: PAGE_SIZE }),
    [query, page],
  );
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (action: () => Promise<Awaited<ReturnType<typeof managerBridge.toggleShortlist>>>) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      setError(null);
      refreshSearch();
    } else setError(result.error);
  };

  return (
    <section className="dashboard">
      {error && <ErrorBanner error={error} />}

      <Panel title="Player Database" className="panel-wide">
        <p className="subtle">
          This is recruitment discovery, not global search. You only see what your club actually knows —
          hidden ability, potential and private figures stay hidden and read as <strong>Unknown</strong>.
        </p>
        <div className="table-tools">
          <label>
            Search known players
            <input
              placeholder="Search by name"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            Knowledge
            <select
              value={knowledge}
              onChange={(event) => setKnowledge(event.target.value as PlayerKnowledgeLevel | "ALL")}
            >
              <option value="ALL">Any</option>
              <option value="NONE">None</option>
              <option value="MINIMAL">Minimal</option>
              <option value="BASIC">Basic</option>
              <option value="GOOD">Good</option>
              <option value="EXTENSIVE">Extensive</option>
              <option value="COMPLETE">Complete</option>
            </select>
          </label>
          <label>
            Sort
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as RecruitmentSortKey)}>
              <option value="name">Name</option>
              <option value="position">Position</option>
              <option value="club">Club</option>
              <option value="knowledge">Knowledge</option>
              <option value="ability">Est. ability</option>
            </select>
          </label>
        </div>
        <p className="subtle">
          {knowledge !== "ALL"
            ? `Filtering the current search results by "${knowledge.toLowerCase()}" knowledge (page-scoped).`
            : "Sorting applies to the current search results."}
        </p>

        <AsyncPanel state={search} isEmpty={(data) => data.rows.length === 0} empty="No players match.">
          {(results: RecruitmentSearchPage) => {
            const filtered = sortRows(
              knowledge === "ALL" ? results.rows : results.rows.filter((row) => row.knowledge === knowledge),
              sortKey,
            );
            return (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Club</th>
                        <th>Position</th>
                        <th>Knowledge</th>
                        <th>Est. ability</th>
                        <th>Potential</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row) => (
                        <tr key={row.playerId}>
                          <td>
                            {row.name ? (
                              <button className="link" onClick={() => onSelectPlayer(row.playerId)}>
                                {row.name}
                              </button>
                            ) : (
                              <span className="unknown">Unknown player</span>
                            )}
                          </td>
                          <td>
                            {row.club ? (
                              <EntityRefLink reference={row.club} onOpen={(reference) => onOpenClub(reference.id)} />
                            ) : (
                              (row.clubName ?? "Free agent")
                            )}
                          </td>
                          <td>{rowPosition(row)}</td>
                          <td>
                            <Badge tone={knowledgeTone(row.knowledge)}>{knowledgeText(row.knowledge)}</Badge>
                          </td>
                          <td>{rangeText(row.estimatedAbility)}</td>
                          <td>{row.estimatedPotential ?? "Unknown"}</td>
                          <td>
                            <button
                              className="ghost small"
                              disabled={busy}
                              onClick={() => void act(() => managerBridge.toggleShortlist(row.playerId))}
                            >
                              {row.shortlisted ? "Unshortlist" : "Shortlist"}
                            </button>
                            <button
                              className="ghost small"
                              disabled={busy}
                              onClick={() =>
                                void act(() =>
                                  managerBridge.createScoutingAssignment({
                                    targetPlayerId: row.playerId,
                                    priority: "HIGH",
                                  }),
                                )
                              }
                            >
                              Scout
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pager">
                  <button className="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Previous
                  </button>
                  <span>
                    {results.page * results.pageSize + 1}–{Math.min(results.total, (results.page + 1) * results.pageSize)}{" "}
                    of {results.total}
                  </span>
                  <button
                    className="ghost"
                    disabled={(results.page + 1) * results.pageSize >= results.total}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </>
            );
          }}
        </AsyncPanel>
      </Panel>
    </section>
  );
};