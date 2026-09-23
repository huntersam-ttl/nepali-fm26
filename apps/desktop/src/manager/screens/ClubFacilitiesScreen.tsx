import React from "react";
import type { ClubCampusProject, ClubProfile, ClubStadiumSummary, EntityId, EntityReferenceType } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Panel, useRuntimeData } from "../ui.js";
import { EntityRefLink } from "../RoleDetailScreen.js";
import { CLUB_UNKNOWN } from "../club.js";

/**
 * Phase 6C — Club Facilities (Manager operational view).
 *
 * Pure presentation over the canonical `ClubProfile` facility snapshot + stadium
 * + active campus projects. Facilities are read-only for the Manager — project
 * planning and approval are Owner institutional authority (preserved in the
 * Owner workspace). Quality is shown exactly as the engine stores it (a level),
 * never with invented labels, multipliers, or a fabricated rendering.
 */

/** Facility categories with canonical snapshot fields. */
export type FacilityCategoryDef = {
  key: string;
  label: string;
  level: "trainingFacilityQuality" | "youthFacilityQuality" | "medicalFacilityQuality" | "analyticsFacilityQuality";
  capacity?: "academyCapacity";
};
export const FACILITY_CATEGORIES: FacilityCategoryDef[] = [
  { key: "training", label: "Training", level: "trainingFacilityQuality" },
  { key: "academy", label: "Academy / Youth", level: "youthFacilityQuality", capacity: "academyCapacity" },
  { key: "medical", label: "Medical / Performance", level: "medicalFacilityQuality" },
  { key: "analytics", label: "Analysis", level: "analyticsFacilityQuality" },
];

/** Which infrastructure project types belong to each facility category. */
const CATEGORY_PROJECT_TYPES: Record<string, string[]> = {
  stadium: ["STADIUM", "STAND", "FLOODLIGHTS", "PITCH", "DRAINAGE", "REFURBISHMENT"],
  training: ["TRAINING_GROUND", "GYM"],
  academy: ["ACADEMY"],
  medical: ["MEDICAL_ROOM", "RECOVERY_CENTRE"],
  analytics: ["ANALYSIS_ROOM"],
};
// Map a project type to its facility category, or undefined for non-facility
// projects (OFFICE, RETAIL_STORE, SCOUTING_DEPARTMENT).
const projectTypeCategory = (projectType: string): string | undefined => {
  for (const [category, types] of Object.entries(CATEGORY_PROJECT_TYPES)) {
    if (types.includes(projectType)) return category;
  }
  return undefined;
};

export const projectTypeCategoryLabel = (projectType: string): string | undefined =>
  projectTypeCategory(projectType);

/** Exact canonical level presentation — `Level 3`, or null when not established. */
export const levelLabel = (level: number | undefined): string | null =>
  level && level > 0 ? `Level ${level}` : null;

export const humanizeProjectType = (type: string): string =>
  type.replaceAll("_", " ").toLowerCase();

/** The club's stadium, if a relationship/fallback resolved it. */
export const stadiumRef = (profile: ClubProfile | undefined): ClubStadiumSummary | undefined =>
  profile?.stadium;

/** Active facility projects present on the club, keyed by category. */
export const facilityProjectsByCategory = (
  projects: ClubCampusProject[],
): Record<string, ClubCampusProject[]> => {
  const map: Record<string, ClubCampusProject[]> = {};
  for (const project of projects) {
    const category = projectTypeCategory(project.projectType);
    if (category) (map[category] ??= []).push(project);
  }
  return map;
};

export const ClubFacilitiesScreen = ({
  clubId,
  onOpenEntity,
}: {
  clubId?: EntityId;
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void;
}): React.ReactElement => {
  const [profile] = useRuntimeData(
    (): Promise<Awaited<ReturnType<typeof managerBridge.getClubProfile>>> =>
      clubId ? managerBridge.getClubProfile(clubId) : Promise.resolve({ ok: false, error: "No club" } as never),
  );

  if (!clubId) {
    return (
      <section className="dashboard">
        <Panel title="Facilities">
          <p className="subtle">Join a club as Manager to view its facilities here.</p>
        </Panel>
      </section>
    );
  }

  return (
    <AsyncPanel state={profile}>
      {(view) => {
        const stadium = stadiumRef(view);
        const snapshot = view.facilitySnapshot;
        const projectsByCategory = facilityProjectsByCategory(view.campusProjects);
        return (
          <>
            <div className="facility-hero" aria-label="Stadium and home ground">
              <div className="facility-hero-body">
                <p className="eyebrow">Stadium / home ground</p>
                <h2 className="facility-title">
                  {stadium?.name ?? CLUB_UNKNOWN}
                  {stadium && !stadium.confirmedHomeGround ? <span className="subtle"> · inferred home ground</span> : null}
                </h2>
                {stadium ? (
                  <ul className="report-list">
                    {stadium.capacity != null && <li>Capacity: {stadium.capacity.toLocaleString("en-US")}</li>}
                    {stadium.surfaceType && <li>Surface: {stadium.surfaceType.toLowerCase()}</li>}
                    {stadium.pitchQuality && <li>Pitch quality: {stadium.pitchQuality.toLowerCase()}</li>}
                    {stadium.floodlights !== undefined && <li>Floodlights: {stadium.floodlights ? "yes" : "no"}</li>}
                    {stadium.coveredStands !== undefined && <li>Covered stands: {stadium.coveredStands ? "yes" : "no"}</li>}
                    {stadium.yearOpened && <li>Opened: {stadium.yearOpened}</li>}
                    {stadium.status && <li>Status: {stadium.status.toLowerCase()}</li>}
                    <li>
                      <Badge tone={stadium.confirmedHomeGround ? "ok" : "info"}>
                        {stadium.confirmedHomeGround ? "confirmed home ground" : "inferred"}
                      </Badge>
                    </li>
                  </ul>
                ) : (
                  <p className="empty-state">No stadium relation has been identified for this club.</p>
                )}
                {renderProjectLink(projectsByCategory.stadium ?? [], "stadium", onOpenEntity)}
              </div>
            </div>
<Panel title="Supporting facilities" className="panel-wide">
              {snapshot ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Facility</th>
                        <th>Level</th>
                        <th>Active project</th>
                      </tr>
                    </thead>
                    <tbody>
                      {FACILITY_CATEGORIES.map((category) => {
                        const level = levelLabel(snapshot[category.level]);
                        const projects = projectsByCategory[category.key] ?? [];
                        return (
                          <tr key={category.key}>
                            <td>{category.label}</td>
                            <td>
                              {level ? (
                                <>
                                  {level} <Badge tone="info">simulated</Badge>
                                </>
                              ) : (
                                <span className="unknown">Not established</span>
                              )}
                              {category.capacity && (
                                <span className="subtle">
                                  {" "}· capacity {snapshot[category.capacity]}
                                </span>
                              )}
                            </td>
                            <td>{renderFacilityProjectCell(projects, onOpenEntity)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty-state">No facility data has been modelled for this club.</p>
              )}
            </Panel>

            <Panel title="Effects">
              <p className="subtle">
                Facility levels are engine inputs: training quality supports player development, academy and youth
                quality support intake and development, and the medical facility supports recovery. These are shown
                here as factual context — the underlying coefficients stay internal.
              </p>
            </Panel>

            <Panel title="Authority">
              <p className="subtle">
                This is the Manager&rsquo;s operational view of the club estate. Proposing and approving facility
                projects is institutional authority held by the board / owner and managed in the Owner workspace.
              </p>
            </Panel>
          </>
        );
      }}
    </AsyncPanel>
  );
};

const renderFacilityProjectCell = (
  projects: ClubCampusProject[],
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void,
): React.ReactNode =>
  projects.length === 0 ? (
    <span className="unknown">None</span>
  ) : (
    <ul className="report-list">
      {projects.map((project) => (
        <li key={project.id}>
          <EntityRefLink
            reference={project.reference}
            onOpen={(r) => onOpenEntity(r.entityType, r.id)}
          />{" "}
          <Badge tone="info">{project.status.toLowerCase()}</Badge>
        </li>
      ))}
    </ul>
  );

const renderProjectLink = (
  projects: ClubCampusProject[],
  _key: string,
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void,
): React.ReactNode => renderFacilityProjectCell(projects, onOpenEntity);