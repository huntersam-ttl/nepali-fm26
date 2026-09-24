import {
  FederationComplianceRepository,
  FederationGovernanceRepository,
  FederationPoliticsRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import type {
  EntityId,
  FederationExternalContext,
  FederationTenureEntry,
  FederationTenureView,
} from "@nepal-football-sim/shared-types";

const personName = (db: GameDatabase, personId: EntityId): string => {
  const row = db.prepare("SELECT display_name, full_name FROM persons WHERE id=?").get(personId) as
    | { display_name?: string; full_name?: string }
    | undefined;
  return row?.display_name ?? row?.full_name ?? "Unknown";
};

/**
 * The President's own presidencies and the public election record. A tenure
 * stays in the history after it ends. Election vote shares, candidate scores,
 * committee influence and coalition support are never returned.
 */
export const buildFederationTenure = (
  db: GameDatabase,
  federationId: EntityId,
  personId: EntityId,
): FederationTenureView => {
  const history: FederationTenureEntry[] = new FederationGovernanceRepository(db)
    .leadershipTenures(federationId)
    .filter((tenure) => tenure.personId === personId && tenure.role === "FEDERATION_PRESIDENT")
    .map((tenure) => ({
      id: tenure.id,
      status: tenure.status,
      termStart: tenure.termStart,
      termEnd: tenure.termEnd,
    }))
    .sort((a, b) => b.termStart.localeCompare(a.termStart) || a.id.localeCompare(b.id));
  const current = history.find((entry) => entry.status === "ACTIVE") ?? history.find((entry) => entry.status === "INTERIM");

  const politics = new FederationPoliticsRepository(db);
  const cycles = politics.cycles(federationId);
  const pending = cycles
    .filter((cycle) => cycle.status !== "COMPLETED")
    .sort((a, b) => a.electionDate.localeCompare(b.electionDate))[0];
  const latestResult = [...politics.results(federationId)].sort(
    (a, b) => b.decidedAt.localeCompare(a.decidedAt) || a.id.localeCompare(b.id),
  )[0];
  const latestCycle = latestResult ? cycles.find((cycle) => cycle.id === latestResult.cycleId) : undefined;

  return {
    current,
    history,
    election: {
      upcoming: pending
        ? { electionDate: pending.electionDate, nominationStart: pending.nominationStart, status: pending.status }
        : undefined,
      latest: latestResult
        ? {
            decidedAt: latestResult.decidedAt,
            winnerName: personName(db, latestResult.electedPersonId),
            youWon: latestResult.electedPersonId === personId,
            termYears: latestCycle?.termYears ?? 4,
          }
        : undefined,
    },
    provenanceStatus: "SIMULATION_ONLY",
  };
};

/** Compliance standing and sanctions imposed on the federation, as the President may see them. */
export const buildFederationExternalContext = (db: GameDatabase, federationId: EntityId): FederationExternalContext => {
  const repo = new FederationComplianceRepository(db);
  const profile = repo.complianceProfile(federationId);
  return {
    compliance: profile ? { status: profile.status, lastReviewedOn: profile.lastReviewedOn } : undefined,
    sanctions: repo
      .sanctionsForFederation(federationId)
      .map((sanction) => ({
        id: sanction.id,
        authority: sanction.authority,
        category: sanction.category,
        reason: sanction.reason,
        startDate: sanction.startDate,
        reviewState: sanction.reviewState,
        resolvedOn: sanction.resolvedOn,
        consequences: [...sanction.consequences],
        requirementsForResolution: [...sanction.requirementsForResolution],
        affectedProgrammes: [...sanction.affectedProgrammes],
      }))
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id)),
    provenanceStatus: "SIMULATION_ONLY",
  };
};
