import type { EntityId } from "./ids.js";
import type { ISODate } from "./domain.js";

export type FixtureOfficialAssignment = {
  id: EntityId;
  fixtureId: EntityId;
  refereePersonId?: EntityId;
  assistantReferee1PersonId?: EntityId;
  assistantReferee2PersonId?: EntityId;
  fourthOfficialPersonId?: EntityId;
  varPersonId?: EntityId;
  assignedOn: ISODate;
  status: "ASSIGNED" | "FAILED";
  competitionLevel?: string;
  refereeQuality?: number;
  failureReason?: string;
  provenanceStatus: "SIMULATION_ONLY";
};
