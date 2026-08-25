import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { startDesktopServer } from "./desktop-server.js";

/**
 * Sidecar entrypoint. Tauri (and Vite dev) spawn this and read the JSON
 * handshake line from stdout to learn the port and token.
 */
const savesDirectory = process.env.NEPAL_SAVES_DIR ?? defaultSavesDirectory();
const worldDatasetPath = resolve(
  process.env.NEPAL_WORLD_DATASET ?? "data/nepal/2026-08/club-registry.json",
);

const handle = await startDesktopServer({
  savesDirectory,
  worldDatasetPath,
  port: Number(process.env.NEPAL_RUNTIME_PORT ?? 0),
  token: process.env.NEPAL_RUNTIME_TOKEN,
});

process.stdout.write(
  `${JSON.stringify({
    runtime: "nepal-football-desktop",
    port: handle.port,
    token: handle.token,
    savesDirectory,
    worldDatasetPath,
  })}\n`,
);

const shutdown = (): void => {
  void handle.close().then(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function defaultSavesDirectory(): string {
  const home = homedir();
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "NepalFootballSim", "saves");
  }
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA ?? join(home, "AppData", "Roaming"),
      "NepalFootballSim",
      "saves",
    );
  }
  return join(
    process.env.XDG_DATA_HOME ?? join(home, ".local", "share"),
    "nepal-football-sim",
    "saves",
  );
}
