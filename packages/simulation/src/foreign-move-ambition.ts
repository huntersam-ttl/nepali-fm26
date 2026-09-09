import type { GameDatabase } from "@nepal-football-sim/database";
import { TransferMarketRepository, SquadDynamicsRepository } from "@nepal-football-sim/database";
import type { EntityId, PlayerContractRecord } from "@nepal-football-sim/shared-types";

type SqlRow = Record<string, any>;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * A player's assessment of one real, specific move opportunity — never a
 * blanket "wants to leave" flag. Deliberately global: every input is a
 * generic market/reputation/state signal (club/league reputation, wage,
 * squad-role fit, age, current happiness, manager relationship, contract
 * status) with no country name, league name, or Nepal-specific branch
 * anywhere in the scoring. The same function evaluates a Nepal player
 * looking at a district rival, a Nepal Super League club looking at a
 * continental power, or (once the global market exists) any generated
 * player anywhere in the world evaluating any destination.
 */
export type MoveAmbitionFactor = {
  label: string;
  contribution: number;
};

export type MoveAmbitionAssessment = {
  /** 0-100: how strongly the player wants this specific move. */
  interestScore: number;
  classification: "REJECT_INTEREST" | "MILD_INTEREST" | "STRONG_INTEREST" | "DEMANDS_MOVE";
  factors: MoveAmbitionFactor[];
};

const classify = (score: number): MoveAmbitionAssessment["classification"] => {
  if (score < 20) return "REJECT_INTEREST";
  if (score < 45) return "MILD_INTEREST";
  if (score < 75) return "STRONG_INTEREST";
  return "DEMANDS_MOVE";
};

/**
 * Club reputation on a common 0-100 scale, regardless of whether the club
 * is a fully-simulated domestic club (club_supporter_profiles.football_reputation,
 * already 0-100) or a CONTEXT_ONLY foreign club (external_club_context,
 * reputation stored 0-10 per its own migration's scale) — this is the ONLY
 * place that reconciles the two scales, so callers never need to know which
 * kind of club they're looking at.
 */
const clubReputation = (db: GameDatabase, clubId: EntityId): number => {
  const external = db
    .prepare(
      `SELECT ecc.reputation AS clubReputation, elc.reputation AS leagueReputation
       FROM external_club_context ecc
       LEFT JOIN external_league_context elc ON elc.league_id = ecc.league_id
       WHERE ecc.club_id = ?`,
    )
    .get(clubId) as SqlRow | undefined;
  if (external) {
    const clubRep = Number(external.clubReputation ?? 5);
    const leagueRep = Number(external.leagueReputation ?? clubRep);
    // External reputations are recorded on a 0-10 scale; blend club and
    // league strength (a strong club in a weak league is still a real
    // step, but a weak club in a strong league carries less draw).
    return clamp(((clubRep * 0.7 + leagueRep * 0.3) / 10) * 100, 0, 100);
  }
  const domestic = db
    .prepare(`SELECT football_reputation AS reputation FROM club_supporter_profiles WHERE club_id = ?`)
    .get(clubId) as SqlRow | undefined;
  return clamp(Number(domestic?.reputation ?? 40), 0, 100);
};

const ageOf = (db: GameDatabase, personId: EntityId, worldDate: string): number | undefined => {
  const row = db.prepare("SELECT date_of_birth AS dob FROM persons WHERE id = ?").get(personId) as
    | { dob?: string }
    | undefined;
  if (!row?.dob) return undefined;
  const dob = new Date(`${row.dob}T00:00:00Z`);
  const now = new Date(`${worldDate}T00:00:00Z`);
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
};

const ROLE_STARTER_WEIGHT: Partial<Record<PlayerContractRecord["squadRole"], number>> = {
  KEY_PLAYER: 3,
  IMPORTANT_PLAYER: 2,
  FIRST_TEAM: 1,
};

export const evaluateMoveAmbition = (
  db: GameDatabase,
  input: {
    personId: EntityId;
    currentClubId: EntityId;
    destinationClubId: EntityId;
    /** Annual wage the destination is offering, same currency as the current contract. */
    offeredWage?: number;
    /** Whether the destination has genuinely indicated it would offer regular first-team football (not always knowable — omit if unknown). */
    likelyRegularStarter?: boolean;
    managerProfileId?: EntityId;
    worldDate: string;
  },
): MoveAmbitionAssessment => {
  const factors: MoveAmbitionFactor[] = [];
  let score = 30; // neutral baseline — a real but unremarkable offer

  const destinationReputation = clubReputation(db, input.destinationClubId);
  const currentReputation = clubReputation(db, input.currentClubId);
  const reputationGap = destinationReputation - currentReputation;
  const reputationContribution = clamp(reputationGap * 0.5, -25, 30);
  score += reputationContribution;
  factors.push({ label: "Club/league reputation step", contribution: reputationContribution });

  const transfers = new TransferMarketRepository(db);
  const contract = transfers.activeContract(input.personId, input.worldDate);
  if (input.offeredWage !== undefined && contract && contract.salary > 0) {
    const wageChange = (input.offeredWage - contract.salary) / contract.salary;
    const wageContribution = clamp(wageChange * 40, -15, 25);
    score += wageContribution;
    factors.push({ label: "Wage change", contribution: wageContribution });
  }

  // Sporting fit: an established starter risks becoming a squad player at a
  // reputable-but-not-clearly-superior destination unless regular football
  // is genuinely on offer; a fringe/prospect player has little to lose.
  if (contract) {
    const starterWeight = ROLE_STARTER_WEIGHT[contract.squadRole] ?? 0;
    if (starterWeight > 0 && input.likelyRegularStarter === false) {
      const roleContribution = -clamp(starterWeight * 5 + Math.max(0, reputationGap) / 10, 0, 25);
      score += roleContribution;
      factors.push({ label: "Uncertain first-team role at destination", contribution: roleContribution });
    } else if (starterWeight > 0 && input.likelyRegularStarter === true) {
      score += 8;
      factors.push({ label: "Guaranteed regular football at destination", contribution: 8 });
    }
  }

  const age = ageOf(db, input.personId, input.worldDate);
  if (age !== undefined) {
    if (age <= 23) {
      // Young players weight the sporting/reputation step more heavily —
      // career development matters more than money at this stage.
      const youthContribution = clamp(reputationContribution * 0.3, -8, 12);
      score += youthContribution;
      factors.push({ label: "Career-development stage (young player)", contribution: youthContribution });
    } else if (age >= 30) {
      // Older players weight wage/security more heavily than a marginal
      // reputation step.
      score += 4;
      factors.push({ label: "Career-stage security weighting (veteran)", contribution: 4 });
    }
  }

  const dynamics = new SquadDynamicsRepository(db);
  const currentTeam = db
    .prepare("SELECT id FROM teams WHERE club_id = ? AND level = 'senior' LIMIT 1")
    .get(input.currentClubId) as { id?: EntityId } | undefined;
  const playerSatisfaction = currentTeam?.id
    ? dynamics.satisfactionForTeam(currentTeam.id).find((entry) => entry.personId === input.personId)
    : undefined;
  if (playerSatisfaction) {
    const unhappinessContribution = clamp((60 - playerSatisfaction.score) / 4, -10, 15);
    score += unhappinessContribution;
    factors.push({ label: "Current club satisfaction", contribution: unhappinessContribution });
  }

  if (input.managerProfileId) {
    const relationship = dynamics.relationship(input.managerProfileId, input.personId);
    if (relationship) {
      const relationshipContribution = clamp(-relationship.score / 12, -8, 8);
      score += relationshipContribution;
      factors.push({ label: "Relationship with current manager", contribution: relationshipContribution });
    }
  }

  if (contract) {
    const daysLeft = Math.round(
      (new Date(`${contract.endDate}T00:00:00Z`).getTime() -
        new Date(`${input.worldDate}T00:00:00Z`).getTime()) /
        86_400_000,
    );
    if (daysLeft <= 180) {
      score += 6;
      factors.push({ label: "Contract nearing expiry", contribution: 6 });
    }
  }

  const interestScore = Math.round(clamp(score, 0, 100));
  return { interestScore, classification: classify(interestScore), factors };
};
