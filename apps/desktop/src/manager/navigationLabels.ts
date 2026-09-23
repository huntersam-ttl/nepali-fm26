import type { EntityReferenceType } from "@nepal-football-sim/shared-types";
import {
  entityTypeTitle,
  type AppDestination,
  type ManagerWorkspace,
} from "../navigation.js";

/**
 * Phase 1D — destination labels + context trail.
 *
 * ONE place that turns an AppDestination (workspace or entity) into the
 * human-readable label shown in the shell header, breadcrumbs and contextual
 * secondary navigation. Labels are not scattered across components.
 *
 * Entity breadcrumb labels deliberately use the lightweight reference/read
 * model label when already known (via getEntityReference); while that resolves
 * they fall back to the entity category label — never a raw id and never a
 * fabricated name.
 */

export const MANAGER_WORKSPACE_LABELS: Record<ManagerWorkspace, string> = {
  home: "Home / Inbox",
  squad: "Squad",
  "squad-overview": "Squad Overview",
  "dressing-room": "Dressing Room",
  tactics: "Tactics",
  training: "Training",
  fixtures: "Fixtures",
  competition: "Competition",
  scouting: "Scouting",
  "recruitment-overview": "Recruitment Overview",
  "player-database": "Player Database",
  recommendations: "Recommendations",
  "recruitment-focuses": "Recruitment Focuses",
  shortlists: "Shortlists",
  "squad-planner": "Squad Planner",
  transfers: "Transfers",
  contracts: "Contracts",
  staff: "Staff",
  medical: "Medical",
  media: "Media",
  messages: "Messages",
  news: "News",
  calendar: "Calendar",
  loans: "Loans",
  "club-overview": "Club Overview",
  "club-profile": "Club Profile",
  "club-finances": "Club Finances",
  "club-board": "Club Board",
  "club-responsibilities": "Responsibilities",
  "club-facilities": "Facilities",
  "club-projects": "Infrastructure Projects",
};

const OWNER_WORKSPACE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  matchday: "Matchday",
  finance: "Finances",
  manager: "Manager",
  meeting: "Talk to Manager",
  investors: "Investors",
  executive: "Executive Management",
  facilities: "Facilities",
  sponsorship: "Sponsorship",
  supporters: "Supporters",
  "club-store": "Club Store",
  identity: "Club Identity",
  bank: "Bank",
};

const PRESIDENT_WORKSPACE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  governance: "Governance",
  finance: "Federation Finance",
  commercial: "Commercial",
  "national-teams": "National Teams",
  "national-development": "National Development",
  "competition-pyramid": "Domestic Pyramid",
  "nepal-map": "Nepal Map",
  "government-relations": "Government",
  tenure: "Election / Tenure",
};

export const workspaceLabel = (destination: AppDestination): string => {
  if (destination.kind === "entity") return entityTypeTitle(destination.entityType);
  switch (destination.role) {
    case "MANAGER":
      return MANAGER_WORKSPACE_LABELS[destination.workspace] ?? "Home / Inbox";
    case "CHAIRMAN_OWNER":
      return OWNER_WORKSPACE_LABELS[destination.workspace] ?? "Dashboard";
    case "FEDERATION_PRESIDENT":
      return PRESIDENT_WORKSPACE_LABELS[destination.workspace] ?? "Dashboard";
    default:
      return "Dashboard";
  }
};

export const entityCategoryLabel = (entityType: EntityReferenceType): string => entityTypeTitle(entityType);

/** Workspace "families" used for contextual secondary navigation. Every id is
 * an existing, navigable workspace — no sub-pages are fabricated. */
export const MANAGER_FAMILIES: Array<{ label: string; items: string[] }> = [
  { label: "Team", items: ["home", "squad", "dressing-room", "tactics", "training", "medical"] },
  { label: "Competition", items: ["fixtures", "competition"] },
  { label: "Recruitment", items: ["recruitment-overview", "player-database", "recommendations", "recruitment-focuses", "shortlists", "squad-planner", "scouting", "transfers", "contracts"] },
  { label: "Club", items: ["club-overview", "club-profile", "club-finances", "club-board", "club-responsibilities", "club-facilities", "club-projects", "staff", "media"] },
];

export const OWNER_FAMILIES: Array<{ label: string; items: string[] }> = [
  { label: "Owner office", items: ["dashboard", "matchday", "finance", "manager", "meeting"] },
  { label: "Ownership", items: ["investors"] },
  { label: "Staff", items: ["executive"] },
  { label: "Development", items: ["facilities"] },
  { label: "Commercial", items: ["sponsorship", "supporters", "club-store"] },
  { label: "Club", items: ["identity"] },
  { label: "External relations", items: ["bank"] },
];

export const PRESIDENT_FAMILIES: Array<{ label: string; items: string[] }> = [
  { label: "Federation", items: ["dashboard", "governance", "finance", "commercial"] },
  { label: "Football", items: ["national-teams", "national-development", "competition-pyramid", "nepal-map"] },
  { label: "External relations", items: ["government-relations"] },
  { label: "Career", items: ["tenure"] },
];

const managerLabels = (id: string): string => (MANAGER_WORKSPACE_LABELS as Record<string, string>)[id] ?? id;
const ownerLabels = (id: string): string => OWNER_WORKSPACE_LABELS[id] ?? id;
const presidentLabels = (id: string): string => PRESIDENT_WORKSPACE_LABELS[id] ?? id;

export type ContextualNavItem = { id: string; label: string; current: boolean };

/** The Manager Daily Operations family — genuinely related sub-workspaces whose
 * contextual secondary navigation is distinct from random side-workspaces. */
export const DAILY_OPS_FAMILY: string[] = [
  "home",
  "messages",
  "news",
  "calendar",
  "fixtures",
  "competition",
];

// Contextual labels deliberately differ from the global sidebar where a member
// is ALSO a top-level nav item, so the family nav never duplicates (or collides
// with) primary navigation accessible names.
const DAILY_OPS_LABELS: Record<string, string> = {
  home: "Overview",
  messages: "Messages",
  news: "News",
  calendar: "Calendar",
  fixtures: "Fixture schedule",
  competition: "League table",
};

/** Daily Operations contextual secondary nav (Overview | Messages | News |
 * Calendar | Fixtures | Competition). Shown only within the family. */
export const dailyOpsNavItems = (workspace: string): ContextualNavItem[] => {
  if (!DAILY_OPS_FAMILY.includes(workspace)) return [];
  return DAILY_OPS_FAMILY.map((id) => ({
    id,
    label: DAILY_OPS_LABELS[id] ?? id,
    current: id === workspace,
  }));
};

/** The Manager Squad family — Overview, First Team, Training, Dynamics, Medical,
 * and a read-only Loans workspace (real transfer-centre active loans). */
export const SQUAD_FAMILY: string[] = [
  "squad-overview",
  "squad",
  "training",
  "dressing-room",
  "medical",
  "loans",
];

export const squadNavItems = (workspace: string): ContextualNavItem[] => {
  if (!SQUAD_FAMILY.includes(workspace)) return [];
  return [
    { id: "squad-overview", label: "Overview", current: workspace === "squad-overview" },
    { id: "squad", label: "First Team", current: workspace === "squad" },
    { id: "training", label: "Training", current: workspace === "training" },
    { id: "dressing-room", label: "Dynamics", current: workspace === "dressing-room" },
    { id: "medical", label: "Medical", current: workspace === "medical" },
    { id: "loans", label: "Loans", current: workspace === "loans" },
  ];
};

/** The Manager Club governance family — Overview, Profile, Finances, Board,
 * Responsibilities (the live Phase 6B destinations). Staff & Media stay listed
 * in the primary sidebar's Club group but are not governance siblings. */
export const CLUB_FAMILY: string[] = [
  "club-overview",
  "club-profile",
  "club-finances",
  "club-board",
  "club-responsibilities",
  "club-facilities",
  "club-projects",
];

export const clubNavItems = (workspace: string): ContextualNavItem[] => {
  if (!CLUB_FAMILY.includes(workspace)) return [];
  return [
    { id: "club-overview", label: "Overview", current: workspace === "club-overview" },
    { id: "club-profile", label: "Profile", current: workspace === "club-profile" },
    { id: "club-finances", label: "Finances", current: workspace === "club-finances" },
    { id: "club-board", label: "Board", current: workspace === "club-board" },
    { id: "club-responsibilities", label: "Responsibilities", current: workspace === "club-responsibilities" },
    { id: "club-facilities", label: "Facilities", current: workspace === "club-facilities" },
    { id: "club-projects", label: "Projects", current: workspace === "club-projects" },
  ];
};

/** Contextual secondary navigation for the active role's workspace family
 * (siblings of the current workspace). Empty when none apply (e.g. entities,
 * executive roles). Only existing, navigable workspaces are ever listed. */
export const contextualNavItems = (role: string, workspace: string): ContextualNavItem[] => {
  let families: Array<{ label: string; items: string[] }>;
  let label: (id: string) => string;
  if (role === "MANAGER") {
    families = MANAGER_FAMILIES;
    label = managerLabels;
  } else if (role === "CHAIRMAN_OWNER") {
    families = OWNER_FAMILIES;
    label = ownerLabels;
  } else if (role === "FEDERATION_PRESIDENT") {
    families = PRESIDENT_FAMILIES;
    label = presidentLabels;
  } else {
    return [];
  }
  const family = families.find((candidate) => candidate.items.includes(workspace));
  if (!family) return [];
  return family.items.map((id) => ({ id, label: label(id), current: id === workspace }));
};

/**
 * Bounded context trail for breadcrumbs. This is NOT the navigation history
 * front-to-back: it starts at the most recent workspace and leads to the
 * current destination (maximum 4 crumbs), so a "Squad > Aayush > Club" chain
 * reads naturally without replaying every historical click.
 */
export const contextTrail = (destination: AppDestination, history: readonly AppDestination[]): AppDestination[] => {
  if (destination.kind === "workspace") return [destination];
  const chain: AppDestination[] = [destination];
  for (let index = history.length - 2; index >= 0; index -= 1) {
    const previous = history[index];
    chain.unshift(previous);
    if (previous.kind === "workspace") break;
  }
  if (chain.length <= 4) return chain;
  const root = chain[0];
  return [root, ...chain.slice(chain.length - 3)];
};