import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  ExecutiveRoleRepository,
  StaffMarketRepository,
  TransferMarketRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  ClubFinanceAuthorityError,
  acceptSponsorshipForExecutive,
  applyClubLoanForExecutive,
  applyForClubLoanCommand,
  assignExecutiveRole,
  clubFinanceMeetingOverview,
  counterSponsorshipForExecutive,
  dismissStaff,
  ExecutiveRoleError,
  hireStaff,
  hireStaffForExecutive,
  initializeClubFinanceMarkets,
  rejectSponsorshipForExecutive,
  repayClubLoanCommand,
  repayClubLoanForExecutive,
  setBudgetForExecutive,
  sponsorMeetingOverview,
} from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type Club,
  type EntityId,
  type Team,
} from "@nepal-football-sim/shared-types";

const saveAt = (worldDate: string) => ({
  id: createStableEntityId("save", "exec-authority-finance-test"),
  name: "Executive Authority Finance Test",
  worldDate,
  databaseVersion: 38,
  gameVersion: "test",
  randomSeed: "exec-authority-finance-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSavedAt: "2026-01-01T00:00:00.000Z",
});

const country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };

/**
 * One real club: a controlling (75%) owner, a real senior team, and enough
 * finance state to actually run a loan through. The CEO seat starts vacant —
 * each test fills or leaves it as its scenario requires.
 */
const buildFixture = (
  dbPath: string,
): { db: GameDatabase; club: Club; team: Team; ownerId: EntityId } => {
  const db = openGameDatabase(dbPath);
  migrateDatabase(db);
  const world = new WorldRepository(db);
  const finances = new TransferMarketRepository(db);
  world.insertCountry(country);

  const club: Club = {
    id: createStableEntityId("club", "eaf-club"),
    name: "Executive Authority FC",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const team: Team = {
    id: createStableEntityId("team", "eaf-club-senior"),
    clubId: club.id,
    name: "Executive Authority FC",
    level: "senior",
    gender: "men",
  };
  world.insertClub(club);
  world.insertTeam(team);
  finances.upsertClubFinancialProfile({
    id: createStableEntityId("finance", club.id),
    clubId: club.id,
    wageBudget: 20_000_000,
    transferBudget: 0,
    currentWageSpend: 0,
    financialHealth: "STABLE",
    currency: "NPR",
    status: "SIMULATION_ONLY",
  });

  const ownerId = createStableEntityId("person", "eaf-owner");
  world.insertPerson({
    id: ownerId,
    fullName: "Controlling Owner",
    nationalityCountryId: country.id,
    languages: ["ne"],
  });
  db.prepare(
    "INSERT INTO club_ownership_stakes (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    createStableEntityId("ownership-stake", "eaf-owner-stake"),
    club.id,
    "PERSON",
    ownerId,
    "Controlling Owner",
    "MAJORITY_OWNER",
    75,
    75,
    "2026-01-01",
    "ACTIVE",
    "BUYABLE",
    "SIMULATION_ONLY",
  );

  const economy = new ClubEconomyRepository(db);
  economy.upsertFinancialAccount({
    clubId: club.id,
    currency: "NPR",
    cashBalance: 5_000_000,
    restrictedCash: 0,
    receivables: 0,
    payables: 0,
    debtBalance: 0,
    equityBalance: 0,
    seasonRevenue: 0,
    seasonExpenses: 0,
    seasonProfitLoss: 0,
    financialHealth: "STABLE",
    lastUpdatedAt: "2026-01-01",
    status: "SIMULATION_ONLY",
  });
  initializeClubFinanceMarkets(db);

  return { db, club, team, ownerId };
};

const hireCeo = (db: GameDatabase, club: Club, team: Team, ownerId: EntityId): EntityId => {
  const ceoId = createStableEntityId("person", "eaf-ceo");
  new WorldRepository(db).insertPerson({
    id: ceoId,
    fullName: "Delegated CEO",
    nationalityCountryId: country.id,
    languages: ["ne"],
  });
  const appointment = hireStaff(
    db,
    saveAt("2026-08-01"),
    club.id,
    team.id,
    ceoId,
    "CEO",
    500_000,
    24,
  );
  assignExecutiveRole(db, {
    clubId: club.id,
    ownerPersonId: ownerId,
    role: "CEO",
    appointment,
    date: "2026-08-01",
  });
  return ceoId;
};

describe("executive authority: club finance commands", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "exec-authority-finance-"));
  });

  it("lets the controlling owner apply for and repay a club loan", () => {
    const { db, club, ownerId } = buildFixture(join(dir, "career.sqlite"));
    const lender = new ClubEconomyRepository(db).lenders()[0]!;
    const application = applyForClubLoanCommand(db, {
      clubId: club.id,
      personId: ownerId,
      callerRole: "CHAIRMAN_OWNER",
      lenderId: lender.id,
      principal: 100_000,
      termMonths: 12,
      purpose: "working capital",
      date: "2026-08-01",
    });
    expect(application.status).toBe("APPROVED");
    const debt = new ClubEconomyRepository(db)
      .debts(club.id)
      .find((item) => item.lenderId === lender.id)!;
    const repaid = repayClubLoanCommand(db, {
      debtId: debt.id,
      personId: ownerId,
      callerRole: "CHAIRMAN_OWNER",
      date: "2026-08-02",
      amount: debt.scheduledPayment,
    });
    expect(repaid.outstandingPrincipal).toBeLessThan(debt.outstandingPrincipal);
    db.close();
  });

  it("rejects an unauthorized caller with a clear domain error, never silently executing", () => {
    const { db, club } = buildFixture(join(dir, "career.sqlite"));
    const lender = new ClubEconomyRepository(db).lenders()[0]!;
    const strangerId = createStableEntityId("person", "eaf-stranger");
    expect(() =>
      applyForClubLoanCommand(db, {
        clubId: club.id,
        personId: strangerId,
        callerRole: "CHAIRMAN_OWNER",
        lenderId: lender.id,
        principal: 100_000,
        termMonths: 12,
        purpose: "working capital",
        date: "2026-08-01",
      }),
    ).toThrow(ClubFinanceAuthorityError);
    expect(new ClubEconomyRepository(db).debts(club.id)).toHaveLength(0);
    db.close();
  });

  it("lets a delegated, filled CEO with budget authority also apply for a club loan, without removing the owner's own authority", () => {
    const { db, club, team, ownerId } = buildFixture(join(dir, "career.sqlite"));
    const ceoId = hireCeo(db, club, team, ownerId);
    const lender = new ClubEconomyRepository(db).lenders()[0]!;
    const ceoApplication = applyForClubLoanCommand(db, {
      clubId: club.id,
      personId: ceoId,
      callerRole: "CEO",
      lenderId: lender.id,
      principal: 80_000,
      termMonths: 12,
      purpose: "CEO-approved capital",
      date: "2026-08-05",
    });
    expect(ceoApplication.status).toBe("APPROVED");
    // Delegating to a CEO is additive, not exclusive: majority-owner control
    // remains authoritative, so the owner can still act directly.
    const ownerApplication = applyForClubLoanCommand(db, {
      clubId: club.id,
      personId: ownerId,
      callerRole: "CHAIRMAN_OWNER",
      lenderId: lender.id,
      principal: 50_000,
      termMonths: 12,
      purpose: "Owner-approved capital",
      date: "2026-08-06",
    });
    expect(ownerApplication.status).toBe("APPROVED");
    db.close();
  });

  it("rejects a vacant CEO seat cleanly — no crash, no unauthorized fallback", () => {
    const { db, club } = buildFixture(join(dir, "career.sqlite"));
    const lender = new ClubEconomyRepository(db).lenders()[0]!;
    const someStaffPersonId = createStableEntityId("person", "eaf-unassigned-staff");
    new WorldRepository(db).insertPerson({
      id: someStaffPersonId,
      fullName: "Unassigned Person",
      nationalityCountryId: country.id,
      languages: ["ne"],
    });
    expect(new ExecutiveRoleRepository(db).role(club.id, "CEO")).toBeUndefined();
    expect(() =>
      applyForClubLoanCommand(db, {
        clubId: club.id,
        personId: someStaffPersonId,
        callerRole: "CEO",
        lenderId: lender.id,
        principal: 80_000,
        termMonths: 12,
        purpose: "Unauthorized attempt",
        date: "2026-08-01",
      }),
    ).toThrow(ClubFinanceAuthorityError);
    db.close();
  });

  it("rejects a CEO whose executive role was assigned but is not the caller", () => {
    const { db, club, team, ownerId } = buildFixture(join(dir, "career.sqlite"));
    hireCeo(db, club, team, ownerId);
    const lender = new ClubEconomyRepository(db).lenders()[0]!;
    const otherPersonId = createStableEntityId("person", "eaf-other");
    new WorldRepository(db).insertPerson({
      id: otherPersonId,
      fullName: "Not The CEO",
      nationalityCountryId: country.id,
      languages: ["ne"],
    });
    expect(() =>
      applyForClubLoanCommand(db, {
        clubId: club.id,
        personId: otherPersonId,
        callerRole: "CEO",
        lenderId: lender.id,
        principal: 80_000,
        termMonths: 12,
        purpose: "Impersonation attempt",
        date: "2026-08-01",
      }),
    ).toThrow(ClubFinanceAuthorityError);
    db.close();
  });

  it("reconciles role loss: a CEO whose staff appointment was dismissed loses executive authority even though the assignment row still reads FILLED", () => {
    // Live-discovered gap: dismissStaff ends the appointment but does not
    // itself touch club_executive_roles, so the persisted row can go stale
    // (still status='FILLED') for a person who is no longer actually
    // employed there. Authority must be derived from the live appointment,
    // never the persisted FILLED flag alone.
    const { db, club, team, ownerId } = buildFixture(join(dir, "career.sqlite"));
    const ceoId = hireCeo(db, club, team, ownerId);
    const lender = new ClubEconomyRepository(db).lenders()[0]!;
    expect(
      applyForClubLoanCommand(db, {
        clubId: club.id,
        personId: ceoId,
        callerRole: "CEO",
        lenderId: lender.id,
        principal: 60_000,
        termMonths: 12,
        purpose: "Before dismissal",
        date: "2026-08-01",
      }).status,
    ).toBe("APPROVED");

    const appointment = new StaffMarketRepository(db).activeAppointment(ceoId)!;
    dismissStaff(
      db,
      { ...saveAt("2026-08-10"), id: createStableEntityId("save", "eaf-dismiss") },
      appointment.id,
    );

    expect(new ExecutiveRoleRepository(db).role(club.id, "CEO")?.status).toBe("FILLED");
    expect(() =>
      applyForClubLoanCommand(db, {
        clubId: club.id,
        personId: ceoId,
        callerRole: "CEO",
        lenderId: lender.id,
        principal: 60_000,
        termMonths: 12,
        purpose: "After dismissal — must be rejected",
        date: "2026-08-11",
      }),
    ).toThrow(ClubFinanceAuthorityError);
    db.close();
  });

  it("lets a filled CEO apply for a club loan through the canonical executive-authority adapter (never a direct repository write)", () => {
    const { db, club, team, ownerId } = buildFixture(join(dir, "career.sqlite"));
    const ceoId = hireCeo(db, club, team, ownerId);
    const lender = new ClubEconomyRepository(db).lenders()[0]!;
    const application = applyClubLoanForExecutive(db, {
      clubId: club.id,
      lenderId: lender.id,
      principal: 60_000,
      termMonths: 12,
      purpose: "Executive-authority adapter path",
      date: "2026-08-05",
      actor: { role: "CEO", personId: ceoId },
    });
    expect(application.status).toBe("APPROVED");
    db.close();
  });

  it("rejects a GENERAL_SECRETARY acting through the CEO-only budget/loan authority, even with a filled role elsewhere", () => {
    const { db, club, team, ownerId } = buildFixture(join(dir, "career.sqlite"));
    const secretaryId = createStableEntityId("person", "eaf-secretary");
    new WorldRepository(db).insertPerson({
      id: secretaryId,
      fullName: "General Secretary",
      nationalityCountryId: country.id,
      languages: ["ne"],
    });
    const appointment = hireStaff(
      db,
      saveAt("2026-08-01"),
      club.id,
      team.id,
      secretaryId,
      "GENERAL_SECRETARY",
      450_000,
      24,
    );
    assignExecutiveRole(db, {
      clubId: club.id,
      ownerPersonId: ownerId,
      role: "GENERAL_SECRETARY",
      appointment,
      date: "2026-08-01",
    });
    const lender = new ClubEconomyRepository(db).lenders()[0]!;
    expect(() =>
      applyClubLoanForExecutive(db, {
        clubId: club.id,
        lenderId: lender.id,
        principal: 60_000,
        termMonths: 12,
        purpose: "Secretary attempting a CEO-only action",
        date: "2026-08-05",
        actor: { role: "GENERAL_SECRETARY", personId: secretaryId },
      }),
    ).toThrow(ExecutiveRoleError);
    db.close();
  });

  it("lets a delegated CEO with budget authority repay a club loan through the canonical executive adapter", () => {
    const { db, club, team, ownerId } = buildFixture(join(dir, "career.sqlite"));
    const ceoId = hireCeo(db, club, team, ownerId);
    const lender = new ClubEconomyRepository(db).lenders()[0]!;
    const application = applyClubLoanForExecutive(db, {
      clubId: club.id,
      lenderId: lender.id,
      principal: 100_000,
      termMonths: 12,
      purpose: "working capital",
      date: "2026-08-01",
      actor: { role: "CEO", personId: ceoId },
    });
    expect(application.status).toBe("APPROVED");
    const debt = new ClubEconomyRepository(db).debts(club.id).find((item) => item.lenderId === lender.id)!;
    const repaid = repayClubLoanForExecutive(db, {
      clubId: club.id,
      debtId: debt.id,
      amount: debt.scheduledPayment,
      date: "2026-08-02",
      actor: { role: "CEO", personId: ceoId },
    });
    expect(repaid.outstandingPrincipal).toBeLessThan(debt.outstandingPrincipal);
    db.close();
  });

  it("rejects a GENERAL_SECRETARY attempting the CEO-only loan repayment authority", () => {
    const { db, club, team, ownerId } = buildFixture(join(dir, "career.sqlite"));
    const secretaryId = createStableEntityId("person", "eaf-repay-secretary");
    new WorldRepository(db).insertPerson({
      id: secretaryId,
      fullName: "General Secretary",
      nationalityCountryId: country.id,
      languages: ["ne"],
    });
    const appointment = hireStaff(db, saveAt("2026-08-01"), club.id, team.id, secretaryId, "GENERAL_SECRETARY", 450_000, 24);
    assignExecutiveRole(db, { clubId: club.id, ownerPersonId: ownerId, role: "GENERAL_SECRETARY", appointment, date: "2026-08-01" });
    const lender = new ClubEconomyRepository(db).lenders()[0]!;
    const application = applyForClubLoanCommand(db, { clubId: club.id, personId: ownerId, callerRole: "CHAIRMAN_OWNER", lenderId: lender.id, principal: 100_000, termMonths: 12, purpose: "working capital", date: "2026-08-01" });
    const debt = new ClubEconomyRepository(db).debts(club.id).find((item) => item.lenderId === application.lenderId)!;
    expect(() =>
      repayClubLoanForExecutive(db, {
        clubId: club.id,
        debtId: debt.id,
        date: "2026-08-05",
        actor: { role: "GENERAL_SECRETARY", personId: secretaryId },
      }),
    ).toThrow(ExecutiveRoleError);
    db.close();
  });

  it("builds an honest bank-meeting overview: real lenders, headroom, and applications scoped to one club", () => {
    const { db, club, ownerId } = buildFixture(join(dir, "career.sqlite"));
    const before = clubFinanceMeetingOverview(db, club.id, "2026-08-01");
    expect(before.lenders.length).toBeGreaterThan(0);
    expect(before.debts).toEqual([]);
    expect(before.loans).toEqual([]);
    expect(before.existingDebt).toBe(0);
    expect(before.headroom).toBeGreaterThan(0);

    const lender = before.lenders[0]!;
    applyForClubLoanCommand(db, { clubId: club.id, personId: ownerId, callerRole: "CHAIRMAN_OWNER", lenderId: lender.id, principal: 100_000, termMonths: 12, purpose: "working capital", date: "2026-08-01" });
    const after = clubFinanceMeetingOverview(db, club.id, "2026-08-01");
    expect(after.loans).toHaveLength(1);
    expect(after.debts).toHaveLength(1);
    expect(after.existingDebt).toBe(100_000);
    // Headroom is derived from live valuation, and the loan drawdown itself
    // raises cash (and so valuation) — it is not guaranteed to fall just
    // because debt rose. What must hold is the ceiling arithmetic itself.
    expect(after.headroom).toBe(Math.max(0, Math.min(after.maxNewPrincipal, after.maxTotalDebt - after.existingDebt)));
    db.close();
  });
});

describe("executive authority: commercial and staff-recruitment adapters", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "exec-authority-commands-"));
  });

  it("lets a filled CEO with commercial oversight accept a real sponsorship offer", () => {
    const { db, club, team, ownerId } = buildFixture(join(dir, "career.sqlite"));
    const ceoId = hireCeo(db, club, team, ownerId);
    const economy = new ClubEconomyRepository(db);
    const sponsorId = createStableEntityId("sponsor", "eaf-sponsor");
    economy.upsertSponsor({
      id: sponsorId,
      name: "Test Sponsor Ltd",
      industry: "TELECOM",
      reputation: 6,
      budgetTier: "REGIONAL",
      status: "SIMULATION_ONLY",
    });
    economy.upsertSponsorship({
      id: createStableEntityId("sponsorship-contract", "eaf-offer"),
      clubId: club.id,
      sponsorId,
      type: "SHIRT_MAIN",
      startDate: "2026-08-05",
      endDate: "2027-08-05",
      annualValue: 500_000,
      bonuses: { champion: 60_000, promotion: 40_000 },
      currency: "NPR",
      status: "OFFERED",
      exclusivityGroup: "SHIRT_MAIN",
      expectations: { appearances: 6, socialReach: 30 },
      provenanceStatus: "SIMULATION_ONLY",
    });
    const contract = acceptSponsorshipForExecutive(db, {
      clubId: club.id,
      sponsorshipId: createStableEntityId("sponsorship-contract", "eaf-offer"),
      date: "2026-08-05",
      actor: { role: "CEO", personId: ceoId },
    });
    expect(contract.status).toBe("ACTIVE");
    db.close();
  });

  it("rejects an unassigned person attempting to accept a sponsorship as CEO", () => {
    const { db, club } = buildFixture(join(dir, "career.sqlite"));
    const economy = new ClubEconomyRepository(db);
    const sponsorId = createStableEntityId("sponsor", "eaf-sponsor-2");
    economy.upsertSponsor({
      id: sponsorId,
      name: "Test Sponsor Two Ltd",
      industry: "BANKING",
      reputation: 5,
      budgetTier: "LOCAL",
      status: "SIMULATION_ONLY",
    });
    const sponsorshipId = createStableEntityId("sponsorship-contract", "eaf-offer-2");
    economy.upsertSponsorship({
      id: sponsorshipId,
      clubId: club.id,
      sponsorId,
      type: "SLEEVE",
      startDate: "2026-08-05",
      endDate: "2027-08-05",
      annualValue: 200_000,
      bonuses: { champion: 20_000, promotion: 10_000 },
      currency: "NPR",
      status: "OFFERED",
      exclusivityGroup: "SLEEVE",
      expectations: { appearances: 4, socialReach: 10 },
      provenanceStatus: "SIMULATION_ONLY",
    });
    const strangerId = createStableEntityId("person", "eaf-stranger-2");
    expect(() =>
      acceptSponsorshipForExecutive(db, {
        clubId: club.id,
        sponsorshipId,
        date: "2026-08-05",
        actor: { role: "CEO", personId: strangerId },
      }),
    ).toThrow(ExecutiveRoleError);
    db.close();
  });

  it("lets a filled CEO with budget authority set a club budget through the canonical adapter", () => {
    const { db, club, team, ownerId } = buildFixture(join(dir, "career.sqlite"));
    const ceoId = hireCeo(db, club, team, ownerId);
    const budget = setBudgetForExecutive(db, {
      clubId: club.id,
      seasonLabel: "2026",
      category: "WAGE_BUDGET",
      amount: 2_000_000,
      actor: { role: "CEO", personId: ceoId },
    });
    expect(budget.amount).toBe(2_000_000);
    db.close();
  });

  it("lets a filled CEO with staff-recruitment authority hire staff through the canonical hireStaff path, never a direct repository write", () => {
    const { db, club, team, ownerId } = buildFixture(join(dir, "career.sqlite"));
    const ceoId = hireCeo(db, club, team, ownerId);
    const scoutId = createStableEntityId("person", "eaf-scout");
    new WorldRepository(db).insertPerson({
      id: scoutId,
      fullName: "Executive-Hired Scout",
      nationalityCountryId: country.id,
      languages: ["ne"],
    });
    const appointment = hireStaffForExecutive(db, saveAt("2026-08-06"), {
      clubId: club.id,
      teamId: team.id,
      personId: scoutId,
      role: "SCOUT",
      salaryAmountMinor: 90_000,
      actor: { role: "CEO", personId: ceoId },
    });
    expect(appointment.role).toBe("SCOUT");
    expect(appointment.employmentStatus).toBe("ACTIVE");
    db.close();
  });

  it("builds an honest sponsor-meeting overview: real sponsor identity attached, bucketed by status", () => {
    const { db, club } = buildFixture(join(dir, "career.sqlite"));
    const economy = new ClubEconomyRepository(db);
    const sponsorId = createStableEntityId("sponsor", "eaf-sm-sponsor");
    economy.upsertSponsor({
      id: sponsorId,
      name: "Test Telecom Ltd",
      industry: "Telecommunications",
      reputation: 6,
      budgetTier: "NATIONAL",
      status: "VERIFIED",
      identityProvenance: "VERIFIED",
    });
    economy.upsertSponsorship({
      id: createStableEntityId("sponsorship-contract", "eaf-sm-offer"),
      clubId: club.id,
      sponsorId,
      type: "SHIRT_MAIN",
      startDate: "2026-08-05",
      endDate: "2027-08-05",
      annualValue: 500_000,
      bonuses: { champion: 60_000 },
      currency: "NPR",
      status: "OFFERED",
      exclusivityGroup: "SHIRT_MAIN",
      expectations: { appearances: 6, socialReach: 30 },
      provenanceStatus: "SIMULATION_ONLY",
    });
    const overview = sponsorMeetingOverview(db, club.id);
    expect(overview.offers).toHaveLength(1);
    expect(overview.offers[0]!.sponsorName).toBe("Test Telecom Ltd");
    expect(overview.offers[0]!.sponsorIndustry).toBe("Telecommunications");
    expect(overview.offers[0]!.sponsorBudgetTier).toBe("NATIONAL");
    expect(overview.offers[0]!.sponsorIdentityProvenance).toBe("VERIFIED");
    expect(overview.active).toEqual([]);
    expect(overview.history).toEqual([]);
    db.close();
  });

  it("lets a delegated CEO with commercial oversight reject a sponsorship through the canonical executive adapter", () => {
    const { db, club, team, ownerId } = buildFixture(join(dir, "career.sqlite"));
    const ceoId = hireCeo(db, club, team, ownerId);
    const economy = new ClubEconomyRepository(db);
    const sponsorId = createStableEntityId("sponsor", "eaf-reject-sponsor");
    economy.upsertSponsor({ id: sponsorId, name: "Reject Test Ltd", industry: "Banking", reputation: 5, budgetTier: "LOCAL", status: "SIMULATION_ONLY" });
    const sponsorshipId = createStableEntityId("sponsorship-contract", "eaf-reject-offer");
    economy.upsertSponsorship({ id: sponsorshipId, clubId: club.id, sponsorId, type: "SLEEVE", startDate: "2026-08-05", endDate: "2027-08-05", annualValue: 200_000, bonuses: {}, currency: "NPR", status: "OFFERED", provenanceStatus: "SIMULATION_ONLY" });
    const rejected = rejectSponsorshipForExecutive(db, { clubId: club.id, sponsorshipId, actor: { role: "CEO", personId: ceoId } });
    expect(rejected.status).toBe("REJECTED");
    db.close();
  });

  it("rejects a GENERAL_SECRETARY attempting the CEO-only commercial rejection authority", () => {
    const { db, club, team, ownerId } = buildFixture(join(dir, "career.sqlite"));
    const secretaryId = createStableEntityId("person", "eaf-sponsor-secretary");
    new WorldRepository(db).insertPerson({ id: secretaryId, fullName: "General Secretary", nationalityCountryId: country.id, languages: ["ne"] });
    const appointment = hireStaff(db, saveAt("2026-08-01"), club.id, team.id, secretaryId, "GENERAL_SECRETARY", 450_000, 24);
    assignExecutiveRole(db, { clubId: club.id, ownerPersonId: ownerId, role: "GENERAL_SECRETARY", appointment, date: "2026-08-01" });
    const economy = new ClubEconomyRepository(db);
    const sponsorId = createStableEntityId("sponsor", "eaf-secretary-sponsor");
    economy.upsertSponsor({ id: sponsorId, name: "Secretary Test Ltd", industry: "Retail", reputation: 4, budgetTier: "LOCAL", status: "SIMULATION_ONLY" });
    const sponsorshipId = createStableEntityId("sponsorship-contract", "eaf-secretary-offer");
    economy.upsertSponsorship({ id: sponsorshipId, clubId: club.id, sponsorId, type: "LOCAL_PARTNER", startDate: "2026-08-05", endDate: "2027-08-05", annualValue: 100_000, bonuses: {}, currency: "NPR", status: "OFFERED", provenanceStatus: "SIMULATION_ONLY" });
    expect(() =>
      rejectSponsorshipForExecutive(db, { clubId: club.id, sponsorshipId, actor: { role: "GENERAL_SECRETARY", personId: secretaryId } }),
    ).toThrow(ExecutiveRoleError);
    db.close();
  });

  it("lets a delegated CEO counter a sponsorship, and rejects a counter for a sponsorship belonging to a different club", () => {
    const { db, club, team, ownerId } = buildFixture(join(dir, "career.sqlite"));
    const ceoId = hireCeo(db, club, team, ownerId);
    const economy = new ClubEconomyRepository(db);
    const sponsorId = createStableEntityId("sponsor", "eaf-counter-sponsor");
    economy.upsertSponsor({ id: sponsorId, name: "Counter Test Ltd", industry: "Aviation", reputation: 7, budgetTier: "PREMIUM", status: "SIMULATION_ONLY" });
    const sponsorshipId = createStableEntityId("sponsorship-contract", "eaf-counter-offer");
    economy.upsertSponsorship({ id: sponsorshipId, clubId: club.id, sponsorId, type: "OFFICIAL_PARTNER", startDate: "2026-08-05", endDate: "2027-08-05", annualValue: 300_000, bonuses: {}, currency: "NPR", status: "OFFERED", provenanceStatus: "SIMULATION_ONLY" });
    const countered = counterSponsorshipForExecutive(db, {
      clubId: club.id,
      sponsorshipId,
      annualValue: 305_000,
      date: "2026-08-06",
      seed: "eaf-counter-test",
      actor: { role: "CEO", personId: ceoId },
    });
    // PREMIUM ceiling is 1.26x the original offer — a modest raise like this stays accepted or the sponsor walks; either way the command executed through the real negotiation math, not a fabricated always-succeed path.
    expect(["ACTIVE", "REJECTED"]).toContain(countered.status);

    const otherClub: Club = { id: createStableEntityId("club", "eaf-counter-other-club"), name: "Other FC", countryId: country.id, ownershipType: "PRIVATE" };
    new WorldRepository(db).insertClub(otherClub);
    const otherOffer = createStableEntityId("sponsorship-contract", "eaf-counter-other-club");
    economy.upsertSponsorship({ id: otherOffer, clubId: otherClub.id, sponsorId, type: "OFFICIAL_PARTNER", startDate: "2026-08-05", endDate: "2027-08-05", annualValue: 300_000, bonuses: {}, currency: "NPR", status: "OFFERED", provenanceStatus: "SIMULATION_ONLY" });
    expect(() =>
      counterSponsorshipForExecutive(db, {
        clubId: club.id,
        sponsorshipId: otherOffer,
        annualValue: 305_000,
        date: "2026-08-06",
        seed: "eaf-counter-test",
        actor: { role: "CEO", personId: ceoId },
      }),
    ).toThrow(/does not belong to this club/);
    db.close();
  });
});
