import { createStableEntityId, type EntityId, type Federation, type FederationElectionCandidate, type FederationElectionCycle, type FederationElectionResult, type FederationStrategicPriority, type Person } from "@nepal-football-sim/shared-types";
import { FederationGovernanceRepository, FederationPoliticsRepository, WorldRepository, type GameDatabase } from "@nepal-football-sim/database";
import { SeededRandom } from "./rng.js";

const status = "SIMULATION_ONLY" as const;
const addYears = (date: string, years: number): string => `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;
const addDays = (date: string, days: number): string => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const federation = (db: GameDatabase, id: EntityId): Federation => { const row = db.prepare("SELECT id,country_id,name,founded_year FROM federations WHERE id=?").get(id) as any; if (!row) throw new Error("Federation not found"); return { id: row.id, countryId: row.country_id, name: row.name, foundedYear: row.founded_year ?? undefined }; };

export const createFederationElectionCycle = (db: GameDatabase, input: { federationId: EntityId; electionDate: string }): FederationElectionCycle => {
  const cycle: FederationElectionCycle = { id: createStableEntityId("federation-election-cycle", `${input.federationId}:${input.electionDate}`), federationId: input.federationId, nominationStart: addDays(input.electionDate, -90), electionDate: input.electionDate, termYears: 4, status: "NOMINATIONS", provenanceStatus: status };
  new FederationPoliticsRepository(db).upsertCycle(cycle); return cycle;
};

const ensurePerson = (db: GameDatabase, id: EntityId, name: string, countryId: EntityId, date: string): Person => {
  const world = new WorldRepository(db); const existing = world.getPerson(id); if (existing) return existing;
  const person: Person = { id, fullName: name, displayName: name, dateOfBirth: "1968-01-01", nationalityCountryId: countryId, genderPresentation: "unknown", languages: ["Nepali", "English"] };
  world.insertPerson(person); world.insertPersonRole({ id: createStableEntityId("person-role", `${id}:FEDERATION_OFFICIAL`), personId: id, role: "FEDERATION_OFFICIAL", activeFrom: date }); return person;
};

export const generateFederationCandidates = (db: GameDatabase, input: { cycleId: EntityId; federationId: EntityId; date: string; seed: string }): FederationElectionCandidate[] => {
  const politics = new FederationPoliticsRepository(db); const existing = politics.candidates(input.cycleId); if (existing.length) return existing;
  const fed = federation(db, input.federationId); const governance = new FederationGovernanceRepository(db); const profile = governance.profile(input.federationId); const active = governance.leadershipTenures(input.federationId).find((item) => item.role === "FEDERATION_PRESIDENT" && item.status === "ACTIVE");
  const clubCount = (db.prepare("SELECT COUNT(*) AS count FROM clubs WHERE country_id=?").get(fed.countryId) as { count: number }).count;
  const rng = new SeededRandom(`${input.seed}:election:${input.cycleId}`);
  const manifests: Array<Record<string, number>> = [
    { NATIONAL_TEAM_PERFORMANCE: 0.85, YOUTH_ELITE_DEVELOPMENT: 0.62, CLUB_PROFESSIONALISATION: 0.48 },
    { GRASSROOTS_EXPANSION: 0.86, WOMENS_FOOTBALL: 0.7, COACH_EDUCATION: 0.64 },
    { INFRASTRUCTURE: 0.78, COMMERCIAL_GROWTH: 0.72, INTERNATIONAL_EXPOSURE: 0.6 },
  ];
  return manifests.map((manifesto, index) => {
    const isIncumbent = Boolean(active && index === 0); const personId = isIncumbent ? active!.personId : createStableEntityId("person", `federation-candidate:${input.cycleId}:${index}`);
    ensurePerson(db, personId, isIncumbent ? "Incumbent Federation President" : `Federation Candidate ${index + 1}`, fed.countryId, input.date);
    const candidate: FederationElectionCandidate = { id: createStableEntityId("federation-election-candidate", `${input.cycleId}:${index}`), cycleId: input.cycleId, federationId: input.federationId, personId, reputation: Number(Math.min(9, Math.max(3, (profile?.reputation ?? 5) + (isIncumbent ? 0.35 : rng.next() * 1.2 - 0.25))).toFixed(2)), supportBase: Number(Math.min(9, Math.max(2, 3.5 + clubCount * 0.04 + rng.next() * 1.8)).toFixed(2)), committeeInfluence: Number((isIncumbent ? 0.72 : 0.35 + rng.next() * 0.3).toFixed(2)), votingBlocs: { clubs: Number((0.35 + rng.next() * 0.4).toFixed(2)), districts: Number((0.3 + rng.next() * 0.45).toFixed(2)), regions: Number((0.3 + rng.next() * 0.45).toFixed(2)) }, manifesto, incumbent: isIncumbent, status: "ELIGIBLE", provenanceStatus: status };
    politics.upsertCandidate(candidate); return candidate;
  });
};

const priorityMap: Record<string, FederationStrategicPriority> = { NATIONAL_TEAM_PERFORMANCE: "NATIONAL_TEAM_PERFORMANCE", YOUTH_ELITE_DEVELOPMENT: "YOUTH_ELITE_DEVELOPMENT", CLUB_PROFESSIONALISATION: "CLUB_PROFESSIONALISATION", GRASSROOTS_EXPANSION: "GRASSROOTS_EXPANSION", WOMENS_FOOTBALL: "WOMENS_FOOTBALL", COACH_EDUCATION: "COACH_EDUCATION", INFRASTRUCTURE: "INFRASTRUCTURE", COMMERCIAL_GROWTH: "COMMERCIAL_GROWTH", INTERNATIONAL_EXPOSURE: "INTERNATIONAL_EXPOSURE" };

export const runFederationElection = (db: GameDatabase, input: { cycleId: EntityId; date: string; seed: string }): FederationElectionResult => {
  const politics = new FederationPoliticsRepository(db); const cycle = politics.cycles().find((item) => item.id === input.cycleId); if (!cycle) throw new Error("Election cycle not found");
  const candidates = generateFederationCandidates(db, { cycleId: cycle.id, federationId: cycle.federationId, date: input.date, seed: input.seed }).filter((item) => item.status === "ELIGIBLE"); if (!candidates.length) throw new Error("No eligible federation candidates");
  const governance = new FederationGovernanceRepository(db); const profile = governance.profile(cycle.federationId); const account = governance.financialAccount(cycle.federationId); const scores = candidates.map((candidate) => ({ candidate, score: candidate.supportBase * 0.42 + candidate.reputation * 0.2 + candidate.committeeInfluence * 1.7 + Object.values(candidate.votingBlocs).reduce((sum, value) => sum + value, 0) * 0.8 + (candidate.incumbent ? (profile?.governanceStability ?? 5) * 0.18 + (account?.financialHealth === "INSOLVENT" ? -1.4 : 0.5) : 0) }));
  scores.sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id)); const total = scores.reduce((sum, item) => sum + Math.max(0.1, item.score), 0); const votes = Object.fromEntries(scores.map((item) => [item.candidate.id, Number((Math.max(0.1, item.score) / total).toFixed(6))])); const winner = scores[0].candidate;
  for (const candidate of candidates) politics.upsertCandidate({ ...candidate, status: candidate.id === winner.id ? "ELECTED" : "DEFEATED" });
  for (const tenure of governance.leadershipTenures(cycle.federationId).filter((item) => item.role === "FEDERATION_PRESIDENT" && item.status === "ACTIVE")) governance.upsertLeadershipTenure({ ...tenure, termEnd: input.date, status: "FORMER" });
  governance.upsertLeadershipTenure({ id: createStableEntityId("federation-leadership", `${cycle.federationId}:${winner.personId}:${input.date}`), personId: winner.personId, federationId: cycle.federationId, role: "FEDERATION_PRESIDENT", termStart: input.date, termEnd: addYears(input.date, cycle.termYears), status: "ACTIVE", provenanceStatus: status });
  const result: FederationElectionResult = { id: createStableEntityId("federation-election-result", cycle.id), cycleId: cycle.id, federationId: cycle.federationId, winnerCandidateId: winner.id, electedPersonId: winner.personId, votes, decidedAt: input.date, status: "COMPLETED", provenanceStatus: status }; politics.upsertResult(result); politics.upsertCycle({ ...cycle, status: "COMPLETED" });
  const activePriorities = governance.strategyPriorities(cycle.federationId).filter((item) => item.status === "ACTIVE"); for (const priority of activePriorities) governance.upsertStrategyPriority({ ...priority, effectiveTo: input.date, status: "INACTIVE" });
  for (const [key, weight] of Object.entries(winner.manifesto)) { const priority = priorityMap[key]; if (!priority) continue; governance.upsertStrategyPriority({ id: createStableEntityId("federation-strategy", `${cycle.federationId}:${priority}:${input.date}`), federationId: cycle.federationId, priority, weight, effectiveFrom: input.date, status: "ACTIVE", provenanceStatus: status }); }
  return result;
};

export const advanceFederationElections = (db: GameDatabase, input: { date: string; seed: string }): FederationElectionResult[] => {
  const politics = new FederationPoliticsRepository(db); const results: FederationElectionResult[] = [];
  for (const cycle of politics.cycles().filter((item) => item.status !== "COMPLETED" && item.electionDate <= input.date)) results.push(runFederationElection(db, { cycleId: cycle.id, date: cycle.electionDate, seed: input.seed }));
  return results;
};
