import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  AppResult,
  CareerCreationCommand,
  AdvanceMatchCommand,
  ConcernResponseAction,
  ContractRenewalCommand,
  SquadMeetingCommand,
  EntityId,
  LiveTacticsCommand,
  RecruitmentSearchCommand,
  ScoutingAssignmentCommand,
  CreateDevelopmentPlanCommand,
  ReturnToPlayDecisionCommand,
  StaffResponsibilityDomain,
  StaffResponsibilityOwnerType,
  StartMatchCommand,
  SubstitutionCommand,
  TacticalSetup,
  TacticsUpdateCommand,
  TrainingUpdateCommand,
  TransferListCommand,
  TransferOfferCommand,
  TransferResponseCommand,
  TransferRequestCommand,
  TransferRequestResponseCommand,
  TransferLoanCommand,
} from "@nepal-football-sim/shared-types";
import { DesktopApplicationService, type DesktopRuntimeOptions } from "./desktop-application.js";

export type DesktopServerOptions = DesktopRuntimeOptions & {
  /** 0 asks the OS for a free port; the chosen port is reported back. */
  port?: number;
  /** Shared secret the UI must present. Generated when omitted. */
  token?: string;
};

export type DesktopServerHandle = {
  port: number;
  token: string;
  service: DesktopApplicationService;
  close: () => Promise<void>;
};

const MAX_BODY_BYTES = 4_000_000;

/**
 * Loopback-only command transport in front of DesktopApplicationService.
 *
 * This exists because the simulation engine and SQLite layer are TypeScript/Node.
 * Tauri launches this as a managed sidecar; Vite dev launches the same process.
 * It holds no game logic of its own — every route is a direct service call.
 */
export const startDesktopServer = async (
  options: DesktopServerOptions,
): Promise<DesktopServerHandle> => {
  const service = new DesktopApplicationService(options);
  const token = options.token ?? randomToken();

  const server = createServer((request, response) => {
    void handle(request, response, service, token);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    port: (server.address() as AddressInfo).port,
    token,
    service,
    close: () => closeServer(server, service),
  };
};

const closeServer = async (server: Server, service: DesktopApplicationService): Promise<void> => {
  service.closeCareer();
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

const handle = async (
  request: IncomingMessage,
  response: ServerResponse,
  service: DesktopApplicationService,
  token: string,
): Promise<void> => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/health") {
    return send(response, 200, { ok: true, data: { status: "ready" } });
  }

  if (request.headers["x-runtime-token"] !== token) {
    return send(response, 401, {
      ok: false,
      error: { code: "RUNTIME_UNAVAILABLE", message: "Invalid runtime token." },
    });
  }

  if (request.method !== "POST" || !url.pathname.startsWith("/command/")) {
    return send(response, 404, {
      ok: false,
      error: { code: "RUNTIME_UNAVAILABLE", message: "Unknown runtime route." },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return send(response, 400, {
      ok: false,
      error: {
        code: "RUNTIME_UNAVAILABLE",
        message: "Malformed command payload.",
        detail: error instanceof Error ? error.message : undefined,
      },
    });
  }

  const command = url.pathname.slice("/command/".length);
  if (process.env.NEPAL_RUNTIME_TRACE) process.stderr.write(`[trace] ${command}\n`);
  const result = dispatch(service, command, body);
  return send(response, 200, result);
};

const dispatch = (
  service: DesktopApplicationService,
  command: string,
  body: Record<string, unknown>,
): AppResult<unknown> => {
  switch (command) {
    case "listSaves":
      return service.listSaves();
    case "listStartingClubs":
      return service.listStartingClubs();
    case "createCareer":
      return service.createCareer(body.command as CareerCreationCommand);
    case "loadCareer":
      return service.loadCareer(body.saveId as EntityId);
    case "closeCareer":
      return service.closeCareer();
    case "getCareerHeader":
      return service.getCareerHeader();
    case "getHomeDashboard":
      return service.getHomeDashboard();
    case "continueCareer":
      return service.continueCareer();
    case "quickSimMatch":
      return service.quickSimMatch(body.fixtureId as EntityId | undefined);
    case "saveTactic":
      return service.saveTactic(body.tactic as TacticalSetup);
    case "saveCareer":
      return service.saveCareer();
    case "deleteSave":
      return service.deleteSave(body.saveId as EntityId);
    // Manager gameplay (Step 3).
    case "getManagerDashboard":
      return service.getManagerDashboard();
    case "getSquad":
      return service.getSquad();
    case "getSquadConcerns":
      return service.getSquadConcerns();
    case "respondToConcern":
      return service.respondToConcern(body as { concernId: EntityId; action: ConcernResponseAction });
    case "holdSquadMeeting":
      return service.holdSquadMeeting(body.command as SquadMeetingCommand);
    case "getPlayerProfile":
      return service.getPlayerProfile(body.playerId as EntityId);
    case "getTactics":
      return service.getTactics();
    case "updateTactics":
      return service.updateTactics(body.command as TacticsUpdateCommand);
    case "getTraining":
      return service.getTraining();
    case "updateTraining":
      return service.updateTraining(body.command as TrainingUpdateCommand);
    case "getPlayerDevelopment":
      return service.getPlayerDevelopment();
    case "createPlayerDevelopmentPlan":
      return service.createPlayerDevelopmentPlan(body.command as CreateDevelopmentPlanCommand);
    case "setPlayerDevelopmentPlanStatus":
      return service.setPlayerDevelopmentPlanStatus(body.planId as EntityId, body.status as string);
    case "getMedicalCentre":
      return service.getMedicalCentre();
    case "decideReturnToPlay":
      return service.decideReturnToPlay(body.command as ReturnToPlayDecisionCommand);
    case "getFixtures":
      return service.getFixtures();
    case "getFixture":
      return service.getFixture(body.fixtureId as EntityId);
    case "getCompetition":
      return service.getCompetition();
    case "getCalendar":
      return service.getCalendar();
    case "getScoutingDashboard":
      return service.getScoutingDashboard();
    case "createScoutingAssignment":
      return service.createScoutingAssignment(body.command as ScoutingAssignmentCommand);
    case "getScoutingReport":
      return service.getScoutingReport(body.playerId as EntityId);
    case "toggleShortlist":
      return service.toggleShortlist(body.playerId as EntityId);
    case "searchRecruitment":
      return service.searchRecruitment(body.command as RecruitmentSearchCommand);
    case "getTransferCentre":
      return service.getTransferCentre();
    case "makeTransferOffer":
      return service.makeTransferOffer(body.command as TransferOfferCommand);
    case "respondTransferOffer":
      return service.respondTransferOffer(body.command as TransferResponseCommand);
    case "makeTransferRequest":
      return service.makeTransferRequest(body.command as TransferRequestCommand);
    case "respondTransferRequest":
      return service.respondTransferRequest(body.command as TransferRequestResponseCommand);
    case "negotiateLoan":
      return service.negotiateLoan(body.command as TransferLoanCommand);
    case "setTransferStatus":
      return service.setTransferStatus(body.command as TransferListCommand);
    case "getContracts":
      return service.getContracts();
    case "renewContract":
      return service.renewContract(body.command as ContractRenewalCommand);
    // Interactive matchday (Step 4C).
    case "startMatch":
      return service.startMatch(body.command as StartMatchCommand);
    case "getLiveMatch":
      return service.getLiveMatch(
        body.fixtureId as EntityId | undefined,
        body.since as number | undefined,
      );
    case "advanceMatch":
      return service.advanceMatch(
        body.command as AdvanceMatchCommand,
        body.fixtureId as EntityId | undefined,
      );
    case "continueFromHalfTime":
      return service.continueFromHalfTime(body.fixtureId as EntityId | undefined);
    case "makeSubstitution":
      return service.makeSubstitution(
        body.command as SubstitutionCommand,
        body.fixtureId as EntityId | undefined,
      );
    case "updateLiveTactics":
      return service.updateLiveTactics(
        body.command as LiveTacticsCommand,
        body.fixtureId as EntityId | undefined,
      );
    case "quickSimCurrentMatch":
      return service.quickSimCurrentMatch(body.fixtureId as EntityId | undefined);
    case "resumeMatch":
      return service.resumeMatch(body.fixtureId as EntityId | undefined);
    case "getPostMatchReport":
      return service.getPostMatchReport(body.fixtureId as EntityId);
    case "getMatchSummary":
      return service.getMatchSummary(body.fixtureId as EntityId);
    case "getStaff":
      return service.getStaff(body.clubId as EntityId | undefined);
    case "getStaffMarket":
      return service.getStaffMarket();
    case "applyForStaffRole":
      return service.applyForStaffRole(
        body.vacancyId as EntityId,
        body.personId as EntityId,
        body.salaryAmountMinor as number,
        body.contractMonths as number,
      );
    case "respondToStaffApplication":
      return service.respondToStaffApplication(body.applicationId as EntityId, body.accept as boolean);
    case "offerStaffContractRenewal":
      return service.offerStaffContractRenewal(
        body.appointmentId as EntityId,
        body.salaryAmountMinor as number,
        body.contractMonths as number,
      );
    case "respondToStaffRenewal":
      return service.respondToStaffRenewal(body.offerId as EntityId, body.accept as boolean);
    case "dismissStaffMember":
      return service.dismissStaffMember(body.appointmentId as EntityId);
    case "enrolStaffLicenceCourse":
      return service.enrolStaffLicenceCourse(body.personId as EntityId, body.clubFunded as boolean);
    // Staff Market Phase C.
    case "getStaffHierarchy":
      return service.getStaffHierarchy();
    case "assignStaffResponsibility":
      return service.assignStaffResponsibility(
        body.domain as StaffResponsibilityDomain,
        body.ownerType as StaffResponsibilityOwnerType,
        body.ownerAppointmentId as EntityId | undefined,
      );
    case "requestStaffBoardApproval":
      return service.requestStaffBoardApproval(body.domain as StaffResponsibilityDomain);
    case "createStaffDevelopmentPlan":
      return service.createStaffDevelopmentPlan(
        body.personId as EntityId,
        body.focus as string,
        body.targetLicenceType as string | undefined,
        body.clubFunded as boolean | undefined,
      );
    // Manager Career World (Step 5).
    case "getJobCentre":
      return service.getJobCentre();
    case "applyForJob":
      return service.applyForJob(body.vacancyId as EntityId);
    case "declineJobOffer":
      return service.declineJobOffer(body.applicationId as EntityId);
    case "acceptJobOffer":
      return service.acceptJobOffer(body.applicationId as EntityId);
    case "resignFromClub":
      return service.resignFromClub();
    case "getCareerHistory":
      return service.getCareerHistory();
    default:
      return {
        ok: false,
        error: { code: "RUNTIME_UNAVAILABLE", message: `Unknown command ${command}.` },
      };
  }
};

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Command payload is too large.");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
};

const send = (response: ServerResponse, status: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
};

const randomToken = (): string =>
  Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join("");
