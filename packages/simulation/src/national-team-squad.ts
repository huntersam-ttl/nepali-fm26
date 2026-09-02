import type { GameDatabase } from "@nepal-football-sim/database";
import type { CareerRole, EntityId, NationalTeamSquadReadModel, NationalTeamSquadPlayer } from "@nepal-football-sim/shared-types";
import { FederationGovernanceRepository } from "@nepal-football-sim/database";
import { buildEntityReference } from "./entity-reference.js";

const ageAt = (dateOfBirth: string | undefined, asOf: string): number | undefined => {
  if (!dateOfBirth) return undefined;
  const birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  const date = new Date(`${asOf}T00:00:00.000Z`);
  if (Number.isNaN(birth.valueOf()) || Number.isNaN(date.valueOf())) return undefined;
  let age = date.getUTCFullYear() - birth.getUTCFullYear();
  if (date.getUTCMonth() < birth.getUTCMonth() || (date.getUTCMonth() === birth.getUTCMonth() && date.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
};

export const buildNationalTeamSquad = (db: GameDatabase, nationalTeamId: EntityId, asOf: string, role: CareerRole, programme?: string): NationalTeamSquadReadModel => {
  const team = db.prepare("SELECT id,name,gender,level FROM teams WHERE id=? AND federation_id IS NOT NULL").get(nationalTeamId) as { id: EntityId; name: string; gender: string; level: string } | undefined;
  if (!team) throw new Error("National team not found");
  const callups = new FederationGovernanceRepository(db).nationalTeamCallups(nationalTeamId)
    .filter((callup) => callup.callupDate <= asOf && callup.status !== "DECLINED" && (!programme || callup.programme === programme))
    .sort((left, right) => `${right.callupDate}:${right.id}`.localeCompare(`${left.callupDate}:${left.id}`));
  const latest = new Map<EntityId, typeof callups[number]>();
  for (const callup of callups) if (!latest.has(callup.playerId)) latest.set(callup.playerId, callup);
  const players: NationalTeamSquadPlayer[] = [...latest.values()].sort((left, right) => left.playerId.localeCompare(right.playerId)).map((callup) => {
    const person = db.prepare("SELECT display_name,full_name,date_of_birth FROM persons WHERE id=?").get(callup.playerId) as { display_name?: string; full_name: string; date_of_birth?: string } | undefined;
    const attrs = db.prepare("SELECT primary_position FROM player_attributes WHERE person_id=?").get(callup.playerId) as { primary_position?: string } | undefined;
    const contract = db.prepare("SELECT club_id FROM player_contracts WHERE player_id=? AND start_date<=? AND end_date>=? AND status IN ('ACTIVE','SIGNED') ORDER BY end_date DESC LIMIT 1").get(callup.playerId, asOf, asOf) as { club_id?: EntityId } | undefined;
    const injured = Boolean(db.prepare("SELECT 1 FROM injuries WHERE person_id=? AND date_occurred<=? AND expected_recovery_date>=? LIMIT 1").get(callup.playerId, asOf, asOf));
    const suspended = Boolean(db.prepare("SELECT 1 FROM suspensions WHERE person_id=? AND matches_remaining>0 LIMIT 1").get(callup.playerId));
    const appearances = db.prepare("SELECT COUNT(*) AS count FROM national_team_appearances WHERE national_team_id=? AND player_id=?").get(nationalTeamId, callup.playerId) as { count?: number };
    return {
      player: buildEntityReference(db, "PLAYER", callup.playerId, role),
      personId: callup.playerId,
      displayName: person?.display_name ?? person?.full_name ?? "Unknown player",
      position: attrs?.primary_position,
      currentClub: contract?.club_id ? buildEntityReference(db, "CLUB", contract.club_id, role) : undefined,
      age: ageAt(person?.date_of_birth, asOf),
      availability: injured ? "INJURED" : suspended ? "SUSPENDED" : person ? "AVAILABLE" : "UNAVAILABLE",
      selectionStatus: callup.status,
      squadType: callup.squadType,
      callupDate: callup.callupDate,
      internationalAppearances: appearances.count ?? 0,
    };
  });
  const derivedProgramme = programme ?? (team.gender === "female" ? "WOMENS_GIRLS" : team.level === "youth" ? "YOUTH" : "SENIOR_MENS");
  return { nationalTeam: { id: team.id, label: team.name }, programme: derivedProgramme, players, asOf, supported: true };
};
