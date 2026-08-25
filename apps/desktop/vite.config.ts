import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const runtimeEntry = fileURLToPath(
  new URL("../../packages/simulation/dist/desktop-server-cli.js", import.meta.url),
);

type Handshake = { port: number; token: string };

/**
 * Dev mode still runs the real Node runtime + SQLite. It is the same sidecar
 * process Tauri launches, so browser dev and packaged desktop share one path.
 */
const desktopRuntime = (): Plugin => {
  let child: ChildProcessWithoutNullStreams | undefined;
  let handshake: Promise<Handshake> | undefined;

  const start = (): Promise<Handshake> => {
    child = spawn("node", [runtimeEntry], {
      cwd: repoRoot,
      env: { ...process.env, NEPAL_SAVES_DIR: process.env.NEPAL_SAVES_DIR ?? "" },
      stdio: ["ignore", "pipe", "inherit"],
    }) as ChildProcessWithoutNullStreams;

    return new Promise<Handshake>((resolve, reject) => {
      let buffered = "";
      const timer = setTimeout(() => reject(new Error("Runtime handshake timed out.")), 30_000);
      child!.stdout.on("data", (chunk: Buffer) => {
        buffered += chunk.toString("utf8");
        const line = buffered.split("\n").find((candidate) => candidate.trim().startsWith("{"));
        if (!line) return;
        clearTimeout(timer);
        resolve(JSON.parse(line) as Handshake);
      });
      child!.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Runtime exited with code ${code}.`));
      });
    });
  };

  return {
    name: "nepal-desktop-runtime",
    apply: "serve",
    configureServer(server) {
      if (!process.env.NEPAL_SAVES_DIR) {
        server.config.logger.warn(
          "[nepal] NEPAL_SAVES_DIR is unset; the runtime will use the OS application data directory.",
        );
      }
      handshake = start();
      server.httpServer?.once("close", () => child?.kill());

      server.middlewares.use("/runtime", (request, response) => {
        void (async () => {
          try {
            const { port, token } = await handshake!;
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(chunk as Buffer);
            const upstream = await fetch(`http://127.0.0.1:${port}${request.url ?? "/"}`, {
              method: request.method,
              headers: { "content-type": "application/json", "x-runtime-token": token },
              body: chunks.length ? Buffer.concat(chunks) : undefined,
            });
            const body = Buffer.from(await upstream.arrayBuffer());
            response.writeHead(upstream.status, { "content-type": "application/json" });
            response.end(body);
          } catch (error) {
            response.writeHead(503, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                ok: false,
                error: {
                  code: "RUNTIME_UNAVAILABLE",
                  message: "The game runtime is not reachable.",
                  detail: error instanceof Error ? error.message : undefined,
                },
              }),
            );
          }
        })();
      });
    },
    closeBundle() {
      child?.kill();
    },
  };
};

export default defineConfig({
  plugins: [react(), desktopRuntime()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: false,
  },
});
