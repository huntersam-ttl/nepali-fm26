import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TransferMarketRepository,
  WorldRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import { createStableEntityId, type EntityId } from "@nepal-football-sim/shared-types";
import {
  analyzeSquadNeeds,
  assessAgentInterest,
  acceptTransferOffer,
  aiRecruitmentPlan,
  assessFreeAgentSigning,
  calculateTransferPackageValue,
  calculateTransferValuation,
  clubTransferIdentity,
  counterTransferOffer,
  createNepalSave,
  createTransferEnquiry,
  createTransferOffer,
  endLoan,
  evaluateTransferOffer,
  initializeTransferMarketForSave,
  negotiatePlayerContract,
  negotiatePlayerTerms,
  processAgentRepresentation,
  processContractExpiries,
  requestPlayerTransfer,
  respondToPlayerTransferRequest,
  respondToTransferEnquiry,
  runTransferDiagnostic,
  searchPlayersForClub,
  simulateNepalCareer,
  startLoan,
} from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-transfers-"));
  tempDirs.push(dir);
  return join(dir, "transfers.sqlite");
};

const createSave = (seed: string): string => {
  const databasePath = tempDbPath();
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Transfers ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
    globalSeedPath: null,
  });
  const db = openGameDatabase(databasePath);
  initializeTransferMarketForSave({ db, worldDate: "2026-08-01", seed });
  db.close();
  return databasePath;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("transfer and contract market", () => {
  it("creates simulation-only starting contracts, budgets, agents, windows and registrations", () => {
    const db = openGameDatabase(createSave("starting-contracts"));
    const market = new TransferMarketRepository(db);
    const contracts = market.allPlayerContracts();
    const inspection = new WorldRepository(db).inspectWorld();

    expect(contracts.length).toBeGreaterThanOrEqual(573);
    expect(contracts.every((contract) => contract.provenance.status === "SIMULATION_ONLY")).toBe(
      true,
    );
    expect(market.transferWindows().map((window) => window.provenance.status)).toContain(
      "SIMULATION_ONLY",
    );
    expect(inspection.clubFinancialProfiles).toBeGreaterThan(0);
    expect(inspection.clubEmploymentProfiles).toBeGreaterThan(0);
    expect(inspection.agents).toBeGreaterThan(0);
    expect(inspection.agents).toBeGreaterThan(0);
    expect(inspection.agentClients).toBe(0);
    expect(
      market.competitionRegistrations().some((item) => item.registrationType === "TEMPORARY_NSL"),
    ).toBe(true);
    db.close();
  });

  it("runs a conservative transfer window with mixed outcomes and no hidden search leaks", () => {
    const db = openGameDatabase(createSave("window-mix"));
    const report = runTransferDiagnostic(db, { seed: "window-mix", worldDate: "2026-08-01" });
    const market = new TransferMarketRepository(db);
    const machhindra = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const search = searchPlayersForClub(db, machhindra, {}, "2026-08-01");

    expect(report.renewals).toBeGreaterThan(0);
    expect(report.releases).toBeGreaterThan(0);
    expect(report.freeAgentSignings).toBeGreaterThan(0);
    expect(report.completedTransfers).toBeGreaterThan(0);
    expect(report.loans).toBeGreaterThan(0);
    expect(report.offers).toBeGreaterThanOrEqual(report.completedTransfers);
    expect(report.sampleNegotiationTimeline.length).toBeGreaterThanOrEqual(2);
    expect(market.transferHistory().map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["TRANSFER_COMPLETED", "FREE_AGENT_SIGNED", "LOAN_STARTED"]),
    );
    expect(search.some((item) => "currentAbility" in (item as object))).toBe(false);
    db.close();
  });

  it("evaluates offers from club knowledge and preserves person identity after transfer", () => {
    const db = openGameDatabase(createSave("offer-person-id"));
    const buyingClubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const target = searchPlayersForClub(db, buyingClubId, {}, "2026-08-01").find(
      (item) => item.clubId && item.clubId !== buyingClubId && item.estimatedAbility,
    )!;
    const offer = createTransferOffer(db, {
      buyingClubId,
      sellingClubId: target.clubId,
      playerId: target.playerId,
      submittedAt: "2026-08-01",
      fee: 1_500_000,
    });

    const evaluation = evaluateTransferOffer(db, offer, "2026-08-01", "offer-person-id");
    if (evaluation.accepted) {
      runTransferDiagnostic(db, { seed: "offer-person-id", worldDate: "2026-08-01" });
    }

    const personRows = db
      .prepare("SELECT COUNT(*) AS count FROM persons WHERE id = ?")
      .get(target.playerId) as {
      count: number;
    };
    const activeAssignments = db
      .prepare(
        `SELECT COUNT(*) AS count
        FROM team_person_assignments
        WHERE person_id = ? AND role = 'PLAYER' AND ended_on IS NULL`,
      )
      .get(target.playerId) as { count: number };

    expect(offer.askingRange).toEqual(target.estimatedAbility ? expect.any(Object) : undefined);
    expect(personRows.count).toBe(1);
    expect(activeAssignments.count).toBeLessThanOrEqual(1);
    db.close();
  });

  it("builds contextual transfer valuation ranges from knowledge rather than a public exact value", () => {
    const db = openGameDatabase(createSave("valuation-ranges"));
    const buyingClubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const target = transferTargetForClub(db, buyingClubId);

    const valuation = calculateTransferValuation(db, {
      buyingClubId,
      sellingClubId: target.clubId,
      playerId: target.playerId,
      worldDate: "2026-08-01",
    });

    expect(valuation.internalValue.min).toBeLessThan(valuation.internalValue.max);
    expect(valuation.scoutEstimate.min).toBeLessThan(valuation.scoutEstimate.max);
    expect(valuation.askingRange.min).toBeLessThan(valuation.askingRange.max);
    expect(valuation.scoutEstimate).not.toEqual(valuation.internalValue);
    expect(valuation.factors.buyerWealthPerception).toBeGreaterThan(0);
    db.close();
  });

  it("applies contract-expiry leverage, seller reluctance and financial pressure", () => {
    const db = openGameDatabase(createSave("valuation-leverage"));
    const market = new TransferMarketRepository(db);
    const buyingClubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const target = transferTargetForClub(db, buyingClubId);
    const contract = market.activeContract(target.playerId, "2026-08-01")!;
    const sellerFinance = market.clubFinancialProfile(target.clubId)!;

    market.upsertPlayerContract({ ...contract, endDate: "2028-08-01", squadRole: "KEY_PLAYER" });
    market.upsertTransferStatus({
      id: `status-not-for-sale-${target.playerId}` as EntityId,
      playerId: target.playerId,
      clubId: target.clubId,
      status: "NOT_FOR_SALE",
      reason: "Core starter",
      setBy: "CLUB",
      updatedAt: "2026-08-01",
    });
    const reluctant = calculateTransferValuation(db, {
      buyingClubId,
      sellingClubId: target.clubId,
      playerId: target.playerId,
      worldDate: "2026-08-01",
    });

    market.upsertPlayerContract({ ...contract, endDate: "2026-09-01", squadRole: "ROTATION" });
    market.upsertTransferStatus({
      id: `status-listed-${target.playerId}` as EntityId,
      playerId: target.playerId,
      clubId: target.clubId,
      status: "TRANSFER_LISTED",
      reason: "Needs cash",
      setBy: "CLUB",
      updatedAt: "2026-08-01",
    });
    market.upsertClubFinancialProfile({ ...sellerFinance, financialHealth: "POOR" });
    const pressured = calculateTransferValuation(db, {
      buyingClubId,
      sellingClubId: target.clubId,
      playerId: target.playerId,
      worldDate: "2026-08-01",
    });

    expect(pressured.factors.contractExpiryLeverage).toBeLessThan(
      reluctant.factors.contractExpiryLeverage,
    );
    expect(pressured.factors.sellerFinancePressure).toBeLessThan(
      reluctant.factors.sellerFinancePressure,
    );
    expect(pressured.askingRange.max).toBeLessThan(reluctant.askingRange.min);
    db.close();
  });

  it("values player exchanges, cash plus player offers and seller-requested counter players", () => {
    const db = openGameDatabase(createSave("exchange-packages"));
    const buyingClubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const target = transferTargetForClub(db, buyingClubId);
    const exchangePlayerId = playerForClub(db, buyingClubId);

    const offer = createTransferOffer(db, {
      buyingClubId,
      sellingClubId: target.clubId,
      playerId: target.playerId,
      submittedAt: "2026-08-01",
      fee: 250_000,
      installments: 80_000,
      addOns: 40_000,
      conditionals: [
        {
          type: "APPEARANCE",
          threshold: 15,
          amount: 60_000,
          description: "After 15 appearances",
        },
      ],
      exchangePlayerIds: [exchangePlayerId],
    });
    const cashOnly = createTransferOffer(db, {
      buyingClubId,
      sellingClubId: target.clubId,
      playerId: target.playerId,
      submittedAt: "2026-08-02",
      fee: 250_000,
    });
    const counter = counterTransferOffer(db, offer, {
      worldDate: "2026-08-03",
      transferFee: 300_000,
      sellerRequestedPlayerId: exchangePlayerId,
    });

    expect(offer.playerExchanges?.[0]?.valuation.min).toBeGreaterThan(0);
    expect(calculateTransferPackageValue(offer)).toBeGreaterThan(
      calculateTransferPackageValue(cashOnly),
    );
    expect(counter.status).toBe("COUNTERED");
    expect(counter.sellerRequestedPlayerId).toBe(exchangePlayerId);
    expect(
      new TransferMarketRepository(db).negotiationRounds(offer.id).map((round) => round.action),
    ).toContain("COUNTER");
    db.close();
  });

  it("persists transfer enquiries, availability responses and negotiated offers across reload", () => {
    const databasePath = createSave("negotiation-persistence");
    const db = openGameDatabase(databasePath);
    const buyingClubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const target = transferTargetForClub(db, buyingClubId);
    const enquiry = createTransferEnquiry(db, {
      buyingClubId,
      sellingClubId: target.clubId,
      playerId: target.playerId,
      submittedAt: "2026-08-01",
    });
    const response = respondToTransferEnquiry(db, enquiry, "2026-08-02");
    const counter = counterTransferOffer(db, response, {
      worldDate: "2026-08-03",
      installments: 120_000,
      sellOnPercentage: 15,
    });
    db.close();

    const reloaded = openGameDatabase(databasePath);
    const market = new TransferMarketRepository(reloaded);
    const persisted = market.transferOffers().find((offer) => offer.id === counter.id)!;
    const rounds = market.negotiationRounds(counter.id);

    expect(persisted.status).toBe("COUNTERED");
    expect(persisted.askingRange?.min).toBeGreaterThan(0);
    expect(persisted.installments).toBe(120_000);
    expect(persisted.sellOnPercentage).toBe(15);
    expect(rounds.map((round) => round.action)).toEqual(
      expect.arrayContaining(["ENQUIRY", "AVAILABILITY_RESPONSE", "COUNTER"]),
    );
    reloaded.close();
  });

  it("keeps low-exposure players self-represented until agent interest is earned", () => {
    const db = openGameDatabase(createSave("self-represented"));
    const market = new TransferMarketRepository(db);
    const playerId = lowExposurePlayer(db);
    const assessment = assessAgentInterest(db, {
      playerId,
      worldDate: "2026-08-01",
      playerAmbition: 1,
    });

    expect(market.agentForPlayer(playerId)).toBeUndefined();
    expect(assessment.shouldApproach).toBe(false);
    expect(
      processAgentRepresentation(db, {
        playerId,
        worldDate: "2026-08-01",
        seed: "self-represented",
        trigger: "CAREER_EXPOSURE",
        playerAmbition: 1,
      }),
    ).toBeUndefined();
    db.close();
  });

  it("creates an agent approach after first senior Nepal call-up and can sign or decline", () => {
    const db = openGameDatabase(createSave("callup-agent"));
    const market = new TransferMarketRepository(db);
    const playerId = playerForClub(db, clubIdByCanonical(db, "NEP-DIVA-MAC"));
    insertNationalTeamExposure(db, playerId, { seniorCallup: true });

    const signed = processAgentRepresentation(db, {
      playerId,
      worldDate: "2026-08-10",
      seed: "callup-agent",
      trigger: "SENIOR_NEPAL_CALLUP",
      decision: "SIGNED",
    })!;

    expect(signed.decision).toBe("SIGNED");
    expect(signed.interestScore).toBeGreaterThanOrEqual(52);
    expect(market.agentForPlayer(playerId)).toBeDefined();

    const decliningPlayerId = playerForClub(db, clubIdByCanonical(db, "NEP-DIVA-FRN"));
    insertNationalTeamExposure(db, decliningPlayerId, { seniorCallup: true });
    const declined = processAgentRepresentation(db, {
      playerId: decliningPlayerId,
      worldDate: "2026-08-10",
      seed: "callup-agent-decline",
      trigger: "SENIOR_NEPAL_CALLUP",
      decision: "DECLINED",
    })!;

    expect(declined.decision).toBe("DECLINED");
    expect(market.agentForPlayer(decliningPlayerId)).toBeUndefined();
    db.close();
  });

  it("uses foreign interest and exposure to choose suitable broader agent networks", () => {
    const db = openGameDatabase(createSave("foreign-network-agent"));
    const playerId = playerForClub(db, clubIdByCanonical(db, "NEP-DIVA-MAC"));
    const assessment = assessAgentInterest(db, {
      playerId,
      worldDate: "2026-08-01",
      foreignInterest: true,
      foreignBased: true,
      competitionExposure: "ASIAN_CUP",
      playerAmbition: 12,
    });
    const approach = processAgentRepresentation(db, {
      playerId,
      worldDate: "2026-08-01",
      seed: "foreign-network-agent",
      trigger: "FOREIGN_INTEREST",
      foreignInterest: true,
      foreignBased: true,
      competitionExposure: "ASIAN_CUP",
      playerAmbition: 12,
      decision: "SIGNED",
    })!;

    expect(assessment.recommendedNetwork).toBe("EUROPE_GLOBAL");
    expect(approach.networkScope).toBe("EUROPE_GLOBAL");
    db.close();
  });

  it("allows players to switch agents over time and persists representation after reload", () => {
    const databasePath = createSave("agent-switch-reload");
    const db = openGameDatabase(databasePath);
    const playerId = playerForClub(db, clubIdByCanonical(db, "NEP-DIVA-MAC"));
    insertNationalTeamExposure(db, playerId, { seniorCallup: true, seniorAppearances: 6 });
    const first = processAgentRepresentation(db, {
      playerId,
      worldDate: "2026-08-10",
      seed: "agent-switch-one",
      trigger: "SENIOR_NEPAL_CALLUP",
      decision: "SIGNED",
    })!;
    const second = processAgentRepresentation(db, {
      playerId,
      worldDate: "2026-09-10",
      seed: "agent-switch-two",
      trigger: "SENIOR_INTERNATIONAL_APPEARANCE",
      competitionExposure: "ASIAN_CUP",
      decision: "SIGNED",
    })!;
    db.close();

    const reloaded = openGameDatabase(databasePath);
    const market = new TransferMarketRepository(reloaded);
    const active = market.agentForPlayer(playerId)!;
    const clients = market.agentClients(playerId);
    const approaches = market.agentApproaches(playerId);

    expect(first.agentId).not.toBe(second.agentId);
    expect(active.id).toBe(second.agentId);
    expect(clients.filter((client) => client.status === "ACTIVE")).toHaveLength(1);
    expect(clients.some((client) => client.status === "ENDED")).toBe(true);
    expect(approaches).toHaveLength(2);
    reloaded.close();
  });

  it("makes represented negotiation more assertive while self-represented talks remain valid", () => {
    const db = openGameDatabase(createSave("represented-negotiation"));
    const buyingClubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const representedTarget = transferTargetForClub(db, buyingClubId);
    insertNationalTeamExposure(db, representedTarget.playerId, { seniorCallup: true });
    processAgentRepresentation(db, {
      playerId: representedTarget.playerId,
      worldDate: "2026-08-01",
      seed: "represented-negotiation",
      trigger: "SENIOR_NEPAL_CALLUP",
      decision: "SIGNED",
      foreignInterest: true,
      competitionExposure: "SAFF",
      playerAmbition: 12,
    });
    const representedOffer = createTransferOffer(db, {
      buyingClubId,
      sellingClubId: representedTarget.clubId,
      playerId: representedTarget.playerId,
      submittedAt: "2026-08-02",
      fee: 700_000,
    });
    const representedContract = negotiatePlayerContract(
      db,
      representedOffer,
      "2026-08-03",
      "represented-negotiation",
    );
    new TransferMarketRepository(db).endActiveAgentClient(representedTarget.playerId);
    const selfOffer = createTransferOffer(db, {
      buyingClubId,
      sellingClubId: representedTarget.clubId,
      playerId: representedTarget.playerId,
      submittedAt: "2026-08-04",
      fee: 700_000,
    });

    const selfContract = negotiatePlayerContract(
      db,
      selfOffer,
      "2026-08-03",
      "represented-negotiation",
    );

    expect(representedOffer.agentFee).toBeGreaterThan(0);
    expect(selfOffer.agentFee).toBe(0);
    expect(representedContract.salary).toBeGreaterThan(selfContract.salary);
    expect(selfContract.salary).toBeGreaterThan(0);
    db.close();
  });

  it("requires player agreement, supports counters and records competing personal terms", () => {
    const databasePath = createSave("phase-c-personal-terms");
    const db = openGameDatabase(databasePath);
    const buyingClubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const competingClubId = clubIdByCanonical(db, "NEP-DIVA-FRN");
    const target = transferTargetForClub(db, buyingClubId);
    const suitableOffer = createTransferOffer(db, {
      buyingClubId,
      sellingClubId: target.clubId,
      playerId: target.playerId,
      submittedAt: "2026-08-01",
      fee: 500_000,
    });
    acceptTransferOffer(db, suitableOffer, "2026-08-01");
    const clubAgreedOffer = { ...suitableOffer, status: "ACCEPTED" as const };
    const accepted = negotiatePlayerTerms(db, clubAgreedOffer, {
      worldDate: "2026-08-02",
      seed: "phase-c-accepted",
      proposal: { salary: 500_000, squadRole: "FIRST_TEAM", contractLengthMonths: 36 },
    });
    expect(accepted.state).toBe("ACCEPTED");
    expect(accepted.represented).toBe(false);
    expect(new TransferMarketRepository(db).negotiationRounds(suitableOffer.id).at(-1)?.actor).toBe(
      "PLAYER",
    );

    const overseasPreference = negotiatePlayerTerms(db, clubAgreedOffer, {
      worldDate: "2026-08-02",
      seed: "phase-c-overseas",
      preferences: { prefersOverseas: true },
      proposal: { salary: 500_000, squadRole: "FIRST_TEAM", contractLengthMonths: 36 },
    });
    expect(overseasPreference.score).toBeLessThan(accepted.score);

    const poorRole = negotiatePlayerTerms(db, clubAgreedOffer, {
      worldDate: "2026-08-03",
      seed: "phase-c-poor-role",
      proposal: { salary: 1, squadRole: "YOUTH", contractLengthMonths: 12 },
    });
    expect(poorRole.state).toBe("REJECTED");

    const countered = negotiatePlayerTerms(db, clubAgreedOffer, {
      worldDate: "2026-08-04",
      seed: "phase-c-counter",
      action: "COUNTER",
      counterProposal: { salary: 350_000, squadRole: "ROTATION", contractLengthMonths: 24 },
    });
    expect(countered.state).toBe("COUNTERED");

    const competing = createTransferOffer(db, {
      buyingClubId: competingClubId,
      sellingClubId: target.clubId,
      playerId: target.playerId,
      submittedAt: "2026-08-01",
      fee: 700_000,
    });
    acceptTransferOffer(db, competing, "2026-08-01");
    const preferred = negotiatePlayerTerms(db, clubAgreedOffer, {
      worldDate: "2026-08-05",
      seed: "phase-c-competing",
      proposal: { salary: 1, squadRole: "ROTATION", contractLengthMonths: 12 },
    });
    expect(preferred.state).toBe("COMPETING_OFFER");
    expect(preferred.preferredOfferId).toBe(competing.id);
    expect(
      new TransferMarketRepository(db).negotiationRounds(suitableOffer.id).length,
    ).toBeGreaterThan(2);
    db.close();

    const reloaded = openGameDatabase(databasePath);
    const persisted = new TransferMarketRepository(reloaded)
      .transferOffers()
      .find((item) => item.id === suitableOffer.id)!;
    expect(persisted.status).toBe("COMPETING_OFFER");
    expect(
      new TransferMarketRepository(reloaded)
        .negotiationRounds(suitableOffer.id)
        .some((round) => round.action === "COUNTER"),
    ).toBe(true);
    reloaded.close();
  });

  it("supports temporary loans without terminating parent contracts", () => {
    const db = openGameDatabase(createSave("loan-return"));
    const parentClubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const loanClubId = clubIdByCanonical(db, "NEP-DIVA-FRN");
    const market = new TransferMarketRepository(db);
    const playerId = playerForClub(db, parentClubId);
    const parentContract = market.activeContract(playerId, "2026-08-01")!;

    const loan = startLoan(db, parentClubId, loanClubId, playerId, "2026-08-01", "loan-return");

    expect(market.activeContract(playerId, "2026-08-15")?.id).toBe(parentContract.id);
    expect(market.activeLoans("2026-08-15").map((item) => item.id)).toContain(loan.id);
    expect(market.transferHistory().map((event) => event.eventType)).toContain("LOAN_STARTED");
    db.close();
  });

  it("covers Phase D loan terms, expiry, free-agent competition, requests and AI planning", () => {
    const databasePath = createSave("phase-d-market");
    const db = openGameDatabase(databasePath);
    const market = new TransferMarketRepository(db);
    const parentClubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const loanClubId = clubIdByCanonical(db, "NEP-DIVA-FRN");
    const loanPlayerId = playerForClub(db, parentClubId);
    const loan = startLoan(db, parentClubId, loanClubId, loanPlayerId, "2026-08-01", "phase-d", {
      endDate: "2026-12-01",
      wageContributionPercent: 70,
      loanFee: 25_000,
      playingTimeExpectation: "FIRST_TEAM",
    });
    expect(loan.wageContributionPercent).toBe(70);
    expect(loan.loanFee).toBe(25_000);
    expect(loan.playingTimeExpectation).toBe("FIRST_TEAM");
    endLoan(db, loan, "2026-09-01");
    expect(market.activeLoans("2026-09-02")).toHaveLength(0);
    expect(market.activeContract(loanPlayerId, "2026-09-02")?.clubId).toBe(parentClubId);

    const expiringPlayerId = market
      .activeContractsForClub(parentClubId, "2026-08-01")
      .find((contract) => contract.playerId !== loanPlayerId)!.playerId;
    const expiring = market.activeContract(expiringPlayerId, "2026-08-01")!;
    market.upsertPlayerContract({ ...expiring, endDate: "2026-08-01" });
    expect(processContractExpiries(db, "2026-08-01").releases).toBeGreaterThan(0);
    expect(market.transferStatus(expiringPlayerId)?.status).toBe("FREE_AGENT");

    const freeAgentOffer = createTransferOffer(db, {
      buyingClubId: parentClubId,
      playerId: expiringPlayerId,
      submittedAt: "2026-08-02",
      fee: 0,
    });
    const rivalClubId = clubIdByCanonical(db, "NEP-DIVA-FRN");
    const rivalOffer = createTransferOffer(db, {
      buyingClubId: rivalClubId,
      playerId: expiringPlayerId,
      submittedAt: "2026-08-02",
      fee: 0,
    });
    expect(
      assessFreeAgentSigning(db, rivalClubId, expiringPlayerId, "2026-08-02").competition,
    ).toBe(1);
    market.insertTransferHistoryEvent({
      id: createStableEntityId("transfer-history", `${expiringPlayerId}:flip-protection`),
      playerId: expiringPlayerId,
      eventType: "FREE_AGENT_SIGNED",
      occurredOn: "2026-08-02",
      data: { clubId: parentClubId },
    });
    expect(assessFreeAgentSigning(db, rivalClubId, expiringPlayerId, "2026-08-15").eligible).toBe(
      false,
    );
    expect(freeAgentOffer.status).toBe("SUBMITTED");
    expect(rivalOffer.status).toBe("SUBMITTED");

    const requestPlayerId = playerForClub(db, parentClubId);
    const request = requestPlayerTransfer(db, {
      playerId: requestPlayerId,
      worldDate: "2026-08-03",
      satisfaction: 10,
      ambition: 12,
      foreignInterest: true,
      reason: "Wants regular first-team football",
    });
    expect(request.status).toBe("PENDING");
    const acceptedRequest = respondToPlayerTransferRequest(db, request, "ACCEPTED", "2026-08-04");
    expect(acceptedRequest.status).toBe("ACCEPTED");
    expect(market.transferStatus(requestPlayerId)?.status).toBe("TRANSFER_LISTED");

    const plan = aiRecruitmentPlan(db, parentClubId, "2026-08-04");
    expect(plan.identity).toBe(clubTransferIdentity(db, parentClubId));
    expect(plan.transferBudget).toBeGreaterThanOrEqual(0);
    expect(plan.wageBudgetRemaining).toBeGreaterThanOrEqual(0);
    expect(plan.foreignSlotsRemaining).toBeGreaterThanOrEqual(0);
    expect(plan.needs.clubId).toBe(parentClubId);

    const lowballTarget = transferTargetForClub(db, parentClubId);
    const firstLowball = createTransferOffer(db, {
      buyingClubId: parentClubId,
      sellingClubId: lowballTarget.clubId,
      playerId: lowballTarget.playerId,
      submittedAt: "2026-08-05",
      fee: 0,
    });
    evaluateTransferOffer(db, firstLowball, "2026-08-05", "phase-d-lowball-1");
    const secondLowball = createTransferOffer(db, {
      buyingClubId: parentClubId,
      sellingClubId: lowballTarget.clubId,
      playerId: lowballTarget.playerId,
      submittedAt: "2026-08-06",
      fee: 0,
    });
    evaluateTransferOffer(db, secondLowball, "2026-08-06", "phase-d-lowball-2");
    expect(
      market
        .negotiationRounds(secondLowball.id)
        .some((round) => round.message.includes("repeated lowball")),
    ).toBe(true);
    db.close();

    const reloaded = openGameDatabase(databasePath);
    expect(new TransferMarketRepository(reloaded).transferRequests(requestPlayerId)).toHaveLength(
      1,
    );
    expect(new TransferMarketRepository(reloaded).activeLoans("2026-09-02")).toHaveLength(0);
    reloaded.close();
  });

  it("keeps three-season transfer careers playable and deterministic", () => {
    const first = openGameDatabase(createSave("deterministic-transfer-career"));
    const second = openGameDatabase(createSave("deterministic-transfer-career"));

    const firstReport = simulateNepalCareer({
      db: first,
      seasons: 3,
      seed: "deterministic-transfer-career",
      transfersEnabled: true,
    });
    const secondReport = simulateNepalCareer({
      db: second,
      seasons: 3,
      seed: "deterministic-transfer-career",
      transfersEnabled: true,
    });
    const firstHistory = new TransferMarketRepository(first).transferHistory();
    const secondHistory = new TransferMarketRepository(second).transferHistory();

    expect(firstReport.worldDate).toBe("2029-07-31");
    expect(
      firstReport.seasons.every((season) => season.matchesPlayed === season.fixturesGenerated),
    ).toBe(true);
    expect(firstHistory.length).toBeGreaterThan(0);
    expect(firstHistory).toEqual(secondHistory);
    expect(firstReport.seasons.map((season) => season.matchesPlayed)).toEqual(
      secondReport.seasons.map((season) => season.matchesPlayed),
    );
    first.close();
    second.close();
  });

  it("persists squad-need analysis for recruitment decisions", () => {
    const db = openGameDatabase(createSave("squad-needs"));
    const clubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const report = analyzeSquadNeeds(db, clubId, "2026-08-01");
    new TransferMarketRepository(db).upsertSquadNeedReport(report);

    expect(report.clubId).toBe(clubId);
    expect(report.expectedDepartures).toBeGreaterThanOrEqual(0);
    expect(report.needs.every((need) => ["LOW", "MEDIUM", "HIGH"].includes(need.severity))).toBe(
      true,
    );
    db.close();
  });
});

function clubIdByCanonical(
  db: ReturnType<typeof openGameDatabase>,
  canonicalExternalId: string,
): EntityId {
  return (
    db.prepare("SELECT id FROM clubs WHERE canonical_external_id = ?").get(canonicalExternalId) as {
      id: EntityId;
    }
  ).id;
}

function playerForClub(db: ReturnType<typeof openGameDatabase>, clubId: EntityId): EntityId {
  return (
    db
      .prepare(
        "SELECT player_id AS id FROM player_factual_profiles WHERE current_club_id = ? LIMIT 1",
      )
      .get(clubId) as { id: EntityId }
  ).id;
}

function lowExposurePlayer(db: ReturnType<typeof openGameDatabase>): EntityId {
  const rows = db
    .prepare(
      `SELECT pfp.player_id AS id
      FROM player_factual_profiles pfp
      JOIN clubs c ON c.id = pfp.current_club_id
      WHERE c.canonical_external_id LIKE 'NEP-DIVB-%'
         OR c.canonical_external_id LIKE 'NEP-DIVC-%'
      ORDER BY c.canonical_external_id, pfp.player_id`,
    )
    .all() as Array<{ id: EntityId }>;
  const candidate = rows.find(
    (row) =>
      !assessAgentInterest(db, {
        playerId: row.id,
        worldDate: "2026-08-01",
        playerAmbition: 1,
      }).shouldApproach,
  );
  return (
    candidate ??
    (db
      .prepare(
        `SELECT pfp.player_id AS id
        FROM player_factual_profiles pfp
        ORDER BY pfp.player_id
        LIMIT 1`,
      )
      .get() as { id: EntityId })
  ).id;
}

function transferTargetForClub(
  db: ReturnType<typeof openGameDatabase>,
  buyingClubId: EntityId,
): { playerId: EntityId; clubId: EntityId } {
  const target = searchPlayersForClub(db, buyingClubId, {}, "2026-08-01").find(
    (item) => item.clubId && item.clubId !== buyingClubId && item.estimatedAbility,
  );
  if (!target?.clubId) {
    throw new Error("Expected a transfer target with a current club");
  }
  return { playerId: target.playerId, clubId: target.clubId };
}

function insertNationalTeamExposure(
  db: ReturnType<typeof openGameDatabase>,
  playerId: EntityId,
  input: { seniorCallup?: boolean; seniorAppearances?: number },
): void {
  const federation = db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as {
    id: EntityId;
  };
  const teamId = createStableEntityId("team", "phase-b-nepal-senior-men");
  db.prepare(
    `INSERT OR IGNORE INTO teams
    (id, club_id, federation_id, name, level, gender)
    VALUES (?, NULL, ?, 'Nepal Senior Men', 'senior', 'men')`,
  ).run(teamId, federation.id);

  if (input.seniorCallup) {
    db.prepare(
      `INSERT OR IGNORE INTO national_team_callups
      (id, national_team_id, player_id, callup_date, programme, squad_type, status,
        provenance_status)
      VALUES (?, ?, ?, '2026-08-05', 'SENIOR_MEN', 'SENIOR', 'CALLED_UP', 'SIMULATION_ONLY')`,
    ).run(createStableEntityId("national-team-callup", `${teamId}:${playerId}`), teamId, playerId);
  }

  for (let index = 0; index < (input.seniorAppearances ?? 0); index += 1) {
    db.prepare(
      `INSERT OR IGNORE INTO national_team_appearances
      (id, national_team_id, player_id, match_date, opponent_name, minutes, goals, status)
      VALUES (?, ?, ?, ?, 'Test Opponent', 70, 0, 'RECORDED')`,
    ).run(
      createStableEntityId("national-team-appearance", `${teamId}:${playerId}:${index}`),
      teamId,
      playerId,
      `2026-08-${String(6 + index).padStart(2, "0")}`,
    );
  }
}
