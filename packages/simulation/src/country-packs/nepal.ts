import type { NamePool, NationalTeamDefinition, CountryPack } from "../country-pack.js";
import { registerCountryPack } from "../country-pack.js";
import { initializeTerritorialStructure } from "../territorial-football.js";
import { seedGeographyLocations } from "../administrative-geography.js";
import { NEPAL_GEOGRAPHY } from "./nepal-geography.js";
import { NEPAL_COMMERCIAL } from "./nepal-commercial.js";
import { NEPAL_MEDIA } from "./nepal-media.js";

export const NEPAL_PACK_ID = "nepal-v1";

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
  geography: NEPAL_GEOGRAPHY,
  economy: { priceLevel: 1, wageLevel: 1, ticketPriceLevel: 1 },
  commercial: NEPAL_COMMERCIAL,
  media: NEPAL_MEDIA,
  initialiseTerritory: (db, date) => {
    initializeTerritorialStructure(db, date, NEPAL_GEOGRAPHY);
    seedGeographyLocations(db, NEPAL_GEOGRAPHY);
  },
  ensureTerritorialStructure: (db, date) => {
    initializeTerritorialStructure(db, date, NEPAL_GEOGRAPHY);
  },
});
