import type { GameDatabase } from "@nepal-football-sim/database";
import { FederationGovernanceRepository, NationalTeamManagementRepository } from "@nepal-football-sim/database";
import type { CareerRole, EntityId, NationalTeamSelectionHistoryEntry, NationalTeamSquadReadModel, NationalTeamSquadPlayer } from "@nepal-football-sim/shared-types";
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
  const federation = new FederationGovernanceRepository(db);
  const management = new NationalTeamManagementRepository(db);
  const derivedProgramme =
    programme ??
    (team.gender === "women"
      ? "WOMENS_GIRLS"
      : ["u17", "u20", "u23"].includes(team.level)
        ? "YOUTH"
        : "SENIOR_MENS");
  const allCallups = federation.nationalTeamCallups(nationalTeamId).filter((callup) => callup.callupDate <= asOf && (!programme || callup.programme === programme)).sort((left, right) => `${right.callupDate}:${right.id}`.localeCompare(`${left.callupDate}:${left.id}`));
  const currentCallups = allCallups.filter((callup) => callup.status !== "DECLINED");
  const latest = new Map<EntityId, typeof currentCallups[number]>();
  for (const callup of currentCallups) if (!latest.has(callup.playerId)) latest.set(callup.playerId, callup);
  const appearances = federation.nationalTeamAppearances(nationalTeamId).filter((appearance) => appearance.matchDate <= asOf);
  const appearancesByPlayer = new Map<EntityId, typeof appearances>();
  for (const appearance of appearances) appearancesByPlayer.set(appearance.playerId, [...(appearancesByPlayer.get(appearance.playerId) ?? []), appearance]);
  const activeContracts = db.prepare("SELECT player_id,club_id FROM player_contracts WHERE start_date<=? AND end_date>=? AND status IN ('ACTIVE','SIGNED') ORDER BY end_date DESC,id DESC").all(asOf, asOf) as Array<{ player_id: EntityId; club_id?: EntityId }>;
  const clubByPlayer = new Map<EntityId, EntityId>();
  for (const contract of activeContracts) if (!clubByPlayer.has(contract.player_id) && contract.club_id) clubByPlayer.set(contract.player_id, contract.club_id);
  const players: NationalTeamSquadPlayer[] = [...latest.values()].sort((left, right) => left.playerId.localeCompare(right.playerId)).map((callup) => {
    const person = db.prepare("SELECT display_name,full_name,date_of_birth FROM persons WHERE id=?").get(callup.playerId) as { display_name?: string; full_name: string; date_of_birth?: string } | undefined;
    const attrs = db.prepare("SELECT primary_position FROM player_attributes WHERE person_id=?").get(callup.playerId) as { primary_position?: string } | undefined;
    const injured = Boolean(db.prepare("SELECT 1 FROM injuries WHERE person_id=? AND date_occurred<=? AND expected_recovery_date>=? LIMIT 1").get(callup.playerId, asOf, asOf));
    const suspended = Boolean(db.prepare("SELECT 1 FROM suspensions WHERE person_id=? AND matches_remaining>0 LIMIT 1").get(callup.playerId));
    const playerAppearances = appearancesByPlayer.get(callup.playerId) ?? [];
    const clubId = clubByPlayer.get(callup.playerId);
    return { player: buildEntityReference(db, "PLAYER", callup.playerId, role), personId: callup.playerId, displayName: person?.display_name ?? person?.full_name ?? "Unknown player", position: attrs?.primary_position, currentClub: clubId ? buildEntityReference(db, "CLUB", clubId, role) : undefined, age: ageAt(person?.date_of_birth, asOf), availability: injured ? "INJURED" : suspended ? "SUSPENDED" : person ? "AVAILABLE" : "UNAVAILABLE", selectionStatus: callup.status, squadType: callup.squadType, callupDate: callup.callupDate, internationalAppearances: playerAppearances.length };
  });
  const selectionHistory: NationalTeamSelectionHistoryEntry[] = allCallups.slice(0, 50).map((callup) => {
    const appearance = [...(appearancesByPlayer.get(callup.playerId) ?? []).filter((item) => item.matchDate >= callup.callupDate)].sort((left, right) => `${right.matchDate}:${right.id}`.localeCompare(`${left.matchDate}:${left.id}`))[0];
    return { id: callup.id, player: buildEntityReference(db, "PLAYER", callup.playerId, role), callupDate: callup.callupDate, programme: callup.programme, squadType: callup.squadType, selectionStatus: callup.status, appearance: appearance ? { date: appearance.matchDate, opponent: appearance.opponentName, minutes: appearance.minutes, goals: appearance.goals } : undefined };
  });
  const camps = management.campLifecycles(nationalTeamId).filter((camp) => camp.callupDate <= asOf && camp.status !== "RELEASED").sort((left, right) => `${right.callupDate}:${right.id}`.localeCompare(`${left.callupDate}:${left.id}`));
  const decisions = management.decisions(nationalTeamId).filter((decision) => decision.decisionDate <= asOf).sort((left, right) => `${right.decisionDate}:${right.id}`.localeCompare(`${left.decisionDate}:${left.id}`));
  const currentCamp = camps[0];
  const currentDecision = decisions[0];
  const headCoach = db.prepare("SELECT person_id FROM staff_appointments WHERE team_id=? AND role='NATIONAL_TEAM_HEAD_COACH' AND employment_status='ACTIVE' ORDER BY start_date DESC,id DESC LIMIT 1").get(nationalTeamId) as { person_id?: EntityId } | undefined;
  const clubDistribution = new Map<EntityId | undefined, number>();
  for (const player of players) clubDistribution.set(player.currentClub?.id, (clubDistribution.get(player.currentClub?.id) ?? 0) + 1);
  return { nationalTeam: { id: team.id, label: team.name, entityReference: buildEntityReference(db, "NATIONAL_TEAM", team.id, role) }, programme: derivedProgramme, currentWindow: currentCamp ? { callupDate: currentCamp.callupDate, competitionEditionId: currentCamp.competitionEditionId, campId: currentCamp.id } : currentDecision ? { callupDate: currentDecision.decisionDate, competitionEditionId: currentDecision.competitionEditionId } : undefined, squadSize: players.length, selectedCount: players.filter((player) => player.selectionStatus === "CALLED_UP").length, unavailableCount: players.filter((player) => player.availability !== "AVAILABLE").length, clubDistribution: [...clubDistribution.entries()].sort(([left], [right]) => (left ?? "").localeCompare(right ?? "")).map(([clubId, count]) => ({ club: clubId ? buildEntityReference(db, "CLUB", clubId, role) : undefined, count })), headCoach: headCoach?.person_id ? buildEntityReference(db, "STAFF", headCoach.person_id, role) : undefined, players, selectionHistory, asOf, supported: true };
};
