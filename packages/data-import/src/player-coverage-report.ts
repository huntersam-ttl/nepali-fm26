import type { NepalWorldDataset } from "./index.js";

export type PlayerCoverageReport = {
  totalRealPlayers: number;
  aDivision: number;
  bDivision: number;
  cLower: number;
  seniorNationalTeam: number;
  youthNationalTeam: number;
  women: number;
  abroad: number;
  diasporaDualNationality: number;
  freeAgents: number;
  unknownClub: number;
  provenance: Record<string, number>;
  duplicateNameCandidates: string[];
};

const normalise = (value: string): string => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");

export const playerCoverageReport = (dataset: NepalWorldDataset): PlayerCoverageReport => {
  const clubByKey = new Map(dataset.clubs.map((club) => [club.key, club]));
  const memberships = new Map(dataset.clubMemberships.map((membership) => [membership.clubKey, membership.competitionKey]));
  const competitions = new Map(dataset.competitions.map((competition) => [competition.key, competition.name.toLocaleLowerCase()]));
  const teamNames = new Map(dataset.teams.map((team) => [team.key, team.name.toLocaleLowerCase()]));
  const assignedTeams = new Map(dataset.teamPersonAssignments.map((assignment) => [assignment.personKey, teamNames.get(assignment.teamKey) ?? ""]));
  const provenance: Record<string, number> = {};
  const names = new Map<string, number>();
  let aDivision = 0; let bDivision = 0; let cLower = 0; let seniorNationalTeam = 0; let youthNationalTeam = 0; let women = 0; let abroad = 0; let diasporaDualNationality = 0; let freeAgents = 0; let unknownClub = 0;
  for (const profile of dataset.playerFactualProfiles) {
    const status = profile.provenance.status; provenance[status] = (provenance[status] ?? 0) + 1;
    const club = profile.currentClubKey?.value ? clubByKey.get(profile.currentClubKey.value) : undefined;
    const competition = profile.currentClubKey?.value ? competitions.get(memberships.get(profile.currentClubKey.value) ?? "") ?? "" : "";
    if (!club) unknownClub += 1;
    if (competition.includes("a-division")) aDivision += 1; else if (competition.includes("b-division")) bDivision += 1; else if (competition.includes("c-division") || competition.includes("lower")) cLower += 1;
    const team = assignedTeams.get(profile.playerKey) ?? "";
    if (team.includes("national") && !team.includes("u17") && !team.includes("u19") && !team.includes("u20") && !team.includes("u23")) seniorNationalTeam += 1;
    if (/u17|u19|u20|u23|youth/.test(team)) youthNationalTeam += 1;
    if (/women|girls|female/.test(team) || profile.factualPositionGroup === "UNKNOWN" && /women/.test(club?.name.toLocaleLowerCase() ?? "")) women += 1;
    if (!club) freeAgents += profile.factualContractStatus === "UNKNOWN" ? 1 : 0;
    const nationality = profile.nationality?.value?.toLocaleLowerCase() ?? ""; if (nationality && !nationality.includes("nepal")) abroad += 1;
    if (nationality.includes(",") || nationality.includes("/") || nationality.includes("dual")) diasporaDualNationality += 1;
    const key = normalise(profile.nameVariants[0] ?? profile.canonicalExternalId); names.set(key, (names.get(key) ?? 0) + 1);
  }
  return { totalRealPlayers: dataset.playerFactualProfiles.filter((profile) => profile.recordStatus !== "UNKNOWN").length, aDivision, bDivision, cLower, seniorNationalTeam, youthNationalTeam, women, abroad, diasporaDualNationality, freeAgents, unknownClub, provenance, duplicateNameCandidates: [...names.entries()].filter(([, count]) => count > 1).map(([name]) => name).sort() };
};
