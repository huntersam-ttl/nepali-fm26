import type { NepalWorldDataset } from "./index.js";

export type PersonnelCoverageReport = {
  totalRealStaff: number;
  managers: number;
  assistantsCoaches: number;
  medical: number;
  scoutingAnalysis: number;
  technicalDirectors: number;
  aDivision: number;
  bDivision: number;
  cLower: number;
  nationalTeams: number;
  women: number;
  youth: number;
  federationTechnical: number;
  referees: number;
  assistantReferees: number;
  fifaListedVerified: number;
  abroad: number;
  unknownAssignment: number;
  provenance: Record<string, number>;
  duplicateNameCandidates: string[];
};

export type PersonnelSourceRecord = {
  sourceId: string;
  sourceUrl: string;
  fullName: string;
  role: string;
  assignmentStatus: "CURRENT" | "FORMER" | "UNKNOWN";
  clubKey?: string;
  teamKey?: string;
  federationKey?: string;
  provenanceStatus: "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export const normalisePersonnelRole = (role: string): string => role.trim().toLocaleLowerCase().replace(/[\s_-]+/g, " ");
const duplicateKey = (value: string): string => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");

export const normalisePersonnelSourceRecords = (records: readonly PersonnelSourceRecord[]): { records: PersonnelSourceRecord[]; duplicateCandidates: string[] } => {
  const byName = new Map<string, PersonnelSourceRecord[]>();
  for (const record of records) { const key = duplicateKey(record.fullName); byName.set(key, [...(byName.get(key) ?? []), record]); }
  return { records: records.map((record) => ({ ...record, role: normalisePersonnelRole(record.role) })), duplicateCandidates: [...byName.entries()].filter(([, values]) => values.length > 1).map(([name]) => name).sort() };
};

export const personnelCoverageReport = (dataset: NepalWorldDataset): PersonnelCoverageReport => {
  const clubs = new Map(dataset.clubs.map((club) => [club.key, club.name.toLocaleLowerCase()]));
  const competitionNames = new Map(dataset.competitions.map((competition) => [competition.key, competition.name.toLocaleLowerCase()]));
  const clubCompetitions = new Map(dataset.clubMemberships.map((membership) => [membership.clubKey, competitionNames.get(membership.competitionKey) ?? ""]));
  const provenance: Record<string, number> = {};
  const names = new Map<string, number>(); const realStaff = new Set<string>(); let managers = 0; let assistantsCoaches = 0; let medical = 0; let scoutingAnalysis = 0; let technicalDirectors = 0; let aDivision = 0; let bDivision = 0; let cLower = 0; let nationalTeams = 0; let women = 0; let youth = 0; let federationTechnical = 0; let abroad = 0; let unknownAssignment = 0;
  for (const profile of dataset.staffProfiles) { provenance[profile.provenance.status] = (provenance[profile.provenance.status] ?? 0) + 1; if (profile.provenance.status !== "SIMULATION_ONLY") realStaff.add(profile.personKey); }
  for (const appointment of dataset.staffAppointments) {
    const role = normalisePersonnelRole(appointment.role); const clubName = appointment.clubKey?.value ? clubs.get(appointment.clubKey.value) ?? "" : ""; const competition = appointment.clubKey?.value ? clubCompetitions.get(appointment.clubKey.value) ?? "" : ""; if (role.includes("manager") || role.includes("head coach")) managers += 1; else if (/assistant|coach|physio|fitness|performance/.test(role)) assistantsCoaches += 1; if (/medical|physio/.test(role)) medical += 1; if (/scout|analyst|analysis/.test(role)) scoutingAnalysis += 1; if (/technical director|football director/.test(role)) technicalDirectors += 1; if (competition.includes("a-division")) aDivision += 1; else if (competition.includes("b-division")) bDivision += 1; else if (competition.includes("c-division") || competition.includes("lower")) cLower += 1; if (appointment.organisationType === "NATIONAL_TEAM") { nationalTeams += 1; if (/women|girls/.test(appointment.organisationName?.value?.toLocaleLowerCase() ?? "")) women += 1; if (/u17|u19|u20|u23|youth/.test(appointment.organisationName?.value?.toLocaleLowerCase() ?? "")) youth += 1; } if (appointment.organisationType === "FEDERATION") federationTechnical += 1; if (!appointment.clubKey?.value && !appointment.teamKey?.value && !appointment.federationKey?.value && !appointment.academyKey?.value && !appointment.organisationName?.value) unknownAssignment += 1; if (/international|abroad|foreign/.test(clubName)) abroad += 1; }
  for (const referee of dataset.refereeProfiles) { provenance[referee.provenance.status] = (provenance[referee.provenance.status] ?? 0) + 1; if (referee.primaryRole.toLocaleLowerCase().includes("assistant")) { /* counted below from the same canonical referee model */ } }
  for (const person of dataset.persons) { const key = duplicateKey(person.fullName); names.set(key, (names.get(key) ?? 0) + 1); }
  return { totalRealStaff: realStaff.size, managers, assistantsCoaches, medical, scoutingAnalysis, technicalDirectors, aDivision, bDivision, cLower, nationalTeams, women, youth, federationTechnical, referees: dataset.refereeProfiles.length, assistantReferees: dataset.refereeProfiles.filter((referee) => referee.primaryRole.toLocaleLowerCase().includes("assistant")).length, fifaListedVerified: dataset.refereeProfiles.filter((referee) => referee.fifaListed?.status === "VERIFIED" && referee.fifaListed.value === true).length, abroad, unknownAssignment, provenance, duplicateNameCandidates: [...names.entries()].filter(([, count]) => count > 1).map(([name]) => name).sort() };
};
