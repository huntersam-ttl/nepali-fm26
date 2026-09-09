import React, { useState } from "react";
import type {
  DressingRoomHierarchyLabel,
  EntityId,
  SquadConcernView,
  SquadDemandView,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, EmptyState, Metrics, Panel, useRuntimeData } from "../ui.js";
import { humanizeEnum } from "../storyHumanizer.js";
import { PlayerMeetingPanel } from "./PlayerMeetingPanel.js";

const hierarchyLabelText = (label: DressingRoomHierarchyLabel): string => {
  switch (label) {
    case "TEAM_LEADER":
      return "Team leaders";
    case "HIGHLY_INFLUENTIAL":
      return "Highly influential";
    case "REGULAR":
      return "Regular squad";
    case "FRINGE":
      return "Fringe";
    case "YOUNGSTER":
      return "Youngsters";
  }
};

const HIERARCHY_ORDER: DressingRoomHierarchyLabel[] = [
  "TEAM_LEADER",
  "HIGHLY_INFLUENTIAL",
  "REGULAR",
  "FRINGE",
  "YOUNGSTER",
];

/**
 * The first-class Dressing Room / Squad Dynamics screen — the previous two
 * relationship-sprint passes only ever surfaced this data as a compact
 * panel inside the Home dashboard. Combines the two canonical read models
 * that already existed for this (getSquadConcerns' SquadDynamicsView and
 * getDressingRoom's DressingRoomView) into one reachable screen rather
 * than inventing a third data source. Every player name here is a real
 * link to the canonical Player Profile — never a plain label when a
 * destination exists.
 */
export const DressingRoomScreen = ({
  onSelectPlayer,
}: {
  onSelectPlayer: (playerId: EntityId) => void;
}): React.ReactElement => {
  const [refreshKey, setRefreshKey] = useState(0);
  const [dynamicsState, refreshDynamics] = useRuntimeData(() => managerBridge.getSquadConcerns(), [refreshKey]);
  const [roomState] = useRuntimeData(() => managerBridge.getDressingRoom(), [refreshKey]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openMeeting, setOpenMeeting] = useState<
    { playerName: string; concern?: SquadConcernView; demand?: SquadDemandView } | null
  >(null);

  const runAction = async (
    key: string,
    run: () => Promise<{ ok: boolean; error?: { message: string } }>,
  ): Promise<void> => {
    setActionBusy(key);
    setActionError(null);
    const result = await run();
    setActionBusy(null);
    if (!result.ok) {
      setActionError(result.error?.message ?? "That action failed.");
      return;
    }
    setRefreshKey((value) => value + 1);
  };

  const Link = ({ id, name }: { id: EntityId; name: string }): React.ReactElement => (
    <button className="link" onClick={() => onSelectPlayer(id)}>
      {name}
    </button>
  );

  return (
    <section className="dressing-room-screen">
      <h2>Dressing Room</h2>
      {actionError && (
        <div className="warning" role="alert">
          {actionError}
        </div>
      )}
      <AsyncPanel state={dynamicsState}>
        {(view) => (
          <>
            <Panel title="Overview">
              <Metrics
                items={[
                  { label: "Atmosphere", value: view.cohesion.level },
                  { label: "Cohesion", value: view.cohesion.score },
                  {
                    label: "Captain",
                    value: view.cohesion.captainPersonId ? (
                      <Link id={view.cohesion.captainPersonId} name={view.cohesion.captainName ?? "—"} />
                    ) : (
                      "None"
                    ),
                  },
                  {
                    label: "Vice-captain",
                    value: view.cohesion.viceCaptainPersonId ? (
                      <Link id={view.cohesion.viceCaptainPersonId} name={view.cohesion.viceCaptainName ?? "—"} />
                    ) : (
                      "None"
                    ),
                  },
                  { label: "Open concerns", value: view.concerns.length },
                  { label: "Open demands", value: view.demands.length },
                  { label: "Open disputes", value: view.disputes.length },
                ]}
              />
              {view.cohesion.topIssue && (
                <p className="warning" role="alert">
                  {view.cohesion.topIssue}
                </p>
              )}
              <div className="button-row">
                <button
                  className="ghost"
                  disabled={actionBusy !== null}
                  onClick={() =>
                    void runAction("team-meeting", () => managerBridge.holdSquadMeeting({ type: "SQUAD_MEETING" }))
                  }
                >
                  {actionBusy === "team-meeting" ? "…" : "Hold team meeting"}
                </button>
                <button
                  className="ghost"
                  disabled={actionBusy !== null}
                  onClick={() =>
                    void runAction("captain-consultation", () =>
                      managerBridge.holdSquadMeeting({ type: "CAPTAIN_CONSULTATION" }),
                    )
                  }
                >
                  {actionBusy === "captain-consultation" ? "…" : "Consult captain"}
                </button>
              </div>
            </Panel>

            <AsyncPanel state={roomState}>
              {(room) => (
                <Panel title="Hierarchy">
                  {HIERARCHY_ORDER.map((label) => {
                    const members = room.hierarchy.filter((entry) => entry.label === label);
                    if (members.length === 0) return null;
                    return (
                      <div key={label} className="dressing-room-tier">
                        <strong>{hierarchyLabelText(label)}</strong> ({members.length}):{" "}
                        {members.map((member, index) => {
                          const isCaptain = view.cohesion.captainPersonId === member.personId;
                          const isVice = view.cohesion.viceCaptainPersonId === member.personId;
                          return (
                            <React.Fragment key={member.personId}>
                              {index > 0 && ", "}
                              <Link id={member.personId} name={member.playerName} />
                              {isCaptain && <Badge tone="info"> C</Badge>}
                              {isVice && <Badge tone="info"> VC</Badge>}
                              {member.groupType === "CORE_LEADERS" && !isCaptain && (
                                <button
                                  className="ghost tiny"
                                  disabled={actionBusy !== null}
                                  title="Appoint as captain"
                                  onClick={() =>
                                    void runAction(`captain-${member.personId}`, () =>
                                      managerBridge.appointCaptaincy({ captainPersonId: member.personId }),
                                    )
                                  }
                                >
                                  {actionBusy === `captain-${member.personId}` ? "…" : "Make captain"}
                                </button>
                              )}
                              {member.groupType === "CORE_LEADERS" && !isCaptain && !isVice && (
                                <button
                                  className="ghost tiny"
                                  disabled={actionBusy !== null}
                                  title="Appoint as vice-captain"
                                  onClick={() =>
                                    void runAction(`vice-captain-${member.personId}`, () =>
                                      managerBridge.appointCaptaincy({ viceCaptainPersonId: member.personId }),
                                    )
                                  }
                                >
                                  {actionBusy === `vice-captain-${member.personId}` ? "…" : "Make vice-captain"}
                                </button>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    );
                  })}
                  {room.managerSupport.length > 0 && (
                    <>
                      <h4>Relationship with you</h4>
                      <ul className="report-list">
                        {room.managerSupport.map((entry) => (
                          <li key={entry.personId}>
                            <Link id={entry.personId} name={entry.playerName} />{" "}
                            <Badge
                              tone={
                                entry.support === "FULLY_ONSIDE"
                                  ? "ok"
                                  : entry.support === "AT_ODDS"
                                    ? "bad"
                                    : "info"
                              }
                            >
                              {humanizeEnum(entry.support)}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {room.socialGroups.length > 0 && (
                    <>
                      <h4>Social dynamics</h4>
                      <ul className="report-list">
                        {room.socialGroups.map((group, index) => (
                          // No canonical personId travels with a social-group
                          // member name today, so these stay plain text —
                          // never a fake link to nowhere.
                          <li key={`${group.type}-${index}`}>
                            <Badge tone={group.type === "DISTRUST" || group.type === "RIVALRY" ? "bad" : "info"}>
                              {humanizeEnum(group.type)}
                            </Badge>{" "}
                            {group.memberNames.join(", ")} — <span className="subtle">{group.clue}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Panel>
              )}
            </AsyncPanel>

            <Panel title={`Concerns (${view.concerns.length})`}>
              {view.concerns.length === 0 ? (
                <EmptyState>No active concerns.</EmptyState>
              ) : (
                <ul className="report-list">
                  {view.concerns.map((concern) => (
                    <li key={concern.id}>
                      <Link id={concern.personId} name={concern.playerName} />{" "}
                      <Badge tone={concern.status === "ESCALATED" ? "bad" : "warn"}>{humanizeEnum(concern.type)}</Badge>{" "}
                      <span className="subtle">
                        {humanizeEnum(concern.status)} · severity {concern.severity}
                      </span>
                      {concern.note && <div className="subtle">{concern.note}</div>}
                      {concern.activePromise ? (
                        <div className="subtle">
                          Promise pending: {concern.activePromise.description} (due {concern.activePromise.dueOn})
                        </div>
                      ) : (
                        <div className="button-row">
                          <button
                            className="ghost small"
                            onClick={() => setOpenMeeting({ playerName: concern.playerName, concern })}
                          >
                            Open meeting
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={`Demands (${view.demands.length})`}>
              {view.demands.length === 0 ? (
                <EmptyState>No open requests from your players right now.</EmptyState>
              ) : (
                <ul className="report-list">
                  {view.demands.map((demand) => (
                    <li key={demand.id}>
                      <Link id={demand.personId} name={demand.playerName} /> wants{" "}
                      <strong>{humanizeEnum(demand.type).replace(/ Request$/, "").replace(/ Concern$/, "")}</strong>
                      <div className="subtle">{demand.requestedOutcome}</div>
                      <div className="subtle">
                        {demand.trigger}
                        {demand.reviewOn && ` · review by ${demand.reviewOn}`}
                      </div>
                      <div className="button-row">
                        <button
                          className="ghost small"
                          onClick={() => setOpenMeeting({ playerName: demand.playerName, demand })}
                        >
                          Open meeting
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={`Promises (${view.promises.length})`}>
              {view.promises.length === 0 ? (
                <EmptyState>No active promises.</EmptyState>
              ) : (
                <ul className="report-list">
                  {view.promises.map((promise) => (
                    <li key={promise.id}>
                      <Link id={promise.personId} name={promise.playerName} /> — {promise.description}
                      <div className="subtle">
                        {humanizeEnum(promise.status)} · due {promise.dueOn}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {view.disputes.length > 0 && (
              <Panel title={`Disputes (${view.disputes.length})`}>
                <ul className="report-list">
                  {view.disputes.map((dispute) => (
                    <li key={dispute.id}>
                      <Link id={dispute.personId} name={dispute.playerName} />
                      {dispute.withPersonId && dispute.withPlayerName && (
                        <>
                          {" "}
                          vs <Link id={dispute.withPersonId} name={dispute.withPlayerName} />
                        </>
                      )}{" "}
                      <span className="subtle">({humanizeEnum(dispute.concernType)})</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {view.meetings.length > 0 && (
              <Panel title="Recent meetings">
                <ul className="report-list">
                  {view.meetings.slice(0, 8).map((meeting) => (
                    <li key={meeting.id}>
                      <span className="subtle">{meeting.occurredOn}</span> · {humanizeEnum(meeting.type)}
                      {meeting.personId && (
                        <>
                          {" — "}
                          <Link id={meeting.personId} name="View player" />
                        </>
                      )}{" "}
                      <Badge tone={meeting.outcome === "POSITIVE" ? "ok" : meeting.outcome === "NEGATIVE" ? "bad" : "info"}>
                        {humanizeEnum(meeting.outcome)}
                      </Badge>
                      <div className="subtle">{meeting.summary}</div>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        )}
      </AsyncPanel>
      {openMeeting && (
        <PlayerMeetingPanel
          playerName={openMeeting.playerName}
          managerName="You"
          concern={openMeeting.concern}
          demand={openMeeting.demand}
          onClose={() => setOpenMeeting(null)}
          onUpdate={() => setRefreshKey((value) => value + 1)}
        />
      )}
    </section>
  );
};
