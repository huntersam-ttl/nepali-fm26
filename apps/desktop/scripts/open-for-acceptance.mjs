#!/usr/bin/env node
// Launches the unsigned packaged app for a human to run the 3D Packaged
// Tauri Manual Acceptance checklist against, and prints where everything
// is. Deliberately does nothing beyond that: no UI automation, no
// Accessibility/TCC permission requests, no secrets. See
// docs/game-design/3D_PRESENTATION_AND_ANIMATION.md for the checklist
// itself and why it has to be run by a person rather than this script.

import { existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const repoRoot = path.resolve(desktopRoot, "../..");

const appPath = path.join(
  desktopRoot,
  "src-tauri/target/release/bundle/macos/Nepal Football Simulation.app",
);
const checklistPath = path.join(
  repoRoot,
  "docs/game-design/3D_PRESENTATION_AND_ANIMATION.md",
);

if (!existsSync(appPath)) {
  console.error(`No unsigned build found at:\n  ${appPath}`);
  console.error('Build one first: pnpm --filter @nepal-football-sim/desktop package:unsigned');
  process.exit(1);
}

const builtAt = statSync(appPath).mtime.toISOString();

console.log("3D Packaged Tauri Manual Acceptance");
console.log("====================================");
console.log(`App artifact:  ${appPath}`);
console.log(`Built:         ${builtAt}`);
console.log(`Checklist:     ${checklistPath}`);
console.log("");
console.log("Launching the app now. Run the checklist in that document by hand —");
console.log("this script does not (and should not) drive the app's UI for you.");

execFileSync("open", [appPath]);
