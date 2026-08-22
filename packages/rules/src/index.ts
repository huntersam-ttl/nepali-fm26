import type {
  ClubOwnershipType,
  FinanceAccount,
  FinanceOwnerType,
} from "@nepal-football-sim/shared-types";

export const NEPAL_CLUB_OWNERSHIP_TYPES: readonly ClubOwnershipType[] = [
  "PRIVATE",
  "CORPORATE",
  "COMMUNITY",
  "MEMBER_OWNED",
  "DEPARTMENTAL",
  "MUNICIPALITY_BACKED",
  "INSTITUTIONAL",
  "UNKNOWN",
];

export const canClubBePrivatelyAcquired = (ownershipType: ClubOwnershipType): boolean =>
  ownershipType === "PRIVATE" || ownershipType === "CORPORATE" || ownershipType === "UNKNOWN";

export const assertFinanceAccountOwner = (
  account: FinanceAccount,
  expectedOwnerType: FinanceOwnerType,
): void => {
  if (account.ownerType !== expectedOwnerType) {
    throw new Error(
      `Finance account ${account.id} belongs to ${account.ownerType}, not ${expectedOwnerType}`,
    );
  }
};
