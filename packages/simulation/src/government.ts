import { createStableEntityId, type ClubInfrastructureGovernmentContext, type EntityId, type GovernmentFundingApplication, type GovernmentInstitution, type GovernmentFundingType, type GovernmentOverview, type GovernmentPriorityBand, type GovernmentRelationshipBand } from "@nepal-football-sim/shared-types";
import { FacilityPlanningRepository, GovernmentRepository, type GameDatabase } from "@nepal-football-sim/database";
import { postClubTransaction } from "./club-economy.js";
import { postFederationTransaction } from "./federation-governance.js";
import { buildEntityReference } from "./entity-reference.js";

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
