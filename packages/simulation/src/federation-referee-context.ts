import type { EntityId, FederationRefereeContext } from "@nepal-football-sim/shared-types";
import { RefereeDevelopmentRepository, type GameDatabase } from "@nepal-football-sim/database";
import { refereeGovernanceSummary } from "./federation-strategy.js";

/**
 * A minimal, honest referee/coaching-development read model for the
 * President: real assignment/match-event-derived governance signals
 * (refereeGovernanceSummary, already fully computed but unwired to the
 * desktop layer) plus the real referee pool size and active development
 * programme count. Never fabricates a quality rating beyond what the
 * governance summary already derives.
 */
export const buildFederationRefereeContext = (
  db: GameDatabase,
  federationId: EntityId,
  worldDate: string,
): FederationRefereeContext => {
  const governance = refereeGovernanceSummary(db, federationId, worldDate);
  const poolSize = (db.prepare("SELECT COUNT(*) AS n FROM referee_profiles").get() as { n: number }).n;
  const activeDevelopmentProgrammes = new RefereeDevelopmentRepository(db)
    .programmes(federationId)
    .filter((programme) => programme.status === "ACTIVE").length;
  return { governance, poolSize, activeDevelopmentProgrammes, provenanceStatus: "SIMULATION_ONLY" };
};
