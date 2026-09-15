import * as THREE from "three";
import type { FacilityVisualTier } from "./clubScenePresentation.js";
import type { MeetingSceneProfile } from "./meetingScenePresentation.js";
import type { SceneMotion, SceneQualitySettings } from "./scenePreferences.js";

/**
 * Builds a reusable off-pitch decision-room scene from a MeetingSceneProfile
 * — a boardroom, negotiation room or press room, all sharing one deliberately
 * lightweight interior instead of one bespoke renderer per workflow. No
 * people are modelled: identity stays in the DOM (see PHASE 29's
 * no-animated-human-scope-creep boundary), so this only ever furnishes the
 * room itself — table, chairs, a presentation wall or podium, tier-scaled
 * materials. The only module besides clubSceneBuilder.ts/
 * federationSceneBuilder.ts that imports three (see noMatchRendering.test.ts).
 */

export type MeetingCameraPreset = "ROOM" | "TABLE";

export type MeetingSceneHandle = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update: (elapsedSeconds: number) => void;
  focus: (preset: MeetingCameraPreset) => void;
  dispose: () => void;
};

const seededRandom = (seed: number): (() => number) => {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
};

/** Room footprint and chair count per tier — a routine club office is small
 * and sparsely furnished; an elite institution's room is larger with more
 * seating and a stronger presentation wall. */
const ROOM_FORM: Record<FacilityVisualTier, { width: number; depth: number; height: number; chairs: number }> = {
  UNDEVELOPED: { width: 5, depth: 4, height: 2.6, chairs: 2 },
  BASIC: { width: 6, depth: 5, height: 2.8, chairs: 4 },
  MODEST: { width: 7, depth: 5.5, height: 3, chairs: 6 },
  PROFESSIONAL: { width: 8.5, depth: 6.5, height: 3.2, chairs: 8 },
  ADVANCED: { width: 10, depth: 7.5, height: 3.6, chairs: 10 },
  ELITE: { width: 12, depth: 9, height: 4, chairs: 12 },
};

const CAMERA_PRESET_VIEW: Record<MeetingCameraPreset, { position: [number, number, number]; lookAt: [number, number, number] }> = {
  ROOM: { position: [9, 6, 10], lookAt: [0, 1.4, 0] },
  TABLE: { position: [0, 3, 5], lookAt: [0, 0.9, 0] },
};

const disposeObject = (root: THREE.Object3D): void => {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
};

export const buildMeetingScene = (
  profile: MeetingSceneProfile,
  quality: SceneQualitySettings,
  motion: SceneMotion,
): MeetingSceneHandle => {
  const random = seededRandom(profile.seed);
  const scene = new THREE.Scene();
  const accent = new THREE.Color().setHSL(profile.accentHue / 360, 0.4, 0.5);
  const form = ROOM_FORM[profile.environmentTier];

  const backdrop = new THREE.Color(0x101625);
  scene.background = backdrop;
  scene.fog = new THREE.Fog(backdrop, 12, 26);

  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.3, 100);
  camera.position.set(9, 6, 10);
  camera.lookAt(0, 1.4, 0);

  const ambient = new THREE.AmbientLight(0xd6e0ff, 0.6);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff2dd, 1);
  key.position.set(4, 6, 5);
  key.castShadow = quality.shadows;
  if (quality.shadows) {
    key.shadow.mapSize.set(512, 512);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 20;
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
  }
  scene.add(key);
  const rim = new THREE.DirectionalLight(accent.getHex(), 0.3);
  rim.position.set(-4, 4, -4);
  scene.add(rim);

  const developed = profile.environmentTier !== "UNDEVELOPED";
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: developed
      ? profile.environmentTier === "ADVANCED" || profile.environmentTier === "ELITE"
        ? 0x8fb4c9 // glass at higher tiers
        : 0x4d5568 // painted concrete otherwise
      : 0x3a4238,
    roughness: developed && (profile.environmentTier === "ADVANCED" || profile.environmentTier === "ELITE") ? 0.15 : 0.8,
    metalness: developed && (profile.environmentTier === "ADVANCED" || profile.environmentTier === "ELITE") ? 0.3 : 0.04,
    transparent: profile.environmentTier === "ADVANCED" || profile.environmentTier === "ELITE",
    opacity: profile.environmentTier === "ADVANCED" || profile.environmentTier === "ELITE" ? 0.85 : 1,
  });
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(form.width, form.depth), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = quality.shadows;
  scene.add(floor);

  // Back and side walls only — an open-fronted room reads clearly from any
  // camera without needing an interior-clipping ceiling.
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(form.width, form.height), wallMaterial);
  backWall.position.set(0, form.height / 2, -form.depth / 2);
  scene.add(backWall);
  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(form.depth, form.height), wallMaterial);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-form.width / 2, form.height / 2, 0);
  scene.add(leftWall);
  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(form.depth, form.height), wallMaterial);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(form.width / 2, form.height / 2, 0);
  scene.add(rightWall);

  // A club/federation-accent band along the back wall — identity, not a
  // crest claim, exactly like the club and federation scenes' own bands.
  const band = new THREE.Mesh(
    new THREE.PlaneGeometry(form.width * 0.9, 0.3),
    new THREE.MeshStandardMaterial({ color: accent.getHex(), emissive: accent.getHex(), emissiveIntensity: 0.3 }),
  );
  band.position.set(0, form.height * 0.72, -form.depth / 2 + 0.02);
  scene.add(band);

  const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x3c342a, roughness: 0.5, metalness: 0.1 });
  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2430, roughness: 0.7 });

  if (profile.context === "PRESS") {
    // A podium facing the room, not a shared table — a press room reads
    // differently from a negotiation/boardroom at a glance.
    const podium = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 0.7), tableMaterial);
    podium.position.set(0, 0.55, -form.depth / 2 + 1.6);
    podium.castShadow = quality.shadows;
    scene.add(podium);
    // Rows of seating facing the podium.
    const rows = Math.min(3, Math.ceil(form.chairs / 4));
    for (let row = 0; row < rows; row += 1) {
      const seatsInRow = Math.min(4, form.chairs - row * 4);
      for (let seat = 0; seat < seatsInRow; seat += 1) {
        const chair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), chairMaterial);
        chair.position.set((seat - (seatsInRow - 1) / 2) * 0.9, 0.25, 0.5 + row * 1.1);
        scene.add(chair);
      }
    }
  } else {
    // A shared table — boardroom/negotiation share this layout, differing
    // only in tier-driven scale.
    const tableWidth = Math.min(form.width * 0.55, 4.2);
    const tableDepth = Math.min(form.depth * 0.4, 1.8);
    const table = new THREE.Mesh(new THREE.BoxGeometry(tableWidth, 0.08, tableDepth), tableMaterial);
    table.position.set(0, 0.75, 0);
    table.castShadow = quality.shadows;
    table.receiveShadow = quality.shadows;
    scene.add(table);
    const legMaterial = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.5, metalness: 0.4 });
    for (const xSign of [1, -1]) {
      for (const zSign of [1, -1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.72, 6), legMaterial);
        leg.position.set(xSign * (tableWidth / 2 - 0.2), 0.36, zSign * (tableDepth / 2 - 0.2));
        scene.add(leg);
      }
    }
    const perSide = Math.max(1, Math.floor(form.chairs / 2));
    for (const side of [1, -1]) {
      for (let index = 0; index < perSide; index += 1) {
        const t = perSide === 1 ? 0.5 : index / (perSide - 1);
        const chair = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.45), chairMaterial);
        chair.position.set((t - 0.5) * (tableWidth - 0.6), 0.25, side * (tableDepth / 2 + 0.4));
        // Small, stable per-organisation jitter so a full room of chairs
        // doesn't look machine-stamped — seeded, so it is the same every launch.
        chair.rotation.y = (random() - 0.5) * 0.1;
        scene.add(chair);
      }
    }
  }

  // A small amount of quality-gated ambient life — a presentation screen
  // glow at higher tiers, never material to the outcome.
  if (quality.ambientProps && (profile.environmentTier === "PROFESSIONAL" || profile.environmentTier === "ADVANCED" || profile.environmentTier === "ELITE")) {
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(form.width * 0.35, form.height * 0.3),
      new THREE.MeshBasicMaterial({ color: 0x9fd7ff }),
    );
    screen.position.set(form.width / 2 - 0.05, form.height * 0.5, -form.depth * 0.15);
    screen.rotation.y = -Math.PI / 2;
    scene.add(screen);
  }

  let activePreset: MeetingCameraPreset = "ROOM";
  let easing: { position: THREE.Vector3; lookAt: THREE.Vector3 } | undefined;
  const currentLookAt = new THREE.Vector3(0, 1.4, 0);

  const focus = (preset: MeetingCameraPreset): void => {
    activePreset = preset;
    const view = CAMERA_PRESET_VIEW[preset];
    const targetPosition = new THREE.Vector3(...view.position);
    const targetLookAt = new THREE.Vector3(...view.lookAt);
    if (motion === "FULL") {
      easing = { position: targetPosition, lookAt: targetLookAt };
    } else {
      camera.position.copy(targetPosition);
      currentLookAt.copy(targetLookAt);
      camera.lookAt(currentLookAt);
    }
  };

  const update = (elapsedSeconds: number): void => {
    if (motion === "OFF") return;
    if (easing) {
      camera.position.lerp(easing.position, 0.15);
      currentLookAt.lerp(easing.lookAt, 0.15);
      camera.lookAt(currentLookAt);
      if (camera.position.distanceTo(easing.position) < 0.05) easing = undefined;
    } else if (motion === "FULL" && activePreset === "ROOM") {
      const drift = Math.sin(elapsedSeconds * 0.1) * 0.6;
      camera.position.x = 9 + drift;
      camera.lookAt(0, 1.4, 0);
    }
  };

  const dispose = (): void => {
    disposeObject(scene);
    scene.clear();
  };

  return { scene, camera, update, focus, dispose };
};
