import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Permanent guard on the project's hardest presentation rule: THE MATCH IS
 * NEVER RENDERED, in 2D or 3D. Matches are Quick Sim, Key Events and Text Live
 * on the canonical match engine, and nothing else.
 *
 * A grep proves that today. This proves it on every run, which is the point —
 * the rule is permanent, so its enforcement has to be too.
 */

const sourceRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

const sourceFiles = (directory: string): string[] => {
  const results: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      results.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
};

const allSources = sourceFiles(sourceRoot);
const read = (file: string): string => readFileSync(file, "utf8");
const relative = (file: string): string => path.relative(sourceRoot, file);

describe("no match rendering, ever", () => {
  it("keeps three.js out of every match screen", () => {
    const matchScreens = allSources.filter((file) => /matchday|[Mm]atch[A-Z]/.test(relative(file)));
    expect(matchScreens.length).toBeGreaterThan(0);
    const offenders = matchScreens.filter((file) => /\bthree\b|WebGLRenderer|SceneCanvas/.test(read(file)));
    expect(offenders.map(relative)).toEqual([]);
  });

  it("keeps a drawing canvas out of every match screen", () => {
    const matchScreens = allSources.filter((file) => /matchday|[Mm]atch[A-Z]/.test(relative(file)));
    const offenders = matchScreens.filter((file) =>
      /<canvas|createElement\("canvas"\)|getContext\(/.test(read(file)),
    );
    expect(offenders.map(relative)).toEqual([]);
  });

  it("imports three in exactly one module, so a new 3D surface cannot appear unnoticed", () => {
    const importers = allSources.filter((file) => /^import .* from "three"|import\("three"\)/m.test(read(file)));
    expect(importers.map(relative).sort()).toEqual([
      path.join("presentation", "SceneCanvas.tsx"),
      path.join("presentation", "clubSceneBuilder.ts"),
    ]);
  });

  it("mounts 3D scenes only where a scene is genuinely intended", () => {
    const mounts = allSources
      .filter((file) => !relative(file).startsWith("presentation"))
      .filter((file) => /<(SceneCanvas|ClubEnvironmentScene)\b/.test(read(file)));
    // Club Profile only. Adding a scene elsewhere is a deliberate act and
    // should update this list along with the design doc.
    expect(mounts.map(relative)).toEqual([path.join("manager", "RoleDetailScreen.tsx")]);
  });
});
