import type { BaileysEventMap } from "baileys";

export type WaEventMap = {
  "connection.update": BaileysEventMap["connection.update"];
  "messages.upsert": BaileysEventMap["messages.upsert"];
  "messaging-history.set": BaileysEventMap["messaging-history.set"];
  "message-receipt.update": BaileysEventMap["message-receipt.update"];
  "presence.update": BaileysEventMap["presence.update"];
  "chats.update": BaileysEventMap["chats.update"];
  "chats.upsert": BaileysEventMap["chats.upsert"];
  "contacts.upsert": BaileysEventMap["contacts.upsert"];
  "groups.update": BaileysEventMap["groups.update"];
  "group-participants.update": BaileysEventMap["group-participants.update"];
  "groups.upsert": BaileysEventMap["groups.upsert"];
  call: BaileysEventMap["call"];
  "creds.update": BaileysEventMap["creds.update"];
};

export type WaEventName = keyof WaEventMap;

export type WaEvent = {
  [K in WaEventName]: { type: K; payload: WaEventMap[K] };
}[WaEventName];

export type WaEventHandler = (event: WaEvent) => void;

export type Unsubscribe = () => void;

export const EVENT_NAMES = [
  "connection.update",
  "messages.upsert",
  "messaging-history.set",
  "message-receipt.update",
  "presence.update",
  "chats.update",
  "chats.upsert",
  "contacts.upsert",
  "groups.update",
  "group-participants.update",
  "groups.upsert",
  "call",
  "creds.update",
] as const satisfies readonly WaEventName[];

export type ConnectionUpdate = WaEventMap["connection.update"];

/** T73 H2: the public SSE surface (/events) whitelists chat/message/presence/
 * metadata events ONLY. Excluded on purpose: "creds.update" (partials carry
 * me/pairingCode/account/signalIdentities/advSecretKey), "messaging-history.set"
 * (bulk history blobs) and "call" (not chat-derived) must never stream. */
export const SAFE_EVENT_NAMES: ReadonlySet<WaEventName> = new Set<WaEventName>([
  "connection.update",
  "messages.upsert",
  "message-receipt.update",
  "presence.update",
  "chats.update",
  "chats.upsert",
  "contacts.upsert",
  "groups.update",
  "groups.upsert",
  "group-participants.update",
]);

export function isSafePublicEvent(event: WaEvent): boolean {
  return SAFE_EVENT_NAMES.has(event.type);
}

export interface EventBus {
  subscribe(handler: WaEventHandler): Unsubscribe;
  unsubscribe(handler: WaEventHandler): void;
  emit(event: WaEvent): void;
  lastConnectionUpdate(): ConnectionUpdate | null;
}

export function createEventBus(): EventBus {
  const handlers = new Set<WaEventHandler>();
  let lastConnection: ConnectionUpdate | null = null;
  return {
    subscribe(handler) {
      handlers.add(handler);
      if (lastConnection !== null) {
        handler({ type: "connection.update", payload: lastConnection });
      }
      return () => {
        handlers.delete(handler);
      };
    },
    unsubscribe(handler) {
      handlers.delete(handler);
    },
    emit(event) {
      if (event.type === "connection.update") {
        lastConnection = event.payload;
      }
      for (const handler of Array.from(handlers)) {
        handler(event);
      }
    },
    lastConnectionUpdate() {
      return lastConnection;
    },
  };
}
