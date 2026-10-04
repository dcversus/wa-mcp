import type { WaEvent } from "./events.ts";
import { isSafePublicEvent } from "./events.ts";

export interface RuleMatch {
  ruleId: string;
  title: string;
  body: string;
}

export interface McpNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

export function toMcpNotifications(
  event: WaEvent,
  ruleMatches: RuleMatch[] = [],
): McpNotification[] {
  if (!isSafePublicEvent(event)) {
    return [];
  }
  const out: McpNotification[] = [];
  if (event.type === "messages.upsert") {
    out.push({
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: { uri: "wa://unread" },
    });
    out.push({
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: { uri: "wa://chats" },
    });
  }
  if (event.type === "connection.update") {
    const state = (event.payload as { state?: string }).state;
    out.push({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: {
        level: "info",
        logger: "wa-mcp.connection",
        data: { state: state ?? null },
      },
    });
    out.push({
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: { uri: "wa://health" },
    });
  }
  for (const match of ruleMatches) {
    out.push({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: {
        level: "notice",
        logger: "wa-mcp.rules",
        data: { ruleId: match.ruleId, title: match.title, body: match.body },
      },
    });
  }
  return out;
}
