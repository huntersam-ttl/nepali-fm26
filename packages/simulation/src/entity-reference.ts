import type { GameDatabase } from "@nepal-football-sim/database";
import type {
  CareerRole,
  EntityId,
  EntityReference,
  EntityReferenceType,
} from "@nepal-football-sim/shared-types";

type Row = Record<string, any>;

const descriptors: Record<
  EntityReferenceType,
  { table: string; destination: string; label: string; subtitle?: string }
> = {
  PLAYER: { table: "persons", destination: "player", label: "full_name" },
  STAFF: { table: "persons", destination: "staff", label: "full_name" },
  CLUB: { table: "clubs", destination: "club", label: "name" },
  COMPETITION: { table: "competitions", destination: "competition", label: "name" },
  FIXTURE: { table: "fixtures", destination: "fixture", label: "id", subtitle: "scheduled_date" },
  SPONSOR: {
    table: "sponsorship_contracts",
    destination: "sponsor",
    label: "id",
    subtitle: "status",
  },
  LENDER: { table: "club_lenders", destination: "lender", label: "name" },
  INVESTOR: { table: "persons", destination: "investor", label: "full_name" },
  GOVERNMENT_INSTITUTION: {
    table: "government_institutions",
    destination: "government",
    label: "name",
  },
  INFRASTRUCTURE_PROJECT: {
    table: "infrastructure_projects",
    destination: "project",
    label: "id",
    subtitle: "status",
  },
  FEDERATION_PROJECT: {
    table: "federation_projects",
    destination: "federation-project",
    label: "name",
    subtitle: "status",
  },
  NATIONAL_TEAM: { table: "teams", destination: "national-team", label: "name" },
  JOURNALIST: { table: "media_journalists", destination: "journalist", label: "name", subtitle: "beat" },
  MEDIA_OUTLET: { table: "media_outlets", destination: "media-outlet", label: "name", subtitle: "scope" },
};

/** Human-readable label for a SCREAMING_SNAKE_CASE enum value, used only as
 * a display fallback here — never persisted, never treated as a fact. */
const titleCase = (value: string): string =>
  value
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");

const roleActions = (type: EntityReferenceType, role: CareerRole): string[] => {
  if (type === "NATIONAL_TEAM") return ["OPEN_PROFILE", "VIEW_SQUAD"];
  if (type === "SPONSOR") return ["OPEN_PROFILE", "VIEW_DEALS"];
  if (type === "PLAYER" && role === "MANAGER")
    return [
      "OPEN_PROFILE",
      "TRANSFER_LIST",
      "LOAN_LIST",
      "RENEW_CONTRACT",
      "SHORTLIST_SCOUT",
      "PROMISES",
    ];
  if (type === "PLAYER") return ["OPEN_PROFILE"];
  if (type === "FIXTURE" && role === "CHAIRMAN_OWNER")
    return ["OPEN_FIXTURE", "WATCH", "QUICK_SIM"];
  if (type === "INFRASTRUCTURE_PROJECT" && ["CHAIRMAN_OWNER", "CEO"].includes(role))
    return ["OPEN_PROJECT", "VIEW_PROGRESS"];
  if (type === "FEDERATION_PROJECT" && role === "FEDERATION_PRESIDENT")
    return ["OPEN_PROJECT", "VIEW_PROGRESS"];
  return ["OPEN_PROFILE"];
};

export const buildEntityReference = (
  db: GameDatabase,
  type: EntityReferenceType,
  id: EntityId,
  role: CareerRole,
): EntityReference => {
  const descriptor = descriptors[type];
  const row =
    type === "SPONSOR"
      ? ((db.prepare("SELECT name, sector FROM commercial_sponsor_profiles WHERE id=?").get(id) as
          Row | undefined) ??
        (db
          .prepare("SELECT name, industry AS sector FROM sponsor_organisations WHERE id=?")
          .get(id) as Row | undefined))
      : type === "FIXTURE"
        ? (db
            .prepare(
              `SELECT f.id, f.scheduled_date, f.status, ht.name AS home_name, at.name AS away_name
               FROM fixtures f
               JOIN teams ht ON ht.id = f.home_team_id
               JOIN teams at ON at.id = f.away_team_id
               WHERE f.id = ?`,
            )
            .get(id) as Row | undefined)
        : (db.prepare(`SELECT * FROM ${descriptor.table} WHERE id=? LIMIT 1`).get(id) as
            Row | undefined);
  const exists = Boolean(row);
  const label = exists
    ? type === "SPONSOR"
      ? String(row?.name ?? id)
      : type === "FIXTURE"
        ? `${row!.home_name} vs ${row!.away_name}`
        : type === "INFRASTRUCTURE_PROJECT"
          ? titleCase(String(row?.project_type ?? id))
          : String(row?.[descriptor.label] ?? id)
    : "Unknown entity";
  const reference: EntityReference = {
    entityType: type,
    id,
    label,
    subtitle: descriptor.subtitle && exists ? String(row?.[descriptor.subtitle] ?? "") : undefined,
    destination: type === "SPONSOR" ? "organization" : descriptor.destination,
    visible: exists,
    allowedActions: exists ? roleActions(type, role) : [],
    provenanceStatus:
      exists && type !== "PLAYER" && type !== "STAFF"
        ? "SIMULATION_ONLY"
        : exists
          ? "SIMULATION_ONLY"
          : "UNKNOWN",
  };
  return reference.subtitle ? reference : { ...reference, subtitle: undefined };
};
