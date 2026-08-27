import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";

export type GlobalImportMode = "VALIDATE" | "DRY_RUN" | "APPLY";
export type FindingSeverity = "FATAL" | "ERROR" | "WARNING" | "INFO";
export type DuplicateClassification = "EXACT_MATCH" | "STRONG_MATCH" | "POSSIBLE_DUPLICATE" | "NEW_ENTITY";

export type ImportFinding = { severity: FindingSeverity; sheet?: string; row?: number; field?: string; message: string };
export type WorkbookRow = Record<string, unknown>;
export type ParsedGlobalWorkbook = { sheets: Record<string, WorkbookRow[]>; sourcePath: string };

export type GlobalImportPlan = {
  datasetVersion: string;
  sourcePath: string;
  generatedAt: string;
  sources: WorkbookRow[];
  federations: WorkbookRow[];
  competitions: WorkbookRow[];
  leagues: WorkbookRow[];
  clubs: WorkbookRow[];
  players: WorkbookRow[];
  staff: WorkbookRow[];
  playerClubHistory: WorkbookRow[];
  nepalForeignPlayers: WorkbookRow[];
  duplicateCandidates: WorkbookRow[];
  manualReviewExternalIds: string[];
  actions: Array<{ entityType: string; externalId: string; action: "NEW" | "MAPPED" | "UNCHANGED" | "REVIEW"; canonicalId?: string }>;
};

export type GlobalImportReport = {
  mode: GlobalImportMode;
  datasetVersion: string;
  sourcePath: string;
  sheets: string[];
  statistics: Record<string, number>;
  findings: ImportFinding[];
  plan?: GlobalImportPlan;
};

export type GlobalImportStore = {
  persistValidatedPlan: (plan: GlobalImportPlan) => void;
};

export const classifyExternalIdentity = (input: { sameExternalId: boolean; sameName: boolean; sameDateOfBirth: boolean; sameNationality: boolean; sameClubOrHistory: boolean }): DuplicateClassification => {
  if (input.sameExternalId) return "EXACT_MATCH";
  if (input.sameName && input.sameDateOfBirth && input.sameNationality) return "STRONG_MATCH";
  if (input.sameName && (input.sameDateOfBirth || input.sameClubOrHistory)) return "POSSIBLE_DUPLICATE";
  return "NEW_ENTITY";
};

const requiredSheets = ["PLAYERS", "CLUBS", "STAFF", "LEAGUES", "COMPETITIONS", "FEDERATIONS", "PLAYER_CLUB_HISTORY", "NEPAL_FOREIGN_PLAYERS", "SOURCES"];
const expectedHeaders: Record<string, string[]> = {
  PLAYERS: ["player_external_id", "full_name", "common_name", "date_of_birth", "birth_year", "nationality", "second_nationality", "primary_position", "secondary_position", "preferred_foot", "height_cm", "current_club", "current_club_country", "current_league", "shirt_number", "national_team", "national_team_status", "is_nepal_connected", "nepal_connection_type", "provenance", "confidence", "source_1_id", "source_2_id", "last_verified_date", "notes"],
  CLUBS: ["club_external_id", "official_name", "common_name", "country", "city", "national_federation", "league", "division_level", "stadium", "stadium_capacity", "founded_year", "professional_status", "website", "is_nepal_club", "is_major_global_club", "is_relevant_to_nepal_market", "provenance", "confidence", "source_1_id", "source_2_id", "last_verified_date", "notes"],
  STAFF: ["staff_external_id", "full_name", "date_of_birth", "nationality", "role", "current_club_or_federation", "country", "previous_club_or_role", "coaching_licence", "is_nepal_connected", "nepal_connection", "provenance", "confidence", "source_1_id", "source_2_id", "last_verified_date", "notes"],
  LEAGUES: ["league_external_id", "official_name", "common_name", "country", "federation", "confederation", "tier", "number_of_clubs", "season_format", "professional_status", "is_playable_in_game", "simulation_depth", "provenance", "source_1_id", "last_verified_date", "notes"],
  COMPETITIONS: ["competition_external_id", "official_name", "country_or_region", "organiser", "confederation", "competition_type", "scope", "current_status", "is_playable_in_game", "simulation_depth", "provenance", "source_1_id", "last_verified_date", "notes"],
  FEDERATIONS: ["federation_external_id", "official_name", "abbreviation", "country", "confederation", "fifa_member", "official_website", "provenance", "source_1_id", "last_verified_date", "notes"],
  PLAYER_CLUB_HISTORY: ["history_external_id", "player_external_id", "player_name", "club_external_id", "club_name", "country", "start_date", "end_date", "season", "relationship_type", "provenance", "confidence", "source_1_id", "notes"],
  NEPAL_FOREIGN_PLAYERS: ["record_external_id", "player_external_id", "full_name", "nationality", "primary_position", "nepali_club", "competition", "season_or_year", "relationship_type", "previous_club", "next_club", "currently_in_nepal", "african_player", "african_country", "source_1_id", "source_2_id", "provenance", "confidence", "notes"],
  SOURCES: ["source_id", "publisher", "page_title", "url", "publication_date", "retrieval_date", "source_type", "source_quality", "notes"],
};
const idColumns: Record<string, { column: string; prefix: string }> = { PLAYERS: { column: "player_external_id", prefix: "PLY-" }, CLUBS: { column: "club_external_id", prefix: "CLB-" }, STAFF: { column: "staff_external_id", prefix: "STF-" }, LEAGUES: { column: "league_external_id", prefix: "LGE-" }, COMPETITIONS: { column: "competition_external_id", prefix: "CMP-" }, FEDERATIONS: { column: "federation_external_id", prefix: "FED-" }, PLAYER_CLUB_HISTORY: { column: "history_external_id", prefix: "HIS-" }, NEPAL_FOREIGN_PLAYERS: { column: "record_external_id", prefix: "NFP-" }, SOURCES: { column: "source_id", prefix: "SRC-" } };
const allowedProvenance = new Set(["VERIFIED", "REPORTED", "UNKNOWN"]);
const allowedConfidence = new Set(["HIGH", "MEDIUM", "LOW"]);
const positions = new Set(["GK", "RB", "LB", "CB", "DM", "CM", "AM", "RW", "LW", "ST", "UNKNOWN"]);
const positionAliases: Record<string, string> = { GOALKEEPER: "GK", KEEPER: "GK", DEFENDER: "CB", MIDFIELDER: "CM", ATTACKER: "ST", FORWARD: "ST", RWB: "RB", LWB: "LB", LM: "LW", RM: "RW", DF: "CB", MF: "CM" };
const countryAliases: Record<string, string> = { "KOREA REPUBLIC": "South Korea", "COTE D'IVOIRE": "Côte d’Ivoire", "CÔTE D’IVOIRE": "Côte d’Ivoire", USA: "United States" };

const text = (value: unknown): string => value == null ? "" : String(value).trim();
const normalized = (value: unknown): string => text(value).toLocaleLowerCase().replace(/[.'’]/g, "").replace(/\s+/g, " ");
const normalizeCountry = (value: unknown): string => countryAliases[text(value).toUpperCase()] ?? text(value);
const normalizePosition = (value: unknown): string => text(value).split(",").map((part) => { const key = part.trim().toUpperCase(); return positionAliases[key] ?? key; }).join(",");
const normalizeBoolean = (value: unknown): string => { const key = text(value).toUpperCase(); if (["YES", "TRUE", "1"].includes(key)) return "YES"; if (["NO", "FALSE", "0"].includes(key)) return "NO"; return key; };
const normalizeDate = (value: unknown): string => { if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10); const raw = text(value); if (/^\d{4}$/.test(raw)) return raw; const parsed = new Date(raw); return raw && !Number.isNaN(parsed.valueOf()) ? parsed.toISOString().slice(0, 10) : raw; };

export const parseGlobalFootballWorkbook = (sourcePath: string): ParsedGlobalWorkbook => {
  const workbook = XLSX.read(readFileSync(sourcePath), { type: "buffer", cellDates: true, cellFormula: false, cellNF: false, cellStyles: false });
  const sheets: Record<string, WorkbookRow[]> = {};
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
    const headers = (rows[0] ?? []).map(text);
    sheets[sheetName] = rows.slice(1).filter((row) => row.some((cell) => text(cell))).map((row) => {
      // v16 has 23 STAFF rows with an undocumented common-name cell inserted
      // after full_name. The following date cell makes this repair unambiguous;
      // no arbitrary column guessing is performed for other row shapes.
      const repaired = sheetName === "STAFF" && !/^\d{4}-\d{2}-\d{2}$/.test(text(row[2])) && /^\d{4}-\d{2}-\d{2}$/.test(text(row[3])) ? [...row.slice(0, 2), ...row.slice(3, 11), "UNKNOWN", ...row.slice(11)] : row;
      return Object.fromEntries(headers.map((header, index) => [header, repaired[index] ?? null]));
    });
  }
  return { sheets, sourcePath };
};

/** Writes a new workbook containing only deterministic, documented repairs. */
export const writeReconciledGlobalFootballWorkbook = (sourcePath: string, destinationPath: string): void => {
  const workbook = XLSX.read(readFileSync(sourcePath), { type: "buffer", cellDates: true, cellFormula: false, cellNF: false, cellStyles: true });
  const players = workbook.Sheets.PLAYERS;
  if (players) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(players, { header: 1, raw: true, defval: null });
    for (const row of rows.slice(1)) if (row.length > 7) row[7] = normalizePosition(row[7]);
    workbook.Sheets.PLAYERS = XLSX.utils.aoa_to_sheet(rows);
  }
  const leagues = workbook.Sheets.LEAGUES;
  if (leagues) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(leagues, { header: 1, raw: true, defval: null });
    for (const row of rows.slice(1)) if (row.length > 11 && text(row[3]).toUpperCase() !== "NEPAL") { row[10] = "NO"; row[11] = "CONTEXT_ONLY"; }
    workbook.Sheets.LEAGUES = XLSX.utils.aoa_to_sheet(rows);
  }
  const staff = workbook.Sheets.STAFF;
  if (staff) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(staff, { header: 1, raw: true, defval: null });
    const repaired = rows.map((row, index) => index > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(text(row[2])) && /^\d{4}-\d{2}-\d{2}$/.test(text(row[3])) ? [...row.slice(0, 2), ...row.slice(3, 11), "UNKNOWN", ...row.slice(11)] : row);
    workbook.Sheets.STAFF = XLSX.utils.aoa_to_sheet(repaired);
  }
  XLSX.writeFile(workbook, destinationPath, { bookType: "xlsx" });
};

export type FinalReconciliationManifestEntry = { sheet: string; externalId: string; field: string; oldValue: string; newValue: string; classification: "SAFE_NORMALIZATION" | "CANONICAL_MAPPING" | "DATA_REPAIR" | "MANUAL_REVIEW"; reason: string };
export type FinalReconciliationResult = { destinationPath: string; manifest: FinalReconciliationManifestEntry[]; manualReview: Array<Record<string, string>> };

const slug = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "UNKNOWN";
const csvCell = (value: string): string => `"${value.replaceAll('"', '""')}"`;

/**
 * Produces a new candidate workbook. It edits only deterministic facts and
 * leaves genuinely uncertain identity/competition decisions in a review file.
 */
export const reconcileFinalGlobalFootballWorkbook = (sourcePath: string, destinationPath: string, manifestPath: string, manualReviewPath: string): FinalReconciliationResult => {
  const workbook = XLSX.read(readFileSync(sourcePath), { type: "buffer", cellDates: true, cellFormula: false, cellNF: false, cellStyles: true });
  const manifest: FinalReconciliationManifestEntry[] = [];
  const manualReview: Array<Record<string, string>> = [];
  const arrays = new Map<string, unknown[][]>();
  for (const sheet of Object.keys(expectedHeaders)) { const ws = workbook.Sheets[sheet]; if (ws) arrays.set(sheet, XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null })); }
  const idAt = (sheet: string, row: unknown[]): string => text(row[expectedHeaders[sheet]!.indexOf(idColumns[sheet]!.column)]);
  const setField = (sheet: string, row: unknown[], field: string, value: string, classification: FinalReconciliationManifestEntry["classification"], reason: string): void => { const index = expectedHeaders[sheet]!.indexOf(field); const oldValue = text(row[index]); if (oldValue !== value) { row[index] = value; manifest.push({ sheet, externalId: idAt(sheet, row), field, oldValue, newValue: value, classification, reason }); } };
  for (const [sheet, rows] of arrays) {
    const headers = expectedHeaders[sheet]!;
    for (const row of rows.slice(1)) {
      const provenance = headers.indexOf("provenance"); if (provenance >= 0 && text(row[provenance]).toUpperCase() === "UNVERIFIED") setField(sheet, row, "provenance", "UNKNOWN", "MANUAL_REVIEW", "Raw Unverified/LOW-confidence row; preserve uncertainty without promoting provenance.");
      const quality = headers.indexOf("source_quality"); if (quality >= 0 && text(row[quality]).toUpperCase() === "STRONG_SECONDARY") setField(sheet, row, "source_quality", "SECONDARY", "SAFE_NORMALIZATION", "Canonical source-quality alias; secondary evidence is not primary evidence.");
      if (sheet === "PLAYERS") { setField(sheet, row, "primary_position", normalizePosition(row[headers.indexOf("primary_position")]), "SAFE_NORMALIZATION", "Explicit supported position alias."); setField(sheet, row, "secondary_position", normalizePosition(row[headers.indexOf("secondary_position")]), "SAFE_NORMALIZATION", "Explicit supported position alias."); }
      if (sheet === "LEAGUES" && text(row[headers.indexOf("country")]).toUpperCase() !== "NEPAL") { setField(sheet, row, "is_playable_in_game", "NO", "SAFE_NORMALIZATION", "External leagues are never playable."); setField(sheet, row, "simulation_depth", "CONTEXT_ONLY", "SAFE_NORMALIZATION", "External leagues use context-only simulation."); }
    }
  }
  const federationRows = arrays.get("FEDERATIONS")!; const federationHeaders = expectedHeaders.FEDERATIONS!; const federationCodes = new Set(federationRows.slice(1).map((row) => text(row[federationHeaders.indexOf("abbreviation")] )));
  const federationByCountry = new Map(federationRows.slice(1).map((row) => [normalized(row[federationHeaders.indexOf("country")]), text(row[federationHeaders.indexOf("abbreviation")] )]));
  const ensureFederation = (code: string, country: string, sourceId: string, confederation: string): string => {
    const existing = federationByCountry.get(normalized(country)); if (existing && existing !== code) return existing;
    if (!federationCodes.has(code)) { const row = ["FED-RECON-" + slug(code), code, code, country, confederation || "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN", sourceId, "", "Reconciled federation reference; identity details remain UNKNOWN."]; federationRows.push(row); federationCodes.add(code); federationByCountry.set(normalized(country), code); manifest.push({ sheet: "FEDERATIONS", externalId: row[0] as string, field: "federation_external_id", oldValue: "", newValue: row[0] as string, classification: "CANONICAL_MAPPING", reason: `Federation code ${code} is directly referenced by a verified league tuple; unprovided identity fields remain UNKNOWN.` }); }
    return code;
  };
  const leagueRows = arrays.get("LEAGUES")!; const leagueHeaders = expectedHeaders.LEAGUES!; const leagueNames = new Set(leagueRows.slice(1).flatMap((row) => [normalized(row[leagueHeaders.indexOf("official_name")]), normalized(row[leagueHeaders.indexOf("common_name")])]).filter(Boolean));
  for (const row of leagueRows.slice(1)) ensureFederation(text(row[leagueHeaders.indexOf("federation")]), text(row[leagueHeaders.indexOf("country")]), text(row[leagueHeaders.indexOf("source_1_id")]), text(row[leagueHeaders.indexOf("confederation")]));
  const clubRows = arrays.get("CLUBS")!; const clubHeaders = expectedHeaders.CLUBS!; const nonLeagueNames = new Set(["aaha! rara gold cup", "budha subba gold cup"]);
  const addedLeagueIds = new Set<string>();
  for (const row of clubRows.slice(1)) {
    const league = text(row[clubHeaders.indexOf("league")]); if (!league || leagueNames.has(normalized(league))) continue;
    const externalId = idAt("CLUBS", row); const country = text(row[clubHeaders.indexOf("country")]);
    if (nonLeagueNames.has(normalized(league))) { setField("CLUBS", row, "league", "", "MANUAL_REVIEW", "Tournament affiliation is not a league; do not invent a canonical league row."); manualReview.push({ sheet: "CLUBS", external_id: externalId, name: text(row[clubHeaders.indexOf("official_name")]), field: "league", value: league, issue: "NOT_APPLICABLE_OR_TOURNAMENT", evidence: "Club row labels an event rather than a league.", candidate_mapping: "", recommended_action: "Review historical/tournament relationship separately." }); continue; }
    const federationToken = text(row[clubHeaders.indexOf("national_federation")]); const federation = ensureFederation(federationToken, country, text(row[clubHeaders.indexOf("source_1_id")]), "UNKNOWN");
    const newId = `LGE-RECON-${slug(country)}-${slug(league)}`; if (!addedLeagueIds.has(newId)) { const newRow = [newId, league, league, country, federation, "UNKNOWN", "UNKNOWN", "", "UNKNOWN", "UNKNOWN", "NO", "CONTEXT_ONLY", "UNKNOWN", text(row[clubHeaders.indexOf("source_1_id")]), "", "Reconciled from a club reference; format details remain UNKNOWN."]; leagueRows.push(newRow); addedLeagueIds.add(newId); leagueNames.add(normalized(league)); manifest.push({ sheet: "LEAGUES", externalId: newId, field: "league_external_id", oldValue: "", newValue: newId, classification: "CANONICAL_MAPPING", reason: `League ${league} is explicitly present in a club/country/federation tuple; unsupported format facts remain UNKNOWN.` }); }
  }
  for (const [sheet, rows] of arrays) if (workbook.Sheets[sheet]) workbook.Sheets[sheet] = XLSX.utils.aoa_to_sheet(rows);
  mkdirSync(manifestPath.includes("/") ? manifestPath.slice(0, manifestPath.lastIndexOf("/")) : ".", { recursive: true });
  writeFileSync(destinationPath, ""); XLSX.writeFile(workbook, destinationPath, { bookType: "xlsx" });
  writeFileSync(manifestPath, `${JSON.stringify({ datasetVersion: "football_world_import_v16", sourcePath, destinationPath, changes: manifest }, null, 2)}\n`);
  const columns = ["sheet", "external_id", "name", "field", "value", "issue", "evidence", "candidate_mapping", "recommended_action"]; writeFileSync(manualReviewPath, `${columns.join(",")}\n${manualReview.map((row) => columns.map((column) => csvCell(row[column] ?? "")).join(",")).join("\n")}\n`);
  return { destinationPath, manifest, manualReview };
};

const normalizeRows = (parsed: ParsedGlobalWorkbook): Record<string, WorkbookRow[]> => {
  const output: Record<string, WorkbookRow[]> = {};
  for (const [sheet, rows] of Object.entries(parsed.sheets)) output[sheet] = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, ["nationality", "second_nationality", "country", "current_club_country", "current_club_or_federation", "current_club", "club_name", "club", "nepali_club", "african_country"].includes(key) ? normalizeCountry(value) : key.includes("date") || key.endsWith("_on") ? normalizeDate(value) : key.includes("position") ? normalizePosition(value) : ["is_nepal_club", "is_playable_in_game", "simulation_depth", "is_nepal_connected", "currently_in_nepal", "african_player", "fifa_member"].includes(key) ? normalizeBoolean(value) : text(value)])));
  return output;
};

const add = (findings: ImportFinding[], severity: FindingSeverity, message: string, sheet?: string, row?: number, field?: string): void => { findings.push({ severity, message, ...(sheet ? { sheet } : {}), ...(row ? { row } : {}), ...(field ? { field } : {}) }); };
const sourceRefs = (row: WorkbookRow): string[] => [text(row.source_1_id), text(row.source_2_id)].filter(Boolean);
const isValidDate = (value: string): boolean => {
  if (/^\d{4}$/.test(value)) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

const validateRows = (sheets: Record<string, WorkbookRow[]>, findings: ImportFinding[]): void => {
  const sourceIds = new Set((sheets.SOURCES ?? []).map((row) => text(row.source_id)));
  for (const [sheet, rows] of Object.entries(sheets)) {
    const contract = expectedHeaders[sheet]; if (!contract) continue;
    const actual = rows.length ? Object.keys(rows[0]!) : [];
    if (rows.length && (actual.length !== contract.length || actual.some((header, index) => header !== contract[index]))) add(findings, "FATAL", `Headers must exactly match the documented ${sheet} contract.`, sheet, 1);
    const id = idColumns[sheet]; const seen = new Map<string, number>();
    rows.forEach((row, index) => {
      const line = index + 2; const value = text(row[id.column]);
      if (!value || !value.startsWith(id.prefix)) add(findings, "ERROR", `Stable ID must be non-empty and use ${id.prefix} prefix.`, sheet, line, id.column);
      if (seen.has(value)) add(findings, "FATAL", `Duplicate stable ID also appears on row ${seen.get(value)}.`, sheet, line, id.column); else seen.set(value, line);
      const provenance = text(row.provenance).toUpperCase(); if (expectedHeaders[sheet]?.includes("provenance") && !allowedProvenance.has(provenance)) add(findings, "ERROR", "Unsupported provenance; expected VERIFIED, REPORTED, or UNKNOWN.", sheet, line, "provenance");
      if (expectedHeaders[sheet]?.includes("confidence") && !allowedConfidence.has(text(row.confidence).toUpperCase())) add(findings, "ERROR", "Confidence must be HIGH, MEDIUM, or LOW.", sheet, line, "confidence");
      for (const ref of sourceRefs(row)) if (!sourceIds.has(ref)) add(findings, "ERROR", `Referenced source ${ref} does not exist.`, sheet, line);
      for (const dateField of ["date_of_birth", "start_date", "end_date", "last_verified_date", "publication_date", "retrieval_date"]) if (text(row[dateField]) && text(row[dateField]).toUpperCase() !== "UNKNOWN" && !isValidDate(text(row[dateField]))) add(findings, "ERROR", "Date must be ISO YYYY or YYYY-MM-DD and represent a real date.", sheet, line, dateField);
      if (sheet === "PLAYERS" && text(row.primary_position) && !positions.has(text(row.primary_position))) add(findings, "ERROR", "Unknown primary position; use the supported position aliases.", sheet, line, "primary_position");
      if (sheet === "PLAYERS" && normalizeDate(row.date_of_birth) > "2026-08-27") add(findings, "ERROR", "Date of birth cannot be in the future.", sheet, line, "date_of_birth");
      if (sheet === "LEAGUES" && text(row.country).toUpperCase() !== "NEPAL" && (normalizeBoolean(row.is_playable_in_game) === "YES" || text(row.simulation_depth).toUpperCase() === "FULL")) add(findings, "WARNING", "External league will be forced to NO / CONTEXT_ONLY by the import plan.", sheet, line);
      if (sheet === "CLUBS" && text(row.country).toUpperCase() !== "NEPAL" && normalizeBoolean(row.is_nepal_club) === "YES") add(findings, "WARNING", "External club country conflicts with is_nepal_club; context-only policy wins.", sheet, line);
      if (sheet === "SOURCES" && (!text(row.publisher) || !text(row.url))) add(findings, "ERROR", "Source requires publisher and URL.", sheet, line);
    });
  }
  const sourceTypes = new Set(["FEDERATION", "CONFEDERATION", "CLUB", "LEAGUE", "PLAYER", "STAFF", "NEWS", "DATABASE", "OTHER"]);
  for (const [index, row] of (sheets.SOURCES ?? []).entries()) { if (!sourceTypes.has(text(row.source_type).toUpperCase())) add(findings, "WARNING", "Unrecognized source_type.", "SOURCES", index + 2, "source_type"); if (!["PRIMARY", "SECONDARY", "TERTIARY"].includes(text(row.source_quality).toUpperCase())) add(findings, "ERROR", "Unrecognized source_quality.", "SOURCES", index + 2, "source_quality"); }
};

const referenceKey = (value: unknown): string => normalized(value);
const nameSet = (rows: WorkbookRow[], official: string, common: string): Set<string> => new Set(rows.flatMap((row) => [referenceKey(row[official]), referenceKey(row[common])]).filter(Boolean));
const validateReferences = (sheets: Record<string, WorkbookRow[]>, findings: ImportFinding[]): void => {
  const federations = nameSet(sheets.FEDERATIONS ?? [], "official_name", "abbreviation");
  const leagues = nameSet(sheets.LEAGUES ?? [], "official_name", "common_name");
  const clubs = nameSet(sheets.CLUBS ?? [], "official_name", "common_name");
  const playerIds = new Set((sheets.PLAYERS ?? []).map((row) => text(row.player_external_id)));
  const clubIds = new Set((sheets.CLUBS ?? []).map((row) => text(row.club_external_id)));
  for (const [index, row] of (sheets.LEAGUES ?? []).entries()) if (!federations.has(referenceKey(row.federation))) add(findings, "ERROR", `League federation ${text(row.federation)} does not resolve.`, "LEAGUES", index + 2, "federation");
  for (const [index, row] of (sheets.CLUBS ?? []).entries()) if (text(row.league) && !leagues.has(referenceKey(row.league))) add(findings, "ERROR", `Club league ${text(row.league)} does not resolve.`, "CLUBS", index + 2, "league");
  for (const [index, row] of (sheets.PLAYERS ?? []).entries()) if (text(row.current_club) && !clubs.has(referenceKey(row.current_club))) add(findings, "WARNING", `Current club ${text(row.current_club)} is not present in CLUBS; no club will be fabricated.`, "PLAYERS", index + 2, "current_club");
  for (const [index, row] of (sheets.PLAYER_CLUB_HISTORY ?? []).entries()) {
    if (!playerIds.has(text(row.player_external_id))) add(findings, "ERROR", "History player_external_id does not resolve.", "PLAYER_CLUB_HISTORY", index + 2, "player_external_id");
    if (!clubIds.has(text(row.club_external_id))) add(findings, "ERROR", "History club_external_id does not resolve.", "PLAYER_CLUB_HISTORY", index + 2, "club_external_id");
    if (text(row.start_date) && text(row.end_date) && text(row.end_date) < text(row.start_date)) add(findings, "ERROR", "History end_date precedes start_date.", "PLAYER_CLUB_HISTORY", index + 2);
  }
  for (const [index, row] of (sheets.NEPAL_FOREIGN_PLAYERS ?? []).entries()) if (text(row.player_external_id) && !playerIds.has(text(row.player_external_id))) add(findings, "ERROR", "Nepal foreign-player player_external_id does not resolve.", "NEPAL_FOREIGN_PLAYERS", index + 2, "player_external_id");
};

const duplicateCandidates = (rows: WorkbookRow[], idField: string, nameField: string, countryField: string): WorkbookRow[] => {
  const groups = new Map<string, WorkbookRow[]>(); for (const row of rows) { const key = `${normalized(row[nameField])}|${normalized(row[countryField])}`; if (!key.startsWith("|")) groups.set(key, [...(groups.get(key) ?? []), row]); }
  return [...groups.values()].filter((group) => group.length > 1).flatMap((group) => group.slice(1).map((row) => ({ candidate_id: text(row[idField]), classification: "POSSIBLE_DUPLICATE", reason: "Same normalized name and country; manual review required." })));
};

const buildPlan = (sheets: Record<string, WorkbookRow[]>, sourcePath: string, duplicates: WorkbookRow[]): GlobalImportPlan => {
  const rows = (name: string) => sheets[name] ?? [];
  const actions: GlobalImportPlan["actions"] = [];
  for (const [sheet, id] of Object.entries(idColumns)) for (const row of rows(sheet)) actions.push({ entityType: sheet, externalId: text(row[id.column]), action: "NEW" });
  const datasetVersion = (sourcePath.split(/[\\/]/).pop() ?? "football_world_import_v16.xlsx").replace(/\.xlsx$/i, "");
  return { datasetVersion, sourcePath, generatedAt: "DETERMINISTIC", sources: rows("SOURCES"), federations: rows("FEDERATIONS"), competitions: rows("COMPETITIONS"), leagues: rows("LEAGUES").map((row) => ({ ...row, is_playable_in_game: text(row.country).toUpperCase() === "NEPAL" ? "YES" : "NO", simulation_depth: text(row.country).toUpperCase() === "NEPAL" ? "FULL" : "CONTEXT_ONLY" })), clubs: rows("CLUBS").map((row) => ({ ...row, is_playable_in_game: "NO", simulation_depth: "CONTEXT_ONLY" })), players: rows("PLAYERS"), staff: rows("STAFF"), playerClubHistory: rows("PLAYER_CLUB_HISTORY"), nepalForeignPlayers: rows("NEPAL_FOREIGN_PLAYERS"), duplicateCandidates: duplicates, manualReviewExternalIds: rows("CLUBS").filter((row) => !text(row.league)).map((row) => text(row.club_external_id)), actions: actions.sort((a, b) => `${a.entityType}:${a.externalId}`.localeCompare(`${b.entityType}:${b.externalId}`)) };
};

export const inspectGlobalFootballWorkbook = (sourcePath: string, mode: GlobalImportMode = "VALIDATE"): GlobalImportReport => {
  const parsed = parseGlobalFootballWorkbook(sourcePath); const sheets = normalizeRows(parsed); const findings: ImportFinding[] = [];
  for (const required of requiredSheets) if (!parsed.sheets[required]) add(findings, "FATAL", `Required sheet ${required} is missing.`, required);
  for (const [sheet, headers] of Object.entries(expectedHeaders)) if (parsed.sheets[sheet]?.length === 0) add(findings, "FATAL", `Required sheet ${sheet} has no data rows.`, sheet);
  validateRows(sheets, findings);
  validateReferences(sheets, findings);
  const duplicates = [...duplicateCandidates(sheets.PLAYERS ?? [], "player_external_id", "full_name", "nationality"), ...duplicateCandidates(sheets.CLUBS ?? [], "club_external_id", "official_name", "country"), ...duplicateCandidates(sheets.STAFF ?? [], "staff_external_id", "full_name", "nationality")];
  for (const candidate of duplicates) add(findings, "WARNING", `Duplicate candidate requires review: ${text(candidate.candidate_id)}.`);
  const statistics: Record<string, number> = {}; for (const [sheet, rows] of Object.entries(sheets)) statistics[sheet.toLocaleLowerCase()] = rows.length;
  statistics.verified_players = (sheets.PLAYERS ?? []).filter((row) => text(row.provenance).toUpperCase() === "VERIFIED").length;
  statistics.players_without_dob = (sheets.PLAYERS ?? []).filter((row) => !text(row.date_of_birth)).length;
  statistics.players_without_current_club = (sheets.PLAYERS ?? []).filter((row) => !text(row.current_club)).length;
  statistics.nepal_connected_foreign_players = (sheets.NEPAL_FOREIGN_PLAYERS ?? []).length;
  const coverage = new Map((sheets.COVERAGE_SUMMARY ?? []).map((row) => [text(row.metric_name), Number(row.metric_value)]));
  for (const [metric, actual] of [["total_players", statistics.players], ["clubs", statistics.clubs], ["staff", statistics.staff], ["leagues", statistics.leagues], ["competitions", statistics.competitions], ["federations", statistics.federations]] as Array<[string, number | undefined]>) {
    const expected = coverage.get(metric); if (expected !== undefined && actual !== undefined && expected !== actual) add(findings, "WARNING", `Coverage summary reports ${expected} for ${metric}, parser counted ${actual}.`, "COVERAGE_SUMMARY");
  }
  statistics.findings_fatal = findings.filter((finding) => finding.severity === "FATAL").length; statistics.findings_error = findings.filter((finding) => finding.severity === "ERROR").length; statistics.findings_warning = findings.filter((finding) => finding.severity === "WARNING").length;
  const plan = mode === "VALIDATE" ? undefined : buildPlan(sheets, sourcePath, duplicates);
  return { mode, datasetVersion: plan?.datasetVersion ?? "football_world_import_v16", sourcePath, sheets: Object.keys(parsed.sheets).sort(), statistics, findings, ...(plan ? { plan } : {}) };
};

export const applyGlobalFootballImport = (report: GlobalImportReport, store: GlobalImportStore): void => {
  if (report.mode !== "APPLY") throw new Error("APPLY requires explicit APPLY mode.");
  if (!report.plan) throw new Error("APPLY requires a canonical import plan.");
  if (report.findings.some((finding) => finding.severity === "FATAL" || finding.severity === "ERROR")) throw new Error("Cannot apply a workbook with fatal or row-level errors.");
  store.persistValidatedPlan(report.plan);
};

export const validateGlobalFootballWorkbook = (sourcePath: string): GlobalImportReport => inspectGlobalFootballWorkbook(sourcePath, "VALIDATE");
export const dryRunGlobalFootballImport = (sourcePath: string): GlobalImportReport => inspectGlobalFootballWorkbook(sourcePath, "DRY_RUN");

export const reconcileNepalField = (existing: { value?: string; provenance: string }, incoming: { value?: string; provenance: string }): { value?: string; provenance: string; action: "REFERENCE_MATCH" | "RETAIN_EXISTING" | "ENRICH" | "CONFLICT_REVIEW" } => {
  if (existing.provenance === "VERIFIED") {
    if (incoming.provenance === "VERIFIED" && existing.value === incoming.value) return { ...existing, action: "REFERENCE_MATCH" };
    if (incoming.provenance !== "VERIFIED") return { ...existing, action: "RETAIN_EXISTING" };
    if (existing.value !== incoming.value) return { ...existing, action: "CONFLICT_REVIEW" };
  }
  if (incoming.provenance === "VERIFIED") return { ...incoming, action: "ENRICH" };
  if (existing.value !== undefined) return { ...existing, action: "RETAIN_EXISTING" };
  return { ...incoming, action: "ENRICH" };
};
