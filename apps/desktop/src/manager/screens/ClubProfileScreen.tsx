import React from "react";
import type {
  ClubProfile,
  ClubVisualIdentityView,
  EntityId,
  EntityReference,
  EntityReferenceType,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Panel, useRuntimeData } from "../ui.js";
import { EntityRefLink } from "../RoleDetailScreen.js";
import { ClubBadge } from "../../presentation/ClubBadge.js";
import { buildClubBadgeDesign } from "../../presentation/clubVisualIdentity.js";
import { CLUB_UNKNOWN, clubDisplayName, groundLabel, groundCapacity, identityAccent, identitySecondary } from "../club.js";

type ClubRead<T> = Promise<Awaited<ReturnType<typeof managerBridge.getClubProfile>>>;

export const ClubProfileScreen = ({
  clubId,
  onOpenEntity,
}: {
  clubId?: EntityId;
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void;
}): React.ReactElement => {
  const [profile] = useRuntimeData(
    (): ClubRead<ClubProfile> =>
      clubId ? managerBridge.getClubProfile(clubId) : Promise.resolve({ ok: false, error: "No club" } as never),
  );
  const [identity] = useRuntimeData(
    (): Promise<Awaited<ReturnType<typeof managerBridge.getClubVisualIdentity>>> =>
      clubId ? managerBridge.getClubVisualIdentity(clubId) : Promise.resolve({ ok: false, error: "No club" } as never),
  );
  const idv = identity as unknown as ClubVisualIdentityView | undefined;

  if (!clubId) {
    return (
      <section className="dashboard">
        <Panel title="Club Profile">
          <p className="subtle">Join a club as Manager to view its profile here.</p>
        </Panel>
      </section>
    );
  }

  return (
    <section className="dashboard">
      <AsyncPanel state={profile} isEmpty={(p) => !p} empty="Club profile unavailable.">
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
                  <p className="subtle">
                    Provenance: {(idv?.provenanceStatus ?? CLUB_UNKNOWN).toLowerCase()}
                  </p>
                </div>
              </div>

              <Panel title="Club Profile" className="panel-wide">
                <dl className="detail-list">
                  {refRow("Manager", view.manager)}
                  {refRow("Owner / Chairman", view.owner)}
                  <div>
                    <dt>Home ground</dt>
                    <dd>
                      {groundLabel(view)}
                      {groundCapacity(view) !== CLUB_UNKNOWN ? ` (capacity ${groundCapacity(view)})` : ""}
                      {view.stadium?.confirmedHomeGround ? "" : " · ground identity unconfirmed"}
                    </dd>
                  </div>
                  {view.activeSponsors.length > 0 && (
                    <div>
                      <dt>Active sponsors</dt>
                      <dd>
                        <ul className="report-list">
                          {view.activeSponsors.map((sponsor) => (
                            <li key={sponsor.id}>
                              <EntityRefLink reference={sponsor} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  )}
                </dl>
              </Panel>

              <Panel title="Squad" className="panel-wide">
                {view.squad.length === 0 ? (
                  <p className="subtle">No squad entries to show.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Player</th>
                          <th>Subtitle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.squad.slice(0, 30).map((player) => (
                          <tr key={player.id}>
                            <td>
                              <EntityRefLink reference={player} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
                            </td>
                            <td>{player.subtitle ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </>
          );
        }}
      </AsyncPanel>
    </section>
  );
};