export * from "./jid.ts";
export * from "./subscription-kinds.ts";
export * from "./subscription-config.ts";
export * from "./hooks.ts";
export * from "./platforms.ts";
export * from "./connection-settings.ts";
export * from "./cli-reference.ts";
export * from "./privacy.ts";
export * from "./defaults.ts";
export const name = "@wa-mcp/shared";
import pkg from "../package.json" with { type: "json" };

export const version: string = pkg.version;
