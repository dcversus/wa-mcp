export interface ChatSummaryView {
  jid: string;
  name: string | null;
  unreadCount: number;
}

export function chatListHtml(
  chats: Array<ChatSummaryView & { lastMessage?: { text: string | null } | null }>,
): string {
  const items = chats
    .map((chat) => {
      const badge =
        chat.unreadCount > 0 ? `<span class="unread-badge">${chat.unreadCount}</span>` : "";
      const preview = chat.lastMessage?.text ?? "";
      return `<li data-jid="${chat.jid}"><span class="chat-name">${chat.name ?? chat.jid}</span>${badge}<span class="chat-preview">${preview}</span></li>`;
    })
    .join("");
  return `<ul class="chat-list">${items}</ul>`;
}

export interface MessageView {
  id: string;
  chatJid: string;
  senderName: string | null;
  timestamp: string;
  content: string | null;
  isFromMe: boolean;
  isUnread: boolean;
}

export function messageListHtml(chatJid: string, messages: Array<MessageView>): string {
  const items = messages
    .map(
      (message) =>
        `<li class="message ${message.isFromMe ? "from-me" : "from-them"}" data-id="${message.id}"><span class="sender">${message.senderName ?? ""}</span><span class="text">${message.content ?? ""}</span><time>${message.timestamp}</time></li>`,
    )
    .join("");
  return `<div class="messages" data-chat-jid="${chatJid}"><ul>${items}</ul><form class="send-box" data-chat-jid="${chatJid}"><input name="text" /><button type="submit">Send</button></form></div>`;
}

export interface UnreadEntryView {
  chatJid: string;
  unreadCount: number;
}

export function unreadHtml(entries: Array<UnreadEntryView>): string {
  const items = entries
    .map(
      (entry) =>
        `<li><span>${entry.chatJid}</span><span class="unread-badge">${entry.unreadCount}</span><button data-mark-jid="${entry.chatJid}">Mark read</button></li>`,
    )
    .join("");
  return `<ul class="unread-list">${items}</ul>`;
}

export function settingsHtml(settings: { bridgeUrl: string; token: string }): string {
  return `<form id="settings-form"><label>Bridge URL<input id="bridge-url" value="${settings.bridgeUrl}" /></label><label>Token<input id="token" value="${settings.token}" /></label><button type="submit">Save</button></form>`;
}

export function qrHtml(pngDataUrl: string | null): string {
  const src = pngDataUrl === null ? "" : ` src="${pngDataUrl}"`;
  return `<div id="pairing"><img id="qr-image"${src} /><p id="qr-status">waiting for scan…</p></div>`;
}

export function healthHtml(health: Record<string, unknown>): string {
  return `<dl class="health">${Object.entries(health)
    .map(([key, value]) => `<dt>${key}</dt><dd>${String(value)}</dd>`)
    .join("")}</dl>`;
}
