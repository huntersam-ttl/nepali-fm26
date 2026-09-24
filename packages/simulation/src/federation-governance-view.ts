import {
  ClubLicensingRepository,
  CompetitionRepository,
  FederationGovernanceRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import type {
  EntityId,
  FederationBudgetCategory,
  FederationCompetitionGovernance,
  FederationCompetitionRow,
  FederationDevelopmentProgrammes,
  FederationLicenceCaseView,
  FederationReformView,
} from "@nepal-football-sim/shared-types";
import { buildEntityReference } from "./entity-reference.js";

const ROLE = "FEDERATION_PRESIDENT" as const;

const LICENCE_ORDER: Record<string, number> = {
  FAILED: 0,
  CONDITIONAL: 1,
  PENDING: 2,
  APPEALED: 3,
  PASSED: 4,
  RESOLVED: 5,
};

/** Budget categories that fund the development programmes shown to the President. */
const PROGRAMME_BUDGET_CATEGORIES: readonly FederationBudgetCategory[] = [
  "YOUTH_DEVELOPMENT",
  "GRASSROOTS",
  "WOMENS_FOOTBALL",
  "COACH_EDUCATION",
  "REFEREE_DEVELOPMENT",
];

/**
 * Read-only competition governance for the President: the federation's domestic
 * competitions with their latest season, every recorded reform, and the latest
 * season's club licence cases. It surfaces recorded state only; it never
 * changes a competition and exposes no hidden weights, committee support, licence
 * history notes or registration-policy payloads.
 */
export const buildFederationCompetitionGovernance = (
  db: GameDatabase,
  federationId: EntityId,
  worldDate: string,
): FederationCompetitionGovernance => {
  const competitionsRepo = new CompetitionRepository(db);
  const rows = db
    .prepare("SELECT id, name, category FROM competitions WHERE federation_id=? AND scope='domestic' ORDER BY name, id")
    .all(federationId) as Array<{ id: EntityId; name: string; category?: string | null }>;

  const competitions: FederationCompetitionRow[] = rows.map((competition) => {
    const season = db
      .prepare(
        "SELECT id, name, start_date, end_date FROM competition_seasons WHERE competition_id=? ORDER BY end_date DESC, id DESC LIMIT 1",
      )
      .get(competition.id) as { id: EntityId; name: string; start_date: string; end_date: string } | undefined;
    const ruleSet = season ? competitionsRepo.getRuleSet(season.id) : undefined;
    const memberCount = season
      ? Number(
          (
            db
              .prepare(
                "SELECT COUNT(DISTINCT club_id) AS count FROM club_memberships WHERE competition_season_id=? AND status NOT IN ('WITHDRAWN','SUSPENDED','INELIGIBLE')",
              )
              .get(season.id) as { count?: number } | undefined
          )?.count ?? 0,
        )
      : 0;
    return {
      competition: buildEntityReference(db, "COMPETITION", competition.id, ROLE),
      category: competition.category ?? undefined,
      seasonName: season?.name,
      seasonStatus: season
        ? worldDate < season.start_date
          ? "Upcoming"
          : worldDate > season.end_date
            ? "Concluded"
            : "In progress"
        : undefined,
      seasonStart: season?.start_date,
      seasonEnd: season?.end_date,
      teamCount: memberCount,
      format: ruleSet?.competitionType,
      rounds: ruleSet?.numberOfRounds,
      promotionSlots: ruleSet?.promotionEnabled ? ruleSet.promotionSlots : undefined,
      relegationSlots: ruleSet?.relegationEnabled ? ruleSet.relegationSlots : undefined,
    };
  });

  const reforms: FederationReformView[] = new FederationGovernanceRepository(db)
    .competitionReforms(federationId)
    .map((reform) => ({
      id: reform.id,
      competition: buildEntityReference(db, "COMPETITION", reform.competitionId, ROLE),
      effectiveSeason: reform.effectiveSeason,
      changes: {
        teamCount: reform.changes.teamCount,
        rounds: reform.changes.rounds,
        promotionSlots: reform.changes.promotionSlots,
        relegationSlots: reform.changes.relegationSlots,
        format: reform.changes.format,
        calendarStart: reform.changes.calendar?.startDate,
        calendarEnd: reform.changes.calendar?.endDate,
      },
      status: reform.status,
      proposedAt: reform.proposedAt,
      decidedAt: reform.decidedAt,
    }))
    .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt) || a.id.localeCompare(b.id));

  const allCases = new ClubLicensingRepository(db).cases().filter((item) => item.federationId === federationId);
  const seasonLabel = allCases.map((item) => item.seasonLabel).sort().at(-1);
  const cases: FederationLicenceCaseView[] = allCases
    .filter((item) => item.seasonLabel === seasonLabel)
    .map((item) => ({
      id: item.id,
      club: buildEntityReference(db, "CLUB", item.clubId, ROLE),
      seasonLabel: item.seasonLabel,
      status: item.status,
      openRequirements: item.remediation
        .filter((requirement) => !requirement.completed)
        .map((requirement) => ({ requirement: requirement.requirement, deadline: requirement.deadline })),
      sanctions: [...item.sanctions],
      reviewedAt: item.reviewedAt,
    }))
    .sort(
      (a, b) =>
        (LICENCE_ORDER[a.status] ?? 9) - (LICENCE_ORDER[b.status] ?? 9) ||
        a.club.label.localeCompare(b.club.label) ||
        a.id.localeCompare(b.id),
    );

  return {
    competitions,
    reforms,
    licensing: { seasonLabel, cases },
    provenanceStatus: "SIMULATION_ONLY",
  };
};

/** Read-only coach-education and referee programmes with the season budgets that fund them. */
export const buildFederationDevelopmentProgrammes = (
  db: GameDatabase,
  federationId: EntityId,
): FederationDevelopmentProgrammes => {
  const repo = new FederationGovernanceRepository(db);
  const newestFirst = <T extends { startDate: string; id: string }>(a: T, b: T): number =>
    b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id);
  const budgets = repo.budgets(federationId).filter((budget) => PROGRAMME_BUDGET_CATEGORIES.includes(budget.category));
  const latest = budgets.map((budget) => budget.seasonLabel).sort().at(-1);
  return {
    coachEducation: repo
      .coachEducationProgrammes(federationId)
      .map((programme) => ({
        id: programme.id,
        kind: "COACH_EDUCATION" as const,
        label: programme.licenceLevel,
        startDate: programme.startDate,
        endDate: programme.endDate,
        capacity: programme.capacity,
        cost: programme.cost,
        currency: programme.currency,
        outcome: programme.graduates,
        outcomeLabel: "Graduates" as const,
        status: programme.status,
      }))
      .sort(newestFirst),
    referee: repo
      .refereeDevelopmentProgrammes(federationId)
      .map((programme) => ({
        id: programme.id,
        kind: "REFEREE" as const,
        label: programme.programmeType,
        startDate: programme.startDate,
        endDate: programme.endDate,
        capacity: programme.capacity,
        cost: programme.cost,
        currency: programme.currency,
        outcome: programme.refereesAdvanced,
        outcomeLabel: "Officials advanced" as const,
        status: programme.status,
      }))
      .sort(newestFirst),
    budgets: budgets
      .filter((budget) => budget.seasonLabel === latest && budget.status === "ACTIVE")
      .map((budget) => ({
        category: budget.category,
        seasonLabel: budget.seasonLabel,
        amount: budget.amount,
        usedAmount: budget.usedAmount,
        currency: budget.currency,
      }))
      .sort((a, b) => a.category.localeCompare(b.category)),
    provenanceStatus: "SIMULATION_ONLY",
  };
};
