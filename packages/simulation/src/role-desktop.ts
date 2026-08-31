import {
  ClubEconomyRepository,
  FederationGovernancePhaseBRepository,
  FederationGovernanceRepository,
  ManagerRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import type {
  ChairmanDashboard,
  EntityId,
  FederationNationalTeamSummary,
  FederationPresidentDashboard,
  SaveMetadata,
} from "@nepal-football-sim/shared-types";
import { getClubFinancialSummary } from "./club-economy.js";
import { getFederationFinances, getFederationOverview } from "./federation-governance.js";
import { heldCareerRoles } from "./career-control.js";

const personName = (db: GameDatabase, personId: EntityId): string => {
  const row = db.prepare("SELECT display_name, full_name FROM persons WHERE id=?").get(personId) as
    | { display_name?: string; full_name?: string }
    | undefined;
  return row?.display_name ?? row?.full_name ?? personId;
};

const heldTarget = (db: GameDatabase, save: SaveMetadata, role: "CHAIRMAN_OWNER" | "FEDERATION_PRESIDENT"): EntityId => {
  if (!save.playerCharacterId) throw new Error("Save has no player character.");
  const personId = careerPersonId(db, save);
  const target = heldCareerRoles(db, personId).find((entry) => entry.role === role)?.targetId;
  if (!target) throw new Error(`The active career does not hold ${role}.`);
  return target;
};

const careerPersonId = (db: GameDatabase, save: SaveMetadata): EntityId => {
  if (!save.playerCharacterId) throw new Error("Save has no player character.");
  const row = db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.playerCharacterId) as { person_id?: EntityId } | undefined;
  if (!row?.person_id) throw new Error("Career character record is missing.");
  return row.person_id;
};

export const buildChairmanDashboard = (db: GameDatabase, save: SaveMetadata): ChairmanDashboard => {
  const clubId = heldTarget(db, save, "CHAIRMAN_OWNER");
  const club = db.prepare("SELECT id, name FROM clubs WHERE id=?").get(clubId) as { id: EntityId; name: string } | undefined;
  if (!club) throw new Error("The controlled club is missing.");
  const personId = careerPersonId(db, save);
  const summary = getClubFinancialSummary(db, clubId);
  const stake = summary.ownership.find((item) => item.holderId === personId && item.status === "ACTIVE");
  const team = db.prepare("SELECT id FROM teams WHERE club_id=? ORDER BY id LIMIT 1").get(clubId) as { id?: EntityId } | undefined;
  const manager = team?.id ? new ManagerRepository(db).activeContractForTeam(team.id) : undefined;
  return {
    role: "CHAIRMAN_OWNER",
    club: {
      id: club.id,
      name: club.name,
      ownershipPercentage: stake?.percentage ?? 0,
      controllingOwner: (stake?.percentage ?? 0) >= 51,
      ownership: summary.ownership,
    },
    finances: {
      account: summary.account,
      budgets: summary.budgets,
      ledgerEntries: summary.ledgerEntries.slice(-12).reverse(),
      debts: new ClubEconomyRepository(db).debts(clubId),
      loans: new ClubEconomyRepository(db).loanApplications(clubId),
      lenders: new ClubEconomyRepository(db).lenders(),
    },
    infrastructure: new ClubEconomyRepository(db).infrastructureProjects(clubId),
    equipment: new ClubEconomyRepository(db).assets(clubId).filter((asset) => asset.assetType === "EQUIPMENT"),
    sponsorships: new ClubEconomyRepository(db).sponsorships(clubId),
    manager: manager ? { name: personName(db, manager.personId), contract: manager } : undefined,
  };
};

export const buildFederationPresidentDashboard = (db: GameDatabase, save: SaveMetadata): FederationPresidentDashboard => {
  const federationId = heldTarget(db, save, "FEDERATION_PRESIDENT");
  const overview = getFederationOverview(db, federationId);
  const finances = getFederationFinances(db, federationId);
  const governance = new FederationGovernanceRepository(db);
  const phaseB = new FederationGovernancePhaseBRepository(db);
  const tenure = governance.leadershipTenures(federationId).find((item) => item.personId === careerPersonId(db, save) && ["ACTIVE", "INTERIM"].includes(item.status));
  const teams = db.prepare("SELECT id, name, level, gender FROM teams WHERE federation_id=? AND club_id IS NULL ORDER BY CASE WHEN level='senior' THEN 0 ELSE 1 END, gender, name").all(federationId) as Array<{ id: EntityId; name: string; level: string; gender: string }>;
  const nationalTeams: FederationNationalTeamSummary[] = teams.map((team) => {
    const coach = db.prepare("SELECT person_id FROM staff_appointments WHERE team_id=? AND role='NATIONAL_TEAM_HEAD_COACH' AND employment_status='ACTIVE' ORDER BY start_date DESC LIMIT 1").get(team.id) as { person_id?: EntityId } | undefined;
    return { id: team.id, name: team.name, level: team.level, gender: team.gender, headCoach: coach?.person_id ? personName(db, coach.person_id) : undefined };
  });
  return {
    role: "FEDERATION_PRESIDENT",
    federation: overview.federation,
    profile: overview.profile,
    finances: { account: finances.account, budgets: finances.budgets, ledgerEntries: finances.ledgerEntries.slice(-12).reverse(), statements: finances.statements.slice(-4).reverse() },
    tenure,
    proposals: phaseB.proposals(federationId),
    projects: overview.projects,
    nationalTeams,
  };
};
