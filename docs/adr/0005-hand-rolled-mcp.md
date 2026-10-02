# 0005 — Hand-rolled MCP server over the SDK

## Status

Accepted

## Context

The MCP surface needs JSON-RPC 2.0: initialize, tools/list, tools/call, ping, notifications, resources. `@modelcontextprotocol/sdk` 1.31.0 pulls express, hono, zod, ajv, jose, cors, eventsource and more.

## Decision

Hand-roll the JSON-RPC 2.0 layer (~200 lines, zero runtime deps): the full contracted method surface, exact error codes (-32700/-32600/-32601/-32602/-32603), notifications answer null, capabilities `{tools, resources}`.

## Consequences

- Every protocol behavior is unit-tested; no SDK version churn.
- Spec compliance is our responsibility — the contracted surface is small (no sampling, no roots, no streaming yet); revisit if the surface grows.
- Tool registry is a plain table: `{ name, description, inputSchema, handler(ctx) }` with `ctx = { bridgeUrl, token, fetchFn }`.
