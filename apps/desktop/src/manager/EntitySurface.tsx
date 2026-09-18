import React from "react";
import type { EntityId, EntityReference, EntityReferenceType } from "@nepal-football-sim/shared-types";
import type { DesktopRuntimeApi } from "../appBridge.js";
import { referenceToDestination } from "../navigation.js";
import { EntityProfileBody, type ProfileEntityType } from "./RoleDetailScreen.js";
import { PlayerProfileScreen } from "./screens/PlayerProfileScreen.js";
import { entityTypeTitle } from "../navigation.js";

/**
 * THE canonical Phase 1B entity destination surface.
 *
 * Rendered as the current application destination (inside the shell workspace)
 * rather than a floating/appended overlay. PLAYER routes to the existing
 * PlayerProfileScreen; every other supported kind renders through the one
 * shared EntityProfileBody so the exact same read models and profile content
 * appear here as in the historical overlay — just as a destination, with
 * history via Phase 1A Back and canonical links outward.
 *
 * Knowledge/provenance boundaries are untouched: this is only navigation. The
 * same read models that restricted hidden scouting data before still do now.
 */
export const EntitySurface = ({
  entityType,
  entityId,
  bridge,
  onOpenEntity,
  onOpenWorkspace,
  onBack,
}: {
  entityType: EntityReferenceType;
  entityId: EntityId;
  bridge: DesktopRuntimeApi;
  onOpenEntity: (entityType: EntityReferenceType, entityId: EntityId) => void;
  /** Workspace actions that are not entity navigation (e.g. a player returning
   * to Dressing Room) — routed back through the shell. */
  onOpenWorkspace: (workspace: "dressing-room") => void;
  onBack: () => void;
}): React.ReactElement => {
  const openReference = (reference: EntityReference): void => {
    const destination = referenceToDestination(reference);
    if (destination) onOpenEntity(destination.entityType, destination.entityId);
    // Unsupported / hidden references are deliberately left alone.
  };

  if (entityType === "PLAYER") {
    return (
      <PlayerProfileScreen
        playerId={entityId}
        onClose={onBack}
        onOpenClub={(clubId) => onOpenEntity("CLUB", clubId)}
        onOpenPlayer={(playerId) => onOpenEntity("PLAYER", playerId)}
        onOpenDressingRoom={() => onOpenWorkspace("dressing-room")}
        bridge={bridge}
      />
    );
  }

  return (
    <section className="entity-destination">
      <header className="page-header">
        <div>
          <p className="eyebrow">Entity</p>
          {/* A section heading, not a second page title: the club stays the
              shell's single <h1>. The profile body below supplies the entity's
              own name. */}
          <h2>{entityTypeTitle(entityType)}</h2>
        </div>
      </header>
      <EntityProfileBody
        entityType={entityType as ProfileEntityType}
        entityId={entityId}
        bridge={bridge}
        onOpenReference={openReference}
      />
    </section>
  );
};