import { GlobalFootballContextRepository, type GameDatabase, WorldRepository } from "@nepal-football-sim/database";
import { createStableEntityId, type EntityId, type ExternalFederationContext, type FootballStaffRole } from "@nepal-football-sim/shared-types";
import type { GlobalImportPlan, WorkbookRow } from "@nepal-football-sim/data-import";

export type GlobalImportApplyCounts = Record<string, number>;
const value = (row: WorkbookRow, key: string): string => row[key] == null ? "" : String(row[key]).trim();
const key = (text: string): string => text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
const isoFor = (country: string): string => ({ Nepal: "NPL", India: "IND", Bangladesh: "BGD", Bhutan: "BTN", Maldives: "MDV", Pakistan: "PAK", "Sri Lanka": "LKA", Japan: "JPN", England: "ENG", Spain: "ESP", Germany: "DEU", Italy: "ITA", France: "FRA", Portugal: "PRT", Netherlands: "NLD", Brazil: "BRA", Argentina: "ARG", USA: "USA", "United States": "USA", Australia: "AUS", Nigeria: "NGA", Ghana: "GHA", "South Korea": "KOR", "Saudi Arabia": "SAU", Qatar: "QAT", UAE: "ARE" } as Record<string, string>)[country] ?? `X-${key(country).replace(/[^a-z0-9]/g, "").slice(0, 9).toUpperCase()}`;

const existingByName = (db: GameDatabase, table: "countries" | "federations" | "clubs", name: string, countryId?: EntityId): EntityId | undefined => {
  const row = countryId ? db.prepare(`SELECT id FROM ${table} WHERE lower(name)=lower(?) AND country_id=? LIMIT 1`).get(name, countryId) : db.prepare(`SELECT id FROM ${table} WHERE lower(name)=lower(?) LIMIT 1`).get(name);
  return (row as { id?: EntityId } | undefined)?.id;
};

const upsertCountry = (db: GameDatabase, name: string): EntityId => {
  const existing = db.prepare("SELECT id FROM countries WHERE lower(name)=lower(?) OR iso_code=? LIMIT 1").get(name, isoFor(name)) as { id?: EntityId } | undefined;
  if (existing?.id) return existing.id;
  const id = createStableEntityId("import-country", isoFor(name));
  db.prepare("INSERT OR IGNORE INTO countries (id,name,iso_code) VALUES (?,?,?)").run(id, name, isoFor(name));
  return id;
};

const findFederation = (db: GameDatabase, name: string, countryId?: EntityId): EntityId | undefined => {
  if (!name) return undefined;
  return existingByName(db, "federations", name, countryId) ?? (db.prepare("SELECT id FROM federations WHERE lower(name)=lower(?) LIMIT 1").get(name) as { id?: EntityId } | undefined)?.id;
};

const importPerson = (db: GameDatabase, externalId: string, fullName: string, dob: string, nationality: string): { personId: EntityId; action: "NEW" | "MAPPED" } => {
  const existing = db.prepare("SELECT player_id AS id FROM player_factual_profiles WHERE canonical_external_id=? LIMIT 1").get(externalId) as { id?: EntityId } | undefined;
  if (existing?.id) return { personId: existing.id, action: "MAPPED" };
  const countryId = upsertCountry(db, nationality || "UNKNOWN");
  const byIdentity = db.prepare("SELECT id FROM persons WHERE lower(full_name)=lower(?) AND date_of_birth=? AND nationality_country_id=? LIMIT 1").get(fullName, dob || null, countryId) as { id?: EntityId } | undefined;
  const personId = byIdentity?.id ?? createStableEntityId("import-person", externalId);
  if (!byIdentity?.id) db.prepare("INSERT OR IGNORE INTO persons (id,full_name,display_name,date_of_birth,nationality_country_id,gender_presentation,languages_json) VALUES (?,?,?,?,?,?,?)").run(personId, fullName, fullName, dob || null, countryId, null, "[]");
  return { personId, action: byIdentity?.id ? "MAPPED" : "NEW" };
};

const canonicalClub = (db: GameDatabase, externalId: string, officialName: string, countryId: EntityId): { id: EntityId; action: "NEW" | "MAPPED" } => {
  const existing = db.prepare("SELECT id FROM clubs WHERE canonical_external_id=? LIMIT 1").get(externalId) as { id?: EntityId } | undefined;
  if (existing?.id) return { id: existing.id, action: "MAPPED" };
  /* Most canonical Nepal clubs carry only `name`; `official_name` is optional
   * and set for a handful. Matching the official name alone therefore missed
   * the existing club and created a second Nepal identity for it. */
  const byName = db.prepare("SELECT id FROM clubs WHERE (lower(official_name)=lower(?) OR lower(name)=lower(?)) AND country_id=? LIMIT 1").get(officialName, officialName, countryId) as { id?: EntityId } | undefined;
  return byName?.id ? { id: byName.id, action: "MAPPED" } : { id: createStableEntityId("import-club", externalId), action: "NEW" };
};

/** Preserve the reported licence family while mapping its rank into the shared eligibility ladder. */
const internalStaffLicence = (raw: string): { licenceType: string; issuer: string } | undefined => {
  const normalised = raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!normalised || normalised === "UNKNOWN") return undefined;
  const family = normalised.includes("UEFA") ? "UEFA" : normalised.includes("AFC") ? "AFC" : "OTHER";
  const level = normalised.includes("PRO") ? "PRO" : normalised.match(/(?:^|_)([ABCD])(?:_|$)/)?.[1];
  return level ? { licenceType: family === "OTHER" ? `AFC_${level}` : `${family}_${level}`, issuer: family === "OTHER" ? raw.trim() : family } : undefined;
};

/** Applies a validated plan to an isolated starting-world database transactionally. */
export const applyGlobalFootballImportToDatabase = (db: GameDatabase, plan: GlobalImportPlan): GlobalImportApplyCounts => {
  const counts: GlobalImportApplyCounts = { inserted_federations: 0, mapped_federations: 0, inserted_leagues: 0, mapped_leagues: 0, inserted_competitions: 0, mapped_competitions: 0, inserted_clubs: 0, mapped_clubs: 0, inserted_players: 0, mapped_existing_players: 0, inserted_staff: 0, mapped_staff: 0, player_club_history_rows: plan.playerClubHistory.length, nepal_foreign_player_links: plan.nepalForeignPlayers.length, skipped_manual_review_rows: plan.manualReviewExternalIds.length, conflicts: 0, unchanged_noop_rows: 0 };
  const world = new WorldRepository(db); const contexts = new GlobalFootballContextRepository(db); const countries = new Map<string, EntityId>(); const federations = new Map<string, EntityId>(); const competitions = new Map<string, EntityId>(); const leagues = new Map<string, EntityId>(); const leagueNames = new Map<string, EntityId>(); const clubs = new Map<string, EntityId>(); const clubNames = new Map<string, string>(); const teams = new Map<string, EntityId>(); const persons = new Map<string, EntityId>();
  const country = (name: string): EntityId => { const normalized = key(name); const found = countries.get(normalized); if (found) return found; const id = upsertCountry(db, name || "UNKNOWN"); countries.set(normalized, id); return id; };
  const transaction = db as GameDatabase & { exec: (sql: string) => void }; transaction.exec("BEGIN IMMEDIATE");
  try {
    for (const row of plan.federations) { const external = value(row, "federation_external_id"), name = value(row, "official_name"), countryId = country(value(row, "country")); const found = existingByName(db, "federations", name, countryId); const id = found ?? createStableEntityId("import-federation", external); if (!found) { world.insertFederation({ id, countryId, name }); counts.inserted_federations++; } else counts.mapped_federations++; federations.set(value(row, "abbreviation") || name, id); if (value(row, "country").toUpperCase() !== "NEPAL") contexts.upsertFederation({ federationId: id, countryId, confederation: value(row, "confederation") as ExternalFederationContext["confederation"], reputation: 0, simulationDepth: "CONTEXT_ONLY", updatedOn: "2026-08-27" }); }
    for (const row of plan.competitions) { const external = value(row, "competition_external_id"), name = value(row, "official_name"), federation = findFederation(db, value(row, "organiser")); const id = createStableEntityId("import-competition", external); const found = db.prepare("SELECT id FROM competitions WHERE id=? OR lower(name)=lower(?) LIMIT 1").get(id, name) as { id?: EntityId } | undefined; if (found?.id) { competitions.set(external, found.id); counts.mapped_competitions++; } else { world.insertCompetition({ id, federationId: federation, name, scope: "domestic", category: "PYRAMID_LEAGUE" }); competitions.set(external, id); counts.inserted_competitions++; } }
    for (const row of plan.leagues) { const external = value(row, "league_external_id"), name = value(row, "official_name"), federation = federations.get(value(row, "federation")) ?? findFederation(db, value(row, "federation"), country(value(row, "country"))); const id = createStableEntityId("import-league", external); const found = db.prepare("SELECT id FROM competitions WHERE id=? LIMIT 1").get(id) as { id?: EntityId } | undefined; if (found?.id) { leagues.set(external, found.id); counts.mapped_leagues++; } else { world.insertCompetition({ id, federationId: federation, name, scope: "domestic", category: "PYRAMID_LEAGUE" }); leagues.set(external, id); counts.inserted_leagues++; } leagueNames.set(key(name), id); leagueNames.set(key(value(row, "common_name")), id); if (value(row, "country").toUpperCase() !== "NEPAL" && federation) contexts.upsertLeague({ leagueId: id, federationId: federation, countryId: country(value(row, "country")), tier: Number(value(row, "tier")) || 0, reputation: 0, simulationDepth: "CONTEXT_ONLY", continentalQualification: true }); }
    for (const row of plan.clubs) { const external = value(row, "club_external_id"), name = value(row, "official_name"), countryId = country(value(row, "country")), resolved = canonicalClub(db, external, name, countryId); if (resolved.action === "NEW") { world.insertClub({ id: resolved.id, name, officialName: name, shortName: value(row, "common_name") || name, canonicalExternalId: external, countryId, ownershipType: "PRIVATE", organisationType: "CLUB", foundedYear: Number(value(row, "founded_year")) || undefined }); counts.inserted_clubs++; } else counts.mapped_clubs++; clubs.set(external, resolved.id); clubNames.set(key(name), external); clubNames.set(key(value(row, "common_name")), external); }
    for (const row of plan.clubs) { const external = value(row, "club_external_id"), clubId = clubs.get(external)!, federationId = federations.get(value(row, "national_federation")) ?? findFederation(db, value(row, "national_federation"), country(value(row, "country"))), leagueId = leagueNames.get(key(value(row, "league"))); const teamId = createStableEntityId("import-team", external); teams.set(external, teamId); if (!db.prepare("SELECT 1 FROM teams WHERE id=?").get(teamId)) world.insertTeam({ id: teamId, clubId, federationId, name: `${value(row, "common_name") || value(row, "official_name")} Senior Men`, canonicalExternalId: `${external}-MEN`, level: "senior", gender: "men" }); if (value(row, "country").toUpperCase() !== "NEPAL" && leagueId && federationId) contexts.upsertClub({ clubId, leagueId, federationId, countryId: country(value(row, "country")), reputation: 40, financialBand: "MEDIUM", academyStrength: 35, scoutingReach: 50, recruitmentRegions: ["WIDER_ASIA"], simulationDepth: "CONTEXT_ONLY" }); }
    for (const row of plan.players) { const external = value(row, "player_external_id"), imported = importPerson(db, external, value(row, "full_name"), value(row, "date_of_birth"), value(row, "nationality")); persons.set(external, imported.personId); const clubExternal = clubNames.get(key(value(row, "current_club"))) ?? value(row, "current_club"), clubId = clubs.get(clubExternal) ?? (clubExternal ? (db.prepare("SELECT id FROM clubs WHERE lower(official_name)=lower(?) LIMIT 1").get(clubExternal) as { id?: EntityId } | undefined)?.id : undefined); const profileId = createStableEntityId("import-player-factual", external); db.prepare("INSERT INTO player_factual_profiles (id,player_id,canonical_external_id,current_club_id,factual_json,simulation_json,evidence_json,record_status,confidence_level,last_verified) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(canonical_external_id) DO UPDATE SET current_club_id=excluded.current_club_id,factual_json=excluded.factual_json,evidence_json=excluded.evidence_json,record_status=excluded.record_status,confidence_level=excluded.confidence_level,last_verified=excluded.last_verified").run(profileId, imported.personId, external, clubId ?? null, JSON.stringify(row), JSON.stringify({}), JSON.stringify({ sourceIds: [value(row, "source_1_id"), value(row, "source_2_id")].filter(Boolean) }), value(row, "provenance") || "UNKNOWN", value(row, "confidence") || "LOW", value(row, "last_verified_date") || null); if (clubId && value(row, "nationality").toUpperCase() !== "NEPAL") { contexts.upsertPlayer({ playerId: imported.personId, clubId, region: "WIDER_ASIA", reputation: 30, interestLevel: "UNKNOWN", careerState: "ACTIVE", updatedOn: "2026-08-27" }); const teamId = teams.get(clubExternal); if (teamId) db.prepare("INSERT OR IGNORE INTO team_person_assignments (id,person_id,team_id,role,started_on,ended_on) VALUES (?,?,?,?,?,NULL)").run(createStableEntityId("import-player-assignment", external), imported.personId, teamId, "PLAYER", "2026-08-27"); } /*
     * An imported footballer needs the canonical PLAYER role, not just a
     * factual profile: the external lifecycle identifies its population by that
     * role, so without it an imported player could never be given simulation
     * attributes and stayed frozen — ageing but never developing, declining or
     * retiring. Identity provenance is untouched; only the role is asserted.
     */
    const playerRoleId = createStableEntityId("import-person-role-player", external);
    if (!db.prepare("SELECT 1 FROM person_roles WHERE id=?").get(playerRoleId)) {
      world.insertPersonRole({ id: playerRoleId, personId: imported.personId, role: "PLAYER", activeFrom: value(row, "last_verified_date") || "2026-08-27" });
    }
    if (imported.action === "NEW") counts.inserted_players++; else counts.mapped_existing_players++; }
    for (const row of plan.staff) {
      const external = value(row, "staff_external_id");
      const imported = importPerson(db, external, value(row, "full_name"), value(row, "date_of_birth"), value(row, "nationality"));
      persons.set(external, imported.personId);
      const date = value(row, "last_verified_date") || "2026-08-27";
      const roleId = createStableEntityId("import-person-role", external);
      if (!db.prepare("SELECT 1 FROM person_roles WHERE id=?").get(roleId)) {
        world.insertPersonRole({ id: roleId, personId: imported.personId, role: "STAFF", activeFrom: date });
      }
      const role = value(row, "role") as FootballStaffRole;
      const clubExternal = clubNames.get(key(value(row, "current_club_or_federation")));
      const clubId = clubExternal ? clubs.get(clubExternal) : undefined;
      const profileId = createStableEntityId("import-staff-profile", external);
      world.insertStaffProfile({
        id: profileId,
        personId: imported.personId,
        preferredRole: role,
        countryKnowledge: [],
        clubKnowledge: clubId ? [clubId] : [],
        availability: clubId ? "EMPLOYED" : "AVAILABLE",
        workEligibilityStatus: "UNKNOWN",
      });
      const licence = internalStaffLicence(value(row, "coaching_licence"));
      if (licence && !db.prepare("SELECT 1 FROM staff_licences WHERE id=?").get(createStableEntityId("import-staff-licence", external))) {
        world.insertStaffLicence({ id: createStableEntityId("import-staff-licence", external), personId: imported.personId, licenceType: licence.licenceType, issuer: licence.issuer, issueDate: date, status: "VERIFIED" });
      }
      if (clubId) {
        const appointmentId = createStableEntityId("import-staff-appointment", external);
        if (!db.prepare("SELECT 1 FROM staff_appointments WHERE id=?").get(appointmentId)) {
          world.insertStaffAppointment({ id: appointmentId, personId: imported.personId, organisationType: "CLUB", clubId, teamId: teams.get(clubExternal!), role, startDate: date, employmentStatus: "ACTIVE" });
        }
      }
      if (imported.action === "NEW") counts.inserted_staff++; else counts.mapped_staff++;
    }
    for (const row of [...plan.sources, ...plan.staff, ...plan.playerClubHistory, ...plan.nepalForeignPlayers]) {
      const entityType = row.source_id ? "SOURCES" : row.staff_external_id ? "STAFF" : row.history_external_id ? "PLAYER_CLUB_HISTORY" : row.record_external_id ? "NEPAL_FOREIGN_PLAYERS" : "UNKNOWN";
      const externalId = value(row, "source_id") || value(row, "staff_external_id") || value(row, "history_external_id") || value(row, "record_external_id");
      const canonicalId = entityType === "STAFF"
        ? persons.get(value(row, "staff_external_id")) ?? externalId
        : value(row, "player_external_id") || value(row, "club_external_id") || value(row, "source_id");
      db.prepare("INSERT OR REPLACE INTO global_dataset_import_records (dataset_version,entity_type,external_id,canonical_id,action,provenance,payload_json) VALUES (?,?,?,?,?,?,?)").run(plan.datasetVersion, entityType, externalId, canonicalId, "UNCHANGED", value(row, "provenance") || "UNKNOWN", JSON.stringify(row));
    }
    db.prepare("INSERT INTO global_dataset_imports (dataset_version,source_path,applied_on,status) VALUES (?,?,?,?) ON CONFLICT(dataset_version) DO UPDATE SET source_path=excluded.source_path,applied_on=excluded.applied_on,status=excluded.status").run(plan.datasetVersion, plan.sourcePath, "2026-08-27", "ACTIVE");
    transaction.exec("COMMIT"); return counts;
  } catch (error) { transaction.exec("ROLLBACK"); throw error; }
};
