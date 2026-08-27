import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { inspectGlobalFootballWorkbook, type GlobalImportReport } from "./global-football-workbook.js";

const [, , command, sourcePath, outputDirectory = "artifacts/import"] = process.argv;
if (!sourcePath || !["validate-world-import", "dry-run-world-import", "VALIDATE", "DRY_RUN"].includes(command ?? "")) {
  console.error("Usage: validate-world-import <xlsx> [output-dir] | dry-run-world-import <xlsx> [output-dir]");
  process.exitCode = 2;
} else {
  const mode = command?.startsWith("dry-run") || command === "DRY_RUN" ? "DRY_RUN" : "VALIDATE";
  const report = inspectGlobalFootballWorkbook(sourcePath, mode);
  mkdirSync(outputDirectory, { recursive: true });
  const stem = basename(sourcePath).replace(/\.xlsx$/i, "");
  writeFileSync(join(outputDirectory, `${stem}-${mode.toLocaleLowerCase()}.json`), `${JSON.stringify(report, null, 2)}\n`);
  const counts = report.findings.reduce<Record<string, number>>((all, finding) => ({ ...all, [finding.severity]: (all[finding.severity] ?? 0) + 1 }), {});
  const markdown = humanReport(report, counts);
  writeFileSync(join(outputDirectory, `${stem}-${mode.toLocaleLowerCase()}.md`), markdown);
  process.stdout.write(markdown);
  if (counts.FATAL || counts.ERROR) process.exitCode = 1;
}

function humanReport(report: GlobalImportReport, counts: Record<string, number>): string {
  const stats = Object.entries(report.statistics).map(([key, value]) => `- ${key}: ${value}`).join("\n");
  const findings = report.findings.slice(0, 80).map((finding) => `- ${finding.severity}: ${finding.sheet ?? ""}${finding.row ? ` row ${finding.row}` : ""} ${finding.message}`).join("\n") || "- none";
  return `# Global Football Import ${report.mode}\n\nDataset: ${report.datasetVersion}\nSource: ${report.sourcePath}\n\n## Statistics\n${stats}\n\n## Findings\nFATAL ${counts.FATAL ?? 0} · ERROR ${counts.ERROR ?? 0} · WARNING ${counts.WARNING ?? 0} · INFO ${counts.INFO ?? 0}\n${findings}\n`;
}
