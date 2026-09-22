import React from "react";
import type { ClubProfile, EntityId, EntityReference, EntityReferenceType, ManagerDashboard } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, EmptyState, Metrics, Panel, useRuntimeData } from "../ui.js";
import { EntityRefLink } from "../RoleDetailScreen.js";
import { CLUB_UNKNOWN } from "../club.js";

/**
 * Phase 6B — Club Board (Manager-facing governance view).
 *
 * Surfaces only canonical board state the Manager can legitimately see:
 *   - Leadership: the owner / chairman identity, from the club's own profile.
 *   - Objective / expectation: the board's stated expectation (`boardExpectation`).
 *   - How the Manager is judged: the canonical `boardConfidence` figure.
 *
 * It deliberately does NOT invent objectives, confidence bars, hidden AI weights,
 * or synthetic job-security percentages. The Owner's institutional board policy,
 * strategic objectives, and decision-making live in the Owner workspace.
 */

const humanizeExpectation = (expectation?: string): string =>
  expectation ? expectation.replaceAll("_", " ").toLowerCase() : CLUB_UNKNOWN;

/** The leadership reference the board surfaces: the Owner / Chairman identity. */
export const leadershipRef = (profile: ClubProfile | undefined): EntityReference | undefined =>
  profile?.owner;

export const ClubBoardScreen = ({
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
  const [dashboardState] = useRuntimeData(
    (): Promise<Awaited<ReturnType<typeof managerBridge.getManagerDashboard>>> =>
      managerBridge.getManagerDashboard(),
    [],
  );

  if (!clubId) {
    return (
      <section className="dashboard">
        <Panel title="Club Board">
          <p className="subtle">Join a club as Manager to see its governance here.</p>
        </Panel>
      </section>
    );
  }

  return (
    <AsyncPanel state={profile}>
      {(profileView) => {
        const leader = leadershipRef(profileView);
        return (
          <>
            <Panel title="Leadership" className="panel-wide">
              <dl className="detail-list">
                <div>
                  <dt>Owner / Chairman</dt>
                  <dd>
                    {leader ? (
                      <EntityRefLink reference={leader} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
                    ) : (
                      <span className="unknown">{CLUB_UNKNOWN}</span>
                    )}
                  </dd>
                </div>
              </dl>
              <p className="subtle">
                The board sets the club&rsquo;s institutional direction. This Manager-facing view shows only the
                governance the club exposes to the football department.
              </p>
            </Panel>

            <AsyncPanel state={dashboardState}>
              {(dashboard: ManagerDashboard) => (
                <>
                  <Panel title="Current objective" className="panel-wide">
                    <Metrics
                      items={[
                        { label: "Board expects", value: humanizeExpectation(dashboard.boardExpectation) },
                        { label: "Board confidence", value: dashboard.boardConfidence === undefined ? "—" : `${Math.round(dashboard.boardConfidence)} / 100` },
                      ]}
                    />
                    <p className="subtle">
                      This is the board&rsquo;s standing expectation for the Manager. It is the only objective the
                      club states to the football department here.
                    </p>
                  </Panel>
                  <Panel title="Manager evaluation">
                    <p className="subtle">
                      Board confidence is the canonical evaluation the club carries for its current Manager. A
                      higher figure is healthier; no hidden weights or firing threshold are shown.
                    </p>
                    {dashboard.boardConfidence === undefined && (
                      <EmptyState>The board has not issued a confidence figure yet.</EmptyState>
                    )}
                  </Panel>
                </>
              )}
            </AsyncPanel>
          </>
        );
      }}
    </AsyncPanel>
  );
};