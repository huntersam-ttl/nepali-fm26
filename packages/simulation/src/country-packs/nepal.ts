import { createStableEntityId, type ClubLender, type CountryDevelopmentProfile, type EntityId, type MediaJournalist, type MediaOutlet, type SponsorOrganisation } from "@nepal-football-sim/shared-types";
import type { NamePool, NationalTeamDefinition, CountryPack } from "../country-pack.js";
import { registerCountryPack } from "../country-pack.js";
import {
  ensureNepalFounderLocations,
  founderLocationOptionsFromDistricts,
  initializeNepalTerritorialStructure,
  NEPAL_PROVINCE_DISTRICTS,
} from "../territorial-football.js";

export const NEPAL_PACK_ID = "nepal-v1";

export const nepalDevelopmentProfile = (countryId: EntityId, date: string): CountryDevelopmentProfile => ({
  id: createStableEntityId("country-development-profile", `${countryId}:${date.slice(0, 4)}`),
  countryId,
  effectiveFrom: date,
  footballPopularity: 0.58,
  grassrootsReach: 0.42,
  coachingQuality: 0.36,
  youthInfrastructure: 0.32,
  talentConversion: 0.34,
  status: "SIMULATION_ONLY",
  notes: "Calibrated Nepal youth environment for gameplay; not a researched score.",
});

export const NEPAL_CLUB_LENDERS: readonly Omit<ClubLender, "id" | "countryId">[] = [
  { name: "Nabil Bank Limited", institutionType: "COMMERCIAL_BANK", sourceUrl: "https://www.nabilbank.com/aboutus", status: "VERIFIED" },
  { name: "Nepal Bank Limited", institutionType: "COMMERCIAL_BANK", sourceUrl: "https://www.nrb.org.np/bfr/bfis-list-in-english-mid-january-2026/", status: "VERIFIED" },
  { name: "Agriculture Development Bank Limited", institutionType: "COMMERCIAL_BANK", sourceUrl: "https://www.nrb.org.np/bfr/bfis-list-in-english-mid-january-2026/", status: "VERIFIED" },
  { name: "Himalayan Bank Limited", institutionType: "COMMERCIAL_BANK", sourceUrl: "https://www.nrb.org.np/bfr/bfis-list-in-english-mid-january-2026/", status: "VERIFIED" },
  { name: "Muktinath Bikas Bank Limited", institutionType: "DEVELOPMENT_BANK", sourceUrl: "https://www.nrb.org.np/bfr/bfis-list-in-english-mid-january-2026/", status: "VERIFIED" },
];

export const NEPAL_MEDIA_OUTLETS: readonly Omit<MediaOutlet, "id">[] = [
  { name: "Kathmandu Football Desk", scope: "LOCAL", reputation: 5.8, reach: 3.5, bias: "CLUB_FOCUSED", style: "ANALYSIS", status: "SIMULATION_ONLY" },
  { name: "Nepal Football News", scope: "NATIONAL", reputation: 6.8, reach: 6.5, bias: "NATIONAL_FOCUS", style: "WIRE", status: "SIMULATION_ONLY" },
  { name: "South Asia Football Review", scope: "REGIONAL_INTERNATIONAL", reputation: 8.1, reach: 7.4, bias: "NEUTRAL", style: "TRADE", status: "SIMULATION_ONLY" },
  { name: "ANFA Federation Bulletin", scope: "NATIONAL", reputation: 7.2, reach: 5.5, bias: "DEVELOPMENT_FOCUS", style: "WIRE", status: "SIMULATION_ONLY" },
  { name: "Nepal Football Business Desk", scope: "NATIONAL", reputation: 6.2, reach: 4.8, bias: "NEUTRAL", style: "TRADE", status: "SIMULATION_ONLY" },
  { name: "Club Media Channel", scope: "LOCAL", reputation: 4.5, reach: 2.8, bias: "CLUB_FOCUSED", style: "TABLOID", status: "SIMULATION_ONLY" },
];

export const NEPAL_MEDIA_JOURNALISTS: readonly Omit<MediaJournalist, "id" | "outletId">[] = [
  { name: "Asha Shrestha", beat: "Domestic football", temperament: "NEUTRAL", reputation: 6.5, status: "SIMULATION_ONLY" },
  { name: "Rijan Gurung", beat: "National teams", temperament: "SCEPTICAL", reputation: 7.2, status: "SIMULATION_ONLY" },
  { name: "Mina Rai", beat: "Player development", temperament: "FRIENDLY", reputation: 6.8, status: "SIMULATION_ONLY" },
];

export const NEPAL_SPONSORS: readonly Pick<SponsorOrganisation, "name" | "industry" | "sourceUrl" | "identityProvenance" | "status">[] = [
  { name: "Nabil Bank Limited", industry: "Banking", sourceUrl: "https://www.nabilbank.com/aboutus", identityProvenance: "VERIFIED", status: "VERIFIED" },
  { name: "Nepal Telecom", industry: "Telecommunications", sourceUrl: "https://www.ntc.net.np/about-us/nepal-telecom-in-brief", identityProvenance: "VERIFIED", status: "VERIFIED" },
  { name: "Ncell Axiata Limited", industry: "Telecommunications", sourceUrl: "https://www.ncell.com.np/en/about/company-profile", identityProvenance: "VERIFIED", status: "VERIFIED" },
  { name: "Nepal Airlines Corporation", industry: "Airlines", sourceUrl: "https://www.nepalairlines.com.np/about", identityProvenance: "VERIFIED", status: "VERIFIED" },
  { name: "Chaudhary Group", industry: "FMCG and diversified industry", sourceUrl: "https://www.chaudharygroup.com/", identityProvenance: "VERIFIED", status: "VERIFIED" },
  { name: "Himal Local Partner", industry: "Local services", identityProvenance: "SIMULATION_ONLY", status: "SIMULATION_ONLY" },
  { name: "Bagmati Community Foods", industry: "Food and beverage", identityProvenance: "SIMULATION_ONLY", status: "SIMULATION_ONLY" },
  { name: "Koshi Digital", industry: "Technology", identityProvenance: "SIMULATION_ONLY", status: "SIMULATION_ONLY" },
  { name: "Lumbini Travel Cooperative", industry: "Travel", identityProvenance: "SIMULATION_ONLY", status: "SIMULATION_ONLY" },
  { name: "Annapurna Training Supplies", industry: "Sports equipment", identityProvenance: "SIMULATION_ONLY", status: "SIMULATION_ONLY" },
  { name: "Kathmandu Youth Education", industry: "Education", identityProvenance: "SIMULATION_ONLY", status: "SIMULATION_ONLY" },
  { name: "Terai Agro Markets", industry: "Agriculture", identityProvenance: "SIMULATION_ONLY", status: "SIMULATION_ONLY" },
  { name: "Everest Health Clinics", industry: "Healthcare", identityProvenance: "SIMULATION_ONLY", status: "SIMULATION_ONLY" },
];

export const NEPAL_FEDERATION_SPONSORS: readonly Pick<SponsorOrganisation, "name" | "industry">[] = [
  { name: "Nepal Football Development Partner", industry: "Development services" },
  { name: "Himal Broadcast Network", industry: "Broadcasting" },
  { name: "Regional Sports Education Trust", industry: "Education" },
];

/** Nepal's name lists, exactly as the generators used them before names became a pack concern. */
export const NEPAL_NAME_POOL: NamePool = {
  id: "nepal-names-v1",
  languageCodes: ["ne"],
  languageNames: ["Nepali"],
  managerFullNames: [
    "Bikash Thapa",
    "Suman Gurung",
    "Nirajan Rai",
    "Sagar Khadka",
    "Prakash Basnet",
    "Rohit Chettri",
    "Deepak Shrestha",
    "Milan Tamang",
    "Kiran Magar",
    "Anup Karki",
    "Bishal Lama",
    "Ramesh Bhandari",
  ],
  staffFullNames: [
    "Suresh Thapa",
    "Bikash Gurung",
    "Anil Rai",
    "Dipesh Shrestha",
    "Nabin Magar",
    "Ramesh Tamang",
    "Kiran Bhandari",
    "Sujan Karki",
    "Prakash Lama",
    "Rajan Basnet",
  ],
  officials: {
    maleFirst: ["Bhim", "Chandra", "Dipak", "Gopal", "Hari", "Indra", "Keshav", "Madhav", "Narayan", "Padam", "Ramesh", "Santosh", "Tek", "Umesh"],
    femaleFirst: ["Anjana", "Bhawana", "Kamala", "Menuka", "Sarita", "Sunita"],
    surnames: ["Adhikari", "Bhandari", "Chaudhary", "Gurung", "Karki", "Lama", "Magar", "Poudel", "Rai", "Shrestha", "Tamang", "Thapa"],
  },
  players: {
    maleFirst: [
      "Aarav", "Aashish", "Abinash", "Anish", "Arjun", "Bikash", "Bimal", "Bibek", "Deepak", "Dinesh", "Kiran", "Manish", "Nabin", "Niraj", "Prabin",
      "Prakash", "Rabin", "Rajan", "Ramesh", "Ritesh", "Roshan", "Sagar", "Sandesh", "Sanjog", "Suman", "Suraj", "Sushil", "Utsav", "Yogesh",
    ],
    femaleFirst: [
      "Anita", "Anjali", "Asmita", "Bimala", "Deepa", "Dipa", "Gita", "Kabita", "Manisha", "Nirmala", "Pooja", "Prabha", "Preeti", "Rachana", "Rekha",
      "Renuka", "Sabitra", "Samjhana", "Sanju", "Saru", "Sarita", "Sunita", "Susmita", "Rasila",
    ],
    maleMiddle: ["Bahadur", "Kumar", "Raj", "Prasad", "Man", "Bir"],
    femaleMiddle: ["Kumari", "Devi", "Maya", "Laxmi"],
    surnames: [
      "Adhikari", "Ale", "Basnet", "Bhandari", "Bista", "Budha", "Chaudhary", "Ghale", "Gurung", "Karki", "Khadka", "Lama", "Limbu", "Magar", "Maharjan",
      "Poudel", "Rai", "Shahi", "Sharma", "Sherpa", "Shrestha", "Tamang", "Thapa", "Yadav",
    ],
  },
};

const NEPAL_NATIONAL_TEAMS: readonly NationalTeamDefinition[] = [
  { teamType: "SENIOR_MEN", level: "senior", gender: "men", label: "Senior Men", strengthMultiplier: 1 },
  { teamType: "SENIOR_WOMEN", level: "senior", gender: "women", label: "Senior Women", strengthMultiplier: 0.84 },
  { teamType: "U23", level: "u23", gender: "men", label: "U23 Men", strengthMultiplier: 0.91 },
  { teamType: "U20", level: "u20", gender: "men", label: "U20 Men", strengthMultiplier: 0.86 },
  { teamType: "U17", level: "u17", gender: "men", label: "U17 Men", strengthMultiplier: 0.8 },
];

export const nepalPack: CountryPack = registerCountryPack({
  packId: NEPAL_PACK_ID,
  countryName: "Nepal",
  nationalTeamCodePrefix: "NEP",
  isoCodes: ["NPL", "NP"],
  currency: "NPR",
  locale: "en-IN",
  federationAbbreviation: "ANFA",
  seasonRules: { seasonStart: "08-01", seasonEnd: "07-31", youthIntake: "08-15" },
  nationalTeams: NEPAL_NATIONAL_TEAMS,
  tierLabels: ["A Division", "B Division", "C Division"],
  namePool: NEPAL_NAME_POOL,
  founderLocations: () => founderLocationOptionsFromDistricts(NEPAL_PROVINCE_DISTRICTS),
  developmentProfile: nepalDevelopmentProfile,
  lenders: NEPAL_CLUB_LENDERS,
  mediaOutlets: NEPAL_MEDIA_OUTLETS,
  mediaJournalists: NEPAL_MEDIA_JOURNALISTS,
  sponsors: NEPAL_SPONSORS,
  federationSponsors: NEPAL_FEDERATION_SPONSORS,
  initialiseTerritory: (db, date) => {
    initializeNepalTerritorialStructure(db, date);
    ensureNepalFounderLocations(db);
  },
  ensureTerritorialStructure: (db, date) => {
    initializeNepalTerritorialStructure(db, date);
  },
});
