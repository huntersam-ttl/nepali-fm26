import {
  CareerControlRepository,
  ExecutiveRoleRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import type { CareerRole, EntityId } from "@nepal-football-sim/shared-types";

export type HeldCareerRole = { role: CareerRole; targetId?: EntityId };
const roleOrder: CareerRole[] = [
  "MANAGER",
  "CHAIRMAN_OWNER",
  "FEDERATION_PRESIDENT",
  "SPORTING_DIRECTOR",
  "DIRECTOR_OF_FOOTBALL",
  "CEO",
  "GENERAL_SECRETARY",
];

/** Canonical role ownership lookup. It never creates or mutates appointments. */
export const heldCareerRoles = (db: GameDatabase, personId: EntityId): HeldCareerRole[] => {
  const roles: HeldCareerRole[] = [];
  const manager = db.prepare(`SELECT mc.team_id FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id JOIN clubs c ON c.id=t.club_id JOIN countries co ON co.id=c.country_id WHERE mc.person_id=? AND mc.status='ACTIVE' AND co.iso_code IN ('NP','NPL') ORDER BY mc.contract_start DESC,mc.id LIMIT 1`).get(personId) as { team_id?: EntityId } | undefined;
  if (manager?.team_id) roles.push({ role: "MANAGER", targetId: manager.team_id });
  const owner = db.prepare(`SELECT s.club_id FROM club_ownership_stakes s JOIN clubs c ON c.id=s.club_id JOIN countries co ON co.id=c.country_id WHERE s.holder_id=? AND s.holder_type='PERSON' AND s.status='ACTIVE' AND s.percentage>=51 AND co.iso_code IN ('NP','NPL') ORDER BY s.percentage DESC,s.club_id LIMIT 1`).get(personId) as { club_id?: EntityId } | undefined;
  if (owner?.club_id) roles.push({ role: "CHAIRMAN_OWNER", targetId: owner.club_id });
  const president = db.prepare(`SELECT lt.federation_id FROM federation_leadership_tenures lt JOIN federations f ON f.id=lt.federation_id JOIN countries co ON co.id=f.country_id WHERE lt.person_id=? AND lt.role='FEDERATION_PRESIDENT' AND lt.status IN ('ACTIVE','INTERIM') AND co.iso_code IN ('NP','NPL') ORDER BY CASE lt.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,lt.term_start DESC,lt.id LIMIT 1`).get(personId) as { federation_id?: EntityId } | undefined;
  if (president?.federation_id) roles.push({ role: "FEDERATION_PRESIDENT", targetId: president.federation_id });
  // A FILLED row is only genuinely held while its underlying appointment is
  // still active: dismissal, retirement and contract expiry all end the
  // appointment without themselves reconciling the executive assignment, so
  // this join is the single point that stops a stale FILLED row from still
  // granting the role once the person is no longer actually employed there.
  const executiveRoles = (
    db
      .prepare(
        `SELECT cer.club_id, cer.role, cer.person_id
         FROM club_executive_roles cer
         JOIN staff_appointments sa ON sa.id = cer.appointment_id
         WHERE cer.person_id=? AND cer.status='FILLED'
           AND sa.person_id=? AND sa.employment_status='ACTIVE'
         ORDER BY cer.club_id, cer.role`,
      )
      .all(personId, personId) as Array<{ club_id?: EntityId; role?: CareerRole }>
  ).filter((assignment) => assignment.club_id && assignment.role);
  for (const assignment of executiveRoles)
    roles.push({ role: assignment.role!, targetId: assignment.club_id! });
  return roles.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));
};

export const activeCareerRole = (db: GameDatabase, personId: EntityId): CareerRole => {
  const held = heldCareerRoles(db, personId);
  const repo = new CareerControlRepository(db);
  const current = repo.get(personId)?.activeRole;
  const resolved = current && held.some((entry) => entry.role === current) ? current : held[0]?.role ?? "MANAGER";
  if (current !== resolved) repo.upsert({ personId, activeRole: resolved });
  return resolved;
};

export const switchActiveCareerRole = (db: GameDatabase, personId: EntityId, targetRole: CareerRole): CareerRole => {
  if (!heldCareerRoles(db, personId).some((entry) => entry.role === targetRole)) throw new Error(`Career role ${targetRole} is not currently held by this person.`);
  const repo = new CareerControlRepository(db);
  if (activeCareerRole(db, personId) !== targetRole) repo.upsert({ personId, activeRole: targetRole });
  return targetRole;
};
