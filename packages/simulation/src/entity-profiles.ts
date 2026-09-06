import type { GameDatabase } from "@nepal-football-sim/database";
import type {
  CareerRole,
  ClubProfile,
  CompetitionProfile,
  EntityId,
  InfrastructureProjectProfile,
  InfrastructureProjectStatus,
  InfrastructureProjectType,
  StaffProfileReadModel,
} from "@nepal-football-sim/shared-types";
import { CompetitionCommercialRepository, CompetitionRepository, ClubEconomyRepository, WorldRepository } from "@nepal-football-sim/database";
import { buildEntityReference } from "./entity-reference.js";
import { presentClubLocation, resolveClubStadium } from "./club-location.js";
import { recentInfrastructureHistory } from "./infrastructure-story.js";

export const buildClubProfile = (db: GameDatabase, clubId: EntityId, role: CareerRole): ClubProfile => {
  const club = db.prepare("SELECT id,name,location_id FROM clubs WHERE id=?").get(clubId) as { id: EntityId; name: string; location_id?: EntityId } | undefined;
  if (!club) throw new Error(`Unknown club ${clubId}`);
  const team = db.prepare("SELECT id,name,level FROM teams WHERE club_id=? AND level='senior' ORDER BY id LIMIT 1").get(clubId) as { id: EntityId; name: string; level: string } | undefined;
  const manager = db.prepare("SELECT p.id FROM persons p JOIN manager_contracts mc ON mc.person_id=p.id WHERE mc.club_id=? AND mc.status='ACTIVE' ORDER BY mc.contract_end DESC LIMIT 1").get(clubId) as { id: EntityId } | undefined;
  const owner = db.prepare("SELECT holder_id FROM club_ownership_stakes WHERE club_id=? AND holder_type='PERSON' AND status='ACTIVE' ORDER BY percentage DESC,holder_id LIMIT 1").get(clubId) as { holder_id: EntityId } | undefined;
  const fixtures = team ? (db.prepare("SELECT id FROM fixtures WHERE (home_team_id=? OR away_team_id=?) ORDER BY scheduled_date DESC,id DESC LIMIT 10").all(team.id, team.id) as Array<{ id: EntityId }>).map((row) => buildEntityReference(db, "FIXTURE", row.id, role)) : [];
  const sponsors = new ClubEconomyRepository(db).sponsorships(clubId).filter((item) => item.status === "ACTIVE").map((item) => buildEntityReference(db, "SPONSOR", item.sponsorId, role)).filter((ref) => ref.visible);
  const projectRows = db
    .prepare(
      "SELECT id, project_type, status, expected_completion FROM infrastructure_projects WHERE club_id=? AND status NOT IN ('COMPLETED','CANCELLED') ORDER BY expected_completion,id",
    )
    .all(clubId) as Array<{ id: EntityId; project_type: string; status: string; expected_completion?: string }>;
  const projects = projectRows.map((row) => buildEntityReference(db, "INFRASTRUCTURE_PROJECT", row.id, role));
  const campusProjects = projectRows.map((row) => ({
    id: row.id,
    reference: buildEntityReference(db, "INFRASTRUCTURE_PROJECT", row.id, role),
    projectType: row.project_type,
    status: row.status,
    expectedCompletion: row.expected_completion,
  }));
  const economy = new ClubEconomyRepository(db);
  const account = economy.financialAccount(clubId);
  const supporter = economy.supporterProfile(clubId);
  const facility = economy.facilityProfile(clubId);
  return {
    entityReference: buildEntityReference(db, "CLUB", clubId, role),
    locationLabel: presentClubLocation(db, clubId),
    division: team?.level,
    manager: manager ? buildEntityReference(db, "STAFF", manager.id, role) : undefined,
    owner: owner ? buildEntityReference(db, "INVESTOR", owner.holder_id, role) : undefined,
    recentFixtures: fixtures,
    activeSponsors: sponsors,
    infrastructureProjects: projects,
    campusProjects,
    stadium: resolveClubStadium(db, clubId),
    financialSummary: account
      ? { cashBalance: account.cashBalance, currency: account.currency, financialHealth: account.financialHealth }
      : undefined,
    reputation: supporter
      ? { footballReputation: supporter.footballReputation, commercialReputation: supporter.commercialReputation }
      : undefined,
    facilitySnapshot: facility
      ? {
          trainingFacilityQuality: facility.trainingFacilityQuality,
          youthFacilityQuality: facility.youthFacilityQuality,
          medicalFacilityQuality: facility.medicalFacilityQuality,
          analyticsFacilityQuality: facility.analyticsFacilityQuality,
          academyCapacity: facility.academyCapacity,
        }
      : undefined,
    infrastructureHistory: recentInfrastructureHistory(db, clubId, role),
  };
};

export const buildInfrastructureProjectProfile = (
  db: GameDatabase,
  projectId: EntityId,
  role: CareerRole,
  worldDate: string,
): InfrastructureProjectProfile => {
  const row = db
    .prepare(
      `SELECT id, club_id, project_type, status, currency, capital_cost, ongoing_cost, planning_start,
              construction_start, expected_completion, completed_at, cancelled_on, delay_days,
              funding_status, funding_committed, site_rights, maintenance_status, components_json
       FROM infrastructure_projects WHERE id=?`,
    )
    .get(projectId) as
    | {
        id: EntityId;
        club_id: EntityId;
        project_type: InfrastructureProjectType;
        status: InfrastructureProjectStatus;
        currency: string;
        capital_cost: number;
        ongoing_cost: number;
        planning_start: string;
        construction_start?: string;
        expected_completion: string;
        completed_at?: string;
        cancelled_on?: string;
        delay_days?: number;
        funding_status?: string;
        funding_committed?: number;
        site_rights?: string;
        maintenance_status?: string;
        components_json?: string;
      }
    | undefined;
  if (!row) throw new Error(`Unknown infrastructure project ${projectId}`);
  return {
    entityReference: buildEntityReference(db, "INFRASTRUCTURE_PROJECT", projectId, role),
    club: buildEntityReference(db, "CLUB", row.club_id, role),
    projectType: row.project_type,
    status: row.status,
    currency: row.currency,
    capitalCost: row.capital_cost,
    ongoingCost: row.ongoing_cost,
    planningStart: row.planning_start,
    constructionStart: row.construction_start ?? undefined,
    expectedCompletion: row.expected_completion,
    completedAt: row.completed_at ?? undefined,
    cancelledOn: row.cancelled_on ?? undefined,
    delayDays: row.delay_days ?? undefined,
    fundingStatus: row.funding_status ?? undefined,
    fundingCommitted: row.funding_committed ?? undefined,
    siteRights: row.site_rights ?? undefined,
    maintenanceStatus: row.maintenance_status ?? undefined,
    components: row.components_json ? JSON.parse(row.components_json) : undefined,
    worldDate,
  };
};

export const buildStaffProfile = (db: GameDatabase, personId: EntityId, role: CareerRole): StaffProfileReadModel => {
  const person = db.prepare("SELECT id FROM persons WHERE id=?").get(personId) as { id: EntityId } | undefined;
  if (!person) throw new Error(`Unknown staff ${personId}`);
  const appointment = db.prepare("SELECT role,club_id,end_date FROM staff_appointments WHERE person_id=? AND employment_status='ACTIVE' ORDER BY end_date DESC LIMIT 1").get(personId) as { role?: string; club_id?: EntityId; end_date?: string } | undefined;
  return {
    entityReference: buildEntityReference(db, "STAFF", personId, role),
    role: appointment?.role,
    club: appointment?.club_id ? buildEntityReference(db, "CLUB", appointment.club_id, role) : undefined,
    contractEnd: appointment?.end_date,
    careerHistory: [],
  };
};

export const buildCompetitionProfile = (db: GameDatabase, competitionId: EntityId, role: CareerRole): CompetitionProfile => {
  const competition = db.prepare("SELECT id,name FROM competitions WHERE id=?").get(competitionId) as { id: EntityId; name: string } | undefined;
  if (!competition) throw new Error(`Unknown competition ${competitionId}`);
  const season = db.prepare("SELECT id,name,start_date,end_date FROM competition_seasons WHERE competition_id=? ORDER BY end_date DESC,id DESC LIMIT 1").get(competitionId) as { id: EntityId; name: string; start_date: string; end_date: string } | undefined;
  const repository = new CompetitionRepository(db);
  const participants = season ? new WorldRepository(db).teamsForCompetitionSeason(season.id).map((team) => team.clubId ? buildEntityReference(db, "CLUB", team.clubId, role) : undefined).filter((ref): ref is NonNullable<typeof ref> => Boolean(ref)) : [];
  const clubIdForTeam = db.prepare("SELECT club_id FROM teams WHERE id=?");
  const standings = season
    ? repository.standings(season.id).flatMap((row) => {
        const team = clubIdForTeam.get(row.teamId) as { club_id?: EntityId } | undefined;
        if (!team?.club_id) return [];
        return [
          {
            team: buildEntityReference(db, "CLUB", team.club_id, role),
            played: row.played,
            points: row.points,
            goalDifference: row.goalDifference,
          },
        ];
      })
    : [];
  const sponsorship = season ? new CompetitionCommercialRepository(db).bySeason(season.id) : undefined;
  return {
    entityReference: buildEntityReference(db, "COMPETITION", competitionId, role),
    canonicalName: competition.name,
    commercialDisplayTitle: sponsorship?.displayTitle,
    currentSeason: season ? { id: season.id, name: season.name, startDate: season.start_date, endDate: season.end_date } : undefined,
    standings,
    fixtures: season ? repository.fixtures(season.id).slice(-50).map((fixture) => buildEntityReference(db, "FIXTURE", fixture.id, role)) : [],
    titleSponsor: sponsorship ? buildEntityReference(db, "SPONSOR", sponsorship.sponsorId, role) : undefined,
    participants,
  };
};
