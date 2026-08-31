import { createStableEntityId, type EntityId } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "@nepal-football-sim/database";
import { SeededRandom } from "./rng.js";

type PlayerRow = {
  player_id: EntityId;
  full_name: string;
  person_date_of_birth?: string | null;
  country_name?: string | null;
  club_id?: EntityId | null;
  primary_position?: string | null;
};

const RECONCILIATION_KEY = "playable-player-gameplay-profile-v1";
const isoDate = (date: string, age: number, rng: SeededRandom): string => {
  const year = Number(date.slice(0, 4)) - age;
  const month = 1 + rng.integer(0, 11);
  const day = 1 + rng.integer(0, 27);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const gameplayHeight = (position: string, rng: SeededRandom): number => {
  const base = position === "GK" ? 185 : position === "CB" ? 183 : position === "ST" ? 179 : 176;
  return base + rng.integer(-6, 6);
};

const gameplayFoot = (rng: SeededRandom): "RIGHT" | "LEFT" | "BOTH" => {
  const roll = rng.next();
  return roll < 0.72 ? "RIGHT" : roll < 0.97 ? "LEFT" : "BOTH";
};

const playableNepalPlayers = (db: GameDatabase): PlayerRow[] =>
  db
    .prepare(
      `
    SELECT DISTINCT p.id AS player_id, p.full_name, p.date_of_birth AS person_date_of_birth,
      country.name AS country_name, club.id AS club_id,
      attributes.primary_position
    FROM persons p
    JOIN person_roles role ON role.person_id = p.id AND role.role = 'PLAYER' AND role.active_to IS NULL
    LEFT JOIN player_attributes attributes ON attributes.person_id = p.id
    LEFT JOIN team_person_assignments assignment
      ON assignment.person_id = p.id AND assignment.role = 'PLAYER' AND assignment.ended_on IS NULL
    LEFT JOIN teams team ON team.id = assignment.team_id
    LEFT JOIN clubs club ON club.id = team.club_id
    LEFT JOIN countries club_country ON club_country.id = club.country_id
    LEFT JOIN countries country ON country.id = p.nationality_country_id
    WHERE club_country.iso_code IN ('NP', 'NPL')
       OR (assignment.person_id IS NULL AND country.iso_code IN ('NP', 'NPL'))
    ORDER BY p.id
  `,
    )
    .all() as PlayerRow[];

export type PlayerGameplayProfileAudit = {
  total: number;
  missingFactual: {
    dateOfBirth: number;
    nationality: number;
    heightCm: number;
    preferredFoot: number;
  };
  missingGameplay: {
    dateOfBirth: number;
    nationality: number;
    heightCm: number;
    preferredFoot: number;
  };
  complete: number;
  byDivision: Record<string, number>;
};

export const reconcilePlayablePlayerProfiles = (
  db: GameDatabase,
  input: { worldDate: string; seed: string },
): PlayerGameplayProfileAudit => {
  const players = playableNepalPlayers(db);
  const existing = db.prepare("SELECT * FROM player_factual_profiles WHERE player_id = ?");
  const insert = db.prepare(`
    INSERT INTO player_factual_profiles
      (id, player_id, canonical_external_id, current_club_id, factual_json, simulation_json,
       evidence_json, record_status, confidence_level, last_verified)
    VALUES (?, ?, ?, ?, '{}', '{}', '{}', 'UNKNOWN', 'LOW', NULL)
    ON CONFLICT(canonical_external_id) DO NOTHING
  `);
  const update = db.prepare(
    "UPDATE player_factual_profiles SET simulation_json = ? WHERE player_id = ?",
  );

  for (const player of players) {
    let row = existing.get(player.player_id) as
      | {
          factual_json?: string | null;
          simulation_json?: string | null;
        }
      | undefined;
    if (!row) {
      insert.run(
        createStableEntityId("player-gameplay-profile", player.player_id),
        player.player_id,
        `bootstrap:${player.player_id}`,
        player.club_id ?? null,
      );
      row = existing.get(player.player_id) as typeof row;
    }
    if (!row) continue;
    const factual = JSON.parse(row.factual_json ?? "{}") as Record<string, unknown>;
    const simulation = JSON.parse(row.simulation_json ?? "{}") as Record<string, unknown>;
    const rng = new SeededRandom(`${input.seed}:gameplay-profile:${player.player_id}`);
    const factualDob = (player.person_date_of_birth as string | null) ?? factual.dateOfBirth;
    const nationality =
      typeof player.country_name === "string" && player.country_name.length > 0
        ? player.country_name
        : "Nepal";
    const age = 18 + rng.integer(0, 16);
    if (!factualDob && typeof simulation.simulationDateOfBirth !== "string") {
      simulation.simulationDateOfBirth = isoDate(input.worldDate, age, rng);
      simulation.simulationDateOfBirthStatus = "SIMULATION_ONLY";
    }
    if (typeof simulation.simulationHeightCm !== "number") {
      simulation.simulationHeightCm = gameplayHeight(player.primary_position ?? "CM", rng);
      simulation.simulationHeightStatus = "SIMULATION_ONLY";
    }
    if (typeof simulation.simulationPreferredFoot !== "string") {
      simulation.simulationPreferredFoot = gameplayFoot(rng);
      simulation.simulationPreferredFootStatus = "SIMULATION_ONLY";
    }
    if (
      typeof factual.nationality !== "string" &&
      typeof simulation.simulationNationality !== "string"
    ) {
      simulation.simulationNationality = nationality;
      simulation.simulationNationalityStatus = "SIMULATION_ONLY";
    }
    update.run(JSON.stringify(simulation), player.player_id);
  }

  const auditRows = players.map((player) => {
    const row = existing.get(player.player_id) as
      { factual_json?: string; simulation_json?: string } | undefined;
    const factual = JSON.parse(row?.factual_json ?? "{}") as Record<string, unknown>;
    const simulation = JSON.parse(row?.simulation_json ?? "{}") as Record<string, unknown>;
    const factualDob = player.person_date_of_birth ?? factual.dateOfBirth;
    return {
      factual: {
        dateOfBirth: Boolean(factualDob),
        nationality: typeof factual.nationality === "string",
        heightCm: typeof factual.heightCm === "number",
        preferredFoot:
          typeof factual.preferredFoot === "string" && factual.preferredFoot !== "UNKNOWN",
      },
      gameplay: {
        dateOfBirth: Boolean(factualDob ?? simulation.simulationDateOfBirth),
        nationality: Boolean(factual.nationality ?? simulation.simulationNationality),
        heightCm: Boolean(factual.heightCm ?? simulation.simulationHeightCm),
        preferredFoot: Boolean(
          factual.preferredFoot && factual.preferredFoot !== "UNKNOWN"
            ? factual.preferredFoot
            : simulation.simulationPreferredFoot,
        ),
      },
    };
  });
  const countMissing = (
    key: "dateOfBirth" | "nationality" | "heightCm" | "preferredFoot",
    group: "factual" | "gameplay",
  ) => auditRows.filter((row) => !row[group][key]).length;
  const byDivision = db
    .prepare(
      `
    SELECT COALESCE(competition.name, 'Free Agents') AS division, COUNT(DISTINCT assignment.person_id) AS count
    FROM team_person_assignments assignment
    JOIN teams team ON team.id = assignment.team_id
    LEFT JOIN clubs club ON club.id = team.club_id
    LEFT JOIN countries country ON country.id = club.country_id
    LEFT JOIN competition_seasons season ON season.start_date <= (SELECT world_date FROM saves LIMIT 1) AND season.end_date >= (SELECT world_date FROM saves LIMIT 1)
    LEFT JOIN club_memberships membership ON membership.team_id = team.id AND membership.competition_season_id = season.id AND membership.status = 'ACTIVE'
    LEFT JOIN competitions competition ON competition.id = season.competition_id
    WHERE assignment.role = 'PLAYER' AND assignment.ended_on IS NULL AND country.iso_code IN ('NP','NPL')
    GROUP BY division
  `,
    )
    .all() as Array<{ division: string; count: number }>;
  const freeAgents = players.filter((player) => !player.club_id).length;
  if (freeAgents > 0) byDivision.push({ division: "Free Agents", count: freeAgents });
  return {
    total: players.length,
    missingFactual: {
      dateOfBirth: countMissing("dateOfBirth", "factual"),
      nationality: countMissing("nationality", "factual"),
      heightCm: countMissing("heightCm", "factual"),
      preferredFoot: countMissing("preferredFoot", "factual"),
    },
    missingGameplay: {
      dateOfBirth: countMissing("dateOfBirth", "gameplay"),
      nationality: countMissing("nationality", "gameplay"),
      heightCm: countMissing("heightCm", "gameplay"),
      preferredFoot: countMissing("preferredFoot", "gameplay"),
    },
    complete: auditRows.filter((row) => Object.values(row.gameplay).every(Boolean)).length,
    byDivision: Object.fromEntries(byDivision.map((row) => [row.division, Number(row.count)])),
  };
};

export const reconcilePlayablePlayerProfilesOnce = (
  db: GameDatabase,
  input: { worldDate: string; seed: string },
): PlayerGameplayProfileAudit => {
  const applied = db
    .prepare("SELECT 1 FROM simulation_reconciliation_runs WHERE reconciliation_key = ?")
    .get(RECONCILIATION_KEY);
  const audit = reconcilePlayablePlayerProfiles(db, input);
  if (!applied)
    db.prepare(
      "INSERT INTO simulation_reconciliation_runs (reconciliation_key, applied_on) VALUES (?, ?)",
    ).run(RECONCILIATION_KEY, input.worldDate);
  return audit;
};
