import React from "react";
import type {
  ClubProfile,
  ClubVisualIdentityView,
  EntityId,
  EntityReference,
  EntityReferenceType,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Panel, money, useRuntimeData } from "../ui.js";
import { EntityRefLink } from "../RoleDetailScreen.js";
import { ClubBadge } from "../../presentation/ClubBadge.js";
import { buildClubBadgeDesign } from "../../presentation/clubVisualIdentity.js";
import { CLUB_UNKNOWN, clubDisplayName, groundLabel, identityAccent, identitySecondary } from "../club.js";

type ClubRead<T> = Promise<Awaited<ReturnType<typeof managerBridge.getClubProfile>>>;

export const ClubOverviewScreen = ({
  clubId,
  onOpenEntity,
  onOpenWorkspace,
}: {
  clubId?: EntityId;
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void;
  onOpenWorkspace?: (workspace: string) => void;
}): React.ReactElement => {
  const [profile] = useRuntimeData(
    (): ClubRead<ClubProfile> =>
      clubId ? managerBridge.getClubProfile(clubId) : Promise.resolve({ ok: false, error: "No club" } as never),
  );
  const [identity] = useRuntimeData(
    (): Promise<Awaited<ReturnType<typeof managerBridge.getClubVisualIdentity>>> =>
      clubId ? managerBridge.getClubVisualIdentity(clubId) : Promise.resolve({ ok: false, error: "No club" } as never),
  );
  // Lightweight governance summaries (finance budget + board confidence) so the
  // Overview can link the Club governance destinations with real context without
  // duplicating those screens. All three reads are the same canonical sources.
  const [centre] = useRuntimeData(() => managerBridge.getTransferCentre(), []);
  const [boardState] = useRuntimeData(() => managerBridge.getManagerDashboard(), []);
  const idv = identity as unknown as ClubVisualIdentityView | undefined;

  if (!clubId) {
    return (
      <section className="dashboard">
        <Panel title="Club Overview">
          <p className="subtle">Join a club as Manager to see its overview here.</p>
        </Panel>
      </section>
    );
  }

  return (
    <section className="dashboard">
      <AsyncPanel state={profile} isEmpty={(p) => !p} empty="Club overview unavailable.">
        {(view: ClubProfile) => {
          const name = clubDisplayName(view);
          const badge = buildClubBadgeDesign(clubId, name);
          const accent = identityAccent(idv);
          const secondary = identitySecondary(idv);
          const refRow = (label: string, ref?: EntityReference) =>
            ref ? (
              <div>
                <dt>{label}</dt>
                <dd>
                  <EntityRefLink reference={ref} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
                </dd>
              </div>
            ) : (
              <div>
                <dt>{label}</dt>
                <dd className="unknown">{CLUB_UNKNOWN}</dd>
              </div>
            );
          return (
            <>
              <div className="club-hero" style={{ ["--club-accent" as string]: accent, ["--club-secondary" as string]: secondary }}>
                <ClubBadge design={badge} size="small" />
                <div>
                  <h1 style={{ margin: 0 }}>{name}</h1>
                  <p className="subtle">
                    {view.locationLabel ?? CLUB_UNKNOWN}
                    {view.division ? ` · ${view.division}` : ""}
                  </p>
                </div>
              </div>

              <Panel title="Club Overview" className="panel-wide">
                <p className="subtle">
                  A club is an institution, not just a squad list. Use the sidebar to act — Squad, Fixtures, Staff,
                  Recruitment, Transfers and Contracts all operate from this club.
                </p>
                <dl className="detail-list">
                  {refRow("Manager", view.manager)}
                  {refRow("Owner / Chairman", view.owner)}
                  <div>
                    <dt>Home ground</dt>
                    <dd>{groundLabel(view)}</dd>
                  </div>
                  <div>
                    <dt>Senior squad size</dt>
                    <dd>{view.squad.length}</dd>
                  </div>
                  <div>
                    <dt>Recent fixtures</dt>
                    <dd>
                      {view.recentFixtures.length === 0 ? (
                        <span className="unknown">{CLUB_UNKNOWN}</span>
                      ) : (
                        <ul className="report-list">
                          {view.recentFixtures.map((fixture) => (
                            <li key={fixture.id}>
                              <EntityRefLink reference={fixture} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </dd>
                  </div>
                  {view.infrastructureProjects.length > 0 && (
                    <div>
                      <dt>Infrastructure projects</dt>
                      <dd>
                        <ul className="report-list">
                          {view.infrastructureProjects.map((project) => (
                            <li key={project.id}>
                              <EntityRefLink reference={project} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  )}
                </dl>
              </Panel>

              <Panel title="Governance" className="panel-wide">
                <ul className="report-list">
                  <li>
                    <GovernanceLink
                      label="Club Finances"
                      to="club-finances"
                      onOpenWorkspace={onOpenWorkspace}
                      context="Football department budget"
                    />
                    {centre.status === "ready" && centre.data.budget ? (
                      <span className="subtle">
                        {" "}· {money(centre.data.budget.transferRemaining, centre.data.budget.currency)} transfer remaining
                      </span>
                    ) : null}
                  </li>
                  <li>
                    <GovernanceLink label="Club Board" to="club-board" onOpenWorkspace={onOpenWorkspace} context="Governance and the Manager evaluation" />
                    {boardState.status === "ready" && boardState.data.boardConfidence !== undefined ? (
                      <span className="subtle">
                        {" "}· board confidence {Math.round(boardState.data.boardConfidence)}/100
                      </span>
                    ) : null}
                  </li>
                  <li>
                    <GovernanceLink label="Responsibilities" to="club-responsibilities" onOpenWorkspace={onOpenWorkspace} context="Who handles each responsibility" />
                  </li>
                </ul>
              </Panel>
            </>
          );
        }}
      </AsyncPanel>
    </section>
  );
};

/** A keyboard-accessible summary link into a Club governance destination. */
const GovernanceLink = ({
  label,
  to,
  onOpenWorkspace,
  context,
}: {
  label: string;
  to: string;
  onOpenWorkspace?: (workspace: string) => void;
  context: string;
}): React.ReactElement => (
  <button
    type="button"
    className="ghost small"
    onClick={() => onOpenWorkspace?.(to)}
  >
    <strong>{label}</strong>
    <span className="subtle"> — {context}</span>
  </button>
);