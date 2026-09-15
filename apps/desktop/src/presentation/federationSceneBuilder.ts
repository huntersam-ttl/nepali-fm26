import * as THREE from "three";
import type { FederationSceneProfile, FederationVisualTier } from "./federationScenePresentation.js";
import type { SceneMotion, SceneQualitySettings } from "./scenePreferences.js";

/**
 * Builds the Federation Environment from a FederationSceneProfile. Every
 * dimension traces back to real federation state through that profile —
 * building footprint/height from real development scores, scaffolding from
 * a real in-progress project. Deterministic: the profile's stable seed
 * means the same federation state renders the identical campus every
 * launch. Mirrors clubSceneBuilder.ts's structure; the only module that
 * imports three, so it loads as a separate lazy chunk.
 */

export type FederationCameraPreset = "OVERVIEW" | "HQ" | "NATIONAL_CENTRE";

export type FederationSceneHandle = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update: (elapsedSeconds: number) => void;
  pickables: Array<{ object: THREE.Object3D; building: "HQ" | "NATIONAL_CENTRE" }>;
  focus: (preset: FederationCameraPreset) => void;
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

const BUILDING_FORM: Record<FederationVisualTier, { width: number; depth: number; height: number }> = {
  UNDEVELOPED: { width: 5, depth: 4, height: 0.25 },
  BASIC: { width: 6, depth: 4.5, height: 1.6 },
  MODEST: { width: 7.5, depth: 5.5, height: 2.4 },
  PROFESSIONAL: { width: 9, depth: 6.5, height: 3.4 },
  ADVANCED: { width: 10.5, depth: 7.5, height: 4.4 },
  ELITE: { width: 12, depth: 8.5, height: 5.6 },
};

const BUILDING_PLOT = {
  HQ: { x: -13, z: 0 },
  NATIONAL_CENTRE: { x: 13, z: 4 },
} as const;

const CAMERA_PRESET_VIEW: Record<FederationCameraPreset, { position: [number, number, number]; lookAt: [number, number, number] }> = {
  OVERVIEW: { position: [30, 20, 34], lookAt: [0, 2, 0] },
  HQ: {
    position: [BUILDING_PLOT.HQ.x - 8, 8, BUILDING_PLOT.HQ.z + 12],
    lookAt: [BUILDING_PLOT.HQ.x, 2, BUILDING_PLOT.HQ.z],
  },
  NATIONAL_CENTRE: {
    position: [BUILDING_PLOT.NATIONAL_CENTRE.x + 10, 9, BUILDING_PLOT.NATIONAL_CENTRE.z + 16],
    lookAt: [BUILDING_PLOT.NATIONAL_CENTRE.x, 2, BUILDING_PLOT.NATIONAL_CENTRE.z],
  },
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

export const buildFederationScene = (
  profile: FederationSceneProfile,
  quality: SceneQualitySettings,
  motion: SceneMotion,
): FederationSceneHandle => {
  const random = seededRandom(profile.seed);
  const scene = new THREE.Scene();
  const accent = new THREE.Color().setHSL(profile.accentHue / 360, 0.4, 0.5);

  const skyTop = new THREE.Color().setHSL(0.6, 0.3, 0.12 + profile.prestige * 0.05);
  scene.background = skyTop;
  scene.fog = new THREE.Fog(skyTop, 55, 140);

  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 400);
  camera.position.set(30, 20, 34);
  camera.lookAt(0, 2, 0);

  const ambient = new THREE.AmbientLight(0xbcd0ff, 0.55 + profile.prestige * 0.2);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff2dd, 1.1 + profile.prestige * 0.25);
  key.position.set(24, 36, 16);
  key.castShadow = quality.shadows;
  if (quality.shadows) {
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 120;
    key.shadow.camera.left = -40;
    key.shadow.camera.right = 40;
    key.shadow.camera.top = 40;
    key.shadow.camera.bottom = -40;
  }
  scene.add(key);
  const rim = new THREE.DirectionalLight(accent.getHex(), 0.3);
  rim.position.set(-24, 14, -20);
  scene.add(rim);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    new THREE.MeshStandardMaterial({ color: 0x30392f, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = quality.shadows;
  scene.add(ground);

  const materials = {
    institutional: new THREE.MeshStandardMaterial({ color: 0x565f6e, roughness: 0.75, metalness: 0.05 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x8fb4c9, roughness: 0.12, metalness: 0.35, opacity: 0.82, transparent: true }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8a93a6, roughness: 0.45, metalness: 0.75 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x3c4250, roughness: 0.4, metalness: 0.8 }),
    paintedConcrete: new THREE.MeshStandardMaterial({ color: 0x4d5568, roughness: 0.75, metalness: 0.03 }),
    scaffold: new THREE.MeshStandardMaterial({ color: 0xd8a54a, roughness: 0.8 }),
    undeveloped: new THREE.MeshStandardMaterial({ color: 0x3a4238, roughness: 1 }),
  };

  const pickables: FederationSceneHandle["pickables"] = [];
  const animated: Array<{ object: THREE.Object3D; phase: number; amplitude: number }> = [];

  const bodyMaterialFor = (kind: "HQ" | "NATIONAL_CENTRE", tier: FederationVisualTier): THREE.Material => {
    if (kind === "HQ") {
      if (tier === "ADVANCED" || tier === "ELITE") return materials.glass;
      if (tier === "PROFESSIONAL") return materials.steel;
      return materials.paintedConcrete;
    }
    return materials.institutional;
  };

  const buildBuilding = (
    kind: "HQ" | "NATIONAL_CENTRE",
    building: FederationSceneProfile["hq"],
    pitchCount: number,
  ): void => {
    const plot = BUILDING_PLOT[kind];
    const form = BUILDING_FORM[building.tier];
    const group = new THREE.Group();
    group.position.set(plot.x, 0, plot.z);
    group.rotation.y = (random() - 0.5) * 0.2;

    const developed = building.tier !== "UNDEVELOPED";
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(form.width, Math.max(form.height, 0.2), form.depth),
      developed ? bodyMaterialFor(kind, building.tier) : materials.undeveloped,
    );
    body.position.y = Math.max(form.height, 0.2) / 2;
    body.castShadow = quality.shadows && developed;
    body.receiveShadow = quality.shadows;
    group.add(body);

    if (developed) {
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(form.width * 0.96, 0.24, form.depth * 0.96),
        new THREE.MeshStandardMaterial({ color: accent.getHex(), emissive: accent.getHex(), emissiveIntensity: 0.25 }),
      );
      band.position.y = form.height * 0.6;
      group.add(band);

      if (kind === "HQ") {
        // An entrance canopy from Professional up — a national federation's
        // arrival façade, scaled to its real institutional strength.
        if (building.tier === "PROFESSIONAL" || building.tier === "ADVANCED" || building.tier === "ELITE") {
          const canopy = new THREE.Mesh(new THREE.BoxGeometry(form.width * 0.55, 0.14, 1.6), materials.darkSteel);
          canopy.position.set(0, form.height * 0.35, -(form.depth / 2 + 0.8));
          group.add(canopy);
        }
        if (building.tier === "ELITE") {
          const plaza = new THREE.Mesh(new THREE.PlaneGeometry(form.width * 1.5, 2.6), materials.paintedConcrete);
          plaza.rotation.x = -Math.PI / 2;
          plaza.position.set(0, 0.03, -(form.depth / 2 + 2));
          group.add(plaza);
        }
      } else {
        // National centre: real practice pitches, scaled from youth/coach
        // development — never a fixed decoration.
        for (let index = 0; index < pitchCount; index += 1) {
          const practice = new THREE.Mesh(
            new THREE.PlaneGeometry(7.5, 5),
            new THREE.MeshStandardMaterial({ color: 0x2c5f38, roughness: 0.95 }),
          );
          practice.rotation.x = -Math.PI / 2;
          practice.position.set(0, 0.05, form.depth / 2 + 3.6 + index * 5.6);
          practice.receiveShadow = quality.shadows;
          group.add(practice);
        }
        // A small technical/referee-education annex once referee
        // development is genuinely active — never fabricated.
      }
    }

    if (building.underConstruction) {
      for (let index = 0; index < 4; index += 1) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, form.height + 1.6, 0.16), materials.scaffold);
        post.position.set(
          (index % 2 === 0 ? 1 : -1) * (form.width / 2 + 0.35),
          (form.height + 1.6) / 2,
          (index < 2 ? 1 : -1) * (form.depth / 2 + 0.35),
        );
        group.add(post);
      }
      const craneMast = new THREE.Mesh(new THREE.BoxGeometry(0.24, form.height + 6.5, 0.24), materials.scaffold);
      craneMast.position.set(form.width / 2 + 1.8, (form.height + 6.5) / 2, -(form.depth / 2 + 1.2));
      group.add(craneMast);
      const jib = new THREE.Mesh(new THREE.BoxGeometry(7, 0.2, 0.2), materials.scaffold);
      jib.position.set(form.width / 2 + 1.8, form.height + 6.5, -(form.depth / 2 + 1.2));
      group.add(jib);
      if (motion !== "OFF") animated.push({ object: jib, phase: random() * Math.PI * 2, amplitude: 0.22 });
    } else if (building.planned) {
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(form.width * 0.64, form.width * 0.72, quality.segments),
        new THREE.MeshBasicMaterial({ color: 0x7ea6ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.y = 0.09;
      group.add(marker);
    }

    if (developed && quality.ambientProps) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.4, 6), materials.darkSteel);
      pole.position.set(form.width / 2 + 0.7, 1.2, form.depth / 2);
      group.add(pole);
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 0.45),
        new THREE.MeshStandardMaterial({ color: accent.getHex(), side: THREE.DoubleSide, roughness: 0.8 }),
      );
      flag.position.set(form.width / 2 + 1.0, 2.1, form.depth / 2);
      group.add(flag);
      if (motion === "FULL") animated.push({ object: flag, phase: random() * Math.PI * 2, amplitude: 0.15 });
    }

    scene.add(group);
    pickables.push({ object: group, building: kind });
  };

  buildBuilding("HQ", profile.hq, 0);
  buildBuilding("NATIONAL_CENTRE", profile.nationalCentre, profile.nationalCentrePitchCount);

  // Referee-development marker: a small classroom block between the two
  // main buildings, only when the federation's real referee-development
  // score justifies it.
  if (profile.refereeDevelopmentPresent) {
    const marker = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 1.6), materials.paintedConcrete);
    marker.position.set(0, 0.6, -6);
    marker.castShadow = quality.shadows;
    scene.add(marker);
  }

  // Women's & girls' development marker: a second small accent-banded
  // block, only when a real WOMENS_DEVELOPMENT project exists.
  if (profile.womensProgrammePresent) {
    const marker = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 1.6), materials.institutional);
    marker.position.set(0, 0.6, 6);
    marker.castShadow = quality.shadows;
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.16, 1.5),
      new THREE.MeshStandardMaterial({ color: accent.getHex(), emissive: accent.getHex(), emissiveIntensity: 0.25 }),
    );
    band.position.set(0, 0.75, 6);
    scene.add(marker, band);
  }

  if (quality.ambientProps) {
    const treeCount = 14;
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 1 });
    const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x2f5134, roughness: 1 });
    for (let index = 0; index < treeCount; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = 26 + random() * 28;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.6, 5), trunkMaterial);
      trunk.position.set(x, 0.8, z);
      scene.add(trunk);
      const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 + random() * 0.5, 0), leafMaterial);
      canopy.position.set(x, 2.1, z);
      canopy.castShadow = quality.shadows;
      scene.add(canopy);
    }
  }

  let activePreset: FederationCameraPreset = "OVERVIEW";
  let easing: { position: THREE.Vector3; lookAt: THREE.Vector3 } | undefined;
  const currentLookAt = new THREE.Vector3(0, 2, 0);

  const focus = (preset: FederationCameraPreset): void => {
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
      camera.position.lerp(easing.position, 0.12);
      currentLookAt.lerp(easing.lookAt, 0.12);
      camera.lookAt(currentLookAt);
      if (camera.position.distanceTo(easing.position) < 0.05) easing = undefined;
    } else if (motion === "FULL" && activePreset === "OVERVIEW") {
      const drift = Math.sin(elapsedSeconds * 0.09) * 2.2;
      camera.position.x = 30 + drift;
      camera.position.z = 34 - drift * 0.35;
      camera.lookAt(0, 2, 0);
    }
    for (const entry of animated) {
      entry.object.rotation.y = Math.sin(elapsedSeconds * 0.12 + entry.phase) * entry.amplitude;
    }
  };

  const dispose = (): void => {
    disposeObject(scene);
    scene.clear();
  };

  return { scene, camera, update, pickables, focus, dispose };
};
