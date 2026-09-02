import { ClubEconomyRepository, ClubLicensingRepository, type GameDatabase } from "@nepal-football-sim/database";
import type { EntityId, SaveMetadata } from "@nepal-football-sim/shared-types";
import { assertExecutiveAuthority } from "./executive-roles.js";
import { acceptSponsorOfferCommand, counterSponsorOffer, rejectSponsorOfferCommand, setClubBudgetCommand } from "./club-economy.js";
import { applyForClubLoanCommand, repayClubLoanCommand } from "./club-finance-markets.js";
import { closeClubLicenceCycle } from "./licensing.js";
import { registerWomenYouthTeam } from "./womens-youth.js";
import { dismissStaff, hireStaff } from "./staff-market.js";

type Executive = { role: "CEO" | "GENERAL_SECRETARY"; personId: EntityId };

const requireAuthority = (
  db: GameDatabase,
  clubId: EntityId,
  actor: Executive,
  authority: Parameters<typeof assertExecutiveAuthority>[0]["authority"],
): void =>
  assertExecutiveAuthority({ db, clubId, personId: actor.personId, role: actor.role, authority });

export const acceptSponsorshipForExecutive = (
  db: GameDatabase,
  input: { clubId: EntityId; sponsorshipId: EntityId; actor: Executive; date: string },
) => {
  requireAuthority(db, input.clubId, input.actor, "COMMERCIAL_OVERSIGHT");
  return acceptSponsorOfferCommand(db, {
    clubId: input.clubId,
    sponsorshipId: input.sponsorshipId,
    personId: input.actor.personId,
    callerRole: "CEO",
    date: input.date,
  });
};

export const rejectSponsorshipForExecutive = (
  db: GameDatabase,
  input: { clubId: EntityId; sponsorshipId: EntityId; actor: Executive },
) => {
  requireAuthority(db, input.clubId, input.actor, "COMMERCIAL_OVERSIGHT");
  return rejectSponsorOfferCommand(db, {
    clubId: input.clubId,
    sponsorshipId: input.sponsorshipId,
    personId: input.actor.personId,
    callerRole: "CEO",
  });
};

/**
 * counterSponsorOffer itself takes no clubId/authority — the owner-facing
 * desktop command relies solely on the active-role gate above it, so this
 * adds the same clubId ownership check acceptSponsorOfferCommand/
 * rejectSponsorOfferCommand already make for their own callers.
 */
export const counterSponsorshipForExecutive = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    sponsorshipId: EntityId;
    annualValue: number;
    endDate?: string;
    date: string;
    seed: string;
    actor: Executive;
  },
) => {
  requireAuthority(db, input.clubId, input.actor, "COMMERCIAL_OVERSIGHT");
  const offer = new ClubEconomyRepository(db).sponsorships().find((item) => item.id === input.sponsorshipId);
  if (!offer || offer.clubId !== input.clubId) throw new Error("Sponsorship offer does not belong to this club");
  return counterSponsorOffer(db, {
    sponsorshipId: input.sponsorshipId,
    annualValue: input.annualValue,
    endDate: input.endDate,
    date: input.date,
    seed: input.seed,
  });
};

export const setBudgetForExecutive = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    seasonLabel: string;
    category: Parameters<typeof setClubBudgetCommand>[1]["category"];
    amount: number;
    actor: Executive;
  },
) => {
  requireAuthority(db, input.clubId, input.actor, "BUDGET_ADMINISTRATION");
  return setClubBudgetCommand(db, { ...input, personId: input.actor.personId, callerRole: "CEO" });
};

export const applyClubLoanForExecutive = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    lenderId: EntityId;
    principal: number;
    termMonths: number;
    purpose: string;
    date: string;
    actor: Executive;
  },
) => {
  requireAuthority(db, input.clubId, input.actor, "BUDGET_ADMINISTRATION");
  return applyForClubLoanCommand(db, {
    ...input,
    personId: input.actor.personId,
    callerRole: "CEO",
  });
};

/**
 * assertClubFinanceAuthority (club-finance-markets.ts) already accepts a CEO
 * with BUDGET_ADMINISTRATION for loan repayment — this was simply never
 * wired to a desktop command, unlike the apply-side executive adapter above.
 */
export const repayClubLoanForExecutive = (
  db: GameDatabase,
  input: { clubId: EntityId; debtId: EntityId; amount?: number; date: string; actor: Executive },
) => {
  requireAuthority(db, input.clubId, input.actor, "BUDGET_ADMINISTRATION");
  return repayClubLoanCommand(db, {
    debtId: input.debtId,
    amount: input.amount,
    date: input.date,
    personId: input.actor.personId,
    callerRole: "CEO",
  });
};

export const closeLicenceForSecretary = (
  db: GameDatabase,
  input: { caseId: EntityId; date: string; actor: Executive },
) => {
  const current = new ClubLicensingRepository(db).get(input.caseId);
  if (!current) throw new Error("Licence case not found");
  requireAuthority(db, current.clubId, input.actor, "LICENSING");
  return closeClubLicenceCycle(db, { caseId: input.caseId, date: input.date });
};

export const registerCompetitionPlayersForSecretary = (
  db: GameDatabase,
  input: { teamId: EntityId; competitionSeasonId: EntityId; date: string; actor: Executive },
) => {
  const team = db.prepare("SELECT club_id AS clubId FROM teams WHERE id=?").get(input.teamId) as
    { clubId?: EntityId } | undefined;
  if (!team?.clubId) throw new Error("Competition registration team not found");
  requireAuthority(db, team.clubId, input.actor, "COMPETITION_REGISTRATION");
  return registerWomenYouthTeam(db, {
    teamId: input.teamId,
    competitionSeasonId: input.competitionSeasonId,
    date: input.date,
  });
};

export const hireStaffForExecutive = (
  db: GameDatabase,
  save: SaveMetadata,
  input: {
    clubId: EntityId;
    teamId?: EntityId;
    personId: EntityId;
    role: Parameters<typeof hireStaff>[5];
    salaryAmountMinor: number;
    contractMonths?: number;
    actor: Executive;
  },
) => {
  requireAuthority(db, input.clubId, input.actor, "STAFF_RECRUITMENT");
  return hireStaff(
    db,
    save,
    input.clubId,
    input.teamId,
    input.personId,
    input.role,
    input.salaryAmountMinor,
    input.contractMonths,
  );
};

export const dismissStaffForExecutive = (
  db: GameDatabase,
  save: SaveMetadata,
  input: { clubId: EntityId; appointmentId: EntityId; actor: Executive },
) => {
  requireAuthority(db, input.clubId, input.actor, "STAFF_RECRUITMENT");
  const appointment = db
    .prepare("SELECT club_id AS clubId FROM staff_appointments WHERE id=?")
    .get(input.appointmentId) as { clubId?: EntityId } | undefined;
  if (appointment?.clubId !== input.clubId) throw new Error("Staff appointment is not at this club");
  return dismissStaff(db, save, input.appointmentId);
};
