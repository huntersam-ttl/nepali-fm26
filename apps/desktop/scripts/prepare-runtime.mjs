import { cpSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { platform } from "node:process";

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

/**
 * On macOS, process.execPath is very often a Homebrew "shared" build of
 * Node — dynamically linked against libnode.<ver>.dylib plus a dozen more
 * Homebrew-provided dylibs (icu4c, openssl, libuv, ...) via @rpath entries
 * that only resolve relative to the original Cellar install layout. Copying
 * just the executable (the previous behaviour here) produces a packaged app
 * whose sidecar aborts at launch with "Library not loaded: @rpath/libnode.*
 * .dylib" — the app UI loads, but every sidecar-backed feature is dead.
 * This walks the real dependency graph (otool -L, recursively, for every
 * non-system dylib) and vendors each one into runtime/lib, rewriting each
 * binary's own load commands (install_name_tool) to reference the vendored
 * copies via @executable_path/@loader_path instead of the original absolute
 * or @rpath location — then ad-hoc re-signs everything, since rewriting
 * load commands invalidates the original signature. System frameworks and
 * anything under /usr/lib or /System are left alone; every macOS install
 * guarantees those.
 */
function isSystemDependency(path) {
  return (
    path.startsWith("/usr/lib/") ||
    path.startsWith("/System/") ||
    path === "/usr/lib/libSystem.B.dylib"
  );
}

/**
 * @rpath/@loader_path/@executable_path entries are resolved relative to
 * wherever the dependent file ORIGINALLY lived (its LC_RPATH commands are
 * unchanged text, copied byte-for-byte) — never relative to where we've
 * since relocated that file into runtime/, which is a different directory
 * and would make every relative dependency fail to resolve.
 */
function resolveDependencyPath(dependency, binaryPathForRpaths, originalDir) {
  if (!/^@(rpath|loader_path|executable_path)\//.test(dependency)) return dependency;
  const suffix = dependency.replace(/^@(rpath|loader_path|executable_path)\//, "");
  const direct = join(originalDir, suffix);
  if (existsSync(direct)) return direct;
  const info = execFileSync("otool", ["-l", binaryPathForRpaths], { encoding: "utf8" });
  const rpaths = [...info.matchAll(/\bpath (.*?) \(offset/g)].map((match) => match[1]);
  for (const rpath of rpaths) {
    const root = rpath.replace("@loader_path", originalDir).replace("@executable_path", originalDir);
    const candidate = join(root, suffix);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function dependenciesOf(binaryPath) {
  const output = execFileSync("otool", ["-L", binaryPath], { encoding: "utf8" });
  const lines = output.split("\n").slice(1);
  const currentName = basename(binaryPath);
  return lines
    .map((line) => line.trim().split(" ")[0])
    .filter((entry) => entry && entry !== binaryPath)
    // A .dylib's own install name (LC_ID_DYLIB) is listed first, alongside
    // its real dependencies (LC_LOAD_DYLIB) — never treat it as one.
    .filter((entry) => basename(entry) !== currentName);
}

function vendorDylibDependencies(executablePath, executableOriginalPath, libDir) {
  const vendored = new Set();
  const queue = [{ target: executablePath, originalDir: dirname(executableOriginalPath) }];
  while (queue.length > 0) {
    const { target, originalDir } = queue.shift();
    for (const dependency of dependenciesOf(target)) {
      if (isSystemDependency(dependency)) continue;
      const sourcePath = resolveDependencyPath(dependency, target, originalDir);
      if (!sourcePath || !existsSync(sourcePath)) {
        console.warn(`prepare-runtime: could not resolve dependency ${dependency} of ${target}; leaving as-is`);
        continue;
      }
      const name = basename(sourcePath);
      const isTopLevelExecutable = target === executablePath;
      const newReference = isTopLevelExecutable ? `@executable_path/lib/${name}` : `@loader_path/${name}`;
      execFileSync("install_name_tool", ["-change", dependency, newReference, target]);
      if (!vendored.has(name)) {
        vendored.add(name);
        const destPath = join(libDir, name);
        cpSync(sourcePath, destPath);
        chmodSync(destPath, 0o755);
        execFileSync("install_name_tool", ["-id", `@loader_path/${name}`, destPath]);
        queue.push({ target: destPath, originalDir: dirname(sourcePath) });
      }
    }
  }
  execFileSync("codesign", ["--force", "--sign", "-", executablePath]);
  for (const name of vendored) {
    execFileSync("codesign", ["--force", "--sign", "-", join(libDir, name)]);
  }
  return vendored;
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
if (platform === "darwin") {
  const libDir = join(runtimeRoot, "lib");
  mkdirSync(libDir, { recursive: true });
  const vendored = vendorDylibDependencies(join(runtimeRoot, "node"), process.execPath, libDir);
  if (vendored.size === 0) rmSync(libDir, { recursive: true, force: true });
}
