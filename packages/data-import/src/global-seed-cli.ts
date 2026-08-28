import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { inspectGlobalFootballWorkbook } from "./global-football-workbook.js";

/*
 * Turns the approved research workbook into the canonical seed the game ships.
 *
 * The workbook is an import input, not a runtime dependency: it lives outside
 * the repository and is not available to a fresh checkout. This writes the
 * normalized plan the importer already produces into a version-controlled
 * artifact so a new save can build the global world with no XLSX, no /tmp and
 * no network. Regenerating from the same approved workbook is deterministic.
 *
 *   pnpm --filter @nepal-football-sim/data-import global:seed <xlsx> [out]
 */
const [, , sourcePath, outputPath = "data/global/football-world-v16.seed.json"] = process.argv;

if (!sourcePath) {
  console.error("Usage: global-seed <xlsx> [output.json]");
  process.exitCode = 2;
} else {
  const report = inspectGlobalFootballWorkbook(sourcePath, "DRY_RUN");
  const fatal = report.findings.filter((finding) => finding.severity === "FATAL").length;
  const errors = report.findings.filter((finding) => finding.severity === "ERROR").length;
  if (fatal || errors || !report.plan) {
    console.error(`Refusing to seed: ${fatal} fatal, ${errors} error findings.`);
    process.exitCode = 1;
  } else {
    /* The source path is recorded as the seed itself: nothing at runtime may
     * reach back to the workbook it was generated from. */
    const seed = { ...report.plan, sourcePath: outputPath, generatedFrom: "APPROVED_WORKBOOK" };
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(seed)}\n`);
    const counts = Object.entries(seed)
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => `${key}=${(value as unknown[]).length}`)
      .join(" ");
    process.stdout.write(`Seeded ${outputPath}\nDataset ${seed.datasetVersion}\n${counts}\n`);
  }
}
