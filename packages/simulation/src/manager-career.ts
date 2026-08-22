import {
  createEntityId,
  createStableEntityId,
  type BusinessBackground,
  type CareerCharacter,
  type CoachingExperience,
  type CoachingLicence,
  type EducationBackground,
  type EntityId,
  type FootballBackground,
  type ISODate,
  type ManagerAttributeSet,
  type ManagerContract,
  type ManagerProfile,
  type Person,
  type PersonRole,
  type PlayingExperience,
} from "@nepal-football-sim/shared-types";

export type CreateCareerCharacterInput = {
  fullName: string;
  preferredDisplayName?: string;
  dateOfBirth: ISODate;
  startingAge: number;
  nationalityCountryId: EntityId;
  secondNationalityCountryId?: EntityId;
  genderPresentation?: string;
  placeOfBirthLocationId?: EntityId;
  hometownLocationId?: EntityId;
  languages: string[];
  footballBackground: FootballBackground;
  education: EducationBackground;
  playingExperience: PlayingExperience;
  coachingExperience: CoachingExperience;
  coachingLicences: CoachingLicence[];
  businessBackground: BusinessBackground;
  startingReputationProfile:
    "LOCAL_UNKNOWN" | "LOCAL_RESPECTED" | "FORMER_PLAYER" | "EDUCATED_COACH";
  careerStartDate: ISODate;
};

export type CareerCreationResult = {
  person: Person;
  character: CareerCharacter;
  managerRole: PersonRole;
  managerProfile: ManagerProfile;
};

export const createCareerCharacter = (input: CreateCareerCharacterInput): CareerCreationResult => {
  validateCareerCharacter(input);
  const key = `${input.fullName}:${input.dateOfBirth}:${input.careerStartDate}`;
  const personId = createStableEntityId("career-person", key);
  const managerProfileId = createStableEntityId("manager-profile", key);
  const person: Person = {
    id: personId,
    fullName: input.fullName,
    displayName: input.preferredDisplayName,
    dateOfBirth: input.dateOfBirth,
    nationalityCountryId: input.nationalityCountryId,
    secondNationalityCountryId: input.secondNationalityCountryId,
    genderPresentation: input.genderPresentation,
    placeOfBirthLocationId: input.placeOfBirthLocationId,
    hometownLocationId: input.hometownLocationId,
    languages: [...input.languages],
  };
  const character: CareerCharacter = {
    id: createStableEntityId("career-character", key),
    personId,
    preferredDisplayName: input.preferredDisplayName,
    startingAge: input.startingAge,
    footballBackground: input.footballBackground,
    education: input.education,
    playingExperience: input.playingExperience,
    coachingExperience: input.coachingExperience,
    coachingLicences: [...input.coachingLicences],
    businessBackground: input.businessBackground,
    startingReputationProfile: input.startingReputationProfile,
  };
  const managerRole: PersonRole = {
    id: createStableEntityId("role", `${key}:manager`),
    personId,
    role: "MANAGER",
    activeFrom: input.careerStartDate,
  };
  const managerProfile: ManagerProfile = {
    id: managerProfileId,
    personId,
    attributes: deriveManagerAttributes(input),
    reputationProfile: input.startingReputationProfile,
    createdOn: input.careerStartDate,
  };
  return { person, character, managerRole, managerProfile };
};

export const createManagerContract = (input: {
  managerProfileId: EntityId;
  personId: EntityId;
  teamId?: EntityId;
  clubId?: EntityId;
  jobTitle?: string;
  contractStart: ISODate;
  contractEnd?: ISODate;
  salaryAmountMinor?: number;
  currency?: string;
}): ManagerContract => ({
  id: createEntityId(),
  managerProfileId: input.managerProfileId,
  personId: input.personId,
  teamId: input.teamId,
  clubId: input.clubId,
  jobTitle: input.jobTitle ?? "Manager",
  contractStart: input.contractStart,
  contractEnd: input.contractEnd,
  salaryAmountMinor: input.salaryAmountMinor ?? 0,
  currency: input.currency ?? "NPR",
  status: "ACTIVE",
});

export const testLicence = (level: string, reputationEffect = 1): CoachingLicence => ({
  id: createStableEntityId("test-licence", level),
  level,
  issuingBody: "Testing Football Education Body",
  requirements: [],
  reputationEffect,
});

export const validateCareerCharacter = (input: CreateCareerCharacterInput): void => {
  if (!input.fullName.trim()) {
    throw new Error("Full name is required.");
  }
  if (input.startingAge < 16 || input.startingAge > 90) {
    throw new Error("Starting age must be between 16 and 90.");
  }
  const derivedAge = ageOn(input.dateOfBirth, input.careerStartDate);
  if (Math.abs(derivedAge - input.startingAge) > 1) {
    throw new Error("Date of birth and starting age are inconsistent.");
  }
  if (input.languages.length === 0) {
    throw new Error("At least one language is required.");
  }
};

const deriveManagerAttributes = (input: CreateCareerCharacterInput): ManagerAttributeSet => {
  const attributes = baseAttributes();
  addPlayingExperience(attributes, input.playingExperience);
  addCoachingExperience(attributes, input.coachingExperience);
  addEducation(attributes, input.education);
  addBusiness(attributes, input.businessBackground);
  addLicences(attributes, input.coachingLicences);
  addReputation(attributes, input.startingReputationProfile);
  return capAttributes(attributes);
};

const baseAttributes = (): ManagerAttributeSet => ({
  tactical: {
    tacticalKnowledge: 6,
    adaptability: 7,
    matchManagement: 6,
    setPieceKnowledge: 6,
  },
  coaching: {
    attackingCoaching: 6,
    defensiveCoaching: 6,
    technicalCoaching: 6,
    mentalCoaching: 6,
    fitnessUnderstanding: 6,
    youthDevelopment: 6,
  },
  people: {
    manManagement: 7,
    motivation: 7,
    discipline: 7,
    communication: 7,
  },
  recruitment: {
    playerJudgement: 6,
    potentialJudgement: 6,
  },
  personality: {
    reputation: 4,
    mediaHandling: 6,
    pressureHandling: 6,
    professionalism: 7,
    ambition: 7,
    loyalty: 7,
  },
});

const addPlayingExperience = (
  attributes: ManagerAttributeSet,
  experience: PlayingExperience,
): void => {
  const values: Record<PlayingExperience, number> = {
    NO_PLAYING_EXPERIENCE: 0,
    AMATEUR_PLAYER: 1,
    SEMI_PROFESSIONAL_PLAYER: 2,
    PROFESSIONAL_PLAYER: 3,
    FORMER_INTERNATIONAL: 4,
  };
  const boost = values[experience];
  attributes.tactical.matchManagement += boost * 0.6;
  attributes.people.discipline += boost * 0.4;
  attributes.personality.reputation += boost * 0.7;
};

const addCoachingExperience = (
  attributes: ManagerAttributeSet,
  experience: CoachingExperience,
): void => {
  const values: Record<CoachingExperience, number> = {
    NONE: 0,
    GRASSROOTS: 1,
    YOUTH_COACH: 2,
    ASSISTANT_COACH: 3,
    SENIOR_COACH: 4,
  };
  const boost = values[experience];
  attributes.tactical.tacticalKnowledge += boost * 0.7;
  attributes.coaching.technicalCoaching += boost * 0.6;
  attributes.coaching.mentalCoaching += boost * 0.4;
  attributes.people.communication += boost * 0.4;
};

const addEducation = (attributes: ManagerAttributeSet, education: EducationBackground): void => {
  if (education === "SPORTS_RELATED_DEGREE") {
    attributes.coaching.fitnessUnderstanding += 1.5;
    attributes.coaching.youthDevelopment += 1;
    attributes.tactical.setPieceKnowledge += 0.8;
  }
  if (education === "BUSINESS_RELATED_DEGREE") {
    attributes.people.communication += 1;
    attributes.personality.professionalism += 1;
  }
  if (education === "UNIVERSITY") {
    attributes.tactical.adaptability += 0.8;
    attributes.people.communication += 0.5;
  }
};

const addBusiness = (attributes: ManagerAttributeSet, background: BusinessBackground): void => {
  if (background === "CORPORATE" || background === "FINANCE" || background === "ENTREPRENEURSHIP") {
    attributes.people.communication += 0.8;
    attributes.personality.pressureHandling += 0.8;
    attributes.personality.professionalism += 0.8;
  }
};

const addLicences = (
  attributes: ManagerAttributeSet,
  licences: readonly CoachingLicence[],
): void => {
  const boost = Math.min(
    4,
    licences.reduce((total, licence) => total + licence.reputationEffect, 0),
  );
  attributes.tactical.tacticalKnowledge += boost;
  attributes.coaching.attackingCoaching += boost * 0.5;
  attributes.coaching.defensiveCoaching += boost * 0.5;
  attributes.personality.reputation += boost * 0.4;
};

const addReputation = (
  attributes: ManagerAttributeSet,
  profile: CreateCareerCharacterInput["startingReputationProfile"],
): void => {
  const boost = {
    LOCAL_UNKNOWN: 0,
    LOCAL_RESPECTED: 1.5,
    FORMER_PLAYER: 2,
    EDUCATED_COACH: 1.2,
  }[profile];
  attributes.personality.reputation += boost;
  attributes.people.motivation += boost * 0.4;
};

const capAttributes = (attributes: ManagerAttributeSet): ManagerAttributeSet => {
  const cap = (value: number): number => Math.max(1, Math.min(14, Math.round(value)));
  return {
    tactical: mapValues(attributes.tactical, cap),
    coaching: mapValues(attributes.coaching, cap),
    people: mapValues(attributes.people, cap),
    recruitment: mapValues(attributes.recruitment, cap),
    personality: mapValues(attributes.personality, cap),
  };
};

const mapValues = <T extends Record<string, number>>(
  input: T,
  mapper: (value: number) => number,
): T => Object.fromEntries(Object.entries(input).map(([key, value]) => [key, mapper(value)])) as T;

const ageOn = (dateOfBirth: ISODate, onDate: ISODate): number => {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  const date = new Date(`${onDate}T00:00:00Z`);
  let age = date.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = date.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && date.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
};
