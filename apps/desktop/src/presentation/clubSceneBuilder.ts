import * as THREE from "three";
import type {
  ClubSceneProfile,
  FacilityVisualTier,
  FloodlightTier,
  SceneBuilding,
  StadiumTypology,
} from "./clubScenePresentation.js";
import type { SceneMotion, SceneQualitySettings } from "./scenePreferences.js";

/**
 * Builds the Club Environment from a ClubSceneProfile. Every dimension here
 * traces back to real club state through that profile — stand count from
 * recorded capacity, building height/footprint from real facility quality,
 * scaffolding from a real in-progress project. Nothing is placed at random:
 * jitter uses the profile's stable per-club seed, so the same club renders
 * the identical campus on every launch and across saves.
 *
 * This is the only module that imports three, so it (and three itself) load
 * as a separate chunk the first time a scene is actually shown.
 */

/** Named viewpoints the player can jump the camera to. ADMIN frames the
 * offices block — there is no separate "admin" building kind. */
export type CameraPreset = "OVERVIEW" | "STADIUM" | "TRAINING" | "ACADEMY" | "ADMIN";

export type ClubSceneHandle = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Advances ambient motion. Never called when motion is OFF. */
  update: (elapsedSeconds: number) => void;
  /** Objects the player can click, mapped to the block they represent. */
  pickables: Array<{ object: THREE.Object3D; building: SceneBuilding["kind"] }>;
  /** Moves the camera to a named preset. Instant on Reduced/Off motion;
   * eased over a few frames of `update()` on Full. */
  focus: (preset: CameraPreset) => void;
  dispose: () => void;
};

/** Deterministic 0-1 sequence from the club's stable seed. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
};

/** Footprint and height per facility band. An undeveloped block is a bare
 * plot, not an invisible one — the site should read as "nothing built here". */
const BUILDING_FORM: Record<FacilityVisualTier, { width: number; depth: number; height: number }> = {
  UNDEVELOPED: { width: 4, depth: 3, height: 0.25 },
  BASIC: { width: 4.5, depth: 3.5, height: 1.2 },
  MODEST: { width: 5.5, depth: 4, height: 1.8 },
  PROFESSIONAL: { width: 6.5, depth: 4.5, height: 2.6 },
  ADVANCED: { width: 7.5, depth: 5, height: 3.4 },
  ELITE: { width: 8.5, depth: 5.5, height: 4.2 },
};

const STADIUM_SCALE: Record<ClubSceneProfile["stadium"]["tier"], number> = {
  LOCAL_GROUND: 0.7,
  BASIC_VENUE: 0.85,
  ESTABLISHED: 1,
  MODERN_LARGE: 1.2,
  ELITE: 1.4,
};

/** Fixed plots, so a club's buildings never swap places between launches. */
const BUILDING_PLOT: Record<SceneBuilding["kind"], { x: number; z: number }> = {
  STADIUM: { x: 0, z: 0 },
  TRAINING: { x: -17, z: 6 },
  ACADEMY: { x: 17, z: 6 },
  MEDICAL: { x: -15, z: -9 },
  OFFICES: { x: 15, z: -9 },
};

/** Camera position/look-at for each named preset, framed from each plot's
 * fixed position — deterministic, and independent of any single club's
 * building tiers so the presets never point at empty space. */
const CAMERA_PRESET_VIEW: Record<CameraPreset, { position: [number, number, number]; lookAt: [number, number, number] }> = {
  OVERVIEW: { position: [34, 22, 38], lookAt: [0, 2, 0] },
  STADIUM: { position: [0, 10, 26], lookAt: [0, 2, 0] },
  TRAINING: {
    position: [BUILDING_PLOT.TRAINING.x - 9, 9, BUILDING_PLOT.TRAINING.z + 14],
    lookAt: [BUILDING_PLOT.TRAINING.x, 2, BUILDING_PLOT.TRAINING.z],
  },
  ACADEMY: {
    position: [BUILDING_PLOT.ACADEMY.x + 9, 9, BUILDING_PLOT.ACADEMY.z + 14],
    lookAt: [BUILDING_PLOT.ACADEMY.x, 2, BUILDING_PLOT.ACADEMY.z],
  },
  ADMIN: {
    position: [BUILDING_PLOT.OFFICES.x + 9, 8, BUILDING_PLOT.OFFICES.z - 12],
    lookAt: [BUILDING_PLOT.OFFICES.x, 2, BUILDING_PLOT.OFFICES.z],
  },
};

/**
 * Which of the four fixed stand placements (0=home long side, 1=away long
 * side, 2=right end, 3=left end) a typology actually builds on. Two clubs
 * with the same stand count can take a different, still-deterministic shape.
 */
const STAND_SELECTION: Record<StadiumTypology, number[]> = {
  OPEN_GROUND: [0],
  SINGLE_MAIN_STAND: [0],
  MAIN_AND_TERRACE: [0, 1],
  MAIN_AND_END: [0, 2],
  THREE_SIDED: [0, 1, 2],
  FOUR_STAND_BOWL: [0, 1, 2, 3],
  ENCLOSED_BOWL: [0, 1, 2, 3],
};

/** Pole count/height and lamp-array size per floodlight band — a real
 * provision difference, not just an on/off flag. */
const FLOODLIGHT_FORM: Record<Exclude<FloodlightTier, "NONE">, { poles: number; height: number; lampWidth: number }> = {
  BASIC: { poles: 4, height: 7, lampWidth: 1.2 },
  PROFESSIONAL: { poles: 4, height: 10, lampWidth: 1.8 },
  ELITE: { poles: 4, height: 13, lampWidth: 2.6 },
};

/** A small, coherent material set so steel, concrete, glass and painted
 * render distinctly rather than as flat colour blocks at different
 * brightness. Built once per scene since materials are cheap and disposed
 * with everything else on unmount. */
const buildMaterialLibrary = (accent: THREE.Color) => ({
  concrete: new THREE.MeshStandardMaterial({ color: 0x565f6e, roughness: 0.95, metalness: 0.02 }),
  paintedConcrete: new THREE.MeshStandardMaterial({ color: 0x4d5568, roughness: 0.75, metalness: 0.03 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8a93a6, roughness: 0.45, metalness: 0.75 }),
  darkSteel: new THREE.MeshStandardMaterial({ color: 0x3c4250, roughness: 0.4, metalness: 0.8 }),
  roofMetal: new THREE.MeshStandardMaterial({ color: 0x596274, roughness: 0.35, metalness: 0.55 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x8fb4c9, roughness: 0.12, metalness: 0.35, opacity: 0.82, transparent: true }),
  asphalt: new THREE.MeshStandardMaterial({ color: 0x232629, roughness: 1, metalness: 0 }),
  seating: new THREE.MeshStandardMaterial({ color: accent.getHex(), roughness: 0.6, metalness: 0.05 }),
  fence: new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.5, metalness: 0.4, transparent: true, opacity: 0.7 }),
  buildingRender: new THREE.MeshStandardMaterial({ color: 0x525d70, roughness: 0.7, metalness: 0.05 }),
});

const disposeObject = (root: THREE.Object3D): void => {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
};

export const buildClubScene = (
  profile: ClubSceneProfile,
  quality: SceneQualitySettings,
  motion: SceneMotion,
): ClubSceneHandle => {
  const random = seededRandom(profile.seed);
  const scene = new THREE.Scene();
  const accent = new THREE.Color().setHSL(profile.accentHue / 360, 0.45, 0.55);

  // Prestige warms and lifts the light rather than adding glitter: a bigger
  // club's ground simply presents better lit.
  const skyTop = new THREE.Color().setHSL(0.6, 0.35, 0.1 + profile.prestige * 0.06);
  scene.background = skyTop;
  scene.fog = new THREE.Fog(skyTop, 60, 150);

  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 400);
  camera.position.set(34, 22, 38);
  camera.lookAt(0, 2, 0);

  const ambient = new THREE.AmbientLight(0xbcd0ff, 0.55 + profile.prestige * 0.2);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff2dd, 1.1 + profile.prestige * 0.3);
  key.position.set(28, 40, 18);
  key.castShadow = quality.shadows;
  if (quality.shadows) {
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 140;
    key.shadow.camera.left = -50;
    key.shadow.camera.right = 50;
    key.shadow.camera.top = 50;
    key.shadow.camera.bottom = -50;
  }
  scene.add(key);
  const rim = new THREE.DirectionalLight(accent.getHex(), 0.35);
  rim.position.set(-30, 16, -24);
  scene.add(rim);

  // ---- ground ---------------------------------------------------------
  const groundTone = profile.site === "OPEN_LAND" ? 0x33402f : profile.site === "URBAN" ? 0x2b2f36 : 0x2f3a30;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: groundTone, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = quality.shadows;
  scene.add(ground);

  const pickables: ClubSceneHandle["pickables"] = [];
  const animated: Array<{ object: THREE.Object3D; phase: number; amplitude: number }> = [];
  const materials = buildMaterialLibrary(accent);

  // ---- stadium --------------------------------------------------------
  const stadiumGroup = new THREE.Group();
  const scale = STADIUM_SCALE[profile.stadium.tier];
  const pitchWidth = 16 * scale;
  const pitchDepth = 11 * scale;

  // Subtle mowing-stripe variation, not a texture: alternating slightly
  // darker/lighter grass bands read as a maintained pitch at a glance.
  const stripeCount = 8;
  for (let index = 0; index < stripeCount; index += 1) {
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(pitchWidth / stripeCount, pitchDepth),
      new THREE.MeshStandardMaterial({ color: index % 2 === 0 ? 0x2f6b3d : 0x2a6237, roughness: 0.9 }),
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(-pitchWidth / 2 + (index + 0.5) * (pitchWidth / stripeCount), 0.06, 0);
    stripe.receiveShadow = quality.shadows;
    stadiumGroup.add(stripe);
  }

  const centreCircle = new THREE.Mesh(
    new THREE.RingGeometry(pitchDepth * 0.16, pitchDepth * 0.175, quality.segments),
    new THREE.MeshBasicMaterial({ color: 0xd8e6da, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
  );
  centreCircle.rotation.x = -Math.PI / 2;
  centreCircle.position.y = 0.08;
  stadiumGroup.add(centreCircle);

  // Goal frames — static environment furniture, never a match feature.
  const goalPostMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4, metalness: 0.1 });
  for (const end of [1, -1]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.6), goalPostMaterial);
    bar.position.set(end * (pitchWidth / 2 - 0.05), 0.55, 0);
    stadiumGroup.add(bar);
    for (const side of [1, -1]) {
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), goalPostMaterial);
      upright.position.set(end * (pitchWidth / 2 - 0.05), 0.55, side * 0.76);
      stadiumGroup.add(upright);
    }
  }

  // One stand per real recorded ~8,000 seats, on the sides a ground actually
  // has, but WHICH sides depends on the club's real typology — same tier,
  // different real shape.
  const standHeight = 1.6 + scale * 1.5;
  const standPlacements = [
    { x: 0, z: pitchDepth / 2 + 2.2, w: pitchWidth + 4, d: 3.4 },
    { x: 0, z: -(pitchDepth / 2 + 2.2), w: pitchWidth + 4, d: 3.4 },
    { x: pitchWidth / 2 + 2.2, z: 0, w: 3.4, d: pitchDepth + 4 },
    { x: -(pitchWidth / 2 + 2.2), z: 0, w: 3.4, d: pitchDepth + 4 },
  ];
  const standIndices = STAND_SELECTION[profile.stadium.typology];
  for (const index of standIndices) {
    const placement = standPlacements[index]!;
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(placement.w, standHeight, placement.d),
      index === 0 ? materials.darkSteel : materials.concrete,
    );
    stand.position.set(placement.x, standHeight / 2, placement.z);
    stand.castShadow = quality.shadows;
    stand.receiveShadow = quality.shadows;
    stadiumGroup.add(stand);

    // Seating rake: a stepped silhouette rather than a flat box face, so a
    // stand reads as tiered seating from the campus approach.
    const rows = quality.segments >= 16 ? 5 : 3;
    for (let row = 0; row < rows; row += 1) {
      const rowScale = 1 - row * 0.14;
      const rise = new THREE.Mesh(
        new THREE.BoxGeometry(placement.w * rowScale * 0.9, 0.14, placement.d * rowScale * 0.9),
        materials.seating,
      );
      rise.position.set(placement.x, standHeight * (0.35 + row * 0.13), placement.z);
      stadiumGroup.add(rise);
    }

    // Support columns beneath the stand — a real stand is not a solid block.
    if (quality.segments >= 16) {
      const columnCount = Math.max(2, Math.round(placement.w / 5));
      for (let col = 0; col < columnCount; col += 1) {
        const t = columnCount === 1 ? 0.5 : col / (columnCount - 1);
        const column = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, standHeight * 0.8, 6), materials.concrete);
        const along = (t - 0.5) * placement.w * 0.85;
        column.position.set(
          placement.x + (placement.d > placement.w ? 0 : along),
          standHeight * 0.4,
          placement.z + (placement.d > placement.w ? along : 0),
        );
        stadiumGroup.add(column);
      }
    }

    if (profile.stadium.roofed) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(placement.w * 1.05, 0.25, placement.d * 1.15), materials.roofMetal);
      roof.position.set(placement.x, standHeight + 1.35, placement.z);
      roof.castShadow = quality.shadows;
      stadiumGroup.add(roof);
      // Roof support struts — a roof is held up, not floating.
      for (const side of [1, -1]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.35, 0.1), materials.darkSteel);
        const offset = placement.d > placement.w ? [0, side * placement.d * 0.42] : [side * placement.w * 0.42, 0];
        strut.position.set(placement.x + offset[0]!, standHeight + 0.6, placement.z + offset[1]!);
        stadiumGroup.add(strut);
      }
    }
  }

  // Enclosed-bowl typology: small corner infill panels connect adjacent
  // stands so the ground reads as a closed arena rather than four separate
  // stands with open gaps — an elite/large-capacity-only silhouette.
  if (profile.stadium.typology === "ENCLOSED_BOWL") {
    const cornerCombos: Array<[number, number]> = [
      [pitchWidth / 2 + 1.6, pitchDepth / 2 + 1.6],
      [-(pitchWidth / 2 + 1.6), pitchDepth / 2 + 1.6],
      [pitchWidth / 2 + 1.6, -(pitchDepth / 2 + 1.6)],
      [-(pitchWidth / 2 + 1.6), -(pitchDepth / 2 + 1.6)],
    ];
    for (const [x, z] of cornerCombos) {
      const infill = new THREE.Mesh(new THREE.BoxGeometry(2.6, standHeight * 0.85, 2.6), materials.paintedConcrete);
      infill.position.set(x, (standHeight * 0.85) / 2, z);
      infill.rotation.y = Math.PI / 4;
      stadiumGroup.add(infill);
    }
  }

  // Stadium construction: a real in-progress project shows as scaffolding
  // and temporary fencing on the block actually building, exactly the same
  // honesty rule the campus facility buildings already follow — the stadium
  // itself was previously the one block with no construction state at all.
  if (profile.stadium.underConstruction) {
    for (let index = 0; index < 4; index += 1) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, standHeight + 2, 0.12), materials.steel);
      const angle = (index / 4) * Math.PI * 2;
      post.position.set(Math.cos(angle) * (pitchWidth / 2 + 3), (standHeight + 2) / 2, Math.sin(angle) * (pitchDepth / 2 + 3));
      stadiumGroup.add(post);
    }
    const fence = new THREE.Mesh(
      new THREE.CylinderGeometry(pitchWidth / 2 + 5, pitchWidth / 2 + 5, 1.1, 12, 1, true),
      materials.fence,
    );
    fence.position.y = 0.55;
    stadiumGroup.add(fence);
    if (motion !== "OFF") animated.push({ object: fence, phase: random() * Math.PI * 2, amplitude: 0.02 });
  } else if (profile.stadium.planned) {
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(pitchWidth / 2 + 3, pitchWidth / 2 + 3.4, quality.segments),
      new THREE.MeshBasicMaterial({ color: 0x7ea6ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.09;
    stadiumGroup.add(marker);
  }

  if (profile.stadium.floodlights) {
    const form = FLOODLIGHT_FORM[profile.stadium.floodlightTier as Exclude<FloodlightTier, "NONE">];
    const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
    const corners = [
      [pitchWidth / 2 + 4, pitchDepth / 2 + 4],
      [-(pitchWidth / 2 + 4), pitchDepth / 2 + 4],
      [pitchWidth / 2 + 4, -(pitchDepth / 2 + 4)],
      [-(pitchWidth / 2 + 4), -(pitchDepth / 2 + 4)],
    ];
    for (let i = 0; i < form.poles; i += 1) {
      const [x, z] = corners[i]!;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, form.height, quality.segments / 2), materials.steel);
      mast.position.set(x!, form.height / 2, z!);
      mast.castShadow = quality.shadows;
      stadiumGroup.add(mast);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(form.lampWidth, 0.6, 0.4), lampMaterial);
      lamp.position.set(x!, form.height, z!);
      lamp.lookAt(0, 2, 0);
      stadiumGroup.add(lamp);
    }
  }

  // Club flags at two stadium corners — identity, not a claim of the real
  // crest/kit, which this game does not hold data for.
  if (quality.ambientProps) {
    const flagMaterial = new THREE.MeshStandardMaterial({ color: accent.getHex(), side: THREE.DoubleSide, roughness: 0.8 });
    for (const [x, z] of [
      [pitchWidth / 2 + 4, pitchDepth / 2 + 4],
      [-(pitchWidth / 2 + 4), -(pitchDepth / 2 + 4)],
    ] as const) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 6), materials.darkSteel);
      pole.position.set(x, 1.5, z);
      stadiumGroup.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), flagMaterial);
      flag.position.set(x + (x > 0 ? 0.47 : -0.47), 2.7, z);
      stadiumGroup.add(flag);
      if (motion === "FULL") animated.push({ object: flag, phase: random() * Math.PI * 2, amplitude: 0.18 });
    }
  }

  scene.add(stadiumGroup);
  pickables.push({ object: stadiumGroup, building: "STADIUM" });

  // ---- facility buildings --------------------------------------------
  for (const building of profile.buildings) {
    const plot = BUILDING_PLOT[building.kind];
    const form = BUILDING_FORM[building.tier];
    const group = new THREE.Group();
    group.position.set(plot.x, 0, plot.z);
    // Small, stable per-club variation so two clubs of the same tier are not
    // pixel-identical — seeded, so it is the same every launch.
    group.rotation.y = (random() - 0.5) * 0.25;

    const developed = building.tier !== "UNDEVELOPED";
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(form.width, Math.max(form.height, 0.2), form.depth),
      new THREE.MeshStandardMaterial({
        color: developed ? 0x525d70 : 0x3a4238,
        roughness: developed ? 0.7 : 1,
      }),
    );
    body.position.y = Math.max(form.height, 0.2) / 2;
    body.castShadow = quality.shadows && developed;
    body.receiveShadow = quality.shadows;
    group.add(body);

    if (developed) {
      // A lit frontage band in the club accent — reads as an occupied building.
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(form.width * 0.96, 0.22, form.depth * 0.96),
        new THREE.MeshStandardMaterial({ color: accent.getHex(), emissive: accent.getHex(), emissiveIntensity: 0.25 }),
      );
      band.position.y = form.height * 0.62;
      group.add(band);
    }

    // Training and academy blocks have real practice pitches beside them.
    if ((building.kind === "TRAINING" || building.kind === "ACADEMY") && developed) {
      const pitchCount = building.tier === "ELITE" ? 3 : building.tier === "ADVANCED" ? 2 : 1;
      for (let index = 0; index < pitchCount; index += 1) {
        const practice = new THREE.Mesh(
          new THREE.PlaneGeometry(7, 4.6),
          new THREE.MeshStandardMaterial({ color: 0x2c5f38, roughness: 0.95 }),
        );
        practice.rotation.x = -Math.PI / 2;
        practice.position.set(0, 0.05, form.depth / 2 + 3.4 + index * 5.2);
        practice.receiveShadow = quality.shadows;
        group.add(practice);
      }
    }

    // A real in-progress project shows as scaffolding and a crane; a planned
    // one shows as a marked-out plot. Neither is decorative.
    if (building.underConstruction) {
      const scaffoldMaterial = new THREE.MeshStandardMaterial({ color: 0xd8a54a, roughness: 0.8 });
      for (let index = 0; index < 4; index += 1) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, form.height + 1.4, 0.14), scaffoldMaterial);
        post.position.set(
          (index % 2 === 0 ? 1 : -1) * (form.width / 2 + 0.3),
          (form.height + 1.4) / 2,
          (index < 2 ? 1 : -1) * (form.depth / 2 + 0.3),
        );
        group.add(post);
      }
      const craneMast = new THREE.Mesh(new THREE.BoxGeometry(0.22, form.height + 6, 0.22), scaffoldMaterial);
      craneMast.position.set(form.width / 2 + 1.6, (form.height + 6) / 2, -(form.depth / 2 + 1));
      group.add(craneMast);
      const jib = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.18, 0.18), scaffoldMaterial);
      jib.position.set(form.width / 2 + 1.6, form.height + 6, -(form.depth / 2 + 1));
      group.add(jib);
      if (motion !== "OFF") animated.push({ object: jib, phase: random() * Math.PI * 2, amplitude: 0.25 });
    } else if (building.planned) {
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(form.width * 0.62, form.width * 0.7, quality.segments),
        new THREE.MeshBasicMaterial({ color: 0x7ea6ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.y = 0.09;
      group.add(marker);
    }

    scene.add(group);
    pickables.push({ object: group, building: building.kind });
  }

  // ---- ambient site props (quality-gated, never state-bearing) ---------
  if (quality.ambientProps) {
    const treeCount = profile.site === "OPEN_LAND" ? 26 : profile.site === "URBAN" ? 8 : 16;
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 1 });
    const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x2f5134, roughness: 1 });
    for (let index = 0; index < treeCount; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = 30 + random() * 34;
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

  // ---- geographic identity (quality-gated, never state-bearing) --------
  // A real classification of the club's recorded district (Kathmandu valley,
  // Terai plains, or hill terrain — see siteGeographyForLocation), not an
  // invented location: gives Nepal's campuses a distinct silhouette instead
  // of generic flat terrain, without claiming a precise real site.
  if (quality.ambientProps) {
    if (profile.geography === "HILL") {
      const ridgeMaterial = new THREE.MeshStandardMaterial({ color: 0x33473a, roughness: 1 });
      const ridgeCount = 7;
      for (let index = 0; index < ridgeCount; index += 1) {
        const angle = (index / ridgeCount) * Math.PI * 2 + random() * 0.3;
        const radius = 90 + random() * 30;
        const ridge = new THREE.Mesh(
          new THREE.ConeGeometry(26 + random() * 14, 22 + random() * 16, 4),
          ridgeMaterial,
        );
        ridge.position.set(Math.cos(angle) * radius, 8, Math.sin(angle) * radius);
        ridge.rotation.y = random() * Math.PI;
        scene.add(ridge);
      }
    } else if (profile.geography === "KATHMANDU_VALLEY") {
      const blockMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.85 });
      for (let index = 0; index < 14; index += 1) {
        const angle = random() * Math.PI * 2;
        const radius = 55 + random() * 30;
        const height = 2.5 + random() * 5;
        const block = new THREE.Mesh(new THREE.BoxGeometry(3 + random() * 2, height, 3 + random() * 2), blockMaterial);
        block.position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius);
        scene.add(block);
      }
    }
    // TERAI and UNKNOWN keep the existing flat, open ground with no added
    // silhouette — that is itself the honest presentation of open plains
    // terrain or a district this campus has no real geography evidence for.
  }

  // Camera preset state. `easing` holds a target the update loop lerps
  // toward on Full motion; Reduced/Off jump the camera immediately instead,
  // since a multi-frame tween is exactly the discomfort those settings exist
  // to remove. Overview keeps its gentle drift only while it is the active
  // preset — once the player focuses a building, the camera holds still
  // there rather than drifting away from what they asked to see.
  let activePreset: CameraPreset = "OVERVIEW";
  let easing: { position: THREE.Vector3; lookAt: THREE.Vector3 } | undefined;
  const currentLookAt = new THREE.Vector3(0, 2, 0);

  const focus = (preset: CameraPreset): void => {
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
      // Reduced motion keeps the scene alive but removes the camera drift
      // that causes the most discomfort; only small on-site movement remains.
      const drift = Math.sin(elapsedSeconds * 0.09) * 2.4;
      camera.position.x = 34 + drift;
      camera.position.z = 38 - drift * 0.35;
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
