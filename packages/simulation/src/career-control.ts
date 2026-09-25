import {
  CareerControlRepository,
  ExecutiveRoleRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  isBaseCareerRole,
  isPlayableCareerRole,
  type BaseCareerRole,
  type CareerRole,
  type EntityId,
  type PlayableCareerRole,
} from "@nepal-football-sim/shared-types";

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

const preferredBaseRole = (
  held: HeldCareerRole[],
  stored?: BaseCareerRole,
): BaseCareerRole | undefined => {
  if (stored && held.some((entry) => entry.role === stored)) return stored;
  const manager = held.find((entry) => entry.role === "MANAGER");
  if (manager) return "MANAGER";
  const owner = held.find((entry) => entry.role === "CHAIRMAN_OWNER");
  return owner ? "CHAIRMAN_OWNER" : undefined;
};

/** Canonical role ownership lookup. It never creates or mutates appointments. */
export const heldCareerRoles = (db: GameDatabase, personId: EntityId): HeldCareerRole[] => {
  const roles: HeldCareerRole[] = [];
  const manager = db.prepare(`SELECT mc.team_id FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id JOIN clubs c ON c.id=t.club_id JOIN countries co ON co.id=c.country_id WHERE mc.person_id=? AND mc.status='ACTIVE' AND co.id = (SELECT country_id FROM home_football_country LIMIT 1) ORDER BY mc.contract_start DESC,mc.id LIMIT 1`).get(personId) as { team_id?: EntityId } | undefined;
  if (manager?.team_id) roles.push({ role: "MANAGER", targetId: manager.team_id });
  const owner = db.prepare(`SELECT s.club_id FROM club_ownership_stakes s JOIN clubs c ON c.id=s.club_id JOIN countries co ON co.id=c.country_id WHERE s.holder_id=? AND s.holder_type='PERSON' AND s.status='ACTIVE' AND s.percentage>=51 AND co.id = (SELECT country_id FROM home_football_country LIMIT 1) ORDER BY s.percentage DESC,s.club_id LIMIT 1`).get(personId) as { club_id?: EntityId } | undefined;
  if (owner?.club_id) roles.push({ role: "CHAIRMAN_OWNER", targetId: owner.club_id });
  const president = db.prepare(`SELECT lt.federation_id FROM federation_leadership_tenures lt JOIN federations f ON f.id=lt.federation_id JOIN countries co ON co.id=f.country_id WHERE lt.person_id=? AND lt.role='FEDERATION_PRESIDENT' AND lt.status IN ('ACTIVE','INTERIM') AND co.id = (SELECT country_id FROM home_football_country LIMIT 1) ORDER BY CASE lt.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,lt.term_start DESC,lt.id LIMIT 1`).get(personId) as { federation_id?: EntityId } | undefined;
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

/** The human-playable subset of `heldCareerRoles` — never includes an NPC
 * executive job (Sporting Director, Director of Football, CEO, General
 * Secretary, ...) even when this same person happens to also hold one.
 * This is what the player's own role picker must be built from; executive
 * jobs stay reachable only through their own dedicated authority APIs. */
export const playableCareerRoles = (db: GameDatabase, personId: EntityId): PlayableCareerRole[] =>
  heldCareerRoles(db, personId)
    .map((entry) => entry.role)
    .filter(isPlayableCareerRole);

/**
 * Resolves and persists the human player's active career role. Always a
 * `PlayableCareerRole` — never an NPC executive job, even if the stored
 * control-state row is stale (an older save written before executive roles
 * were removed from the player-facing model, or any other malformed state).
 */
export const activeCareerRole = (db: GameDatabase, personId: EntityId): PlayableCareerRole => {
  const held = heldCareerRoles(db, personId);
  const playable = held.filter((entry) => isPlayableCareerRole(entry.role));
  const repo = new CareerControlRepository(db);
  const context = repo.get(personId);
  const current = context?.activeRole;

  // If a temporary presidency has ended, return to the base career that was
  // active when the player entered office. This is deliberately different
  // from merely picking the first held role: an Owner who becomes President
  // must come back as Owner, not silently become Manager because both roles
  // happen to be held. A stored `current` that isn't itself playable (a
  // stale executive value from an older save) is never trusted directly —
  // it always falls through to reconciliation below.
  let resolved =
    current && isPlayableCareerRole(current) && playable.some((entry) => entry.role === current)
      ? current
      : undefined;
  if (!resolved && current === "FEDERATION_PRESIDENT") {
    resolved = preferredBaseRole(playable, context?.baseRole);
  }
  // Final fallback is deliberately restricted to the playable subset (never
  // `held[0]?.role`, which could be an NPC executive job sorted first only
  // because no playable role exists at all) — "MANAGER" here is a safe,
  // architecture-supported default, not a claim the person actually holds
  // a manager contract.
  const firstPlayable = playable[0]?.role;
  resolved ??=
    preferredBaseRole(playable, context?.baseRole) ??
    (firstPlayable && isPlayableCareerRole(firstPlayable) ? firstPlayable : undefined) ??
    "MANAGER";

  const baseRole = isBaseCareerRole(resolved)
    ? resolved
    : preferredBaseRole(playable, context?.baseRole);
  if (current !== resolved || context?.baseRole !== baseRole) {
    repo.upsert({ personId, activeRole: resolved, baseRole });
  }
  return resolved;
};

export const switchActiveCareerRole = (db: GameDatabase, personId: EntityId, targetRole: CareerRole): PlayableCareerRole => {
  if (!isPlayableCareerRole(targetRole)) {
    // Deliberately thrown even when this exact person genuinely holds that
    // job (e.g. a delegated CEO appointment): NPC executive roles are never
    // player-switchable, regardless of who holds the underlying position.
    // DesktopApplicationService maps any thrown error here to
    // ROLE_NOT_AUTHORIZED — never a crash.
    throw new Error(`${targetRole} is an NPC executive role and cannot be selected as a player career.`);
  }
  const held = heldCareerRoles(db, personId);
  if (!held.some((entry) => entry.role === targetRole)) throw new Error(`Career role ${targetRole} is not currently held by this person.`);

  const repo = new CareerControlRepository(db);
  const current = activeCareerRole(db, personId);
  const context = repo.get(personId);
  const baseRole = targetRole === "FEDERATION_PRESIDENT"
    ? (isBaseCareerRole(current) ? current : preferredBaseRole(held, context?.baseRole))
    : isBaseCareerRole(targetRole)
      ? targetRole
      : context?.baseRole;

  if (current !== targetRole || context?.baseRole !== baseRole) {
    repo.upsert({ personId, activeRole: targetRole, baseRole });
  }
  return targetRole;
};
