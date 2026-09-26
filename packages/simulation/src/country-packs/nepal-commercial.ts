import type { PackCommercial } from "../country-pack.js";

/*
 * Nepal's commercial identities. Banks and the named corporate sponsors are real, researched
 * institutions (each with its source); the regional sponsors are simulation-only names in Nepal's
 * own naming style. Order matters: the sponsor pool draws its reputations and tiers in this order.
 */
const NRB_BFI_LIST = "https://www.nrb.org.np/bfr/bfis-list-in-english-mid-january-2026/";

export const NEPAL_COMMERCIAL: PackCommercial = {
  lenders: [
    { name: "Nabil Bank Limited", institutionType: "COMMERCIAL_BANK", sourceUrl: "https://www.nabilbank.com/aboutus", status: "VERIFIED" },
    { name: "Nepal Bank Limited", institutionType: "COMMERCIAL_BANK", sourceUrl: NRB_BFI_LIST, status: "VERIFIED" },
    { name: "Agriculture Development Bank Limited", institutionType: "COMMERCIAL_BANK", sourceUrl: NRB_BFI_LIST, status: "VERIFIED" },
    { name: "Himalayan Bank Limited", institutionType: "COMMERCIAL_BANK", sourceUrl: NRB_BFI_LIST, status: "VERIFIED" },
    { name: "Muktinath Bikas Bank Limited", institutionType: "DEVELOPMENT_BANK", sourceUrl: NRB_BFI_LIST, status: "VERIFIED" },
  ],
  sponsors: [
    { name: "Nabil Bank Limited", industry: "Banking", sourceUrl: "https://www.nabilbank.com/aboutus", identityProvenance: "VERIFIED" },
    { name: "Nepal Telecom", industry: "Telecommunications", sourceUrl: "https://www.ntc.net.np/about-us/nepal-telecom-in-brief", identityProvenance: "VERIFIED" },
    { name: "Ncell Axiata Limited", industry: "Telecommunications", sourceUrl: "https://www.ncell.com.np/en/about/company-profile", identityProvenance: "VERIFIED" },
    { name: "Nepal Airlines Corporation", industry: "Airlines", sourceUrl: "https://www.nepalairlines.com.np/about", identityProvenance: "VERIFIED" },
    { name: "Chaudhary Group", industry: "FMCG and diversified industry", sourceUrl: "https://www.chaudharygroup.com/", identityProvenance: "VERIFIED" },
    { name: "Himal Local Partner", industry: "Local services", identityProvenance: "SIMULATION_ONLY" },
    { name: "Bagmati Community Foods", industry: "Food and beverage", identityProvenance: "SIMULATION_ONLY" },
    { name: "Koshi Digital", industry: "Technology", identityProvenance: "SIMULATION_ONLY" },
    { name: "Lumbini Travel Cooperative", industry: "Travel", identityProvenance: "SIMULATION_ONLY" },
    { name: "Annapurna Training Supplies", industry: "Sports equipment", identityProvenance: "SIMULATION_ONLY" },
    { name: "Kathmandu Youth Education", industry: "Education", identityProvenance: "SIMULATION_ONLY" },
    { name: "Terai Agro Markets", industry: "Agriculture", identityProvenance: "SIMULATION_ONLY" },
    { name: "Everest Health Clinics", industry: "Healthcare", identityProvenance: "SIMULATION_ONLY" },
  ],
  suppliers: [
    { name: "Kathmandu Football Supply", region: "Nepal", reputation: 6.4, priceLevel: 0.92, reliability: 0.86, foreign: false, status: "SIMULATION_ONLY" },
    { name: "Himalayan Sports Cooperative", region: "Nepal", reputation: 5.8, priceLevel: 0.78, reliability: 0.72, foreign: false, status: "SIMULATION_ONLY" },
    { name: "South Asia Performance Group", region: "South Asia", reputation: 7.2, priceLevel: 1.08, reliability: 0.82, foreign: true, status: "SIMULATION_ONLY" },
    { name: "AsiaPro Football Systems", region: "Wider Asia", reputation: 8.1, priceLevel: 1.24, reliability: 0.91, foreign: true, status: "SIMULATION_ONLY" },
  ],
  federationSponsors: [
    { name: "Nepal Football Development Partner", industry: "Development services" },
    { name: "Himal Broadcast Network", industry: "Broadcasting" },
    { name: "Regional Sports Education Trust", industry: "Education" },
  ],
};
