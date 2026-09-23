import React from "react";
import type { ClubProfile, EntityId, EntityReference, EntityReferenceType, ManagerCareerHistoryView } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Panel, useRuntimeData } from "../ui.js";
import { EntityRefLink } from "../RoleDetailScreen.js";

/**
 * Phase 6D — Club History & Honours.
 *
 * Persisted institutional memory, surfaced truthfully from canonical records:
 *   - Club milestones: the club's recorded infrastructure history.
 *   - Honours: the current manager's trophies (competition + year + team).
 *   - Career record: the manager's persistent appointments and outcomes.
 * No history or trophy is reconstructed or invented here.
 */

/** The club's recorded milestone entries. */
export const clubMilestones = (profile: ClubProfile | undefined): ClipMilestone[] =>
  (profile?.infrastructureHistory ?? []).map((entry) => ({
    headline: entry.headline,
    occurredOn: entry.occurredOn,
    tone: entry.tone,
    entities: entry.entities,
  }));

type ClipMilestone = {
  headline: string;
  occurredOn: string;
  tone: string;
  entities: EntityReference[];
};

/** The manager's honours (trophies). */
export const honours = (view: ManagerCareerHistoryView): ManagerCareerHistoryView["trophies"] =>
  view.trophies;

/** The manager's institutional career record. */
export const careerRecord = (view: ManagerCareerHistoryView): ManagerCareerHistoryView["history"] =>
  view.history;

export const ClubHistoryScreen = ({
  clubId,
  onOpenEntity,
}: {
  clubId?: EntityId;
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void;
}): React.ReactElement => {
  const [careerState] = useRuntimeData(() => managerBridge.getCareerHistory(), []);
  const [profile] = useRuntimeData(
    (): Promise<Awaited<ReturnType<typeof managerBridge.getClubProfile>>> =>
      clubId ? managerBridge.getClubProfile(clubId) : Promise.resolve({ ok: false, error: "No club" } as never),
  );

  if (!clubId) {
    return (
      <section className="dashboard">
        <Panel title="History & Honours">
          <p className="subtle">Join a club as Manager to view its recorded history here.</p>
        </Panel>
      </section>
    );
  }

  return (
    <AsyncPanel state={profile}>
      {(profileView) => {
        const milestones = clubMilestones(profileView);
        return (
          <>
            <Panel title="Honours" className="panel-wide">
              <AsyncPanel state={careerState}>
                {(career) => {
                  const trophies = honours(career);
                  if (trophies.length === 0) {
                    return <p className="empty-state">No honours are on record for the current manager.</p>;
                  }
                  return (
                    <ul className="report-list">
                      {trophies.map((trophy, index) => (
                        <li key={`${trophy.wonOn}-${index}`}>
                          <strong>{trophy.competitionName}</strong>{" "}
                          <span className="subtle">{`${trophy.wonOn.slice(0, 4)} · ${trophy.teamName}`}</span>
                        </li>
                      ))}
                    </ul>
                  );
                }}
              </AsyncPanel>
              <p className="subtle">Honours here are the current manager&rsquo;s recorded trophies.</p>
            </Panel>

            <Panel title="Club milestones" className="panel-wide">
              {milestones.length === 0 ? (
                <p className="empty-state">No recorded milestones exist for this club yet.</p>
              ) : (
                <ul className="report-list">
                  {milestones.map((milestone, index) => (
                    <li key={`${milestone.occurredOn}-${index}`}>
                      <Badge tone={milestone.tone as "ok" | "warn" | "bad" | "info"}>{milestone.tone}</Badge>{" "}
                      {milestone.headline} <span className="subtle">{milestone.occurredOn}</span>
                      {milestone.entities.length > 0 && (
                        <span className="subtle">
                          {" "}·{" "}
                          {milestone.entities
                            .filter((ref) => ref.visible)
                            .map((ref) => (
                              <EntityRefLink key={ref.id} reference={ref} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
                            ))}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Manager record" className="panel-wide">
              <AsyncPanel state={careerState}>
                {(career) => {
                  const record = careerRecord(career);
                  if (record.length === 0) {
                    return <p className="empty-state">No career history has been recorded.</p>;
                  }
                  return (
                    <ol className="report-list" reversed>
                      {record.map((entry) => (
                        <li key={entry.contractId}>
                          {entry.jobTitle} at {entry.clubName ?? "an unknown club"}
                          <span className="subtle">
                            {" "}· {entry.start.slice(0, 4)}–{(entry.end ?? "present").slice(0, 4)}
                            {" "}({entry.outcome.replaceAll("_", " ").toLowerCase()})
                          </span>
                        </li>
                      ))}
                    </ol>
                  );
                }}
              </AsyncPanel>
              <p className="subtle">Longer club history beyond the current manager&rsquo;s record is a later world-history gap.</p>
            </Panel>
          </>
        );
      }}
    </AsyncPanel>
  );
};