import {
  createHash,
} from "node:crypto";
import {
  cpSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { platform } from "node:process";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopRoot, "../..");
const runtimeRoot = join(desktopRoot, "src-tauri", "runtime");
const deployRoot = join(runtimeRoot, "app");
// Outside runtimeRoot deliberately — runtimeRoot is wiped at the start of
// every prepare-runtime run, but a downloaded ~50MB Node tarball should
// survive across repeated local/CI runs for the same version+arch.
const nodeCacheRoot = join(desktopRoot, ".node-runtime-cache");
// Pinned to whatever Node this script itself is running under by default,
// so a fresh checkout stays reproducible against the toolchain it was last
// verified with; override with NEPAL_RUNTIME_NODE_VERSION to bump deliberately.
const PINNED_NODE_VERSION = process.env.NEPAL_RUNTIME_NODE_VERSION ?? process.versions.node;

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
installNodeRuntime();

/**
 * ARCHITECTURE PORTABILITY (release-hardening fix)
 * -------------------------------------------------
 * The sidecar's own JS code has zero native (.node) addons — the database
 * layer is Node's built-in `node:sqlite` — so the ONLY architecture-specific
 * artifact the sidecar needs is the `node` executable itself. This script
 * used to always copy `process.execPath` (the HOST's installed Node) and
 * vendor its dynamic library dependencies (vendorDylibDependencies, above,
 * kept as a same-arch/offline fallback below). That only works when
 * building for the host's own architecture: a Homebrew "shared" Node build
 * is single-arch, so cross-compiling a universal macOS app on hardware that
 * only has one arch's Homebrew Node installed silently produced a runtime
 * whose Node binary/dylibs did NOT match the Rust target's architecture
 * (e.g. an arm64 app bundle shipped with x86_64 runtime dylibs) — a defect
 * this repo's Mach-O architecture check (scripts/build-macos-release.sh)
 * now catches instead of silently packaging.
 *
 * The fix: fetch the OFFICIAL prebuilt Node.js binary for the exact target
 * architecture from nodejs.org, pinned to a known version and checksum-
 * verified against the official SHASUMS256.txt. Official darwin builds link
 * only against system frameworks/dylibs (verified via `otool -L`) — no
 * dylib vendoring is needed for them at all, which is what makes fetching a
 * matching-arch binary sufficient regardless of what is installed locally.
 *
 * Target architecture comes from NEPAL_RUNTIME_ARCH ("x64" or "arm64"),
 * which build-macos-release.sh sets per Rust target it builds for; a local
 * `pnpm build` run outside that script falls back to the host's own arch.
 */
function resolveTargetArch() {
  const requested = process.env.NEPAL_RUNTIME_ARCH;
  if (requested === "x64" || requested === "arm64") return requested;
  if (requested) {
    throw new Error(
      `prepare-runtime: unrecognised NEPAL_RUNTIME_ARCH "${requested}" (expected "x64" or "arm64")`,
    );
  }
  return process.arch === "arm64" ? "arm64" : "x64";
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function fetchToFile(url, destPath) {
  execFileSync("curl", ["-fsSL", "--max-time", "120", "-o", destPath, url], { stdio: "inherit" });
}

/**
 * Downloads (or reuses a cached, checksum-verified) official Node.js darwin
 * binary for `arch` ("x64" | "arm64") and returns the path to its
 * extracted `bin/node`. Throws on checksum mismatch or download failure —
 * this never silently substitutes a wrong-architecture binary.
 */
function officialNodeBinary(arch) {
  const version = PINNED_NODE_VERSION;
  const distName = `node-v${version}-darwin-${arch}`;
  const tarballName = `${distName}.tar.gz`;
  mkdirSync(nodeCacheRoot, { recursive: true });
  const tarballPath = join(nodeCacheRoot, tarballName);
  const extractDir = join(nodeCacheRoot, distName);
  const nodeBinPath = join(extractDir, "bin", "node");
  const checksumMarker = join(nodeCacheRoot, `${tarballName}.sha256-ok`);

  if (existsSync(nodeBinPath) && existsSync(checksumMarker)) {
    return nodeBinPath;
  }

  console.log(`prepare-runtime: fetching official Node ${version} (darwin-${arch}) from nodejs.org...`);
  const shasumsPath = join(nodeCacheRoot, `SHASUMS256-${version}.txt`);
  fetchToFile(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`, shasumsPath);
  fetchToFile(`https://nodejs.org/dist/v${version}/${tarballName}`, tarballPath);

  const shasums = readFileSync(shasumsPath, "utf8");
  const expectedLine = shasums.split("\n").find((line) => line.trim().endsWith(tarballName));
  if (!expectedLine) {
    throw new Error(`prepare-runtime: SHASUMS256.txt for Node ${version} has no entry for ${tarballName}`);
  }
  const expectedSha256 = expectedLine.trim().split(/\s+/)[0];
  const actualSha256 = sha256(tarballPath);
  if (expectedSha256 !== actualSha256) {
    rmSync(tarballPath, { force: true });
    throw new Error(
      `prepare-runtime: checksum mismatch for ${tarballName} (expected ${expectedSha256}, got ${actualSha256}) — refusing to use it`,
    );
  }

  rmSync(extractDir, { recursive: true, force: true });
  execFileSync("tar", ["-xzf", tarballPath, "-C", nodeCacheRoot, `${distName}/bin/node`]);
  writeFileSync(checksumMarker, actualSha256);
  return nodeBinPath;
}

/**
 * Fails loudly (rather than silently shipping the wrong architecture) if a
 * Mach-O file's actual architecture doesn't match what the target requires.
 */
function assertArch(filePath, arch) {
  const expected = arch === "arm64" ? "arm64" : "x86_64";
  const info = execFileSync("file", [filePath], { encoding: "utf8" });
  if (!info.includes(expected)) {
    throw new Error(`prepare-runtime: ${filePath} is not ${expected} (file: ${info.trim()})`);
  }
}

function installNodeRuntime() {
  const targetArch = resolveTargetArch();
  const nodeDestPath = join(runtimeRoot, "node");
  try {
    const officialBinary = officialNodeBinary(targetArch);
    cpSync(officialBinary, nodeDestPath);
    chmodSync(nodeDestPath, 0o755);
    assertArch(nodeDestPath, targetArch);
    console.log(
      `prepare-runtime: installed official Node ${PINNED_NODE_VERSION} (${targetArch}); no runtime/lib vendoring needed`,
    );
    return;
  } catch (error) {
    const hostArch = process.arch === "arm64" ? "arm64" : "x64";
    if (targetArch !== hostArch) {
      // Cannot safely substitute a different architecture's Node binary —
      // that is exactly the bug this fix exists to prevent.
      throw new Error(
        `prepare-runtime: could not obtain an official Node ${PINNED_NODE_VERSION} (${targetArch}) binary (${error.message}). ` +
          `Refusing to fall back to the host's ${hostArch} Node for a ${targetArch} target.`,
      );
    }
    console.warn(
      `prepare-runtime: official Node download unavailable (${error.message}); falling back to vendoring the host's own installed Node (only valid because the requested target matches the host architecture).`,
    );
    cpSync(process.execPath, nodeDestPath);
    chmodSync(nodeDestPath, 0o755);
    if (platform === "darwin") {
      const libDir = join(runtimeRoot, "lib");
      mkdirSync(libDir, { recursive: true });
      const vendored = vendorDylibDependencies(nodeDestPath, process.execPath, libDir);
      if (vendored.size === 0) rmSync(libDir, { recursive: true, force: true });
    }
    assertArch(nodeDestPath, targetArch);
  }
}
