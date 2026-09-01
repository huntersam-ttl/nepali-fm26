import { ClubLicensingRepository, type GameDatabase } from "@nepal-football-sim/database";
import type { EntityId, SaveMetadata } from "@nepal-football-sim/shared-types";
import { assertExecutiveAuthority } from "./executive-roles.js";
import { acceptSponsorOfferCommand, setClubBudgetCommand } from "./club-economy.js";
import { applyForClubLoanCommand } from "./club-finance-markets.js";
import { closeClubLicenceCycle } from "./licensing.js";
import { registerWomenYouthTeam } from "./womens-youth.js";
import { hireStaff } from "./staff-market.js";

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
