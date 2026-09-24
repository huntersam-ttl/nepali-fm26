import { FederationGovernanceRepository, StaffMarketRepository, type GameDatabase } from "@nepal-football-sim/database";
import type {
  EntityId,
  NationalTeamCoachCandidate,
  NationalTeamCoachCandidatesView,
  NationalTeamPlayerPool,
  NationalTeamPlayerPoolQuery,
  NationalTeamPoolEligibility,
  NationalTeamPoolPlayer,
} from "@nepal-football-sim/shared-types";
import { buildEntityReference } from "./entity-reference.js";
import { eligibleForNationalTeamAge } from "./federation-governance.js";
import { nationalTeamIdentity } from "./national-team-workspace.js";
import { highestLicence, staffEligibility } from "./staff-market.js";

const ROLE = "FEDERATION_PRESIDENT" as const;
const POOL_LIMIT = 150;
const CANDIDATE_LIMIT = 25;

const POSITION_ORDER = ["GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"];
const positionRank = (position?: string): number => {
  const index = position ? POSITION_ORDER.indexOf(position) : -1;
  return index === -1 ? POSITION_ORDER.length : index;
};

const ageAt = (dateOfBirth: string | null | undefined, asOf: string): number | undefined => {
  if (!dateOfBirth) return undefined;
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  const date = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(birth.valueOf()) || Number.isNaN(date.valueOf())) return undefined;
  let age = date.getUTCFullYear() - birth.getUTCFullYear();
  if (
    date.getUTCMonth() < birth.getUTCMonth() ||
    (date.getUTCMonth() === birth.getUTCMonth() && date.getUTCDate() < birth.getUTCDate())
  )
    age -= 1;
  return age;
};

const ELIGIBILITY_NOTES: Record<NationalTeamPoolEligibility, string> = {
  ELIGIBLE: "Eligible for this team",
  DOCUMENTATION_REQUIRED: "Second nationality: documentation still required",
  CAP_TIED: "Tied to another nation by caps",
  INELIGIBLE: "Ruled ineligible for this nation",
  OVER_AGE: "Outside this team's age limit",
  SENIOR_SQUAD: "Already called up to the senior men's team",
  RETIRED_INTERNATIONAL: "Retired from international football with this team",
};

/**
 * Everyone who holds this nation's nationality in the team's category, with the
 * eligibility state the selection itself applies. Read-only: it never records
 * anything, and it exposes no ability, ranking or selection score.
 */
export type PoolRow = {
  id: EntityId;
  name: string;
  position?: string;
  age?: number;
  eligibility: NationalTeamPoolEligibility;
  availability: NationalTeamPoolPlayer["availability"];
  selectable: boolean;
};

const loadPool = (db: GameDatabase, teamId: EntityId, asOf: string) => {
  const team = nationalTeamIdentity(db, teamId);
  const country = db.prepare("SELECT country_id FROM federations WHERE id=?").get(team.federation.id) as
    | { country_id: EntityId }
    | undefined;
  if (!country) throw new Error("Federation not found");
  const governance = new FederationGovernanceRepository(db);

  const prior = new Map(governance.internationalEligibilities(team.federation.id).map((item) => [item.playerId, item.status]));
  const retired = new Set(
    (
      db
        .prepare("SELECT player_id FROM international_retirements WHERE national_team_id=? AND status='RETIRED_INTERNATIONAL'")
        .all(teamId) as Array<{ player_id: EntityId }>
    ).map((row) => row.player_id),
  );
  const seniorCallups =
    team.level === "senior"
      ? new Set<EntityId>()
      : new Set(
          (
            db
              .prepare(
                `SELECT c.player_id FROM national_team_callups c JOIN teams t ON t.id=c.national_team_id
                 WHERE t.federation_id=? AND t.level='senior' AND t.gender='men' AND c.status='CALLED_UP' AND c.callup_date<=?`,
              )
              .all(team.federation.id, asOf) as Array<{ player_id: EntityId }>
          ).map((row) => row.player_id),
        );
  const injured = new Set(
    (
      db
        .prepare("SELECT DISTINCT person_id FROM injuries WHERE date_occurred<=? AND expected_recovery_date>=?")
        .all(asOf, asOf) as Array<{ person_id: EntityId }>
    ).map((row) => row.person_id),
  );
  const suspended = new Set(
    (db.prepare("SELECT DISTINCT person_id FROM suspensions WHERE matches_remaining>0").all() as Array<{ person_id: EntityId }>).map(
      (row) => row.person_id,
    ),
  );
  const stateAvailability = new Map<EntityId, string>();
  for (const row of db
    .prepare("SELECT person_id, availability FROM player_availability_states ORDER BY updated_on ASC")
    .all() as Array<{ person_id: EntityId; availability: string }>)
    stateAvailability.set(row.person_id, row.availability);

  const latestCallup = new Map<EntityId, { status: string; date: string }>();
  for (const callup of governance
    .nationalTeamCallups(teamId)
    .filter((item) => item.callupDate <= asOf)
    .sort((a, b) => `${a.callupDate}:${a.id}`.localeCompare(`${b.callupDate}:${b.id}`)))
    latestCallup.set(callup.playerId, { status: callup.status, date: callup.callupDate });

  const caps = new Map<EntityId, { caps: number; goals: number }>();
  for (const appearance of governance.nationalTeamAppearances(teamId).filter((item) => item.matchDate <= asOf)) {
    const current = caps.get(appearance.playerId) ?? { caps: 0, goals: 0 };
    caps.set(appearance.playerId, { caps: current.caps + 1, goals: current.goals + (appearance.goals ?? 0) });
  }
  const clubByPlayer = new Map<EntityId, EntityId>();
  for (const contract of db
    .prepare(
      "SELECT player_id, club_id FROM player_contracts WHERE start_date<=? AND end_date>=? AND status IN ('ACTIVE','SIGNED') ORDER BY end_date DESC, id DESC",
    )
    .all(asOf, asOf) as Array<{ player_id: EntityId; club_id?: EntityId }>)
    if (!clubByPlayer.has(contract.player_id) && contract.club_id) clubByPlayer.set(contract.player_id, contract.club_id);

  const rows = db
    .prepare(
      `SELECT p.id AS person_id, p.display_name, p.full_name, p.date_of_birth, p.nationality_country_id, pa.primary_position
       FROM persons p
       JOIN player_attributes pa ON pa.person_id = p.id
       JOIN person_roles pr ON pr.person_id = p.id AND pr.role = 'PLAYER' AND pr.active_to IS NULL
       WHERE (p.nationality_country_id = ? OR p.second_nationality_country_id = ?)
         AND (? = 'women' AND p.gender_presentation = 'female'
           OR ? != 'women' AND COALESCE(p.gender_presentation, 'male') != 'female')
       ORDER BY p.id`,
    )
    .all(country.country_id, country.country_id, team.gender, team.gender) as Array<{
    person_id: EntityId;
    display_name?: string | null;
    full_name: string;
    date_of_birth?: string | null;
    nationality_country_id?: EntityId | null;
    primary_position?: string | null;
  }>;

  const pool: PoolRow[] = rows.map((row) => {
    const derived = row.nationality_country_id === country.country_id ? "ELIGIBLE" : "DOCUMENTATION_REQUIRED";
    const status = prior.get(row.person_id);
    const standing: NationalTeamPoolEligibility =
      status && ["CAP_TIED", "INELIGIBLE", "DOCUMENTATION_REQUIRED"].includes(status)
        ? (status as NationalTeamPoolEligibility)
        : derived;
    const eligibility: NationalTeamPoolEligibility = retired.has(row.person_id)
      ? "RETIRED_INTERNATIONAL"
      : seniorCallups.has(row.person_id)
        ? "SENIOR_SQUAD"
        : standing !== "ELIGIBLE"
          ? standing
          : !eligibleForNationalTeamAge(row.date_of_birth, team.level as never, asOf)
            ? "OVER_AGE"
            : "ELIGIBLE";
    const state = stateAvailability.get(row.person_id);
    const availability: NationalTeamPoolPlayer["availability"] = injured.has(row.person_id)
      ? "INJURED"
      : state && state !== "AVAILABLE"
        ? "UNAVAILABLE"
        : suspended.has(row.person_id)
          ? "SUSPENDED"
          : "AVAILABLE";
    return {
      id: row.person_id,
      name: row.display_name ?? row.full_name,
      position: row.primary_position ?? undefined,
      age: ageAt(row.date_of_birth, asOf),
      eligibility,
      availability,
      selectable: eligibility === "ELIGIBLE" && availability !== "INJURED" && availability !== "UNAVAILABLE",
    };
  });
  return { team, pool, latestCallup, caps, clubByPlayer };
};

/** Where each player stands for this team today: the same eligibility the pool and the selection apply. */
export const nationalTeamPoolStanding = (
  db: GameDatabase,
  teamId: EntityId,
  asOf: string,
): Map<EntityId, PoolRow> => new Map(loadPool(db, teamId, asOf).pool.map((row) => [row.id, row]));

export const buildNationalTeamPlayerPool = (
  db: GameDatabase,
  teamId: EntityId,
  asOf: string,
  query: NationalTeamPlayerPoolQuery = {},
): NationalTeamPlayerPool => {
  const { team, pool, latestCallup, caps, clubByPlayer } = loadPool(db, teamId, asOf);
  const isCalledUp = (id: EntityId): boolean => latestCallup.get(id)?.status === "CALLED_UP";
  const matching = pool
    .filter((row) => (query.position ? row.position === query.position : true))
    .filter((row) => (query.onlyEligible ? row.eligibility === "ELIGIBLE" : true))
    .sort(
      (a, b) =>
        Number(isCalledUp(b.id)) - Number(isCalledUp(a.id)) ||
        positionRank(a.position) - positionRank(b.position) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );

  const players: NationalTeamPoolPlayer[] = matching.slice(0, POOL_LIMIT).map((row) => {
    const callup = latestCallup.get(row.id);
    const clubId = clubByPlayer.get(row.id);
    const record = caps.get(row.id);
    return {
      player: buildEntityReference(db, "PLAYER", row.id, ROLE),
      position: row.position,
      club: clubId ? buildEntityReference(db, "CLUB", clubId, ROLE) : undefined,
      age: row.age,
      selection: callup && ["CALLED_UP", "WITHDRAWN", "DECLINED"].includes(callup.status)
        ? (callup.status as NationalTeamPoolPlayer["selection"])
        : "NOT_SELECTED",
      availability: row.availability,
      eligibility: row.eligibility,
      eligibilityNote: ELIGIBILITY_NOTES[row.eligibility],
      selectable: row.selectable,
      caps: record?.caps ?? 0,
      goals: record?.goals ?? 0,
    };
  });

  return {
    team,
    players,
    matchingCount: matching.length,
    selectableCount: pool.filter((row) => row.selectable).length,
    poolCount: pool.length,
    positions: [...new Set(pool.map((row) => row.position).filter((value): value is string => Boolean(value)))].sort(
      (a, b) => positionRank(a) - positionRank(b) || a.localeCompare(b),
    ),
    limit: POOL_LIMIT,
    asOf,
    provenanceStatus: "SIMULATION_ONLY",
  };
};

/**
 * Unemployed, eligible coaches the President could appoint to a vacant
 * head-coach seat. The same eligibility rule the appointment command enforces;
 * no ranking or fit score is computed or shown.
 */
export const buildNationalTeamCoachCandidates = (
  db: GameDatabase,
  teamId: EntityId,
  asOf: string,
): NationalTeamCoachCandidatesView => {
  const team = nationalTeamIdentity(db, teamId);
  const vacant = !db
    .prepare("SELECT 1 FROM staff_appointments WHERE team_id=? AND role='NATIONAL_TEAM_HEAD_COACH' AND employment_status='ACTIVE' LIMIT 1")
    .get(teamId);
  if (!vacant) return { team, vacant: false, candidates: [], asOf, provenanceStatus: "SIMULATION_ONLY" };

  const market = new StaffMarketRepository(db);
  const rows = db
    .prepare(
      `SELECT sp.person_id, sp.preferred_role, sp.availability, c.name AS nationality
       FROM staff_profiles sp
       JOIN persons p ON p.id = sp.person_id
       LEFT JOIN countries c ON c.id = p.nationality_country_id
       WHERE sp.availability = 'AVAILABLE'
         AND EXISTS (SELECT 1 FROM staff_licences l WHERE l.person_id = sp.person_id)
         AND NOT EXISTS (SELECT 1 FROM staff_appointments a WHERE a.person_id = sp.person_id AND a.employment_status = 'ACTIVE')
       ORDER BY sp.person_id`,
    )
    .all() as Array<{ person_id: EntityId; preferred_role?: string | null; availability: string; nationality?: string | null }>;

  const candidates = rows
    .flatMap((row) => {
      const profile = market.staffProfile(row.person_id);
      const licences = market.staffLicencesForPerson(row.person_id);
      const eligibility = staffEligibility("NATIONAL_TEAM_HEAD_COACH", profile, licences);
      if (!eligibility.eligible) return [];
      const best = highestLicence(licences);
      return [
        {
          rank: best?.rank ?? 0,
          candidate: {
            person: buildEntityReference(db, "STAFF", row.person_id, ROLE),
            preferredRole: row.preferred_role ?? undefined,
            nationality: row.nationality ?? undefined,
            licence: best?.type.replace(/_/g, " "),
            availability: row.availability,
            note: eligibility.note,
          } satisfies NationalTeamCoachCandidate,
        },
      ];
    })
    .sort((a, b) => b.rank - a.rank || a.candidate.person.label.localeCompare(b.candidate.person.label))
    .slice(0, CANDIDATE_LIMIT)
    .map((item) => item.candidate);

  return { team, vacant: true, candidates, asOf, provenanceStatus: "SIMULATION_ONLY" };
};
