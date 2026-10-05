export * from "./jid.ts";
export * from "./subscription-kinds.ts";
export const name = "@wa-mcp/shared";
import pkg from "../package.json" with { type: "json" };

export const version: string = pkg.version;
