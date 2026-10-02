import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOOLS } from "../packages/mcp-server/src/tools.ts";

const OUT = join(import.meta.dirname ?? ".", "..", "docs", "reference", "tools.md");

function schemaLines(schema: Record<string, unknown>, indent: string): string[] {
  const lines: string[] = [];
  const required = new Set((schema.required as Array<string> | undefined) ?? []);
  const properties = (schema.properties as Record<string, Record<string, unknown>>) ?? {};
  for (const [name, prop] of Object.entries(properties)) {
    const type = typeof prop.type === "string" ? prop.type : "any";
    const req = required.has(name) ? "required" : "optional";
    const desc = typeof prop.description === "string" ? ` — ${prop.description}` : "";
    lines.push(`${indent}- \`${name}\` (${type}, ${req})${desc}`);
  }
  if (Array.isArray(schema.required) && schema.required.length > 0) {
    lines.push(`${indent}- required: ${schema.required.map((name) => `\`${name}\``).join(", ")}`);
  }
  return lines;
}

const sections = TOOLS.map((tool) => {
  const lines = [
    `### ${tool.name}`,
    "",
    tool.description,
    "",
    "```json",
    JSON.stringify(tool.inputSchema),
    "```",
    "",
  ];
  lines.push(...schemaLines(tool.inputSchema, ""));
  return lines.join("\n");
});

const doc = [
  "# Tool reference",
  "",
  `Generated from the MCP registry (\`scripts/gen-docs.ts\`) — ${TOOLS.length} tools. Regenerate with \`pnpm run docs:gen\`.`,
  "",
  ...sections,
].join("\n");

mkdirSync(join(import.meta.dirname ?? ".", "..", "docs", "reference"), { recursive: true });
writeFileSync(OUT, `${doc}\n`);
console.log(`docs/reference/tools.md written: ${TOOLS.length} tools`);
