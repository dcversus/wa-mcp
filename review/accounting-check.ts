import { readFileSync } from "node:fs";
import { join } from "node:path";

const DISPOSITIONS = new Set(["ABSORBED", "SUPERSEDED-BY", "NA-ENGINE", "ALREADY-CORE", "OUT-OF-SCOPE-0.9", "NOISE"]);
const EXPECTED_ROWS = 1029;

function fail(message: string): never {
  console.error(`accounting-check FAILED: ${message}`);
  process.exit(1);
}

const accounting = readFileSync(join(process.cwd(), "review", "ACCOUNTING.md"), "utf8");
const rows = accounting.split("\n").filter((line) => line.startsWith("| ") && !line.includes("---") && !line.includes("disposition |") && !line.startsWith("| disposition"));
const dataRows = rows.filter((line) => {
  const cells = line.split("|").map((cell) => cell.trim());
  return cells[3] === "issue" || cells[3] === "pr";
});

if (dataRows.length !== EXPECTED_ROWS) {
  fail(`expected ${EXPECTED_ROWS} rows, found ${dataRows.length}`);
}

const counts = new Map<string, number>();
for (const row of dataRows) {
  const cells = row.split("|").map((cell) => cell.trim()).filter((cell, index, all) => !(index === 0 && cell === "") && !(index === all.length - 1 && cell === ""));
  if (cells.length !== 7) {
    fail(`row has ${cells.length} cells (expected 7): ${row.slice(0, 80)}`);
  }
  const disposition = cells[5] ?? "";
  if (!DISPOSITIONS.has(disposition)) {
    fail(`invalid disposition '${disposition}' in: ${row.slice(0, 80)}`);
  }
  counts.set(disposition, (counts.get(disposition) ?? 0) + 1);
}

const totalRow = accounting.split("\n").find((line) => line.startsWith("| **total**"));
if (totalRow === undefined) {
  fail("missing total row");
}
const totalCell = Number(totalRow?.split("|")[2]?.trim().replace(/\*/g, "") ?? "0");
if (totalCell !== EXPECTED_ROWS) {
  fail(`total row says ${totalCell}`);
}

console.log(`accounting-check OK: ${dataRows.length} rows`);
for (const [disposition, count] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`  ${disposition}: ${count}`);
}
