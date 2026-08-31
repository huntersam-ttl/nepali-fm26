import {
  CareerWorldRepository,
  ClubEconomyRepository,
  CompetitionRepository,
  ManagerRepository,
  PlayerRepository,
  RecruitmentRepository,
  SquadDynamicsRepository,
  TransferMarketRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  ATTRIBUTE_GROUPS,
  createEntityId,
  createStableEntityId,
  type AttributeGroupView,
  type CalendarEntry,
  type CompetitionTableRow,
  type ManagerCompetitionView,
  type ContinueOutcome,
  type ContinueStopReason,
  type ContractList,
  type ContractRenewalCommand,
  type ContractRow,
  type CreateDevelopmentPlanCommand,
  type DevelopmentFocusType,
  type EntityId,
  type Fact,
  type FixtureDetail,
  type FixtureList,
  type FixtureRow,
  type IndividualDevelopmentPlan,
  type InjuryRecord,
  type ISODate,
  type KnowledgeRange,
  type ManagerDashboard,
  type ManagerPermission,
  type PlayerAttributeSet,
  type PlayerDevelopmentEntry,
  type PlayerDevelopmentView,
  type SquadAvailability,
  type PlayerKnowledgeLevel,
  type PlayerPosition,
  type PlayerProfile,
  type ProvenanceStatus,
  type QuickSimSummary,
  type RecruitmentRow,
  type RecruitmentSearchCommand,
  type RecruitmentSearchPage,
  type SaveMetadata,
  type ScoutingAssignmentCommand,
  type ScoutingDashboard,
  type ScoutingReportView,
  type SquadSelectionValidation,
  type ShortlistEntry,
  type SlotRoleFit,
  type SquadList,
  type SquadPlayerRow,
  type StaffList,
  type StaffRow,
  type TacticalSetup,
  type TacticsUpdateCommand,
  type TacticsView,
  type TrainingUpdateCommand,
  type TrainingView,
  type TransferBudgetView,
  type TransferCentre,
  type TransferListCommand,
  type TransferOfferCommand,
  type TransferOffer,
  type TransferOfferView,
  type TransferResponseCommand,
  type TransferRequestCommand,
  type TransferRequestResponseCommand,
  type TransferLoanCommand,
} from "@nepal-football-sim/shared-types";
import { initializeClubEconomyForSave } from "./club-economy.js";
import { activeConcernCount } from "./squad-dynamics.js";
import { medicalCentreReadModel } from "./medical.js";
import {
  createDefaultTrainingPlan,
  createInitialDevelopmentState,
  developmentPhaseForAge,
  simulateTrainingDay,
  trainingInjuryRiskSignal,
} from "./player-development.js";
import {
  addDaysISO,
  computeCongestionMultiplier,
  computeDevelopmentEnvironment,
  DEVELOPMENT_BLOCK_DAYS,
  daysSinceRecovery,
  ensureSensibleDevelopmentPlan,
  reviewDevelopmentPlanIfDue,
  trainingAvailabilityFor,
} from "./player-development-plans.js";
import { SeededRandom } from "./rng.js";
import {
  addPlayerToShortlist,
  createScoutingAssignment,
  generateScoutReport,
  removePlayerFromShortlist,
  searchPlayersForClub,
  simulateScoutingDay,
} from "./scouting.js";
import {
  FORMATION_PRESETS,
  ROLE_DEFINITIONS,
  TACTICAL_STYLE_PRESETS,
  calculateRoleFit,
  roleById,
  validateSelection,
} from "./tactics.js";
import {
  createTransferOffer,
  counterTransferOffer,
  evaluateTransferOffer,
  completePermanentTransfer,
  initializeTransferMarketForSave,
  negotiatePlayerContract,
  requestPlayerTransfer,
  respondToPlayerTransferRequest,
  startLoan,
} from "./transfer-market.js";
import type { ManagerContext } from "./desktop-application.js";

type SqlRow = Record<string, any>;

/** Thrown by manager commands; the application service maps these to AppResult. */
export class ManagerCommandError extends Error {
  constructor(
    readonly code:
      | "ROLE_NOT_AUTHORIZED"
      | "PLAYER_MISSING"
      | "FIXTURE_MISSING"
      | "INVALID_SELECTION"
      | "SIMULATION_ERROR",
    message: string,
  ) {
    super(message);
  }
}

const MANAGER_PERMISSIONS: readonly ManagerPermission[] = [
  "SELECT_SQUAD",
  "SET_TACTICS",
  "SET_TRAINING",
  "SCOUT_PLAYERS",
  "OFFER_TRANSFER",
  "NEGOTIATE_CONTRACT",
  "LIST_PLAYER",
  "MANAGE_STAFF",
];

/**
 * Every manager command runs through this. A manager may only act for the club
 * their active contract covers; club ownership, federation, and board finance
 * actions stay outside this permission set (see ADR-021).
 */
export const assertManagerAuthority = (
  context: ManagerContext,
  clubId?: EntityId,
  permission: ManagerPermission = "SELECT_SQUAD",
): void => {
  if (!MANAGER_PERMISSIONS.includes(permission)) {
    throw new ManagerCommandError("ROLE_NOT_AUTHORIZED", `Managers may not perform ${permission}.`);
  }
  if (!context.contract?.teamId) {
    throw new ManagerCommandError("ROLE_NOT_AUTHORIZED", "No active manager appointment.");
  }
  if (clubId && clubId !== context.club?.id) {
    throw new ManagerCommandError("ROLE_NOT_AUTHORIZED", "You do not manage that club.");
  }
};

/** Actions reserved for the chairman/owner. Manager mode must never run these. */
export const assertNotOwnerAction = (action: string): never => {
  throw new ManagerCommandError(
    "ROLE_NOT_AUTHORIZED",
    `${action} is a club ownership decision, not a manager decision.`,
  );
};

/**
 * Recruitment, transfer, economy, and training records are created on demand so
 * careers made before Manager mode existed pick them up on first use. Each
 * underlying initialiser is idempotent.
 */
export const ensureManagerSystems = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): void => {
  initializeTransferMarketForSave({
    db,
    worldDate: save.worldDate,
    seed: `${save.randomSeed}:market`,
  });
  initializeClubEconomyForSave({
    db,
    worldDate: save.worldDate,
    seed: `${save.randomSeed}:economy`,
  });
  if (!trainingPlanForTeam(db, context.team.id)) {
    new WorldRepository(db).insertTrainingPlan(
      createDefaultTrainingPlan(context.team.id, save.worldDate),
    );
  }
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const fact = <T>(value: T | undefined, status: ProvenanceStatus): Fact<T> =>
  value === undefined || value === null ? { status: "UNKNOWN" } : { value, status };

const ageOn = (dateOfBirth: string, onDate: string): number => {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  const date = new Date(`${onDate}T00:00:00Z`);
  let age = date.getUTCFullYear() - birth.getUTCFullYear();
  if (
    date.getUTCMonth() < birth.getUTCMonth() ||
    (date.getUTCMonth() === birth.getUTCMonth() && date.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
};

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const monthsBetween = (from: string, to: string): number => {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return Math.max(
    0,
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()),
  );
};

export const playerAbility = (player: PlayerAttributeSet): number => {
  const values = [
    ...Object.values(player.technical),
    ...Object.values(player.mental),
    ...Object.values(player.physical),
  ];
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10;
};

const abilityLabel = (ability: number): string => {
  if (ability >= 15) return "Very Good";
  if (ability >= 12.5) return "Good";
  if (ability >= 10) return "Adequate";
  if (ability >= 8) return "Limited";
  return "Weak";
};

const moraleLabel = (modifier: number): string => {
  if (modifier >= 15) return "Very Good";
  if (modifier >= 5) return "Good";
  if (modifier <= -15) return "Very Poor";
  if (modifier <= -5) return "Poor";
  return "Okay";
};

const availabilityOf = (raw?: string): SquadAvailability => {
  switch (raw) {
    case "INJURED":
      return "INJURED";
    case "SUSPENDED":
      return "SUSPENDED";
    case "INTERNATIONAL_DUTY":
      return "INTERNATIONAL_DUTY";
    case "UNAVAILABLE":
      return "UNAVAILABLE";
    default:
      return "AVAILABLE";
  }
};

const personRow = (db: GameDatabase, id: EntityId): SqlRow | undefined =>
  db.prepare("SELECT * FROM persons WHERE id = ?").get(id) as SqlRow | undefined;

const personName = (db: GameDatabase, id: EntityId): string => {
  const row = personRow(db, id);
  return (row?.display_name as string) ?? (row?.full_name as string) ?? "Unknown player";
};

const clubName = (db: GameDatabase, id?: EntityId): string | undefined => {
  if (!id) return undefined;
  const row = db.prepare("SELECT name FROM clubs WHERE id = ?").get(id) as SqlRow | undefined;
  return row?.name as string | undefined;
};

const teamName = (db: GameDatabase, id: EntityId): string => {
  const row = db.prepare("SELECT name FROM teams WHERE id = ?").get(id) as SqlRow | undefined;
  return (row?.name as string) ?? "Unknown team";
};

const playerNationality = (db: GameDatabase, playerId: EntityId): string | undefined => {
  const row = db.prepare("SELECT c.iso_code FROM persons p LEFT JOIN countries c ON c.id = p.nationality_country_id WHERE p.id = ?").get(playerId) as SqlRow | undefined;
  return row?.iso_code as string | undefined;
};

const simulationPhysicalFallbacks = (player: PlayerAttributeSet): { heightCm: number; preferredFoot: string } => {
  const heightByPosition: Record<string, number> = { GK: 185, CB: 182, LB: 176, RB: 176, DM: 178, CM: 177, AM: 175, LW: 174, RW: 174, ST: 180 };
  const last = player.personId.charCodeAt(player.personId.length - 1);
  return { heightCm: (heightByPosition[player.primaryPosition] ?? 177) + (last % 7) - 3, preferredFoot: last % 2 === 0 ? "Right" : "Left" };
};

const factualProfile = (db: GameDatabase, playerId: EntityId): SqlRow | undefined => {
  const row = db
    .prepare("SELECT * FROM player_factual_profiles WHERE player_id = ?")
    .get(playerId) as SqlRow | undefined;
  if (!row) return undefined;
  return {
    ...row,
    factual: JSON.parse(row.factual_json ?? "{}"),
    simulation: JSON.parse(row.simulation_json ?? "{}"),
  };
};

const seasonStats = (db: GameDatabase, teamId: EntityId): Map<EntityId, SqlRow> =>
  new Map(
    (db.prepare("SELECT * FROM player_season_stats WHERE team_id = ?").all(teamId) as SqlRow[]).map(
      (row) => [row.person_id as EntityId, row],
    ),
  );

const trainingPlanForTeam = (db: GameDatabase, teamId: EntityId): SqlRow | undefined =>
  db
    .prepare("SELECT * FROM training_plans WHERE team_id = ? ORDER BY effective_from DESC LIMIT 1")
    .get(teamId) as SqlRow | undefined;

const knowledgeMap = (db: GameDatabase, clubId?: EntityId): Map<EntityId, PlayerKnowledgeLevel> => {
  if (!clubId) return new Map();
  return new Map(
    new RecruitmentRepository(db)
      .playerKnowledgeForClub(clubId)
      .map((item) => [item.playerId, item.knowledgeLevel]),
  );
};

// ---------------------------------------------------------------------------
// Squad
// ---------------------------------------------------------------------------

export const buildSquadList = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): SquadList => {
  assertManagerAuthority(context);
  const players = new PlayerRepository(db);
  const attributes = players.attributesForTeam(context.team.id);
  const states = new Map(
    players.availabilityStates(context.team.id).map((state) => [state.personId, state]),
  );
  const stats = seasonStats(db, context.team.id);
  const market = new TransferMarketRepository(db);
  const contracts = new Map(
    market
      .activeContractsForClub(context.club?.id ?? ("" as EntityId), save.worldDate)
      .map((contract) => [contract.playerId, contract]),
  );
  const knowledge = knowledgeMap(db, context.club?.id);

  const rows = attributes.map((player) =>
    squadRow(db, save, player, {
      state: states.get(player.personId),
      stat: stats.get(player.personId),
      contract: contracts.get(player.personId),
      transferStatus: market.transferStatus(player.personId)?.status,
      knowledge: knowledge.get(player.personId) ?? "EXTENSIVE",
    }),
  );

  const availabilityCounts: Record<SquadAvailability, number> = {
    AVAILABLE: 0,
    INJURED: 0,
    SUSPENDED: 0,
    INTERNATIONAL_DUTY: 0,
    UNAVAILABLE: 0,
  };
  for (const row of rows) availabilityCounts[row.availability] += 1;

  return {
    teamId: context.team.id,
    teamName: context.team.name,
    clubName: context.club?.name,
    players: rows.sort((a, b) => b.ability - a.ability),
    positionOptions: [...new Set(rows.map((row) => row.primaryPosition))].sort(),
    availabilityCounts,
  };
};

const squadRow = (
  db: GameDatabase,
  save: SaveMetadata,
  player: PlayerAttributeSet,
  extra: {
    state?: { fitness: number; moraleModifier: number; formModifier: number; availability: string };
    stat?: SqlRow;
    contract?: { endDate: ISODate; salary: number; squadRole: string };
    transferStatus?: string;
    knowledge: PlayerKnowledgeLevel;
  },
): SquadPlayerRow => {
  const person = personRow(db, player.personId);
  const profile = factualProfile(db, player.personId);
  const ability = playerAbility(player);
  const dob = (person?.date_of_birth as string | undefined) ?? profile?.factual?.dateOfBirth ?? profile?.simulation?.simulationDateOfBirth;
  return {
    personId: player.personId,
    name: (person?.display_name as string) ?? (person?.full_name as string) ?? "Unknown",
    age: dob ? fact(ageOn(dob, save.worldDate), profile?.factual?.dateOfBirth || person?.date_of_birth ? "REPORTED" : "SIMULATION_ONLY") : { status: "UNKNOWN" },
    nationality: (profile?.factual?.nationality as string) ?? (profile?.simulation?.simulationNationality as string) ?? playerNationality(db, player.personId) ?? "NEP",
    primaryPosition: player.primaryPosition,
    positions: [player.primaryPosition, ...player.secondaryPositions],
    squadStatus: (profile?.factual?.squadStatus as string) ?? "UNKNOWN",
    availability: availabilityOf(extra.state?.availability),
    fitness: Math.round(extra.state?.fitness ?? 85),
    condition: Math.round(extra.state?.fitness ?? 85),
    morale: moraleLabel(extra.state?.moraleModifier ?? 0),
    form: Math.round(extra.state?.formModifier ?? 0),
    appearances: (extra.stat?.appearances as number) ?? 0,
    starts: (extra.stat?.starts as number) ?? (extra.stat?.appearances as number) ?? 0,
    minutes: (extra.stat?.minutes as number) ?? 0,
    goals: (extra.stat?.goals as number) ?? 0,
    assists: (extra.stat?.assists as number) ?? 0,
    yellowCards: (extra.stat?.yellow_cards as number) ?? 0,
    redCards: (extra.stat?.red_cards as number) ?? 0,
    contractExpiry: extra.contract?.endDate,
    salary: extra.contract?.salary,
    squadRole: extra.contract?.squadRole,
    transferStatus: extra.transferStatus,
    knowledge: extra.knowledge,
    ability,
    abilityLabel: abilityLabel(ability),
  };
};

// ---------------------------------------------------------------------------
// Player profile
// ---------------------------------------------------------------------------

const attributeGroups = (player: PlayerAttributeSet): AttributeGroupView[] =>
  ATTRIBUTE_GROUPS.map(({ group, source }) => ({
    group,
    attributes: Object.entries(player[source]).map(([key, value]) => ({
      key,
      label: key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (character) => character.toUpperCase())
        .trim(),
      value: value as number,
    })),
  }));

const potentialBandFor = (ceiling: number): string => {
  if (ceiling >= 16) return "Elite potential";
  if (ceiling >= 13.5) return "High potential";
  if (ceiling >= 11) return "Solid potential";
  if (ceiling >= 9) return "Modest potential";
  return "Limited potential";
};

export const buildPlayerProfile = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  playerId: EntityId,
): PlayerProfile => {
  assertManagerAuthority(context);
  const players = new PlayerRepository(db);
  const attributes = players.getAttributes(playerId);
  if (!attributes) throw new ManagerCommandError("PLAYER_MISSING", `Unknown player ${playerId}.`);
  const person = personRow(db, playerId);
  const profile = factualProfile(db, playerId);
  const factual = profile?.factual ?? {};
  const simulation = profile?.simulation ?? {};
  const ownSquad = players
    .attributesForTeam(context.team.id)
    .some((candidate) => candidate.personId === playerId);

  const state = players
    .availabilityStates(context.team.id)
    .find((candidate) => candidate.personId === playerId);
  const stat = seasonStats(db, context.team.id).get(playerId);
  const contract = new TransferMarketRepository(db).activeContract(playerId, save.worldDate);
  const development = players.developmentState(playerId);
  const potential = players.potential(playerId);
  const knowledge =
    knowledgeMap(db, context.club?.id).get(playerId) ?? (ownSquad ? "EXTENSIVE" : "NONE");

  const factualDob = (person?.date_of_birth as string | undefined) ?? factual.dateOfBirth;
  const simulationDob = simulation.dateOfBirth as string | undefined;
  const dobFact: Fact<ISODate> = factualDob
    ? fact(factualDob as ISODate, "REPORTED")
    : simulationDob
      ? fact(simulationDob as ISODate, "SIMULATION_ONLY")
      : { status: "UNKNOWN" };
  const ability = playerAbility(attributes);
  const physicalFallbacks = simulationPhysicalFallbacks(attributes);

  return {
    personId: playerId,
    name: (person?.display_name as string) ?? (person?.full_name as string) ?? "Unknown",
    fullName: (person?.full_name as string) ?? "Unknown",
    dateOfBirth: dobFact,
    age:
      dobFact.value !== undefined
        ? { value: ageOn(dobFact.value, save.worldDate), status: dobFact.status }
        : { status: "UNKNOWN" },
    nationality: factual.nationality ? fact(factual.nationality as string, "REPORTED") : fact((simulation.simulationNationality as string | undefined) ?? playerNationality(db, playerId) ?? "NEP", "SIMULATION_ONLY"),
    heightCm: factual.heightCm
      ? fact(factual.heightCm as number, "REPORTED")
      : fact((simulation.heightCm as number | undefined) ?? physicalFallbacks.heightCm, "SIMULATION_ONLY"),
    preferredFoot: factual.preferredFoot
      ? fact(factual.preferredFoot as string, "REPORTED")
      : fact((simulation.preferredFoot as string | undefined) ?? physicalFallbacks.preferredFoot, "SIMULATION_ONLY"),
    primaryPosition: attributes.primaryPosition,
    secondaryPositions: attributes.secondaryPositions,
    clubName: clubName(db, (profile?.current_club_id as EntityId) ?? context.club?.id),
    squadStatus: (factual.squadStatus as string) ?? "UNKNOWN",
    availability: availabilityOf(state?.availability),
    attributeProvenance: "SIMULATION_ONLY",
    attributeGroups: attributeGroups(attributes),
    ability,
    abilityLabel: abilityLabel(ability),
    form: Math.round(state?.formModifier ?? 0),
    fitness: Math.round(state?.fitness ?? 85),
    condition: Math.round(development?.fitness ?? state?.fitness ?? 85),
    morale: moraleLabel(state?.moraleModifier ?? 0),
    contract: contract
      ? {
          salary: contract.salary,
          currency: contract.currency,
          startDate: contract.startDate,
          endDate: contract.endDate,
          squadRole: contract.squadRole,
          status: contract.status,
          releaseClause: contract.releaseClause,
        }
      : undefined,
    development: development
      ? {
          phase: development.developmentPhase,
          momentum: development.developmentMomentum,
          matchSharpness: development.matchSharpness,
          fatigue: development.fatigue,
          recovery: development.recovery,
          // Banded even for own players: the exact ceiling stays hidden.
          potentialBand: potential ? potentialBandFor(potential.potentialCeiling) : "Unassessed",
          lastUpdated: development.lastDevelopmentUpdate,
        }
      : undefined,
    season: {
      appearances: (stat?.appearances as number) ?? 0,
      starts: (stat?.starts as number) ?? (stat?.appearances as number) ?? 0,
      minutes: (stat?.minutes as number) ?? 0,
      goals: (stat?.goals as number) ?? 0,
      assists: (stat?.assists as number) ?? 0,
      yellowCards: (stat?.yellow_cards as number) ?? 0,
      redCards: (stat?.red_cards as number) ?? 0,
      averageRating: (stat?.average_rating as number) ?? 0,
    },
    knowledge,
    scoutingSummary: ownSquad ? undefined : buildScoutingReport(db, save, context, playerId, false),
  };
};

// ---------------------------------------------------------------------------
// Tactics
// ---------------------------------------------------------------------------

const activeSetup = (db: GameDatabase, context: ManagerContext): TacticalSetup => {
  const setups = new ManagerRepository(db).tacticalSetups(context.team.id);
  const setup = setups[0];
  if (!setup) {
    throw new ManagerCommandError("INVALID_SELECTION", "No tactical setup exists for this team.");
  }
  return setup;
};

const roleFits = (
  db: GameDatabase,
  setup: TacticalSetup,
  players: readonly PlayerAttributeSet[],
): SlotRoleFit[] =>
  setup.assignments.flatMap((assignment) => {
    const slot = setup.formation.slots.find((candidate) => candidate.id === assignment.slotId);
    if (!slot) return [];
    const player = players.find((candidate) => candidate.personId === assignment.playerId);
    if (!player) {
      return [
        {
          slotId: assignment.slotId,
          roleId: assignment.roleId,
          overall: 0,
          label: "Empty",
          positionFit: 0,
          attributeFit: 0,
          familiarity: 0,
        },
      ];
    }
    const fit = calculateRoleFit({
      player,
      slot,
      role: roleById(assignment.roleId),
      familiarity: setup.familiarity.roles,
    });
    return [
      {
        slotId: assignment.slotId,
        playerId: player.personId,
        playerName: personName(db, player.personId),
        roleId: assignment.roleId,
        overall: fit.overall,
        label: fit.label,
        positionFit: fit.positionFit,
        attributeFit: fit.attributeFit,
        familiarity: fit.familiarity,
      },
    ];
  });

/**
 * Availability warnings are surfaced but never block selection — the engine
 * allows a manager to field a poor or risky side if they choose to.
 */
const availabilityWarnings = (setup: TacticalSetup, squad: SquadPlayerRow[]): string[] => {
  const selected = new Set(
    setup.assignments.flatMap((assignment) => (assignment.playerId ? [assignment.playerId] : [])),
  );
  return squad
    .filter((player) => selected.has(player.personId) && player.availability !== "AVAILABLE")
    .map((player) => `${player.name} is ${player.availability.toLowerCase().replace("_", " ")}.`);
};

export const buildTacticsView = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): TacticsView => {
  assertManagerAuthority(context, undefined, "SET_TACTICS");
  const setup = activeSetup(db, context);
  const players = new PlayerRepository(db).attributesForTeam(context.team.id);
  const squad = buildSquadList(db, save, context);
  const validation = validateSelection({ setup, players, playerName: (id) => personName(db, id) });
  const starters = new Set(
    setup.assignments.flatMap((assignment) => (assignment.playerId ? [assignment.playerId] : [])),
  );
  return {
    setup,
    formations: FORMATION_PRESETS.map((formation) => ({
      id: formation.id,
      name: formation.name,
      slots: formation.slots.map((slot) => ({
        id: slot.id,
        label: slot.label ?? slot.id,
        position: slot.position,
        x: slot.x,
        y: slot.y,
        zone: slot.zone,
      })),
    })),
    roles: ROLE_DEFINITIONS.map((role) => ({
      id: role.id,
      name: role.name,
      family: role.family,
      zones: [...role.preferredZones],
    })),
    styles: Object.keys(TACTICAL_STYLE_PRESETS),
    mentalities: [
      "VERY_DEFENSIVE",
      "DEFENSIVE",
      "CAUTIOUS",
      "BALANCED",
      "POSITIVE",
      "ATTACKING",
      "VERY_ATTACKING",
    ],
    familiarity: setup.familiarity,
    roleFits: roleFits(db, setup, players),
    benchCandidates: squad.players.filter((player) => !starters.has(player.personId)),
    validation: {
      isValid: validation.isValid,
      blockingErrors: validation.blockingErrors,
      warnings: [...validation.warnings, ...availabilityWarnings(setup, squad.players)],
    } satisfies SquadSelectionValidation,
  };
};

export const applyTacticsUpdate = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  command: TacticsUpdateCommand,
): TacticalSetup => {
  assertManagerAuthority(context, undefined, "SET_TACTICS");
  const current = activeSetup(db, context);
  const formation =
    command.formationId && command.formationId !== current.formation.id
      ? FORMATION_PRESETS.find((candidate) => candidate.id === command.formationId)
      : undefined;

  // Changing formation remaps by slot order so the manager keeps their XI.
  const assignments =
    command.assignments ??
    (formation
      ? formation.slots.map((slot, index) => ({
          slotId: slot.id,
          playerId: current.assignments[index]?.playerId,
          roleId: defaultRoleForSlot(slot.position, slot.zone),
        }))
      : current.assignments);

  const next: TacticalSetup = {
    ...current,
    name: command.name ?? current.name,
    formation: formation ?? current.formation,
    style: (command.style as TacticalSetup["style"]) ?? current.style,
    instructions:
      command.instructions ??
      (command.style
        ? TACTICAL_STYLE_PRESETS[command.style as keyof typeof TACTICAL_STYLE_PRESETS]
        : current.instructions),
    assignments,
    bench: command.bench ?? current.bench,
    setPieces: command.setPieces ?? current.setPieces,
    updatedOn: save.worldDate,
  };

  const players = new PlayerRepository(db).attributesForTeam(context.team.id);
  const validation = validateSelection({ setup: next, players });
  if (!validation.isValid) {
    throw new ManagerCommandError("INVALID_SELECTION", validation.blockingErrors.join(" "));
  }
  new ManagerRepository(db).insertTacticalSetup(next);
  return next;
};

const defaultRoleForSlot = (position: string, zone: string): string => {
  if (position === "GK") return "GOALKEEPER";
  if (zone === "forward") return "PRESSING_FORWARD";
  if (zone === "defense") return "BALL_PLAYING_DEFENDER";
  if (zone === "attackingMidfield") return "ADVANCED_PLAYMAKER";
  return "CENTRAL_MIDFIELDER";
};

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

const mapTrainingPlan = (row: SqlRow) => ({
  id: row.id as EntityId,
  teamId: row.team_id as EntityId,
  name: row.name as string,
  effectiveFrom: row.effective_from as ISODate,
  effectiveTo: (row.effective_to ?? undefined) as ISODate | undefined,
  intensity: row.intensity as TrainingView["plan"]["intensity"],
  sessions: JSON.parse(row.sessions_json ?? "[]"),
  source: row.source as TrainingView["plan"]["source"],
});

export const buildTrainingView = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): TrainingView => {
  assertManagerAuthority(context, undefined, "SET_TRAINING");
  const row = trainingPlanForTeam(db, context.team.id);
  const plan = row
    ? mapTrainingPlan(row)
    : createDefaultTrainingPlan(context.team.id, save.worldDate);
  const players = new PlayerRepository(db);
  const facility = db
    .prepare("SELECT * FROM training_facility_profiles WHERE club_id = ?")
    .get(context.club?.id ?? "") as SqlRow | undefined;

  return {
    plan,
    intensityOptions: ["LOW", "NORMAL", "HIGH", "VERY_HIGH"],
    categoryOptions: [
      "RECOVERY",
      "FITNESS",
      "ENDURANCE",
      "STRENGTH",
      "SPEED",
      "TECHNICAL_GENERAL",
      "PASSING",
      "FINISHING",
      "DEFENDING",
      "TACTICAL_GENERAL",
      "MATCH_PREPARATION",
      "SET_PIECES",
      "REST",
    ],
    groupOptions: ["FULL_SQUAD", "GOALKEEPERS", "DEFENDERS", "MIDFIELDERS", "ATTACKERS", "YOUTH"],
    dayOptions: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
    squadDevelopment: players.attributesForTeam(context.team.id).map((player) => {
      const state = players.developmentState(player.personId);
      const activePlan = new WorldRepository(db).activeIndividualDevelopmentPlan(player.personId);
      return {
        personId: player.personId,
        name: personName(db, player.personId),
        phase: state?.developmentPhase ?? "UNKNOWN",
        momentum: state?.developmentMomentum ?? 0,
        fitness: Math.round(state?.fitness ?? 85),
        fatigue: Math.round(state?.fatigue ?? 0),
        matchSharpness: Math.round(state?.matchSharpness ?? 0),
        focus: activePlan?.focusType,
      };
    }),
    facility: facility
      ? {
          trainingQuality: facility.training_facility_quality ?? undefined,
          youthQuality: facility.youth_facility_quality ?? undefined,
          medicalQuality: facility.medical_facility_quality ?? undefined,
        }
      : undefined,
  };
};

export const applyTrainingUpdate = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  command: TrainingUpdateCommand,
): TrainingView["plan"] => {
  assertManagerAuthority(context, undefined, "SET_TRAINING");
  const current = buildTrainingView(db, save, context).plan;
  const plan = {
    ...current,
    // A manager edit takes ownership of the plan away from the default.
    id: createStableEntityId("training-plan", `${context.team.id}:${save.worldDate}:user`),
    name: command.name ?? current.name,
    intensity: command.intensity ?? current.intensity,
    effectiveFrom: save.worldDate,
    source: "USER" as const,
    sessions: (command.sessions ?? current.sessions) as typeof current.sessions,
  };
  new WorldRepository(db).insertTrainingPlan(plan);
  return plan;
};

// ---------------------------------------------------------------------------
// Fixtures and competition
// ---------------------------------------------------------------------------

const venueForFixture = (db: GameDatabase, fixture: SqlRow): string | undefined => {
  const row = db
    .prepare(
      `SELECT v.name FROM venue_relationships vr
       JOIN venues v ON v.id = vr.venue_id
       JOIN teams t ON t.club_id = vr.club_id OR t.id = vr.team_id
       WHERE t.id = ?
         AND vr.relationship_type IN ('HOME_GROUND', 'OPERATOR', 'PRIMARY_USER', 'TEMPORARY_USER')
         AND vr.status != 'UNKNOWN'
       ORDER BY vr.relationship_type
       LIMIT 1`,
    )
    .get(fixture.home_team_id) as SqlRow | undefined;
  if (row?.name) return row.name as string;
  const fallback = db
    .prepare("SELECT c.name FROM teams t JOIN clubs c ON c.id = t.club_id WHERE t.id = ?")
    .get(fixture.home_team_id) as SqlRow | undefined;
  return fallback?.name ? `${fallback.name} Ground` : "Home ground (simulated)";
};

const fixtureRow = (
  db: GameDatabase,
  context: ManagerContext,
  fixture: {
    id: EntityId;
    homeTeamId: EntityId;
    awayTeamId: EntityId;
    scheduledDate: string;
    status: string;
  },
): FixtureRow => {
  const isHome = fixture.homeTeamId === context.team.id;
  const opponentId = isHome ? fixture.awayTeamId : fixture.homeTeamId;
  const match = db.prepare("SELECT * FROM matches WHERE fixture_id = ? LIMIT 1").get(fixture.id) as
    SqlRow | undefined;
  const homeGoals = match?.home_goals as number | undefined;
  const awayGoals = match?.away_goals as number | undefined;
  const own = isHome ? homeGoals : awayGoals;
  const other = isHome ? awayGoals : homeGoals;
  return {
    id: fixture.id,
    date: fixture.scheduledDate as ISODate,
    competition: context.season.name,
    opponent: teamName(db, opponentId),
    opponentId,
    homeAway: isHome ? "home" : "away",
    venue: venueForFixture(db, { home_team_id: fixture.homeTeamId }),
    status: fixture.status,
    score: match ? `${homeGoals}-${awayGoals}` : undefined,
    result:
      own === undefined || other === undefined
        ? undefined
        : own > other
          ? "W"
          : own === other
            ? "D"
            : "L",
  };
};

const managerFixtures = (db: GameDatabase, context: ManagerContext): FixtureRow[] =>
  context.fixtures
    .filter(
      (fixture) => fixture.homeTeamId === context.team.id || fixture.awayTeamId === context.team.id,
    )
    .map((fixture) => fixtureRow(db, context, fixture))
    .sort((a, b) => a.date.localeCompare(b.date));

export const buildFixtureList = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): FixtureList => {
  assertManagerAuthority(context);
  const rows = managerFixtures(db, context);
  return {
    upcoming: rows.filter((row) => row.status === "scheduled"),
    results: rows.filter((row) => row.status === "played").reverse(),
    competitions: [...new Set(rows.map((row) => row.competition))],
    worldDate: save.worldDate,
  };
};

const formStrings = (rows: FixtureRow[], limit = 5): string[] =>
  rows
    .filter((row) => row.result)
    .slice(-limit)
    .map((row) => row.result!);

export const buildFixtureDetail = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  fixtureId: EntityId,
): FixtureDetail => {
  assertManagerAuthority(context);
  const rows = managerFixtures(db, context);
  const fixture = rows.find((row) => row.id === fixtureId);
  if (!fixture) throw new ManagerCommandError("FIXTURE_MISSING", `Unknown fixture ${fixtureId}.`);

  const squad = buildSquadList(db, save, context);
  const setup = activeSetup(db, context);
  const players = new PlayerRepository(db).attributesForTeam(context.team.id);
  const validation = validateSelection({ setup, players });

  const opponentResults = context.fixtures
    .filter(
      (candidate) =>
        candidate.status === "played" &&
        (candidate.homeTeamId === fixture.opponentId ||
          candidate.awayTeamId === fixture.opponentId),
    )
    .map((candidate) => {
      const match = db
        .prepare("SELECT * FROM matches WHERE fixture_id = ? LIMIT 1")
        .get(candidate.id) as SqlRow | undefined;
      if (!match) return undefined;
      const isHome = candidate.homeTeamId === fixture.opponentId;
      const own = isHome ? match.home_goals : match.away_goals;
      const other = isHome ? match.away_goals : match.home_goals;
      return (own > other ? "W" : own === other ? "D" : "L") as "W" | "D" | "L";
    })
    .filter((value): value is "W" | "D" | "L" => Boolean(value));

  return {
    fixture,
    ownForm: formStrings(rows),
    opponentForm: opponentResults.slice(-5),
    previousMeetings: rows
      .filter((row) => row.opponentId === fixture.opponentId && row.score)
      .map((row) => ({ date: row.date, score: row.score!, competition: row.competition })),
    availableCount: squad.availabilityCounts.AVAILABLE,
    unavailable: squad.players.filter((player) => player.availability !== "AVAILABLE"),
    selectionValid: validation.isValid,
    warnings: [...validation.warnings, ...availabilityWarnings(setup, squad.players)],
    selectedXI: setup.assignments.map((assignment) => ({
      slotId: assignment.slotId,
      playerName: assignment.playerId ? personName(db, assignment.playerId) : undefined,
      roleId: assignment.roleId,
    })),
    bench: setup.bench.map((id) => personName(db, id)),
  };
};

export const buildCompetitionView = (
  db: GameDatabase,
  _save: SaveMetadata,
  context: ManagerContext,
): ManagerCompetitionView => {
  assertManagerAuthority(context);
  const standings = new CompetitionRepository(db).standings(context.season.id);
  const table: CompetitionTableRow[] = (
    standings.length
      ? standings
      : context.teams.map((team) => ({
          competitionSeasonId: context.season.id,
          teamId: team.id,
          played: 0,
          won: 0,
          drawn: 0,
          lost: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDifference: 0,
          points: 0,
        }))
  ).map((standing, index) => ({
    position: index + 1,
    teamId: standing.teamId,
    teamName: teamName(db, standing.teamId),
    played: standing.played,
    won: standing.won,
    drawn: standing.drawn,
    lost: standing.lost,
    goalsFor: standing.goalsFor,
    goalsAgainst: standing.goalsAgainst,
    goalDifference: standing.goalDifference,
    points: standing.points,
    isManagerTeam: standing.teamId === context.team.id,
  }));

  const scorers = (
    db
      .prepare(
        `SELECT person_id, team_id, SUM(goals) AS goals FROM player_season_stats
         GROUP BY person_id, team_id HAVING goals > 0 ORDER BY goals DESC LIMIT 10`,
      )
      .all() as SqlRow[]
  ).map((row) => ({
    personId: row.person_id as EntityId,
    name: personName(db, row.person_id as EntityId),
    teamName: teamName(db, row.team_id as EntityId),
    goals: row.goals as number,
  }));

  return {
    seasonName: context.season.name,
    competitionName: context.season.name,
    table,
    topScorers: scorers,
    managerPosition: table.find((row) => row.isManagerTeam)?.position,
    form: formStrings(managerFixtures(db, context)),
  };
};

// ---------------------------------------------------------------------------
// Scouting
//
// Nothing in this section may return `currentAbility` or `potentialAbility`.
// Everything the manager learns about an outside player comes from
// PlayerKnowledge/ScoutReport, which band and decay the underlying truth.
// ---------------------------------------------------------------------------

const shortlistIds = (db: GameDatabase, clubId?: EntityId): Set<EntityId> =>
  new Set(
    clubId ? new RecruitmentRepository(db).shortlist(clubId).map((item) => item.playerId) : [],
  );

export const buildScoutingReport = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  playerId: EntityId,
  persist = true,
): ScoutingReportView => {
  assertManagerAuthority(context, undefined, "SCOUT_PLAYERS");
  const clubId = context.club?.id;
  if (!clubId) throw new ManagerCommandError("ROLE_NOT_AUTHORIZED", "Manager has no club.");
  const report = generateScoutReport(
    db,
    clubId,
    playerId,
    save.worldDate,
    `${save.randomSeed}:report:${playerId}`,
  );
  if (persist) new RecruitmentRepository(db).insertScoutReport(report);
  return {
    playerId,
    playerName: personName(db, playerId),
    estimatedAbility: report.estimatedAbilityBand as KnowledgeRange,
    estimatedPotentialBand: report.estimatedPotentialBand,
    confidence: report.confidence,
    observations: report.observations,
    strengths: report.strengths,
    weaknesses: report.weaknesses,
    positionAssessment: report.positionAssessment,
    roleAssessment: report.roleAssessment,
    recommendation: report.recommendation,
    generatedAt: report.generatedAt,
    scoutName: report.scoutId ? personName(db, report.scoutId) : undefined,
  };
};

export const buildScoutingDashboard = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): ScoutingDashboard => {
  assertManagerAuthority(context, undefined, "SCOUT_PLAYERS");
  const clubId = context.club?.id;
  if (!clubId) throw new ManagerCommandError("ROLE_NOT_AUTHORIZED", "Manager has no club.");
  const recruitment = new RecruitmentRepository(db);
  const knowledge = recruitment.playerKnowledgeForClub(clubId);
  const totalPlayers = (
    db.prepare("SELECT COUNT(*) AS total FROM player_attributes").get() as SqlRow
  ).total as number;
  const known = knowledge.filter((item) =>
    ["GOOD", "EXTENSIVE", "COMPLETE"].includes(item.knowledgeLevel),
  ).length;
  const discovered = knowledge.filter((item) =>
    ["MINIMAL", "BASIC"].includes(item.knowledgeLevel),
  ).length;

  const assignments = (
    db
      .prepare("SELECT * FROM scouting_assignments WHERE club_id = ? ORDER BY started_at DESC")
      .all(clubId) as SqlRow[]
  ).map((row) => ({
    id: row.id as EntityId,
    assignmentType: row.assignment_type as string,
    targetName: row.target_player_id
      ? personName(db, row.target_player_id as EntityId)
      : row.target_club_id
        ? (clubName(db, row.target_club_id as EntityId) ?? "Club")
        : "Region",
    status: row.status as string,
    priority: row.priority as string,
    startedAt: row.started_at as ISODate,
    expectedCompletionAt: row.expected_completion_at as ISODate,
  }));

  const reports = (
    db
      .prepare(
        "SELECT * FROM scout_reports WHERE observer_club_id = ? ORDER BY generated_at DESC LIMIT 10",
      )
      .all(clubId) as SqlRow[]
  ).map((row) => ({
    playerId: row.player_id as EntityId,
    playerName: personName(db, row.player_id as EntityId),
    estimatedAbility: JSON.parse(row.estimated_ability_json ?? "null") as KnowledgeRange,
    estimatedPotentialBand: row.estimated_potential_band as string,
    confidence: row.confidence,
    observations: row.observations as number,
    strengths: JSON.parse(row.strengths_json ?? "[]"),
    weaknesses: JSON.parse(row.weaknesses_json ?? "[]"),
    positionAssessment: row.position_assessment as string,
    roleAssessment: row.role_assessment as string,
    recommendation: row.recommendation as string,
    generatedAt: row.generated_at as ISODate,
  }));

  const knowledgeLevels = knowledgeMap(db, clubId);
  const shortlist: ShortlistEntry[] = recruitment.shortlist(clubId).map((item) => {
    const record = recruitment.playerKnowledge(clubId, item.playerId);
    return {
      playerId: item.playerId,
      playerName: personName(db, item.playerId),
      clubName: clubName(db, factualProfile(db, item.playerId)?.current_club_id as EntityId),
      priority: item.priority,
      addedAt: item.addedAt,
      scoutingStatus: item.scoutingStatus,
      knowledge: knowledgeLevels.get(item.playerId) ?? "NONE",
      estimatedAbility: record?.abilityKnowledge.estimatedAbility as KnowledgeRange | undefined,
    };
  });

  return {
    coverage: {
      knownPlayers: known,
      discoveredPlayers: discovered,
      unknownPlayers: Math.max(0, totalPlayers - known - discovered),
      totalPlayers,
    },
    assignments,
    recentReports: reports,
    shortlist,
  };
};

export const createManagerScoutingAssignment = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  command: ScoutingAssignmentCommand,
): ScoutingDashboard => {
  assertManagerAuthority(context, undefined, "SCOUT_PLAYERS");
  const clubId = context.club?.id;
  if (!clubId) throw new ManagerCommandError("ROLE_NOT_AUTHORIZED", "Manager has no club.");
  if (!command.targetPlayerId && !command.targetClubId && !command.targetCompetitionId) {
    throw new ManagerCommandError(
      "INVALID_SELECTION",
      "A scouting assignment needs a player, club, or competition target.",
    );
  }
  createScoutingAssignment(db, {
    clubId,
    targetPlayerId: command.targetPlayerId,
    targetClubId: command.targetClubId,
    targetCompetitionId: command.targetCompetitionId,
    startedAt: save.worldDate,
    priority: command.priority,
  });
  return buildScoutingDashboard(db, save, context);
};

export const toggleManagerShortlist = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  playerId: EntityId,
): ScoutingDashboard => {
  assertManagerAuthority(context, undefined, "SCOUT_PLAYERS");
  const clubId = context.club?.id;
  if (!clubId) throw new ManagerCommandError("ROLE_NOT_AUTHORIZED", "Manager has no club.");
  if (shortlistIds(db, clubId).has(playerId)) {
    removePlayerFromShortlist(db, clubId, playerId);
  } else {
    addPlayerToShortlist(db, {
      clubId,
      playerId,
      addedAt: save.worldDate,
      priority: "INTERESTED",
    });
  }
  return buildScoutingDashboard(db, save, context);
};

export const searchManagerRecruitment = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  command: RecruitmentSearchCommand,
): RecruitmentSearchPage => {
  assertManagerAuthority(context, undefined, "SCOUT_PLAYERS");
  const clubId = context.club?.id;
  if (!clubId) throw new ManagerCommandError("ROLE_NOT_AUTHORIZED", "Manager has no club.");
  const page = Math.max(0, command.page ?? 0);
  const pageSize = Math.min(100, Math.max(5, command.pageSize ?? 25));
  const shortlisted = shortlistIds(db, clubId);

  const results = searchPlayersForClub(
    db,
    clubId,
    {
      position: command.position,
      ageMin: command.ageMin,
      ageMax: command.ageMax,
      clubId: command.clubId,
      estimatedAbilityMin: command.estimatedAbilityMin,
    },
    save.worldDate,
  ).filter((result) =>
    command.query ? (result.name ?? "").toLowerCase().includes(command.query.toLowerCase()) : true,
  );

  const rows: RecruitmentRow[] = results
    .slice(page * pageSize, page * pageSize + pageSize)
    .map((result) => ({
      playerId: result.playerId,
      name: result.name,
      clubName: clubName(db, result.clubId),
      discoveryStatus: result.discoveryStatus,
      knowledge: result.knowledgeLevel,
      confidence: result.confidence,
      knownPosition: result.knownPosition,
      positionGroup: result.publicPositionGroup,
      estimatedAbility: result.estimatedAbility,
      estimatedPotential: result.estimatedPotential,
      shortlisted: shortlisted.has(result.playerId),
    }));

  return { rows, page, pageSize, total: results.length };
};

// ---------------------------------------------------------------------------
// Transfers and contracts
// ---------------------------------------------------------------------------

const budgetView = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): TransferBudgetView => {
  const clubId = context.club?.id;
  const economy = new ClubEconomyRepository(db);
  const budgets = clubId ? economy.budgets(clubId) : [];
  const transferBudget = budgets.find((budget) => budget.category === "TRANSFER_BUDGET");
  const wageBudget = budgets.find((budget) => budget.category === "WAGE_BUDGET");
  const financial = clubId
    ? new TransferMarketRepository(db).clubFinancialProfile(clubId)
    : undefined;
  const allocatedTransfer = transferBudget?.amount ?? financial?.transferBudget ?? 0;
  const usedTransfer = transferBudget?.usedAmount ?? 0;
  const allocatedWage = wageBudget?.amount ?? financial?.wageBudget ?? 0;
  const committed = financial?.currentWageSpend ?? 0;
  return {
    transferBudget: allocatedTransfer,
    transferSpent: usedTransfer,
    transferRemaining: Math.max(0, allocatedTransfer - usedTransfer),
    wageBudget: allocatedWage,
    committedWages: committed,
    wageRemaining: Math.max(0, allocatedWage - committed),
    currency: financial?.currency ?? "NPR",
  };
};

const offerView = (
  db: GameDatabase,
  context: ManagerContext,
  offer: TransferOffer,
): TransferOfferView => {
  const outgoing = offer.sellingClubId === context.club?.id;
  return {
    id: offer.id,
    playerId: offer.playerId,
    playerName: personName(db, offer.playerId),
    direction: outgoing ? "OUTGOING" : "INCOMING",
    otherClubName: clubName(db, outgoing ? offer.buyingClubId : offer.sellingClubId),
    offerType: offer.offerType,
    transferFee: offer.transferFee,
    installments: offer.installments,
    addOns: offer.addOns,
    sellOnPercentage: offer.sellOnPercentage,
    askingRange: offer.askingRange,
    agentFee: offer.agentFee,
    signingFee: offer.signingFee,
    agentContact: new TransferMarketRepository(db).agentForPlayer(offer.playerId)
      ? "AGENT"
      : "SELF_REPRESENTED",
    conditionals: offer.conditionals ?? [],
    playerExchanges: (offer.playerExchanges ?? []).map((exchange) => ({
      playerId: exchange.playerId,
      playerName: personName(db, exchange.playerId),
      valuation: exchange.valuation,
      requestedBy: exchange.requestedBy,
    })),
    sellerRequestedPlayerId: offer.sellerRequestedPlayerId,
    currency: offer.currency,
    status: offer.status,
    submittedAt: offer.submittedAt,
    expiresAt: offer.expiresAt,
    negotiation: new TransferMarketRepository(db).negotiationRounds(offer.id).map((round) => ({
      round: round.roundNumber,
      actor: round.actor,
      action: round.action,
      message: round.message ?? "",
    })),
  };
};

export const buildTransferCentre = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): TransferCentre => {
  assertManagerAuthority(context, undefined, "OFFER_TRANSFER");
  const clubId = context.club?.id;
  const market = new TransferMarketRepository(db);
  const offers = market.transferOffers().filter(
    (offer) =>
      (offer.buyingClubId === clubId || offer.sellingClubId === clubId) &&
      // Contract renewals are modelled as same-club offers; they belong on
      // the contracts screen, not in the transfer lists.
      offer.buyingClubId !== offer.sellingClubId,
  );
  const windows = market.openTransferWindows(save.worldDate);
  const dashboard = buildScoutingDashboard(db, save, context);

  const loans = market
    .activeLoans(save.worldDate)
    .filter((loan) => loan.parentClubId === clubId || loan.loanClubId === clubId)
    .map((loan) => ({
      playerId: loan.playerId,
      playerName: personName(db, loan.playerId),
      direction: loan.parentClubId === clubId ? ("OUT" as const) : ("IN" as const),
      otherClubName: clubName(
        db,
        loan.parentClubId === clubId ? loan.loanClubId : loan.parentClubId,
      ),
      startDate: loan.startDate,
      endDate: loan.endDate,
      wageContributionPercent: loan.wageContributionPercent,
      status: loan.status,
    }));

  const freeAgents = searchPlayersForClub(db, clubId!, {}, save.worldDate)
    .filter((result) => !result.clubId)
    .slice(0, 25)
    .map((result) => ({
      playerId: result.playerId,
      name: result.name,
      clubName: undefined,
      discoveryStatus: result.discoveryStatus,
      knowledge: result.knowledgeLevel,
      confidence: result.confidence,
      knownPosition: result.knownPosition,
      positionGroup: result.publicPositionGroup,
      estimatedAbility: result.estimatedAbility,
      estimatedPotential: result.estimatedPotential,
      shortlisted: false,
    }));

  return {
    budget: budgetView(db, save, context),
    windowOpen: windows.length > 0,
    windowCloses: windows[0]?.closeDate,
    expiringContracts: market
      .contractsExpiringBetween(save.worldDate, addDays(save.worldDate, 180))
      .filter((contract) => contract.clubId === clubId)
      .map((contract) => ({
        playerId: contract.playerId,
        playerName: personName(db, contract.playerId),
        endDate: contract.endDate,
        monthsRemaining: monthsBetween(save.worldDate, contract.endDate),
        squadRole: contract.squadRole,
      })),
    requests: market
      .transferRequests()
      .filter((request) => request.clubId === clubId)
      .map((request) => ({
        id: request.id,
        playerId: request.playerId,
        playerName: personName(db, request.playerId),
        reason: request.reason,
        pressureScore: request.pressureScore,
        status: request.status,
        askingRange: request.askingContext,
      })),
    targets: dashboard.shortlist,
    incoming: offers
      .filter((offer) => offer.buyingClubId === clubId)
      .map((offer) => offerView(db, context, offer)),
    outgoing: offers
      .filter((offer) => offer.sellingClubId === clubId)
      .map((offer) => offerView(db, context, offer)),
    loans,
    freeAgents,
    history: market
      .transferHistory()
      .filter((event) => event.clubId === clubId || event.relatedClubId === clubId)
      .slice(-20)
      .reverse()
      .map((event) => ({
        playerId: event.playerId,
        playerName: personName(db, event.playerId),
        eventType: event.eventType,
        occurredOn: event.occurredOn,
        otherClubName: clubName(db, event.relatedClubId),
      })),
  };
};

export const makeManagerTransferRequest = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  command: TransferRequestCommand,
): TransferCentre => {
  assertManagerAuthority(context, undefined, "LIST_PLAYER");
  if (command.playerId && context.club?.id) {
    requestPlayerTransfer(db, { ...command, worldDate: save.worldDate });
  }
  return buildTransferCentre(db, save, context);
};

export const respondManagerTransferRequest = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  command: TransferRequestResponseCommand,
): TransferCentre => {
  assertManagerAuthority(context, undefined, "LIST_PLAYER");
  const market = new TransferMarketRepository(db);
  const request = market.transferRequests().find((item) => item.id === command.requestId);
  if (!request || request.clubId !== context.club?.id) {
    throw new ManagerCommandError(
      "ROLE_NOT_AUTHORIZED",
      "You may only respond to requests from your own players.",
    );
  }
  respondToPlayerTransferRequest(db, request, command.decision, save.worldDate);
  return buildTransferCentre(db, save, context);
};

export const negotiateManagerLoan = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  command: TransferLoanCommand,
): TransferCentre => {
  assertManagerAuthority(context, undefined, "OFFER_TRANSFER");
  const parentClubId = new TransferMarketRepository(db).activeContract(
    command.playerId,
    save.worldDate,
  )?.clubId;
  if (!context.club?.id || !parentClubId || parentClubId === context.club.id) {
    throw new ManagerCommandError(
      "INVALID_SELECTION",
      "That player cannot be approached for a loan.",
    );
  }
  startLoan(db, parentClubId, context.club.id, command.playerId, save.worldDate, save.randomSeed, {
    endDate: command.endDate,
    wageContributionPercent: command.wageContributionPercent,
    loanFee: command.loanFee,
    playingTimeExpectation: command.playingTimeExpectation,
    recallAllowed: command.recallAllowed,
  });
  return buildTransferCentre(db, save, context);
};

export const makeManagerTransferOffer = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  command: TransferOfferCommand,
): TransferCentre => {
  assertManagerAuthority(context, undefined, "OFFER_TRANSFER");
  const clubId = context.club?.id;
  if (!clubId) throw new ManagerCommandError("ROLE_NOT_AUTHORIZED", "Manager has no club.");
  const profile = factualProfile(db, command.playerId);
  const sellingClubId = (profile?.current_club_id ?? undefined) as EntityId | undefined;
  if (sellingClubId === clubId) {
    throw new ManagerCommandError("INVALID_SELECTION", "That player already plays for you.");
  }
  const budget = budgetView(db, save, context);
  if (command.fee !== undefined && command.fee > budget.transferRemaining) {
    throw new ManagerCommandError(
      "INVALID_SELECTION",
      "The offer exceeds the transfer budget the board has allocated.",
    );
  }
  const offer = createTransferOffer(db, {
    buyingClubId: clubId,
    sellingClubId,
    playerId: command.playerId,
    submittedAt: save.worldDate,
    fee: command.fee,
    installments: command.installments,
    addOns: command.addOns,
    sellOnPercentage: command.sellOnPercentage,
    conditionals: command.conditionals,
    exchangePlayerIds: command.exchangePlayerIds,
    sellerRequestedPlayerId: command.sellerRequestedPlayerId,
  });
  // The selling club's decision is made by the engine, never by the UI.
  const outcome = evaluateTransferOffer(
    db,
    offer,
    save.worldDate,
    `${save.randomSeed}:offer:${offer.id}`,
  );
  if (outcome.accepted) {
    completePermanentTransfer(db, offer, save.worldDate, `${save.randomSeed}:complete:${offer.id}`);
  }
  new ManagerRepository(db).insertInboxItem({
    id: createStableEntityId("inbox", `${offer.id}:response`),
    createdOn: save.worldDate,
    type: "COMPETITION_UPDATE",
    title: outcome.accepted ? "Transfer offer accepted" : "Transfer offer rejected",
    body: `${personName(db, command.playerId)}: ${outcome.reason}.`,
    relatedEntity: { type: "person", id: command.playerId },
    read: false,
  });
  return buildTransferCentre(db, save, context);
};

export const respondToTransferOffer = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  command: TransferResponseCommand,
): TransferCentre => {
  assertManagerAuthority(context, undefined, "OFFER_TRANSFER");
  const market = new TransferMarketRepository(db);
  const offer = market.transferOffers().find((candidate) => candidate.id === command.offerId);
  if (!offer) throw new ManagerCommandError("INVALID_SELECTION", "Unknown transfer offer.");
  if (offer.sellingClubId !== context.club?.id) {
    throw new ManagerCommandError(
      "ROLE_NOT_AUTHORIZED",
      "You may only respond to offers made for your own players.",
    );
  }
  if (command.action === "COUNTER") {
    counterTransferOffer(db, offer, {
      worldDate: save.worldDate,
      transferFee: command.transferFee,
      installments: command.installments,
      addOns: command.addOns,
      sellOnPercentage: command.sellOnPercentage,
      sellerRequestedPlayerId: command.sellerRequestedPlayerId,
    });
    return buildTransferCentre(db, save, context);
  }
  market.insertNegotiationRound({
    id: createStableEntityId("negotiation-round", `${offer.id}:manager:${command.action}`),
    offerId: offer.id,
    roundNumber: market.negotiationRounds(offer.id).length + 1,
    actor: "SELLING_CLUB",
    action: command.action,
    message: `Manager ${command.action.toLowerCase()}ed the offer`,
    createdAt: save.worldDate,
  });
  if (command.action === "ACCEPT") {
    completePermanentTransfer(db, offer, save.worldDate, `${save.randomSeed}:sale:${offer.id}`);
  } else {
    market.updateOfferStatus(offer.id, "REJECTED");
  }
  return buildTransferCentre(db, save, context);
};

export const setManagerTransferStatus = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  command: TransferListCommand,
): TransferCentre => {
  assertManagerAuthority(context, undefined, "LIST_PLAYER");
  const clubId = context.club?.id;
  if (!clubId) throw new ManagerCommandError("ROLE_NOT_AUTHORIZED", "Manager has no club.");
  const squad = new PlayerRepository(db).attributesForTeam(context.team.id);
  if (!squad.some((player) => player.personId === command.playerId)) {
    throw new ManagerCommandError(
      "ROLE_NOT_AUTHORIZED",
      "You may only list players in your own squad.",
    );
  }
  new TransferMarketRepository(db).upsertTransferStatus({
    id: createStableEntityId("player-transfer-status", command.playerId),
    playerId: command.playerId,
    clubId,
    status: command.status,
    reason: "Manager decision",
    setBy: "CLUB",
    updatedAt: save.worldDate,
  });
  return buildTransferCentre(db, save, context);
};

export const buildContractList = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): ContractList => {
  assertManagerAuthority(context, undefined, "NEGOTIATE_CONTRACT");
  const clubId = context.club?.id;
  if (!clubId) throw new ManagerCommandError("ROLE_NOT_AUTHORIZED", "Manager has no club.");
  const contracts = new TransferMarketRepository(db)
    .activeContractsForClub(clubId, save.worldDate)
    .map<ContractRow>((contract) => {
      const months = monthsBetween(save.worldDate, contract.endDate);
      return {
        playerId: contract.playerId,
        playerName: personName(db, contract.playerId),
        salary: contract.salary,
        currency: contract.currency,
        startDate: contract.startDate,
        endDate: contract.endDate,
        squadRole: contract.squadRole,
        status: contract.status,
        monthsRemaining: months,
        expiringSoon: months <= 6,
      };
    })
    .sort((a, b) => a.endDate.localeCompare(b.endDate));

  return {
    contracts,
    totalWageBill: contracts.reduce((total, contract) => total + contract.salary, 0),
    currency: contracts[0]?.currency ?? "NPR",
    expiringCount: contracts.filter((contract) => contract.expiringSoon).length,
  };
};

export const renewManagerContract = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  command: ContractRenewalCommand,
): ContractList => {
  assertManagerAuthority(context, undefined, "NEGOTIATE_CONTRACT");
  const clubId = context.club?.id;
  if (!clubId) throw new ManagerCommandError("ROLE_NOT_AUTHORIZED", "Manager has no club.");
  const market = new TransferMarketRepository(db);
  const current = market.activeContract(command.playerId, save.worldDate);
  if (!current || current.clubId !== clubId) {
    throw new ManagerCommandError(
      "ROLE_NOT_AUTHORIZED",
      "You may only renew contracts at your own club.",
    );
  }
  // A renewal is a real negotiation, so it is persisted as an offer where both
  // sides are this club. `buildTransferCentre` filters these out of the
  // incoming/outgoing lists but the negotiation history is kept.
  const renewalOffer = {
    id: createStableEntityId("transfer-offer", `${command.playerId}:renewal:${save.worldDate}`),
    buyingClubId: clubId,
    sellingClubId: clubId,
    playerId: command.playerId,
    offerType: "PERMANENT" as const,
    transferFee: 0,
    installments: 0,
    addOns: 0,
    sellOnPercentage: 0,
    submittedAt: save.worldDate as ISODate,
    expiresAt: addDays(save.worldDate, 14) as ISODate,
    status: "SUBMITTED" as const,
    currency: current.currency,
    agentFee: 0,
    signingFee: 0,
  };
  market.insertTransferOffer(renewalOffer);
  // The engine sets the terms the player will accept; the UI only proposes.
  const negotiated = negotiatePlayerContract(
    db,
    renewalOffer,
    save.worldDate,
    `${save.randomSeed}:renewal:${command.playerId}`,
  );
  market.updateOfferStatus(renewalOffer.id, "COMPLETED");
  const months = command.months ?? Math.max(12, monthsBetween(save.worldDate, negotiated.endDate));
  const renewed = {
    ...negotiated,
    id: createStableEntityId("player-contract", `${command.playerId}:${save.worldDate}:renewal`),
    clubId,
    startDate: save.worldDate as ISODate,
    endDate: addDays(save.worldDate, months * 30) as ISODate,
    salary: Math.max(negotiated.salary, command.salary ?? 0),
    squadRole: (command.squadRole ?? negotiated.squadRole) as typeof negotiated.squadRole,
    status: "ACTIVE" as const,
  };
  // The superseded contract is retained as history, not deleted.
  market.markContractStatus(current.id, "EXPIRED");
  market.upsertPlayerContract(renewed);
  return buildContractList(db, save, context);
};

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

const staffCategory = (role: string): StaffRow["category"] => {
  const value = role.toUpperCase();
  if (value.includes("DOCTOR") || value.includes("PHYSIO") || value.includes("MEDICAL")) {
    return "MEDICAL";
  }
  if (value.includes("SCOUT") || value.includes("RECRUIT")) return "RECRUITMENT";
  if (value.includes("DIRECTOR") || value.includes("CHAIRMAN") || value.includes("PRESIDENT")) {
    return "DIRECTOR";
  }
  if (value.includes("COACH") || value.includes("MANAGER") || value.includes("ANALYST")) {
    return "COACHING";
  }
  return "OTHER";
};

export const buildStaffList = (
  db: GameDatabase,
  _save: SaveMetadata,
  context: ManagerContext,
  clubId?: EntityId,
): StaffList => {
  // Passing another club's id here is the main way a manager could overreach.
  assertManagerAuthority(context, clubId, "MANAGE_STAFF");
  const targetClubId = clubId ?? context.club?.id;
  if (!targetClubId) throw new ManagerCommandError("ROLE_NOT_AUTHORIZED", "Manager has no club.");

  const staff = (
    db
      .prepare(
        `SELECT sa.*, sl.licence_type FROM staff_appointments sa
         LEFT JOIN staff_licences sl ON sl.person_id = sa.person_id
         WHERE sa.club_id = ? OR sa.team_id = ?
         ORDER BY sa.role`,
      )
      .all(targetClubId, context.team.id) as SqlRow[]
  ).map<StaffRow>((row) => {
    const simulation = db
      .prepare("SELECT * FROM staff_simulation_profiles WHERE person_id = ?")
      .get(row.person_id) as SqlRow | undefined;
    return {
      personId: row.person_id as EntityId,
      appointmentId: row.id as EntityId,
      name: personName(db, row.person_id as EntityId),
      role: row.role as string,
      category: staffCategory(row.role as string),
      startDate: (row.start_date ?? undefined) as ISODate | undefined,
      endDate: (row.end_date ?? undefined) as ISODate | undefined,
      employmentStatus: row.employment_status as string,
      serviceRankTitle: (row.service_rank_title ?? undefined) as string | undefined,
      licence: (row.licence_type ?? undefined) as string | undefined,
      simulatedQualities: simulation
        ? [
            { label: "Coaching (technical)", value: simulation.coaching_technical as number },
            { label: "Coaching (tactical)", value: simulation.coaching_tactical as number },
            { label: "Coaching (physical)", value: simulation.coaching_physical as number },
            { label: "Youth development", value: simulation.youth_development as number },
            { label: "Man management", value: simulation.man_management as number },
          ]
        : undefined,
    };
  });

  const vacancies = (
    db
      .prepare("SELECT * FROM staff_vacancies WHERE club_id = ? OR team_id = ?")
      .all(targetClubId, context.team.id) as SqlRow[]
  ).map((row) => ({
    id: row.id as EntityId,
    role: row.role as string,
    required: Boolean(row.required),
    status: row.status as string,
  }));

  // Candidates come only from imported staff profiles. No invented coaches.
  const candidates = (
    db
      .prepare(
        `SELECT sp.person_id, sp.preferred_role FROM staff_profiles sp
         LEFT JOIN staff_appointments sa ON sa.person_id = sp.person_id
           AND sa.employment_status = 'ACTIVE'
         WHERE sa.id IS NULL LIMIT 25`,
      )
      .all() as SqlRow[]
  ).map((row) => ({
    personId: row.person_id as EntityId,
    name: personName(db, row.person_id as EntityId),
    preferredRole: (row.preferred_role ?? undefined) as string | undefined,
  }));

  return { staff, vacancies, candidates };
};

// ---------------------------------------------------------------------------
// Dashboard and calendar
// ---------------------------------------------------------------------------

export const buildManagerDashboard = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): ManagerDashboard => {
  assertManagerAuthority(context);
  const squad = buildSquadList(db, save, context);
  const fixtures = managerFixtures(db, context);
  const competition = buildCompetitionView(db, save, context);
  const standing = competition.table.find((row) => row.isManagerTeam);
  const clubId = context.club?.id;
  const training = trainingPlanForTeam(db, context.team.id);

  const contracts = clubId
    ? new TransferMarketRepository(db)
        .activeContractsForClub(clubId, save.worldDate)
        .filter((contract) => monthsBetween(save.worldDate, contract.endDate) <= 6).length
    : 0;
  const scoutingUpdates = clubId
    ? ((
        db
          .prepare(
            "SELECT COUNT(*) AS total FROM scout_reports WHERE observer_club_id = ? AND generated_at >= ?",
          )
          .get(clubId, addDays(save.worldDate, -30)) as SqlRow
      ).total as number)
    : 0;
  const transferActivity = clubId
    ? new TransferMarketRepository(db)
        .transferOffers()
        .filter(
          (offer) =>
            (offer.buyingClubId === clubId || offer.sellingClubId === clubId) &&
            ["SUBMITTED", "NEGOTIATING", "ACCEPTED"].includes(offer.status),
        ).length
    : 0;
  const staffIssues = clubId
    ? ((
        db
          .prepare(
            "SELECT COUNT(*) AS total FROM staff_vacancies WHERE (club_id = ? OR team_id = ?) AND status != 'FILLED'",
          )
          .get(clubId, context.team.id) as SqlRow
      ).total as number)
    : 0;

  const moraleCounts = squad.players.reduce<Record<string, number>>((counts, player) => {
    counts[player.morale] = (counts[player.morale] ?? 0) + 1;
    return counts;
  }, {});
  const dominantMorale =
    Object.entries(moraleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown";

  const boardConfidence = clubId ? new CareerWorldRepository(db).boardConfidence(clubId) : undefined;
  const concernCount = activeConcernCount(db, context.team.id);
  const cohesion = new SquadDynamicsRepository(db).cohesion(context.team.id);

  return {
    employmentStatus: "EMPLOYED",
    boardConfidence: boardConfidence?.confidence,
    boardExpectation: boardConfidence?.expectation,
    concernCount,
    cohesionScore: cohesion?.score,
    cohesionLevel: cohesion?.level,
    cohesionTopIssue: cohesion?.topIssue,
    clubName: context.club?.name,
    teamName: context.team.name,
    competitionName: context.season.name,
    worldDate: save.worldDate as ISODate,
    leaguePosition: standing?.position,
    played: standing?.played ?? 0,
    points: standing?.points ?? 0,
    form: competition.form,
    nextFixture: fixtures.find((fixture) => fixture.status === "scheduled"),
    recentResults: fixtures
      .filter((fixture) => fixture.status === "played")
      .slice(-5)
      .reverse(),
    squadAvailability: {
      total: squad.players.length,
      available: squad.availabilityCounts.AVAILABLE,
      injured: squad.availabilityCounts.INJURED,
      suspended: squad.availabilityCounts.SUSPENDED,
      unavailable:
        squad.availabilityCounts.UNAVAILABLE + squad.availabilityCounts.INTERNATIONAL_DUTY,
    },
    moraleSummary: `Mostly ${dominantMorale.toLowerCase()}`,
    trainingSummary: training ? `${training.name} (${training.intensity})` : "No training plan set",
    scoutingUpdates,
    transferActivity,
    contractIssues: contracts,
    staffIssues,
    inbox: new ManagerRepository(db).inboxItems().slice(0, 12),
    medicalCentre: clubId ? medicalCentreReadModel(db, { clubId, date: save.worldDate }) : [],
  };
};

export const buildCalendar = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): CalendarEntry[] => {
  assertManagerAuthority(context);
  const horizon = addDays(save.worldDate, 120);
  const entries: CalendarEntry[] = managerFixtures(db, context)
    .filter((fixture) => fixture.date >= save.worldDate && fixture.date <= horizon)
    .map((fixture) => ({
      date: fixture.date,
      type: "FIXTURE" as const,
      title: `${fixture.homeAway === "home" ? "vs" : "at"} ${fixture.opponent}`,
      detail: fixture.competition,
    }));

  const market = new TransferMarketRepository(db);
  for (const window of market.transferWindows()) {
    if (window.closeDate >= save.worldDate && window.openDate <= horizon) {
      entries.push({
        date: window.closeDate,
        type: "TRANSFER_WINDOW",
        title: "Transfer window closes",
        detail: window.windowType,
      });
    }
  }

  const clubId = context.club?.id;
  if (clubId) {
    for (const contract of market.contractsExpiringBetween(save.worldDate, horizon)) {
      if (contract.clubId !== clubId) continue;
      entries.push({
        date: contract.endDate,
        type: "CONTRACT_EXPIRY",
        title: `${personName(db, contract.playerId)} contract expires`,
      });
    }
    for (const row of db
      .prepare("SELECT * FROM scouting_assignments WHERE club_id = ? AND status = 'ACTIVE'")
      .all(clubId) as SqlRow[]) {
      entries.push({
        date: row.expected_completion_at as ISODate,
        type: "SCOUTING",
        title: "Scouting report due",
      });
    }
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 60);
};

// ---------------------------------------------------------------------------
// Continue
// ---------------------------------------------------------------------------

/**
 * Advances a day at a time, running the existing scouting and training systems,
 * and stops at the first meaningful decision point. This is an event-priority
 * wrapper over the current schedulers — it does not replace world simulation.
 */
export const advanceManagerCareer = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  maxDays = 60,
): ContinueOutcome => {
  assertManagerAuthority(context);
  const nextFixture = context.fixtures
    .filter(
      (fixture) =>
        fixture.status === "scheduled" &&
        (fixture.homeTeamId === context.team.id || fixture.awayTeamId === context.team.id) &&
        fixture.scheduledDate > save.worldDate,
    )
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0];

  const clubId = context.club?.id;
  const market = new TransferMarketRepository(db);
  const recruitment = new RecruitmentRepository(db);
  const players = new PlayerRepository(db);
  const plan = trainingPlanForTeam(db, context.team.id);
  const trainingPlan = plan ? mapTrainingPlan(plan) : undefined;

  const reportsBefore = clubId
    ? ((
        db
          .prepare("SELECT COUNT(*) AS total FROM scout_reports WHERE observer_club_id = ?")
          .get(clubId) as SqlRow
      ).total as number)
    : 0;

  let date = save.worldDate;
  let days = 0;
  let stopReason: ContinueStopReason = "SEASON_COMPLETE";

  while (days < maxDays) {
    date = addDays(date, 1);
    days += 1;

    simulateScoutingDay({ db, worldDate: date, seed: `${save.randomSeed}:scouting:${date}` });
    applyDailyTraining(db, save, context, players, trainingPlan, date);

    if (nextFixture && date >= nextFixture.scheduledDate) {
      stopReason = "NEXT_FIXTURE";
      break;
    }
    if (clubId) {
      const reportsNow = (
        db
          .prepare("SELECT COUNT(*) AS total FROM scout_reports WHERE observer_club_id = ?")
          .get(clubId) as SqlRow
      ).total as number;
      if (reportsNow > reportsBefore) {
        stopReason = "SCOUT_REPORT";
        break;
      }
      const responded = market
        .transferOffers()
        .some(
          (offer) =>
            (offer.buyingClubId === clubId || offer.sellingClubId === clubId) &&
            ["ACCEPTED", "REJECTED"].includes(offer.status) &&
            offer.expiresAt >= date &&
            offer.submittedAt <= date,
        );
      if (responded && days >= 3) {
        stopReason = "TRANSFER_RESPONSE";
        break;
      }
      if (
        market.contractsExpiringBetween(date, date).some((contract) => contract.clubId === clubId)
      ) {
        stopReason = "CONTRACT_EXPIRY";
        break;
      }
    }
  }

  void recruitment;
  return {
    worldDate: date as ISODate,
    daysAdvanced: days,
    stopReason,
    message: continueMessage(
      stopReason,
      nextFixture ? teamName(db, oppositionOf(nextFixture, context)) : undefined,
    ),
  };
};

const oppositionOf = (
  fixture: { homeTeamId: EntityId; awayTeamId: EntityId },
  context: ManagerContext,
): EntityId => (fixture.homeTeamId === context.team.id ? fixture.awayTeamId : fixture.homeTeamId);

const continueMessage = (reason: ContinueStopReason, opponent?: string): string => {
  switch (reason) {
    case "NEXT_FIXTURE":
      return opponent ? `Matchday: ${opponent}.` : "Matchday.";
    case "SCOUT_REPORT":
      return "A new scouting report has arrived.";
    case "TRANSFER_RESPONSE":
      return "There is a response to a transfer negotiation.";
    case "CONTRACT_EXPIRY":
      return "A player contract needs attention.";
    default:
      return "No further fixtures are scheduled.";
  }
};

// ---------------------------------------------------------------------------
// Player development (Phase A/B) — environment, injury risk, individual plans
// ---------------------------------------------------------------------------

/** Injury risk rolled from the same training-load signal the engine already computes — no new medical engine. */
const rollTrainingInjury = (
  db: GameDatabase,
  players: PlayerRepository,
  personId: EntityId,
  teamId: EntityId,
  risk: number,
  fitness: number,
  date: string,
  seed: string,
): void => {
  const alreadyInjured = players.activeInjuries(date).some((injury) => injury.personId === personId);
  if (alreadyInjured) return;
  const random = new SeededRandom(`${seed}:injury:${personId}:${date}`);
  if (random.next() >= risk) return;
  const severity: InjuryRecord["severity"] = risk >= 0.15 ? "major" : risk >= 0.08 ? "moderate" : "minor";
  const recoveryDays = severity === "major" ? 45 : severity === "moderate" ? 21 : 7;
  const recovery = new Date(`${date}T00:00:00.000Z`);
  recovery.setUTCDate(recovery.getUTCDate() + recoveryDays);
  players.insertInjury({
    id: createStableEntityId("injury", `training:${personId}:${date}`),
    personId,
    injuryType: "Training overload",
    dateOccurred: date,
    expectedRecoveryDate: recovery.toISOString().slice(0, 10),
    severity,
  });
  players.upsertAvailabilityState({
    personId,
    teamId,
    fitness,
    moraleModifier: 0,
    formModifier: 0,
    availability: "INJURED",
    updatedOn: date,
  });
  players.insertTrainingHistoryEvent({
    id: createStableEntityId("training-setback", `${personId}:${date}`),
    playerId: personId,
    teamId,
    eventType: "TRAINING_SETBACK_INJURY",
    occurredOn: date,
    data: { severity },
  });
};

/** Runs the existing per-day development model for the manager's squad. */
const applyDailyTraining = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  players: PlayerRepository,
  plan: TrainingView["plan"] | undefined,
  date: string,
): void => {
  if (!plan) return;
  ensureSensibleDevelopmentPlan(db, save.worldDate, context.team.id);
  const environment = computeDevelopmentEnvironment(db, context.club?.id);
  const congestion = computeCongestionMultiplier(context.fixtures, context.team.id, date);
  const world = new WorldRepository(db);
  for (const attributes of players.attributesForTeam(context.team.id)) {
    const potential = players.potential(attributes.personId);
    if (!potential) continue;
    const person = personRow(db, attributes.personId);
    const dob = person?.date_of_birth as string | undefined;
    const age = dob ? ageOn(dob, date) : 25;
    const state =
      players.developmentState(attributes.personId) ??
      createInitialDevelopmentState(attributes, age, date);
    const individualPlan = world.activeIndividualDevelopmentPlan(attributes.personId);
    const playingTime = players.latestPlayingTime(attributes.personId);
    const availability = trainingAvailabilityFor(db, attributes.personId, date);
    if (availability === "RETURNING" && daysSinceRecovery(db, attributes.personId, date) === 1) {
      players.insertTrainingHistoryEvent({
        id: createStableEntityId("return-ramp", `${attributes.personId}:${date}`),
        playerId: attributes.personId,
        teamId: context.team.id,
        eventType: "RETURNED_FROM_INJURY_RAMP_UP",
        occurredOn: date,
        data: {},
      });
    }
    const output = simulateTrainingDay({
      attributes,
      state: { ...state, developmentPhase: developmentPhaseForAge(age) },
      potential,
      age,
      date,
      seed: `${save.randomSeed}:training:${attributes.personId}:${date}`,
      historyScope: context.team.id,
      plan,
      individualPlan,
      playingTime,
      environment: { ...environment, competitionMultiplier: congestion },
      trainingAvailability: availability,
    });
    players.upsertDevelopmentState(output.updatedState);
    players.upsertAttributes(output.updatedAttributes);
    for (const event of output.historyEvents) {
      players.insertTrainingHistoryEvent({ ...event, teamId: context.team.id });
    }
    if (availability === "FULL") {
      rollTrainingInjury(
        db,
        players,
        attributes.personId,
        context.team.id,
        output.injuryRiskSignal.risk,
        output.updatedState.fitness,
        date,
        save.randomSeed,
      );
    }
    if (individualPlan) {
      const familiarity =
        individualPlan.focusType === "POSITION" && individualPlan.targetPosition
          ? output.updatedState.positionFamiliarity[individualPlan.targetPosition]
          : individualPlan.focusType === "ROLE" && individualPlan.targetRole
            ? output.updatedState.roleFamiliarity[individualPlan.targetRole]
            : undefined;
      const recentDeltas = players
        .trainingHistoryForPlayer(attributes.personId, 12)
        .filter((event) => event.eventType === "ATTRIBUTE_IMPROVED" || event.eventType === "ATTRIBUTE_DECLINED")
        .map((event) => Number((event.data as { averageDelta?: number } | undefined)?.averageDelta ?? 0));
      const review = reviewDevelopmentPlanIfDue(db, save.worldDate, individualPlan, familiarity, recentDeltas);
      if (review) {
        if (review.plateaued) {
          players.insertTrainingHistoryEvent({
            id: createStableEntityId("plateau", `${attributes.personId}:${date}`),
            playerId: attributes.personId,
            teamId: context.team.id,
            eventType: "DEVELOPMENT_PLATEAU_DETECTED",
            occurredOn: date,
            data: { focusType: individualPlan.focusType },
          });
        }
        players.insertTrainingHistoryEvent({
          id: createStableEntityId("plan-review", `${attributes.personId}:${date}`),
          playerId: attributes.personId,
          teamId: context.team.id,
          eventType: "DEVELOPMENT_PLAN_REVIEWED",
          occurredOn: date,
          data: { recommendation: review.recommendation, focusType: individualPlan.focusType },
        });
      }
    }
  }
};

const developmentTrend = (momentum: number): "IMPROVING" | "STABLE" | "DECLINING" => {
  if (momentum >= 1.5) return "IMPROVING";
  if (momentum <= -1.5) return "DECLINING";
  return "STABLE";
};

/** Manager-facing read model: real per-player progress, trend, active plan and recent history. */
export const buildPlayerDevelopmentView = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): PlayerDevelopmentView => {
  assertManagerAuthority(context, undefined, "SET_TRAINING");
  const players = new PlayerRepository(db);
  const world = new WorldRepository(db);
  const environment = computeDevelopmentEnvironment(db, context.club?.id);

  const entries: PlayerDevelopmentEntry[] = players.attributesForTeam(context.team.id).map((attributes) => {
    const person = personRow(db, attributes.personId);
    const dob = person?.date_of_birth as string | undefined;
    const age = dob ? ageOn(dob, save.worldDate) : undefined;
    const state = players.developmentState(attributes.personId);
    const plan = world.activeIndividualDevelopmentPlan(attributes.personId);
    const injured = players.activeInjuries(save.worldDate).some((injury) => injury.personId === attributes.personId);
    const risk = state ? trainingInjuryRiskSignal(state).risk : 0;
    const history = players.trainingHistoryForPlayer(attributes.personId, 8);
    const plateaued = history.some((event) => event.eventType === "DEVELOPMENT_PLATEAU_DETECTED");
    const latestReview = history.find((event) => event.eventType === "DEVELOPMENT_PLAN_REVIEWED");
    return {
      personId: attributes.personId,
      name: personName(db, attributes.personId),
      age,
      primaryPosition: attributes.primaryPosition,
      phase: state?.developmentPhase ?? developmentPhaseForAge(age ?? 25),
      trend: developmentTrend(state?.developmentMomentum ?? 0),
      momentum: state?.developmentMomentum ?? 0,
      currentAbility: playerAbility(attributes),
      fitness: Math.round(state?.fitness ?? 85),
      fatigue: Math.round(state?.fatigue ?? 0),
      recovery: Math.round(state?.recovery ?? 80),
      injuryRisk: risk,
      currentlyInjured: injured,
      trainingAvailability: trainingAvailabilityFor(db, attributes.personId, save.worldDate),
      plateaued,
      latestRecommendation: (latestReview?.data as { recommendation?: string } | undefined)?.recommendation,
      activePlan: plan
        ? {
            id: plan.id,
            focusType: plan.focusType,
            targetPosition: plan.targetPosition,
            targetRole: plan.targetRole,
            targetAttributeGroup: plan.targetAttributeGroup,
            intensity: plan.intensity,
            startDate: plan.startDate,
            endDate: plan.endDate,
            status: plan.status,
          }
        : undefined,
      recentHistory: players.trainingHistoryForPlayer(attributes.personId, 5).map((event) => ({
        eventType: event.eventType,
        occurredOn: event.occurredOn,
        data: event.data,
      })),
    };
  });

  return {
    players: entries,
    focusTypeOptions: ["ATTRIBUTE", "POSITION", "ROLE", "PHYSICAL", "TECHNICAL", "MENTAL", "BALANCED", "MAINTENANCE"],
    attributeGroupOptions: ["technical", "mental", "physical", "goalkeeping"],
    positionOptions: ["GK", "RB", "CB", "LB", "DM", "CM", "AM", "RW", "LW", "ST"],
    intensityOptions: ["LOW", "NORMAL", "HIGH", "VERY_HIGH"],
    environment: { coachingQuality: environment.coachingQuality, facilitiesEffect: environment.facilitiesEffect },
  };
};

export class DevelopmentPlanError extends Error {
  constructor(
    readonly code: "NOT_ON_ROSTER" | "MISSING_TARGET",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Sets the club's single individual focus for a player — reassigning always
 * supersedes any prior active plan for that player, so a player is never
 * being trained toward two focuses at once.
 */
export const createDevelopmentPlan = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  command: CreateDevelopmentPlanCommand,
): IndividualDevelopmentPlan => {
  assertManagerAuthority(context, undefined, "SET_TRAINING");
  const players = new PlayerRepository(db);
  if (!players.attributesForTeam(context.team.id).some((attributes) => attributes.personId === command.personId)) {
    throw new DevelopmentPlanError("NOT_ON_ROSTER", "That player is not part of this squad.");
  }
  const focusType = command.focusType as DevelopmentFocusType;
  if (focusType === "POSITION" && !command.targetPosition) {
    throw new DevelopmentPlanError("MISSING_TARGET", "Select a target position for position retraining.");
  }
  if (focusType === "ROLE" && !command.targetRole) {
    throw new DevelopmentPlanError("MISSING_TARGET", "Select a target role.");
  }
  if (focusType === "ATTRIBUTE" && !command.targetAttributeGroup) {
    throw new DevelopmentPlanError("MISSING_TARGET", "Select a target attribute group.");
  }
  const world = new WorldRepository(db);
  const previous = world.activeIndividualDevelopmentPlan(command.personId);
  if (previous) {
    world.upsertIndividualDevelopmentPlan({ ...previous, status: "COMPLETED", endDate: save.worldDate });
  }
  const plan: IndividualDevelopmentPlan = {
    id: createEntityId(),
    playerId: command.personId,
    focusType,
    targetPosition: command.targetPosition as PlayerPosition | undefined,
    targetRole: command.targetRole,
    targetAttributeGroup: command.targetAttributeGroup as IndividualDevelopmentPlan["targetAttributeGroup"],
    intensity: command.intensity,
    startDate: save.worldDate,
    endDate: addDaysISO(save.worldDate, DEVELOPMENT_BLOCK_DAYS),
    status: "ACTIVE",
  };
  world.upsertIndividualDevelopmentPlan(plan);
  return plan;
};

export const setDevelopmentPlanStatus = (
  db: GameDatabase,
  save: SaveMetadata,
  planId: EntityId,
  status: "ACTIVE" | "PAUSED" | "COMPLETED",
): void => {
  const plan = db
    .prepare("SELECT * FROM individual_development_plans WHERE id = ?")
    .get(planId) as SqlRow | undefined;
  if (!plan) return;
  new WorldRepository(db).upsertIndividualDevelopmentPlan({
    id: plan.id,
    playerId: plan.player_id,
    focusType: plan.focus_type,
    targetPosition: plan.target_position ?? undefined,
    targetRole: plan.target_role ?? undefined,
    targetAttributeGroup: plan.target_attribute_group ?? undefined,
    intensity: plan.intensity,
    startDate: plan.start_date,
    endDate: status === "ACTIVE" ? addDaysISO(save.worldDate, DEVELOPMENT_BLOCK_DAYS) : (plan.end_date ?? save.worldDate),
    status,
  });
};

// ---------------------------------------------------------------------------
// Quick sim summary
// ---------------------------------------------------------------------------

export const buildQuickSimSummary = (
  db: GameDatabase,
  context: ManagerContext,
  fixtureId: EntityId,
): QuickSimSummary | undefined => {
  const match = db.prepare("SELECT * FROM matches WHERE fixture_id = ? LIMIT 1").get(fixtureId) as
    SqlRow | undefined;
  if (!match) return undefined;
  const fixture = db.prepare("SELECT * FROM fixtures WHERE id = ?").get(match.fixture_id) as SqlRow;
  const events = db
    .prepare("SELECT * FROM match_events WHERE match_id = ? ORDER BY minute, id")
    .all(match.id) as SqlRow[];

  const isHome = fixture.home_team_id === context.team.id;
  const homeGoals = match.home_goals as number;
  const awayGoals = match.away_goals as number;
  const own = isHome ? homeGoals : awayGoals;
  const other = isHome ? awayGoals : homeGoals;

  const countFor = (teamId: EntityId, type: string): number =>
    events.filter((event) => event.team_id === teamId && event.type === type).length;
  const xgFor = (teamId: EntityId): number =>
    Math.round(
      events
        .filter((event) => event.team_id === teamId && event.type === "SHOT")
        .reduce((total, event) => total + Number(JSON.parse(event.data_json ?? "{}").xg ?? 0), 0) *
        100,
    ) / 100;

  // The match engine records season aggregates, not per-match player ratings,
  // so this stays empty rather than inventing a number per player.
  const ratings: QuickSimSummary["ratings"] = [];

  return {
    fixtureId,
    score: `${homeGoals}-${awayGoals}`,
    homeTeam: teamName(db, fixture.home_team_id as EntityId),
    awayTeam: teamName(db, fixture.away_team_id as EntityId),
    result: own > other ? "W" : own === other ? "D" : "L",
    scorers: events
      .filter((event) => event.type === "GOAL")
      .map((event) => ({
        minute: (event.minute ?? undefined) as number | undefined,
        playerName: event.primary_person_id
          ? personName(db, event.primary_person_id as EntityId)
          : "Unknown",
        teamName: event.team_id ? teamName(db, event.team_id as EntityId) : "",
      })),
    possession: { home: 50, away: 50 },
    shots: {
      home: countFor(fixture.home_team_id as EntityId, "SHOT"),
      away: countFor(fixture.away_team_id as EntityId, "SHOT"),
    },
    shotsOnTarget: {
      home: countFor(fixture.home_team_id as EntityId, "SHOT_ON_TARGET"),
      away: countFor(fixture.away_team_id as EntityId, "SHOT_ON_TARGET"),
    },
    xg: {
      home: xgFor(fixture.home_team_id as EntityId),
      away: xgFor(fixture.away_team_id as EntityId),
    },
    cards: events
      .filter((event) => event.type === "YELLOW_CARD" || event.type === "RED_CARD")
      .map((event) => ({
        minute: (event.minute ?? undefined) as number | undefined,
        playerName: event.primary_person_id
          ? personName(db, event.primary_person_id as EntityId)
          : "Unknown",
        type: event.type as string,
      })),
    injuries: events
      .filter((event) => event.type === "INJURY")
      .map((event) => ({
        playerName: event.primary_person_id
          ? personName(db, event.primary_person_id as EntityId)
          : "Unknown",
        minute: (event.minute ?? undefined) as number | undefined,
      })),
    ratings,
    attendance: (match.attendance ?? undefined) as number | undefined,
  };
};
