import { cpSync, chmodSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopRoot, "../..");
const runtimeRoot = join(desktopRoot, "src-tauri", "runtime");
const deployRoot = join(runtimeRoot, "app");

function flattenSymlinks(directory) {
  let flattened = 0;
  for (const entry of readdirSync(directory)) {
    const entryPath = join(directory, entry);
    const stats = lstatSync(entryPath);
    if (stats.isSymbolicLink()) {
      const target = realpathSync(entryPath);
      rmSync(entryPath, { recursive: true, force: true });
      cpSync(target, entryPath, { recursive: true, dereference: true });
      flattened += 1;
      continue;
    }
    if (stats.isDirectory()) flattened += flattenSymlinks(entryPath);
  }
  return flattened;
}

function prunePackagingMetadata(directory) {
  for (const entry of readdirSync(directory)) {
    const entryPath = join(directory, entry);
    const stats = lstatSync(entryPath);
    if (stats.isDirectory()) {
      prunePackagingMetadata(entryPath);
      continue;
    }
    if (
      entryPath.endsWith(".d.ts") ||
      entryPath.endsWith(".d.cts") ||
      entryPath.endsWith(".d.mts") ||
      entryPath.endsWith(".tsbuildinfo") ||
      entryPath.endsWith(".map") ||
      entryPath.endsWith("/tsconfig.json") ||
      entryPath.endsWith("/node_modules/.pnpm/lock.yaml")
    ) {
      rmSync(entryPath, { force: true });
    }
  }
}

rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(runtimeRoot, { recursive: true });
execFileSync("pnpm", [
  "--filter",
  "@nepal-football-sim/simulation",
  "deploy",
  "--prod",
  "--config.node-linker=hoisted",
  deployRoot,
], {
  cwd: repoRoot,
  stdio: "inherit",
});
while (flattenSymlinks(deployRoot) > 0) {}
rmSync(join(deployRoot, "tsconfig.json"), { force: true });
prunePackagingMetadata(deployRoot);
cpSync(process.execPath, join(runtimeRoot, "node"));
chmodSync(join(runtimeRoot, "node"), 0o755);
