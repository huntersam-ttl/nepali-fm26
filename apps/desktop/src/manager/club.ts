import type { ClubProfile, ClubVisualIdentityView, EntityReference } from "@nepal-football-sim/shared-types";

/**
 * Phase 6A — Club presentation helpers.
 * Canonical facts only; unknown stays unknown; simulated identity is labelled
 * honestly via EntityReference.provenanceStatus.
 */

export const CLUB_UNKNOWN = "Unknown";

export const clubDisplayName = (profile: ClubProfile | undefined): string =>
  profile?.entityReference?.label ? profile.entityReference.label : CLUB_UNKNOWN;

export const referenceLabel = (ref?: EntityReference): string => ref?.label ?? CLUB_UNKNOWN;

/** Accent for identity presentation — falls back to the system accent. */
export const identityAccent = (identity: ClubVisualIdentityView | undefined): string =>
  identity?.primaryColour ?? "var(--sys-accent)";

export const identitySecondary = (identity: ClubVisualIdentityView | undefined): string =>
  identity?.secondaryColour ?? "var(--sys-accent)";

export const provenanceLabel = (provenanceStatus?: string): string =>
  provenanceStatus ? provenanceStatus : CLUB_UNKNOWN;

/** True when a reference is navigable via the canonical entity destination. */
export const isNavigable = (ref?: EntityReference): boolean => Boolean(ref?.visible && ref?.destination);

export const groundLabel = (profile: ClubProfile | undefined): string =>
  profile?.stadium?.name ?? CLUB_UNKNOWN;

export const groundCapacity = (profile: ClubProfile | undefined): string =>
  profile?.stadium?.capacity == null ? CLUB_UNKNOWN : String(profile.stadium.capacity);

export const confirmedHomeGround = (profile: ClubProfile | undefined): boolean =>
  Boolean(profile?.stadium?.confirmedHomeGround);