import { describe, expect, it } from "vitest";
import type { ClubProfile, EntityId, EntityReference } from "@nepal-football-sim/shared-types";
import { buildClubSceneProfile } from "./clubScenePresentation.js";
import { buildClubScene } from "./clubSceneBuilder.js";
import { qualitySettings } from "./scenePreferences.js";

/**
 * Behavioural coverage for the scene graph itself. three's scene/camera maths
 * run fine without a GPU — only WebGLRenderer needs a context — so the
 * animation contract, the state-driven geometry and disposal are all testable
 * here rather than only by looking at a picture.
 */

const eid = (value: string): EntityId => value as unknown as EntityId;

const ref = (id: string, label: string): EntityReference => ({
  entityType: "CLUB",
  id: eid(id),
  label,
  destination: "club",
  visible: true,
  allowedActions: [],
  provenanceStatus: "SIMULATION_ONLY",
});

const profileFor = (overrides: Partial<ClubProfile> = {}): ClubProfile => ({
  entityReference: ref("club-scene", "Scene FC"),
  recentFixtures: [],
  squad: [],
  activeSponsors: [],
  infrastructureProjects: [],
  campusProjects: [],
  infrastructureHistory: [],
  stadium: {
    venueId: eid("venue"),
    name: "Scene Ground",
    capacity: 24000,
    floodlights: true,
    coveredStands: true,
    confirmedHomeGround: true,
  },
  reputation: { footballReputation: 60, commercialReputation: 50 },
  facilitySnapshot: {
    trainingFacilityQuality: 14,
    youthFacilityQuality: 12,
    medicalFacilityQuality: 10,
    analyticsFacilityQuality: 8,
    academyCapacity: 30,
  },
  ...overrides,
});

const sceneFor = (motion: "FULL" | "REDUCED" | "OFF", overrides: Partial<ClubProfile> = {}) =>
  buildClubScene(buildClubSceneProfile(profileFor(overrides)), qualitySettings("MEDIUM"), motion);

describe("club scene animation contract", () => {
  it("moves the camera over time on Full", () => {
    const handle = sceneFor("FULL");
    handle.update(0);
    const start = handle.camera.position.clone();
    handle.update(6);
    expect(handle.camera.position.equals(start)).toBe(false);
    handle.dispose();
  });

  it("never sweeps the camera on Reduced — the setting exists to stop exactly that", () => {
    const handle = sceneFor("REDUCED");
    handle.update(0);
    const start = handle.camera.position.clone();
    handle.update(6);
    handle.update(18);
    expect(handle.camera.position.equals(start)).toBe(true);
    handle.dispose();
  });

  it("keeps a construction crane moving on Reduced — Reduced calms the camera, it is not Off", () => {
    const underConstruction: Partial<ClubProfile> = {
      campusProjects: [
        {
          id: eid("p1"),
          projectType: "TRAINING_GROUND",
          status: "CONSTRUCTION",
          reference: { ...ref("p1", "Training build"), entityType: "INFRASTRUCTURE_PROJECT" },
        } as ClubProfile["campusProjects"][number],
      ],
    };
    // Buildings carry a seeded resting rotation, so compare each scene against
    // itself over time rather than against zero.
    const movedOverTime = (motion: "REDUCED" | "OFF"): boolean => {
      const handle = sceneFor(motion, underConstruction);
      const sample = (): number[] => {
        const values: number[] = [];
        handle.scene.traverse((child) => {
          values.push((child as { rotation: { y: number } }).rotation.y);
        });
        return values;
      };
      handle.update(0);
      const before = sample();
      handle.update(7);
      const after = sample();
      handle.dispose();
      return after.some((value, index) => value !== before[index]);
    };
    expect(movedOverTime("REDUCED")).toBe(true);
    expect(movedOverTime("OFF")).toBe(false);
  });

  it("does nothing at all on Off", () => {
    const handle = sceneFor("OFF");
    const start = handle.camera.position.clone();
    handle.update(6);
    handle.update(30);
    expect(handle.camera.position.equals(start)).toBe(true);
    handle.dispose();
  });

  it("is deterministic: the same club builds an identical camera and object count twice", () => {
    const a = sceneFor("FULL");
    const b = sceneFor("FULL");
    expect(b.camera.position.equals(a.camera.position)).toBe(true);
    expect(b.scene.children.length).toBe(a.scene.children.length);
    a.dispose();
    b.dispose();
  });
});

describe("camera presets", () => {
  it("jumps instantly to a preset on Reduced motion", () => {
    const handle = sceneFor("REDUCED");
    const before = handle.camera.position.clone();
    handle.focus("STADIUM");
    const afterFocus = handle.camera.position.clone();
    expect(afterFocus.equals(before)).toBe(false);
    handle.update(1);
    handle.update(2);
    expect(handle.camera.position.equals(afterFocus)).toBe(true);
    handle.dispose();
  });

  it("eases toward a preset over several frames on Full motion, without snapping instantly", () => {
    const handle = sceneFor("FULL");
    handle.update(0);
    const before = handle.camera.position.clone();
    handle.focus("TRAINING");
    handle.update(0.1);
    const oneFrameIn = handle.camera.position.clone();
    expect(oneFrameIn.equals(before)).toBe(false);
    for (let frame = 0; frame < 60; frame += 1) handle.update(0.1 * (frame + 2));
    const settled = handle.camera.position.clone();
    // Still moving after one frame, but converges after many.
    expect(oneFrameIn.distanceTo(settled)).toBeGreaterThan(0);
    handle.dispose();
  });

  it("stops orbiting Overview once a different preset is focused, and resumes when Overview is re-selected", () => {
    const handle = sceneFor("FULL");
    handle.focus("ACADEMY");
    for (let frame = 0; frame < 40; frame += 1) handle.update(0.1 * (frame + 1));
    const settledAtAcademy = handle.camera.position.clone();
    handle.update(20);
    handle.update(21);
    expect(handle.camera.position.distanceTo(settledAtAcademy)).toBeLessThan(0.1);
    handle.focus("OVERVIEW");
    for (let frame = 0; frame < 40; frame += 1) handle.update(0.1 * (frame + 1));
    const settledOverview = handle.camera.position.clone();
    handle.update(40);
    const afterDrift = handle.camera.position.clone();
    expect(afterDrift.equals(settledOverview)).toBe(false);
    handle.dispose();
  });

  it("frames a different, real position for each named preset", () => {
    const handle = sceneFor("REDUCED");
    const positions = (["OVERVIEW", "STADIUM", "TRAINING", "ACADEMY", "ADMIN"] as const).map((preset) => {
      handle.focus(preset);
      return handle.camera.position.clone();
    });
    const unique = new Set(positions.map((position) => `${position.x},${position.y},${position.z}`));
    expect(unique.size).toBe(positions.length);
    handle.dispose();
  });
});

describe("club scene geometry follows real state", () => {
  // Measured over the campus groups only, never scene.children: ambient trees
  // are quality-gated scenery and a bare open-land site carries far more of
  // them than a built-up one, so a whole-scene object count reports the
  // opposite of what it looks like it reports.
  const campusObjects = (handle: {
    pickables: Array<{ object: unknown }>;
  }): number => {
    let total = 0;
    for (const pickable of handle.pickables) {
      (pickable.object as { traverse: (fn: () => void) => void }).traverse(() => {
        total += 1;
      });
    }
    return total;
  };

  it("builds more of a campus for a bigger, better-equipped club", () => {
    const small = sceneFor("OFF", {
      stadium: {
        venueId: eid("v"),
        name: "Small",
        capacity: 900,
        floodlights: false,
        coveredStands: false,
        confirmedHomeGround: true,
      },
      reputation: { footballReputation: 4, commercialReputation: 3 },
      facilitySnapshot: {
        trainingFacilityQuality: 0,
        youthFacilityQuality: 0,
        medicalFacilityQuality: 0,
        analyticsFacilityQuality: 0,
        academyCapacity: 0,
      },
    });
    const big = sceneFor("OFF");
    expect(campusObjects(big)).toBeGreaterThan(campusObjects(small));
    small.dispose();
    big.dispose();
  });

  it("adds construction geometry only where a project is genuinely building", () => {
    const idle = sceneFor("OFF");
    const building = sceneFor("OFF", {
      campusProjects: [
        {
          id: eid("p1"),
          projectType: "TRAINING_GROUND",
          status: "CONSTRUCTION",
          reference: { ...ref("p1", "Training build"), entityType: "INFRASTRUCTURE_PROJECT" },
        } as ClubProfile["campusProjects"][number],
      ],
    });
    // Scaffolding posts, a crane mast and a jib are real extra objects.
    expect(campusObjects(building)).toBeGreaterThan(campusObjects(idle));
    idle.dispose();
    building.dispose();
  });

  it("exposes every campus block as a pickable, so a 3D click can only ever open a real block", () => {
    const handle = sceneFor("OFF");
    const kinds = handle.pickables.map((entry) => entry.building).sort();
    expect(kinds).toEqual(["ACADEMY", "MEDICAL", "OFFICES", "STADIUM", "TRAINING"]);
    handle.dispose();
  });

  it("releases its geometry on dispose rather than leaking it", () => {
    const handle = sceneFor("OFF");
    let disposed = 0;
    handle.scene.traverse((child) => {
      const mesh = child as { geometry?: { dispose: () => void } };
      if (mesh.geometry) {
        const original = mesh.geometry.dispose.bind(mesh.geometry);
        mesh.geometry.dispose = () => {
          disposed += 1;
          original();
        };
      }
    });
    handle.dispose();
    expect(disposed).toBeGreaterThan(0);
    expect(handle.scene.children.length).toBe(0);
  });

  it("gives a full-capacity elite stadium visibly more stadium geometry than a one-stand local ground of the same building count", () => {
    const village = sceneFor("OFF", {
      stadium: { venueId: eid("v"), name: "Village", capacity: 900, confirmedHomeGround: true },
    });
    const elite = sceneFor("OFF", {
      stadium: {
        venueId: eid("v2"),
        name: "Elite Bowl",
        capacity: 45000,
        floodlights: true,
        coveredStands: true,
        confirmedHomeGround: true,
      },
    });
    const stadiumObjectCount = (handle: typeof village): number => {
      let count = 0;
      const stadium = handle.pickables.find((entry) => entry.building === "STADIUM")!.object;
      stadium.traverse(() => {
        count += 1;
      });
      return count;
    };
    expect(stadiumObjectCount(elite)).toBeGreaterThan(stadiumObjectCount(village));
    village.dispose();
    elite.dispose();
  });

  it("shows the stadium itself under construction from a real project — the stadium block previously had no construction state at all", () => {
    const idle = sceneFor("OFF", {
      stadium: { venueId: eid("v"), name: "V", capacity: 12000, confirmedHomeGround: true },
    });
    const building = sceneFor("OFF", {
      stadium: { venueId: eid("v"), name: "V", capacity: 12000, confirmedHomeGround: true },
      campusProjects: [
        {
          id: eid("stand-proj"),
          projectType: "STAND",
          status: "CONSTRUCTION",
          reference: { ...ref("stand-proj", "Stand expansion"), entityType: "INFRASTRUCTURE_PROJECT" },
        } as ClubProfile["campusProjects"][number],
      ],
    });
    const stadiumObjectCount = (handle: typeof idle): number => {
      let count = 0;
      handle.pickables.find((entry) => entry.building === "STADIUM")!.object.traverse(() => {
        count += 1;
      });
      return count;
    };
    expect(stadiumObjectCount(building)).toBeGreaterThan(stadiumObjectCount(idle));
    idle.dispose();
    building.dispose();
  });

  const buildingObjectCount = (
    handle: { pickables: Array<{ object: { traverse: (fn: () => void) => void }; building: string }> },
    kind: string,
  ): number => {
    let count = 0;
    handle.pickables.find((entry) => entry.building === kind)!.object.traverse(() => {
      count += 1;
    });
    return count;
  };

  it("gives an Elite training complex visibly more geometry than a Basic one — real composition, not just a bigger box", () => {
    const basic = sceneFor("OFF", {
      facilitySnapshot: { trainingFacilityQuality: 3, youthFacilityQuality: 0, medicalFacilityQuality: 0, analyticsFacilityQuality: 0, academyCapacity: 0 },
    });
    const elite = sceneFor("OFF", {
      facilitySnapshot: { trainingFacilityQuality: 18, youthFacilityQuality: 0, medicalFacilityQuality: 0, analyticsFacilityQuality: 0, academyCapacity: 0 },
    });
    expect(buildingObjectCount(elite, "TRAINING")).toBeGreaterThan(buildingObjectCount(basic, "TRAINING"));
    basic.dispose();
    elite.dispose();
  });

  it("gives training and academy different geometry at the same tier — not duplicate copies of each other", () => {
    const handle = sceneFor("OFF", {
      facilitySnapshot: { trainingFacilityQuality: 16, youthFacilityQuality: 16, medicalFacilityQuality: 0, analyticsFacilityQuality: 0, academyCapacity: 30 },
    });
    const training = buildingObjectCount(handle, "TRAINING");
    const academy = buildingObjectCount(handle, "ACADEMY");
    // Same tier band (16 -> ELITE for both), but training's pitch count and
    // academy's are deliberately different bands (4 vs 3 at ELITE), so the
    // two blocks are not identical geometry with a different label.
    expect(training).not.toBe(academy);
    handle.dispose();
  });

  it("gives an Elite club HQ visibly more geometry than a Basic office — a real administration ladder", () => {
    const basic = sceneFor("OFF", {
      facilitySnapshot: { trainingFacilityQuality: 0, youthFacilityQuality: 0, medicalFacilityQuality: 0, analyticsFacilityQuality: 3, academyCapacity: 0 },
    });
    const elite = sceneFor("OFF", {
      facilitySnapshot: { trainingFacilityQuality: 0, youthFacilityQuality: 0, medicalFacilityQuality: 0, analyticsFacilityQuality: 18, academyCapacity: 0 },
    });
    expect(buildingObjectCount(elite, "OFFICES")).toBeGreaterThan(buildingObjectCount(basic, "OFFICES"));
    basic.dispose();
    elite.dispose();
  });

  it("gives an Elite medical centre visibly more geometry than an Advanced-or-below one via the recovery annex", () => {
    const professional = sceneFor("OFF", {
      facilitySnapshot: { trainingFacilityQuality: 0, youthFacilityQuality: 0, medicalFacilityQuality: 10, analyticsFacilityQuality: 0, academyCapacity: 0 },
    });
    const elite = sceneFor("OFF", {
      facilitySnapshot: { trainingFacilityQuality: 0, youthFacilityQuality: 0, medicalFacilityQuality: 18, analyticsFacilityQuality: 0, academyCapacity: 0 },
    });
    expect(buildingObjectCount(elite, "MEDICAL")).toBeGreaterThan(buildingObjectCount(professional, "MEDICAL"));
    professional.dispose();
    elite.dispose();
  });
});
