import { AsyncLocalStorage } from "node:async_hooks";

export const AGENT_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

const sendSource = new AsyncLocalStorage<string>();

export function withSendSource<T>(source: string, fn: () => T): T {
  return sendSource.run(source, fn);
}

export function currentSendSource(): string | undefined {
  return sendSource.getStore();
}
