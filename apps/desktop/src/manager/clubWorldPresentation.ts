import type {
  ClubCampusProject,
  ClubFacilitySnapshot,
  InfrastructureProject,
} from "@nepal-football-sim/shared-types";
import type { MeetingTone } from "./meetings.js";

/** Which campus block a project type belongs to — several project types
 * (e.g. GYM/MEDICAL_ROOM/RECOVERY_CENTRE) share the same physical block on
 * the campus overview rather than each getting their own tile. */
const CAMPUS_BLOCK_FOR_PROJECT_TYPE: Record<string, string> = {
  TRAINING_GROUND: "training",
  GYM: "training",
  MEDICAL_ROOM: "medical",
  RECOVERY_CENTRE: "medical",
  ANALYSIS_ROOM: "training",
  ACADEMY: "academy",
  OFFICE: "offices",
  SCOUTING_DEPARTMENT: "offices",
  STADIUM: "stadium",
  STAND: "stadium",
  FLOODLIGHTS: "stadium",
  PITCH: "stadium",
  DRAINAGE: "stadium",
  REFURBISHMENT: "stadium",
};

export type CampusBlockKey = "stadium" | "training" | "academy" | "medical" | "offices";

export type CampusBlockDescriptor = {
  key: CampusBlockKey;
  label: string;
  quality?: number;
  qualityLabel?: string;
  tone: MeetingTone;
  activeProject?: ClubCampusProject;
  statusLabel: string;
};

const QUALITY_LABEL = (value: number): { label: string; tone: MeetingTone } => {
  if (value >= 16) return { label: "Elite", tone: "ok" };
  if (value >= 11) return { label: "Strong", tone: "ok" };
  if (value >= 6) return { label: "Adequate", tone: "info" };
  if (value > 0) return { label: "Basic", tone: "warn" };
  return { label: "Undeveloped", tone: "bad" };
};

const PROJECT_STATUS_LABEL: Record<string, string> = {
  IDEA: "Idea stage",
  PLANNING: "Planning",
  APPROVED: "Approved",
  FINANCING: "Arranging funding",
  CONSTRUCTION: "Under construction",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const projectStatusLabel = (status: string): string => PROJECT_STATUS_LABEL[status] ?? status.replace(/_/g, " ").toLowerCase();

/**
 * The real, current state of every campus block — driven strictly from the
 * club's facility-quality snapshot and its own active infrastructure
 * projects, never a decorative fixed layout. A block with no quality data
 * and no active project shows honestly as undeveloped/no data, not hidden.
 */
export const campusBlockDescriptors = (
  facilitySnapshot: ClubFacilitySnapshot | undefined,
  campusProjects: ClubCampusProject[],
): CampusBlockDescriptor[] => {
  const activeByBlock = new Map<CampusBlockKey, ClubCampusProject>();
  for (const project of campusProjects) {
    const block = CAMPUS_BLOCK_FOR_PROJECT_TYPE[project.projectType] as CampusBlockKey | undefined;
    if (!block) continue;
    // Prefer the most advanced active project if more than one targets the
    // same block (construction over planning, etc.) — never just "the last
    // one found".
    const existing = activeByBlock.get(block);
    if (!existing || rank(project.status) > rank(existing.status)) activeByBlock.set(block, project);
  }
  const blocks: Array<{ key: CampusBlockKey; label: string; quality?: number }> = [
    { key: "stadium", label: "Stadium" },
    { key: "training", label: "Training ground" },
    { key: "academy", label: "Academy", quality: facilitySnapshot?.youthFacilityQuality },
    { key: "medical", label: "Medical / performance", quality: facilitySnapshot?.medicalFacilityQuality },
    { key: "offices", label: "Club offices" },
  ];
  // Training ground quality comes from the same snapshot field the game
  // already treats as "training facility" — stadium/offices have no
  // quality-rating field in the canonical model, so they're described by
  // their active project (if any) and otherwise left honestly undated.
  const withTrainingQuality = blocks.map((block) =>
    block.key === "training" ? { ...block, quality: facilitySnapshot?.trainingFacilityQuality } : block,
  );
  return withTrainingQuality.map((block) => {
    const activeProject = activeByBlock.get(block.key);
    if (block.quality !== undefined) {
      const { label, tone } = QUALITY_LABEL(block.quality);
      return {
        key: block.key,
        label: block.label,
        quality: block.quality,
        qualityLabel: label,
        tone: activeProject ? "warn" : tone,
        activeProject,
        statusLabel: activeProject ? projectStatusLabel(activeProject.status) : label,
      };
    }
    return {
      key: block.key,
      label: block.label,
      tone: activeProject ? "warn" : "info",
      activeProject,
      statusLabel: activeProject ? projectStatusLabel(activeProject.status) : "No data on record",
    };
  });
};

const STATUS_RANK: Record<string, number> = {
  IDEA: 0,
  PLANNING: 1,
  APPROVED: 2,
  FINANCING: 2,
  CONSTRUCTION: 3,
};
const rank = (status: string): number => STATUS_RANK[status] ?? 0;

/**
 * A real progress percentage for an in-flight project, derived from its own
 * persisted dates — never a fabricated animation. PLANNING/FINANCING/
 * APPROVED sit at a fixed low band (nothing physical has started yet);
 * CONSTRUCTION is interpolated between constructionStart and
 * expectedCompletion; COMPLETED is 100; CANCELLED/IDEA is 0.
 */
export type ProjectProgressInput = Pick<InfrastructureProject, "status" | "planningStart" | "constructionStart" | "expectedCompletion">;

export const projectProgressPercent = (project: ProjectProgressInput, worldDate: string): number => {
  if (project.status === "COMPLETED") return 100;
  if (project.status === "CANCELLED" || project.status === "IDEA") return 0;
  if (project.status === "PLANNING") return 8;
  if (project.status === "APPROVED") return 15;
  if (project.status === "FINANCING") return 20;
  // CONSTRUCTION
  const start = project.constructionStart ?? project.planningStart;
  const end = project.expectedCompletion;
  const startMs = new Date(`${start}T00:00:00Z`).getTime();
  const endMs = new Date(`${end}T00:00:00Z`).getTime();
  const nowMs = new Date(`${worldDate}T00:00:00Z`).getTime();
  if (!(endMs > startMs)) return 25;
  const elapsed = (nowMs - startMs) / (endMs - startMs);
  return Math.round(25 + Math.max(0, Math.min(1, elapsed)) * 70);
};
