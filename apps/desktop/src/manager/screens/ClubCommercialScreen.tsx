import React from "react";
import type { ClubProfile, EntityId, EntityReference, EntityReferenceType } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Metrics, Panel, useRuntimeData } from "../ui.js";
import { EntityRefLink } from "../RoleDetailScreen.js";

/**
 * Phase 6D — Club Commercial (Manager read-only awareness).
 *
 * Surfaces the Manager-facing commercial context: the club's current sponsor
 * partners (canonical Sponsor destinations) and its commercial standing.
 * Deal values, terms and renewal controls are Owner institutional authority and
 * are deliberately not surfaced to the Manager.
 */

/** The club's active sponsor partners as canonical references. */
export const sponsors = (profile: ClubProfile | undefined): EntityReference[] =>
  profile?.activeSponsors ?? [];

export const ClubCommercialScreen = ({
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
  const [support] = useRuntimeData(() => managerBridge.getSupporterOverview(), []);

  if (!clubId) {
    return (
      <section className="dashboard">
        <Panel title="Commercial">
          <p className="subtle">Join a club as Manager to view its commercial partners here.</p>
        </Panel>
      </section>
    );
  }

  return (
    <AsyncPanel state={profile}>
      {(view) => {
        const partnerList = sponsors(view);
        return (
          <>
            <Panel title="Current partners" className="panel-wide">
              {partnerList.length === 0 ? (
                <p className="empty-state">No active commercial partners are on record for this club.</p>
              ) : (
                <ul className="report-list">
                  {partnerList.map((sponsor) => (
                    <li key={sponsor.id}>
                      <EntityRefLink reference={sponsor} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
                      <Badge tone="info">partner</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <p className="subtle">
                Deal values, sponsorship terms and renewal decisions are Owner institutional authority and are not
                shown to the football department.
              </p>
            </Panel>

            <Panel title="Commercial standing" className="panel-wide">
              {view.reputation ? (
                <Metrics
                  items={[
                    { label: "Commercial reputation", value: `${Math.round(view.reputation.commercialReputation)}/100` },
                    { label: "Football reputation", value: `${Math.round(view.reputation.footballReputation)}/100` },
                  ]}
                />
              ) : (
                <p className="empty-state">No commercial reputation has been modelled for this club.</p>
              )}
              {support.status === "ready" && support.data ? (
                <p className="subtle">
                  Supporter commercial engagement index {Math.round(support.data.commercialEngagementIndex)}/100
                </p>
              ) : null}
            </Panel>

            <Panel title="Authority">
              <p className="subtle">
                The Manager has commercial awareness here and no institutional deal controls. Negotiating,
                accepting and pricing partnerships is the owner&rsquo;s responsibility in the Owner workspace.
              </p>
            </Panel>
          </>
        );
      }}
    </AsyncPanel>
  );
};