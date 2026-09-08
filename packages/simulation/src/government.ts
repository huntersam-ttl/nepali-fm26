import { createStableEntityId, type ClubInfrastructureGovernmentContext, type EntityId, type GovernmentFundingApplication, type GovernmentInstitution, type GovernmentFundingType, type GovernmentOverview, type GovernmentPriorityBand, type GovernmentRelationshipBand, type GovernmentSupportApplicationSummary, type GovernmentSupportMeetingContext } from "@nepal-football-sim/shared-types";
import { ClubEconomyRepository, EventRepository, FacilityPlanningRepository, GovernmentRepository, type GameDatabase } from "@nepal-football-sim/database";
import { postClubTransaction } from "./club-economy.js";
import { postFederationTransaction } from "./federation-governance.js";
import { buildEntityReference } from "./entity-reference.js";
import { presentClubLocation } from "./club-location.js";

/** Once-only historical-event insert — see the identical helper in
 * club-economy.ts for why this cannot rely on the table's own constraints. */
const recordHistoricalEventOnce = (
  db: GameDatabase,
  event: Parameters<InstanceType<typeof EventRepository>["insertHistoricalEvent"]>[0],
): void => {
  if (db.prepare("SELECT 1 FROM historical_events WHERE id=?").get(event.id)) return;
  new EventRepository(db).insertHistoricalEvent(event);
};

const clubName = (db: GameDatabase, clubId: EntityId): string =>
  (db.prepare("SELECT name FROM clubs WHERE id=?").get(clubId) as { name?: string } | undefined)?.name ?? "The club";

/** A short human phrase for what the requested support is actually for —
 * derived from the linked project's real type when one exists yet, and
 * from the funding type alone (site-anchored requests predate the project)
 * otherwise. Never fabricates a project that doesn't exist. */
const supportPurposePhrase = (db: GameDatabase, application: Pick<GovernmentFundingApplication, "projectId" | "fundingType">): string => {
  if (application.projectId) {
    const project = db.prepare("SELECT project_type FROM infrastructure_projects WHERE id=?").get(application.projectId) as { project_type?: string } | undefined;
    if (project?.project_type) return `proposed ${project.project_type.replaceAll("_", " ").toLowerCase()} project`;
  }
  switch (application.fundingType) {
    case "MUNICIPAL_LAND_OR_VENUE":
      return "proposed municipal ground";
    case "REGIONAL_GROUND":
      return "proposed regional ground";
    case "INFRASTRUCTURE":
      return "proposed infrastructure project";
    case "YOUTH_GRASSROOTS":
      return "youth development programme";
    case "WOMENS_FOOTBALL":
      return "women's football programme";
    default:
      return "funding request";
  }
};

export type GovernmentFundingEvidence = {
  federationCredibility: number;
  projectQuality: number;
  footballPerformance: number;
  existingCommitments: number;
};

export type GovernmentFundingDecision = {
  status: GovernmentFundingApplication["status"];
  approvedAmount?: number;
  conditions: string[];
  reason: string;
};

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

/** Pure, inspectable decision function; it never moves money between ledgers. */
export const evaluateGovernmentFunding = (input: {
  institution: GovernmentInstitution;
  requestedAmount: number;
  fundingType: GovernmentFundingType;
  evidence: GovernmentFundingEvidence;
}): GovernmentFundingDecision => {
  const profile = input.institution.profile;
  const available = Math.max(0, profile.budgetCapacity - profile.committedBudget);
  const priority = input.fundingType === "INFRASTRUCTURE" || input.fundingType === "REGIONAL_GROUND" || input.fundingType === "MUNICIPAL_LAND_OR_VENUE"
    ? profile.infrastructurePriority
    : input.fundingType === "YOUTH_GRASSROOTS" || input.fundingType === "WOMENS_FOOTBALL"
      ? profile.youthWomenPriority
      : profile.footballPriority;
  const score = clamp(priority * 0.25 + input.evidence.federationCredibility * 0.25 + input.evidence.projectQuality * 0.2 + input.evidence.footballPerformance * 0.15 + (100 - clamp(input.evidence.existingCommitments)) * 0.15);
  if (input.requestedAmount <= 0 || available <= 0 || score < 35) return { status: "REJECTED", conditions: [], reason: "Budget capacity or football evidence is insufficient" };
  const affordableAmount = Math.min(input.requestedAmount, Math.floor(available * (score >= 65 ? 0.5 : 0.25)));
  if (affordableAmount <= 0) return { status: "REJECTED", conditions: [], reason: "Existing commitments leave no responsible allocation" };
  const conditions = ["annual reporting", "auditable use of funds"];
  if (["INFRASTRUCTURE", "REGIONAL_GROUND", "MUNICIPAL_LAND_OR_VENUE"].includes(input.fundingType)) conditions.push("community access");
  if (["YOUTH_GRASSROOTS", "WOMENS_FOOTBALL"].includes(input.fundingType)) conditions.push("youth/women allocation");
  if (score < 65 || affordableAmount < input.requestedAmount) return { status: "CONDITIONAL", approvedAmount: affordableAmount, conditions, reason: "Support is viable but requires staged delivery and evidence" };
  return { status: "APPROVED", approvedAmount: affordableAmount, conditions, reason: "Priority and capacity support the requested programme" };
};

export const proposeGovernmentFunding = (db: GameDatabase, input: Omit<GovernmentFundingApplication, "id" | "status" | "approvedAmount" | "conditions" | "decidedOn" | "decisionReason" | "provenanceStatus">): GovernmentFundingApplication => {
  const repo = new GovernmentRepository(db);
  const applicationId = createStableEntityId("government-funding", `${input.institutionId}:${input.fundingType}:${input.proposedOn}:${input.projectId ?? input.clubId ?? input.federationId ?? "general"}`);
  const existing = repo.applications().find((item) => item.id === applicationId);
  if (existing) return existing;
  const application: GovernmentFundingApplication = { ...input, id: applicationId, status: "PROPOSED", conditions: [], provenanceStatus: "SIMULATION_ONLY" };
  repo.upsertApplication(application);
  adjustGovernmentRelationship(db, application, 1, input.proposedOn);
  if (application.clubId) {
    recordHistoricalEventOnce(db, {
      id: createStableEntityId("history", `GOVERNMENT_SUPPORT_REQUESTED:${application.id}`),
      occurredOn: input.proposedOn,
      eventType: "GOVERNMENT_SUPPORT_REQUESTED",
      involvedEntities: [
        { id: application.clubId, type: "club" },
        { id: application.institutionId, type: "governmentInstitution" },
      ],
      title: `${clubName(db, application.clubId)} has opened a government support request for its ${supportPurposePhrase(db, application)}.`,
      data: { applicationId: application.id, institutionId: application.institutionId },
      importance: "medium",
      scope: "club",
    });
  }
  return application;
};

const adjustGovernmentRelationship = (
  db: GameDatabase,
  application: GovernmentFundingApplication,
  delta: number,
  date: string,
): void => {
  const entityId = application.federationId ?? application.clubId;
  if (!entityId) return;
  const entityType = application.federationId ? "FEDERATION" as const : "CLUB" as const;
  const repo = new GovernmentRepository(db);
  const existing = repo.relationships(application.institutionId).find(
    (relationship) => relationship.entityId === entityId && relationship.entityType === entityType,
  );
  repo.upsertRelationship({
    id: existing?.id ?? createStableEntityId("government-relationship", `${application.institutionId}:${entityType}:${entityId}`),
    institutionId: application.institutionId,
    entityId,
    entityType,
    trust: clamp((existing?.trust ?? 50) + delta),
    lastInteractionOn: date,
    provenanceStatus: "SIMULATION_ONLY",
  });
};

/**
 * Annual opportunity surfaced by the federation cadence. This deliberately
 * stops at PROPOSED: approval and ledger settlement remain the existing
 * government-funding flow. The amount is a gameplay-only request, not a
 * factual government allocation.
 */
export const proposeAnnualGovernmentFunding = (
  db: GameDatabase,
  input: { date: string; seed: string },
): GovernmentFundingApplication | undefined => {
  const federation = db.prepare(`
    SELECT f.id FROM federations f
    JOIN countries c ON c.id = f.country_id
    WHERE c.iso_code IN ('NP', 'NPL')
    ORDER BY f.id LIMIT 1
  `).get() as { id?: EntityId } | undefined;
  if (!federation?.id) return undefined;
  const institutionRepo = new GovernmentRepository(db);
  const existingInstitution = institutionRepo.institutions("NATIONAL_SPORTS_COUNCIL")[0];
  const institution = existingInstitution ?? {
    id: createStableEntityId("government-institution", "nepal-national-sports-council"),
    name: "National Sports Council",
    institutionType: "NATIONAL_SPORTS_COUNCIL" as const,
    profile: {
      budgetCapacity: 40_000_000,
      committedBudget: 0,
      footballPriority: 60,
      credibilityTowardFederation: 60,
      infrastructurePriority: 60,
      youthWomenPriority: 70,
    },
    provenanceStatus: "SIMULATION_ONLY" as const,
  };
  if (!existingInstitution) institutionRepo.upsertInstitution(institution);
  const applicationId = createStableEntityId(
    "government-funding",
    `${institution.id}:YOUTH_GRASSROOTS:${input.date}:${federation.id}`,
  );
  const existing = institutionRepo.applications().find((application) => application.id === applicationId);
  if (existing) return existing;
  return proposeGovernmentFunding(db, {
    institutionId: institution.id,
    federationId: federation.id,
    fundingType: "YOUTH_GRASSROOTS",
    requestedAmount: 5_000_000,
    proposedOn: input.date,
  });
};

const priorityBand = (value: number): GovernmentPriorityBand =>
  value >= 75 ? "VERY_HIGH" : value >= 50 ? "HIGH" : value >= 25 ? "MODERATE" : "LOW";

const relationshipBand = (trust: number): GovernmentRelationshipBand =>
  trust >= 75 ? "STRONG" : trust >= 50 ? "COOPERATIVE" : trust >= 25 ? "CAUTIOUS" : "STRAINED";

/**
 * Read model behind the federation's government-relations panel. Institutions
 * and relationships are both genuinely sparse today — most saves will show no
 * institution until the annual youth-grassroots cadence first proposes one,
 * and no relationship row exists until something actually records trust — so
 * this deliberately returns an honest empty/NOT_ESTABLISHED state rather than
 * inventing a placeholder relationship or institution.
 */
export const governmentOverview = (db: GameDatabase, federationId: EntityId): GovernmentOverview => {
  const repo = new GovernmentRepository(db);
  const relationshipByInstitution = new Map(
    repo.relationships().filter((relationship) => relationship.entityId === federationId).map((relationship) => [relationship.institutionId, relationship]),
  );
  return {
    institutions: repo.institutions().map((institution) => {
      const relationship = relationshipByInstitution.get(institution.id);
      return {
        id: institution.id,
        name: institution.name,
        institutionType: institution.institutionType,
        locationId: institution.locationId,
        relationshipBand: relationship ? relationshipBand(relationship.trust) : "NOT_ESTABLISHED",
        infrastructurePriorityBand: priorityBand(institution.profile.infrastructurePriority),
        youthWomenPriorityBand: priorityBand(institution.profile.youthWomenPriority),
        estimatedAvailableFunding: Math.max(0, institution.profile.budgetCapacity - institution.profile.committedBudget),
      };
    }),
    applications: repo.applications().filter((application) => application.federationId === federationId),
  };
};

/**
 * Lets the Federation President formally raise a funding request against an
 * existing institution — a thin, authority-checked wrapper around the same
 * proposeGovernmentFunding the annual cadence already uses. It is honest
 * about where it stops: nothing today automatically submits or reviews a
 * request raised this way (see CODEX_UI_BRIDGE_NEEDED in the UI layer), so
 * the application sits at PROPOSED until a future review path picks it up.
 */
export const requestGovernmentFunding = (
  db: GameDatabase,
  input: { federationId: EntityId; institutionId: EntityId; fundingType: GovernmentFundingType; requestedAmount: number; date: string },
): GovernmentFundingApplication => {
  const repo = new GovernmentRepository(db);
  if (!repo.institution(input.institutionId)) throw new Error(`Government institution missing: ${input.institutionId}`);
  if (!Number.isFinite(input.requestedAmount) || input.requestedAmount <= 0) throw new Error("Requested amount must be a positive number");
  return proposeGovernmentFunding(db, {
    institutionId: input.institutionId,
    federationId: input.federationId,
    fundingType: input.fundingType,
    requestedAmount: Math.round(input.requestedAmount),
    proposedOn: input.date,
  });
};

/**
 * The institution with real jurisdiction over a club's own district/
 * municipality. Solves the circularity where an Owner/CEO otherwise had no
 * way to discover an institution id at all (getGovernmentOverview is
 * FEDERATION_PRESIDENT-gated, and institutions are seeded sparsely — often
 * only once, nationally, via the federation's annual cadence): this walks
 * the same real location chain a club actually sits in and matches an
 * institution whose own locationId falls in that chain, falling back to an
 * institution with no locationId (national jurisdiction). Returns undefined,
 * never a fabricated id, when the club has no location on record or no
 * institution has been seeded yet at all.
 */
export const resolveGovernmentInstitutionForClub = (
  db: GameDatabase,
  clubId: EntityId,
): GovernmentInstitution | undefined => {
  const club = db.prepare("SELECT location_id FROM clubs WHERE id=?").get(clubId) as
    | { location_id?: EntityId }
    | undefined;
  if (!club?.location_id) return undefined;
  const institutions = new GovernmentRepository(db).institutions();
  if (!institutions.length) return undefined;
  const chain = db
    .prepare(
      `WITH RECURSIVE up(id, parent_location_id) AS (
         SELECT id, parent_location_id FROM locations WHERE id = ?
         UNION ALL
         SELECT l.id, l.parent_location_id FROM locations l JOIN up ON l.id = up.parent_location_id
       )
       SELECT id FROM up`,
    )
    .all(club.location_id) as Array<{ id: EntityId }>;
  const chainIds = new Set(chain.map((entry) => entry.id));
  const local = institutions.find(
    (institution) => institution.locationId && chainIds.has(institution.locationId),
  );
  return local ?? institutions.find((institution) => !institution.locationId);
};

/**
 * Anchors a government support request on a facility site option directly,
 * before any InfrastructureProject exists. requestClubInfrastructureGovernmentSupport
 * requires an existing project, which created a real circularity for a
 * brand-new GOVERNMENT_REVIEW site: createFacilityProjectPlan refuses to
 * create that project until an application exists, and (before this) the
 * only way to open an application was to already have the project. This
 * lets the site option itself anchor the request; createFacilityProjectPlan
 * then proceeds once the site's own readiness flips to AVAILABLE on
 * approval (settleApprovedFunding), never via a placeholder project.
 */
export const requestFacilitySiteGovernmentSupport = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    siteOptionId: EntityId;
    fundingType: Extract<GovernmentFundingType, "INFRASTRUCTURE" | "REGIONAL_GROUND" | "MUNICIPAL_LAND_OR_VENUE">;
    requestedAmount: number;
    date: string;
  },
): GovernmentFundingApplication => {
  if (!db.prepare("SELECT 1 FROM clubs WHERE id=?").get(input.clubId)) throw new Error("Club missing");
  const site = new FacilityPlanningRepository(db)
    .siteOptions(input.clubId)
    .find((option) => option.id === input.siteOptionId);
  if (!site) throw new Error("Facility site option missing");
  const institution = resolveGovernmentInstitutionForClub(db, input.clubId);
  if (!institution)
    throw new Error(
      "No government institution can be resolved for this club's location yet; the request cannot be opened.",
    );
  return proposeGovernmentFunding(db, {
    institutionId: institution.id,
    clubId: input.clubId,
    fundingType: input.fundingType,
    requestedAmount: Math.round(input.requestedAmount),
    proposedOn: input.date,
  });
};

/** Club-scoped infrastructure request. This deliberately uses the existing
 * government application lifecycle; it is not the federation funding command. */
export const requestClubInfrastructureGovernmentSupport = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    projectId: EntityId;
    institutionId: EntityId;
    fundingType: Extract<GovernmentFundingType, "INFRASTRUCTURE" | "REGIONAL_GROUND" | "MUNICIPAL_LAND_OR_VENUE">;
    requestedAmount: number;
    date: string;
  },
): GovernmentFundingApplication => {
  if (!db.prepare("SELECT 1 FROM clubs WHERE id=?").get(input.clubId)) throw new Error("Club missing");
  if (!db.prepare("SELECT 1 FROM infrastructure_projects WHERE id=? AND club_id=?").get(input.projectId, input.clubId)) throw new Error("Infrastructure project missing");
  return proposeGovernmentFunding(db, {
    institutionId: input.institutionId,
    clubId: input.clubId,
    projectId: input.projectId,
    fundingType: input.fundingType,
    requestedAmount: Math.round(input.requestedAmount),
    proposedOn: input.date,
  });
};

export const clubInfrastructureGovernmentContext = (
  db: GameDatabase,
  projectId: EntityId,
): ClubInfrastructureGovernmentContext => {
  const project = db.prepare("SELECT id, club_id FROM infrastructure_projects WHERE id=?").get(projectId) as
    | { id: EntityId; club_id: EntityId }
    | undefined;
  if (!project) return { projectId, status: "STALE", clubId: "" as EntityId, conditions: [], fundingSettled: false, nextAction: "NONE", blockedReason: "Infrastructure project no longer exists." };
  const plan = new FacilityPlanningRepository(db).planByProject(projectId);
  const site = plan?.siteOptionId
    ? new FacilityPlanningRepository(db).siteOptions(project.club_id).find((item) => item.id === plan.siteOptionId)
    : undefined;
  const application = new GovernmentRepository(db).applications().find(
    (item) => item.projectId === projectId && item.clubId === project.club_id,
  );
  const institution = application
    ? new GovernmentRepository(db).institution(application.institutionId)
    : undefined;
  const settlement = application
    ? (db.prepare("SELECT id FROM club_ledger_entries WHERE related_entity_id=? ORDER BY id LIMIT 1").get(application.id) as { id?: EntityId } | undefined)
    : undefined;
  const status = application?.status ?? "NOT_REQUESTED";
  const approved = application && ["APPROVED", "CONDITIONAL", "COMPLETED"].includes(application.status);
  const nextAction = !application
    ? "OPEN_REQUEST"
    : ["PROPOSED", "SUBMITTED", "REVIEWED"].includes(application.status)
      ? "WAIT_FOR_REVIEW"
      : approved && site?.readiness === "AVAILABLE"
        ? "START_PROJECT"
        : "NONE";
  return {
    projectId,
    project: buildEntityReference(db, "INFRASTRUCTURE_PROJECT", projectId, "CHAIRMAN_OWNER"),
    siteId: plan?.siteOptionId,
    siteReadiness: site?.readiness,
    clubId: project.club_id,
    governmentInstitution: institution
      ? buildEntityReference(db, "GOVERNMENT_INSTITUTION", institution.id, "CHAIRMAN_OWNER")
      : undefined,
    requestType: application?.fundingType,
    applicationId: application?.id,
    status,
    submittedOn: application?.proposedOn,
    reviewedOn: application?.decidedOn,
    requestedAmount: application?.requestedAmount,
    approvedAmount: application?.approvedAmount,
    conditions: application?.conditions ?? site?.governmentConditions ?? [],
    fundingSettled: Boolean(settlement?.id),
    settlementReference: settlement?.id,
    nextAction,
    blockedReason: !application && site?.readiness === "GOVERNMENT_REVIEW" ? "Government support request is required for this site." : undefined,
  };
};

const applicationSummary = (application: GovernmentFundingApplication): GovernmentSupportApplicationSummary => ({
  applicationId: application.id,
  fundingType: application.fundingType,
  status: application.status,
  requestedAmount: application.requestedAmount,
  approvedAmount: application.approvedAmount,
  proposedOn: application.proposedOn,
  decidedOn: application.decidedOn,
  decisionReason: application.decisionReason,
  conditions: application.conditions,
});

/**
 * Everything the Owner-side Government Support meeting needs in one call —
 * club/institution/site/project identity, the current + prior applications,
 * relationship context, and the real financing figures behind the request.
 * Never fabricates an institution or a precise real-world address; when the
 * club's location genuinely cannot resolve an institution, callers get an
 * honest blockedReason instead of a placeholder.
 */
export const buildGovernmentSupportMeeting = (
  db: GameDatabase,
  input: { clubId: EntityId; siteOptionId?: EntityId; projectId?: EntityId },
  role: "CHAIRMAN_OWNER" | "CEO" | "GENERAL_SECRETARY",
): GovernmentSupportMeetingContext => {
  if (!db.prepare("SELECT 1 FROM clubs WHERE id=?").get(input.clubId)) throw new Error("Club missing");
  const repo = new GovernmentRepository(db);
  const institution = resolveGovernmentInstitutionForClub(db, input.clubId);
  const applications = repo
    .applications()
    .filter((application) => application.clubId === input.clubId)
    .sort((a, b) => b.proposedOn.localeCompare(a.proposedOn) || b.id.localeCompare(a.id));
  const openApplication = applications.find((application) =>
    ["PROPOSED", "SUBMITTED", "REVIEWED"].includes(application.status),
  );
  const current = openApplication ?? applications[0];
  const priorApplications = applications.filter((application) => application.id !== current?.id);
  const site = input.siteOptionId
    ? new FacilityPlanningRepository(db).siteOptions(input.clubId).find((option) => option.id === input.siteOptionId)
    : undefined;
  const project = input.projectId
    ? (db.prepare("SELECT id, project_type, capital_cost, financing_json FROM infrastructure_projects WHERE id=?").get(input.projectId) as
        | { id: EntityId; project_type: string; capital_cost: number; financing_json?: string }
        | undefined)
    : undefined;
  const relationship = institution
    ? repo.relationships(institution.id).find((item) => item.entityType === "CLUB" && item.entityId === input.clubId)
    : undefined;
  const settlement = current
    ? (db.prepare("SELECT id FROM club_ledger_entries WHERE related_entity_id=? ORDER BY id LIMIT 1").get(current.id) as { id?: EntityId } | undefined)
    : undefined;
  const approved = current && ["APPROVED", "CONDITIONAL", "COMPLETED"].includes(current.status);
  const nextAction: GovernmentSupportMeetingContext["nextAction"] = !institution
    ? "NONE"
    : !current || current.status === "REJECTED" || current.status === "COMPLETED"
      ? "OPEN_REQUEST"
      : current.status === "PROPOSED"
        ? "SUBMIT_CASE"
        : current.status === "SUBMITTED" || current.status === "REVIEWED"
          ? "WAIT_FOR_REVIEW"
          : approved && (!site || site.readiness === "AVAILABLE")
            ? "START_PROJECT"
            : "NONE";
  const financing = project?.financing_json ? (JSON.parse(project.financing_json) as Record<string, number>) : undefined;
  return {
    club: buildEntityReference(db, "CLUB", input.clubId, role),
    locationLabel: presentClubLocation(db, input.clubId),
    institution: institution ? buildEntityReference(db, "GOVERNMENT_INSTITUTION", institution.id, role) : undefined,
    relationshipBand: relationship ? relationshipBand(relationship.trust) : institution ? "NOT_ESTABLISHED" : undefined,
    site: site ? { siteType: site.siteType, municipalityName: site.municipalityName, readiness: site.readiness } : undefined,
    project: project ? buildEntityReference(db, "INFRASTRUCTURE_PROJECT", project.id, role) : undefined,
    reasonNeeded: project
      ? `The club's ${project.project_type.replaceAll("_", " ").toLowerCase()} project needs municipal/government support to proceed.`
      : site?.readiness === "GOVERNMENT_REVIEW"
        ? "This site requires government support before the club can develop it."
        : "The club is seeking government support for a facility need.",
    current: current ? applicationSummary(current) : undefined,
    priorApplications: priorApplications.map(applicationSummary),
    totalProjectCost: project?.capital_cost,
    clubContribution: financing ? Object.values(financing).reduce((total, value) => total + Math.max(0, value), 0) : undefined,
    governmentContributionRequested: current?.requestedAmount,
    // camelCase financing keys (clubCash, governmentGrant, debt) must render
    // through the same humanizer path as any other status/category token —
    // insert the underscore camelCase itself omits so it never lowercases to
    // a single run-together word like "governmentgrant".
    financingSource: financing
      ? Object.keys(financing)[0].replace(/([A-Z])/g, "_$1").toUpperCase()
      : undefined,
    fundingSettled: Boolean(settlement?.id),
    nextAction,
    blockedReason: !institution
      ? "No government institution can be resolved for this club's location yet — it lacks enough canonical location/institution context."
      : undefined,
  };
};

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

/** A municipal/national institution takes real time to respond — nothing
 * elsewhere in the tick loop ever reviews a club-scoped application, so
 * without this every request opened via the Owner-side flow would sit at
 * PROPOSED forever. Runs on the same daily cadence as
 * advanceInfrastructureProjects. Evidence is derived from the club's own
 * real, already-persisted reputation/finance state — never invented — so
 * the same club scores the same way regardless of how many times a given
 * day is (re-)processed. */
export const advanceGovernmentApplications = (
  db: GameDatabase,
  input: { date: string },
): GovernmentFundingApplication[] => {
  const REVIEW_LAG_DAYS = 14;
  const repo = new GovernmentRepository(db);
  const economy = new ClubEconomyRepository(db);
  const due = repo
    .applications()
    .filter(
      (application) =>
        application.clubId &&
        (application.status === "PROPOSED" || application.status === "SUBMITTED") &&
        addDays(application.proposedOn, REVIEW_LAG_DAYS) <= input.date,
    );
  const reviewed: GovernmentFundingApplication[] = [];
  for (const application of due) {
    const institution = repo.institution(application.institutionId);
    if (!institution) continue;
    const supporter = application.clubId ? economy.supporterProfile(application.clubId) : undefined;
    reviewed.push(
      reviewGovernmentFunding(db, {
        applicationId: application.id,
        reviewedOn: input.date,
        evidence: {
          federationCredibility: supporter?.commercialReputation ?? 40,
          projectQuality: 55,
          footballPerformance: supporter?.footballReputation ?? 40,
          existingCommitments: institution.profile.budgetCapacity > 0
            ? Math.round((institution.profile.committedBudget / institution.profile.budgetCapacity) * 100)
            : 50,
        },
      }),
    );
  }
  return reviewed;
};

export const submitGovernmentFunding = (db: GameDatabase, applicationId: string): GovernmentFundingApplication => {
  const repo = new GovernmentRepository(db); const application = repo.applications().find((item) => item.id === applicationId);
  if (!application) throw new Error(`Government funding application missing: ${applicationId}`);
  if (application.status !== "PROPOSED") return application;
  const submitted = { ...application, status: "SUBMITTED" as const };
  repo.upsertApplication(submitted);
  adjustGovernmentRelationship(db, submitted, 2, application.proposedOn);
  return submitted;
};

export const reviewGovernmentFunding = (db: GameDatabase, input: { applicationId: string; reviewedOn: string; evidence: GovernmentFundingEvidence }): GovernmentFundingApplication => {
  const repo = new GovernmentRepository(db); const application = repo.applications().find((item) => item.id === input.applicationId);
  if (!application) throw new Error(`Government funding application missing: ${input.applicationId}`);
  if (["APPROVED", "REJECTED", "COMPLETED"].includes(application.status)) return application;
  const institution = repo.institution(application.institutionId); if (!institution) throw new Error(`Government institution missing: ${application.institutionId}`);
  const decision = evaluateGovernmentFunding({ institution, requestedAmount: application.requestedAmount, fundingType: application.fundingType, evidence: input.evidence });
  const reviewed: GovernmentFundingApplication = { ...application, status: decision.status, approvedAmount: decision.approvedAmount, conditions: decision.conditions, decidedOn: input.reviewedOn, decisionReason: decision.reason };
  repo.upsertApplication(reviewed);
  if (decision.approvedAmount && ["APPROVED", "CONDITIONAL"].includes(decision.status)) {
    repo.upsertInstitution({ ...institution, profile: { ...institution.profile, committedBudget: institution.profile.committedBudget + decision.approvedAmount } });
    settleApprovedFunding(db, reviewed, decision.approvedAmount, input.reviewedOn);
  }
  const relationshipDelta = decision.status === "REJECTED" ? -3 : decision.status === "APPROVED" ? 5 : 3;
  adjustGovernmentRelationship(db, reviewed, relationshipDelta, input.reviewedOn);
  if (reviewed.clubId && ["APPROVED", "CONDITIONAL", "REJECTED"].includes(decision.status)) {
    const approvedLike = decision.status !== "REJECTED";
    recordHistoricalEventOnce(db, {
      id: createStableEntityId("history", `GOVERNMENT_SUPPORT_DECIDED:${reviewed.id}`),
      occurredOn: input.reviewedOn,
      eventType: approvedLike ? "GOVERNMENT_SUPPORT_APPROVED" : "GOVERNMENT_SUPPORT_REJECTED",
      involvedEntities: [
        { id: reviewed.clubId, type: "club" },
        ...(institution ? [{ id: institution.id, type: "governmentInstitution" as const }] : []),
        ...(reviewed.projectId ? [{ id: reviewed.projectId, type: "infrastructureProject" as const }] : []),
      ],
      title: approvedLike
        ? `${institution.name} has approved support for ${clubName(db, reviewed.clubId)}'s ${supportPurposePhrase(db, reviewed)}.`
        : `${institution.name} has rejected ${clubName(db, reviewed.clubId)}'s government support request.`,
      data: { applicationId: reviewed.id, institutionId: institution.id },
      importance: approvedLike ? "high" : "medium",
      scope: "club",
    });
  }
  return reviewed;
};

/**
 * Government money only becomes football money once the federation actually holds it.
 * Approval used to move the institution's committed budget alone, so an approved grant
 * never entered the modelled economy. It enters through the same external-income route
 * FIFA and AFC grants already use, carrying the funding type as its restriction so the
 * money stays tied to the purpose it was granted for.
 */
const settleApprovedFunding = (
  db: GameDatabase,
  application: GovernmentFundingApplication,
  approvedAmount: number,
  date: string,
): void => {
  const description = `government funding received for ${application.fundingType.replaceAll("_", " ").toLowerCase()}`;
  if (application.clubId) {
    postClubTransaction(db, {
      clubId: application.clubId,
      date,
      category: "GRANT",
      direction: "CREDIT",
      amount: approvedAmount,
      description,
      relatedEntityId: application.id,
      idempotencyKey: `government-funding:${application.id}`,
    });
    const sites = new FacilityPlanningRepository(db);
    const plan = application.projectId ? sites.planByProject(application.projectId) : undefined;
    const siteFromPlan = plan?.siteOptionId
      ? sites.siteOptions(application.clubId).find((option) => option.id === plan.siteOptionId)
      : undefined;
    // A site-anchored request (requestFacilitySiteGovernmentSupport, opened
    // before any project/plan exists) has no plan to look the site up
    // through — fall back to the club's own pending site(s), which in
    // practice is at most one at a time per district.
    const sitesToRelease = siteFromPlan
      ? [siteFromPlan]
      : application.projectId
        ? []
        : sites.siteOptions(application.clubId).filter((option) => option.readiness === "GOVERNMENT_REVIEW");
    for (const site of sitesToRelease) sites.upsertSiteOption({ ...site, readiness: "AVAILABLE" });
    return;
  }
  if (!application.federationId) return;
  postFederationTransaction(db, {
    federationId: application.federationId,
    date,
    category: "GOVERNMENT_GRANT",
    direction: "CREDIT",
    amount: approvedAmount,
    description,
    relatedEntityId: application.id,
    restrictionTag: restrictionTagFor(application.fundingType),
    idempotencyKey: `government-funding:${application.id}`,
  });
};

const restrictionTagFor = (fundingType: GovernmentFundingType): string | undefined => {
  switch (fundingType) {
    case "FEDERATION_OPERATIONS":
      return undefined;
    case "NATIONAL_TEAM_PREPARATION":
      return "national-team";
    case "INFRASTRUCTURE":
    case "REGIONAL_GROUND":
    case "MUNICIPAL_LAND_OR_VENUE":
      return "infrastructure";
    case "WOMENS_FOOTBALL":
      return "womens-football";
    case "YOUTH_GRASSROOTS":
      return "development";
  }
};
