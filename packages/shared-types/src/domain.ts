import type { EntityId } from "./ids.js";

export type ISODate = string;
export type ISODateTime = string;

export type EntityRef = {
  id: EntityId;
  type:
    | "country"
    | "location"
    | "venue"
    | "federation"
    | "club"
    | "team"
    | "person"
    | "competition"
    | "fixture"
    | "match"
    | "contract"
    | "transfer"
    | "loan"
    | "financeAccount"
    | "careerCharacter";
};

export type Country = {
  id: EntityId;
  name: string;
  isoCode: string;
};

export type Location = {
  id: EntityId;
  countryId: EntityId;
  name: string;
  kind: "city" | "district" | "province" | "stadium" | "unknown";
  parentLocationId?: EntityId;
};

export type Venue = {
  id: EntityId;
  countryId: EntityId;
  locationId?: EntityId;
  name: string;
  capacity?: number;
};

export type Federation = {
  id: EntityId;
  countryId: EntityId;
  name: string;
  foundedYear?: number;
};

export type ClubOwnershipType =
  | "PRIVATE"
  | "CORPORATE"
  | "COMMUNITY"
  | "MEMBER_OWNED"
  | "DEPARTMENTAL"
  | "MUNICIPALITY_BACKED"
  | "INSTITUTIONAL"
  | "UNKNOWN";

export type Club = {
  id: EntityId;
  name: string;
  countryId: EntityId;
  locationId?: EntityId;
  ownershipType: ClubOwnershipType;
  foundedYear?: number;
};

export type Team = {
  id: EntityId;
  clubId?: EntityId;
  federationId?: EntityId;
  name: string;
  level: "senior" | "u23" | "u20" | "u17" | "reserve" | "academy";
  gender: "men" | "women" | "mixed" | "unknown";
};

export type TeamPersonAssignment = {
  id: EntityId;
  personId: EntityId;
  teamId: EntityId;
  role: PersonRoleType;
  startedOn?: ISODate;
  endedOn?: ISODate;
};

export type Person = {
  id: EntityId;
  fullName: string;
  displayName?: string;
  dateOfBirth?: ISODate;
  nationalityCountryId: EntityId;
  secondNationalityCountryId?: EntityId;
  genderPresentation?: string;
  placeOfBirthLocationId?: EntityId;
  hometownLocationId?: EntityId;
  languages: string[];
};

export type PersonRoleType =
  "PLAYER" | "MANAGER" | "STAFF" | "AGENT" | "CHAIRMAN" | "FEDERATION_OFFICIAL";

export type PersonRole = {
  id: EntityId;
  personId: EntityId;
  role: PersonRoleType;
  activeFrom: ISODate;
  activeTo?: ISODate;
};

export type Player = PersonRole & { role: "PLAYER" };
export type Manager = PersonRole & { role: "MANAGER" };
export type Staff = PersonRole & { role: "STAFF" };
export type Agent = PersonRole & { role: "AGENT" };
export type Chairman = PersonRole & { role: "CHAIRMAN" };
export type FederationOfficial = PersonRole & { role: "FEDERATION_OFFICIAL" };

export type CareerCharacter = {
  id: EntityId;
  personId: EntityId;
  preferredDisplayName?: string;
  startingAge?: number;
  footballBackground?: string;
  education?: string;
  playingExperience?: string;
  coachingLicences: string[];
  businessBackground?: string;
  startingReputationProfile?: string;
};

export type Competition = {
  id: EntityId;
  federationId?: EntityId;
  name: string;
  scope: "domestic" | "continental" | "international" | "local";
};

export type CompetitionSeason = {
  id: EntityId;
  competitionId: EntityId;
  name: string;
  startDate: ISODate;
  endDate: ISODate;
};

export type Fixture = {
  id: EntityId;
  competitionSeasonId?: EntityId;
  homeTeamId: EntityId;
  awayTeamId: EntityId;
  scheduledDate: ISODate;
  status: "scheduled" | "postponed" | "played" | "cancelled";
};

export type Match = {
  id: EntityId;
  fixtureId: EntityId;
  playedDate?: ISODate;
  homeGoals?: number;
  awayGoals?: number;
};

export type MatchEvent = {
  id: EntityId;
  matchId: EntityId;
  minute?: number;
  type: string;
  personId?: EntityId;
  teamId?: EntityId;
  data?: Record<string, unknown>;
};

export type Contract = {
  id: EntityId;
  personId: EntityId;
  employerEntity: EntityRef;
  startsOn: ISODate;
  endsOn?: ISODate;
  wageAmountMinor: number;
  currency: string;
};

export type PlayerContract = Contract & { contractKind: "PLAYER" };
export type StaffContract = Contract & { contractKind: "STAFF" };

export type Transfer = {
  id: EntityId;
  personId: EntityId;
  fromClubId?: EntityId;
  toClubId: EntityId;
  transferDate: ISODate;
  feeAmountMinor?: number;
  currency?: string;
};

export type Loan = {
  id: EntityId;
  personId: EntityId;
  fromClubId: EntityId;
  toClubId: EntityId;
  startsOn: ISODate;
  endsOn: ISODate;
};

export type FinanceOwnerType = "PERSON" | "CLUB" | "FEDERATION";

export type FinanceAccount = {
  id: EntityId;
  ownerType: FinanceOwnerType;
  ownerId: EntityId;
  name: string;
  currency: string;
};

export type FinancialTransaction = {
  id: EntityId;
  accountId: EntityId;
  occurredOn: ISODate;
  amountMinor: number;
  currency: string;
  category: string;
  description?: string;
  relatedEntity?: EntityRef;
};

export type Relationship = {
  id: EntityId;
  fromEntity: EntityRef;
  toEntity: EntityRef;
  kind: string;
  strength?: number;
};

export type Promise = {
  id: EntityId;
  madeBy: EntityRef;
  madeTo: EntityRef;
  madeOn: ISODate;
  dueOn?: ISODate;
  status: "open" | "kept" | "broken" | "cancelled";
  description: string;
};

export type HistoricalEvent = {
  id: EntityId;
  occurredOn: ISODate;
  eventType: string;
  involvedEntities: EntityRef[];
  title: string;
  data?: Record<string, unknown>;
  importance: "low" | "medium" | "high" | "historic";
  scope: "person" | "club" | "federation" | "country" | "world";
};

export type ScheduledEvent = {
  id: EntityId;
  dueOn: ISODate;
  eventType: string;
  payload: Record<string, unknown>;
  status: "pending" | "processed" | "cancelled";
  processedOn?: ISODate;
};

export type SaveMetadata = {
  id: EntityId;
  name: string;
  worldDate: ISODate;
  databaseVersion: number;
  gameVersion: string;
  randomSeed: string;
  createdAt: ISODateTime;
  lastSavedAt: ISODateTime;
  playerCharacterId?: EntityId;
};

export type DataProvenanceStatus =
  "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN" | "SIMULATION_ONLY";

export type DataProvenance = {
  sourceUrl?: string;
  sourceName: string;
  lastVerifiedDate?: ISODate;
  confidence: number;
  status: DataProvenanceStatus;
};
