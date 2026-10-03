import { describe, expect, test } from "vite-plus/test";
import {
  chatListHtml,
  contactsPageHtml,
  eventsPageHtml,
  groupsPageHtml,
  initials,
  notFoundHtml,
  privacyMatrixHtml,
} from "../src/pages.ts";

describe("T67 layout pass", () => {
  test("chat rows render avatar initials + name + time + preview + badge", () => {
    const html = chatListHtml([
      {
        jid: "120363428874442773@g.us",
        name: "Test group",
        unreadCount: 2,
        lastMessage: { text: "hello", timestamp: "2026-10-03T09:31:00.000Z" },
      },
    ]);
    expect(html).toContain('class="avatar"');
    expect(html).toContain(">TG<");
    expect(html).toContain('class="chat-main"');
    expect(html).toContain('class="unread-badge"');
    expect(html).toContain("09:31");
    expect(html).toContain("hello");
  });

  test("initials derives up-to-two leading characters", () => {
    expect(initials("Test group")).toBe("TG");
    expect(initials("vasilisa")).toBe("V");
    expect(initials("")).toBe("?");
  });

  test("empty chat list renders a human empty state", () => {
    const html = chatListHtml([], {});
    expect(html).toContain("No chats yet");
  });
});

describe("T67 empty states + 404", () => {
  test("contacts page renders rows, search and empty-state text", () => {
    const populated = contactsPageHtml([{ jid: "1@s.whatsapp.net", name: "V" }]);
    expect(populated).toContain('id="contacts-list"');
    expect(populated).toContain('data-alias-jid="1@s.whatsapp.net"');
    const empty = contactsPageHtml([]);
    expect(empty).toContain("No contacts yet — they appear after you chat");
  });

  test("groups page renders subject/description editing + empty state", () => {
    const html = groupsPageHtml([]);
    expect(html).toContain('id="group-create"');
    expect(html).toContain("No groups yet");
    const withGroups = groupsPageHtml([{ jid: "1@g.us", name: "G", unreadCount: 0 }]);
    expect(withGroups).toContain('data-group-jid="1@g.us"');
  });

  test("events page renders a live feed skeleton with pause + clear", () => {
    const html = eventsPageHtml([{ at: 1, type: "connection.update", detail: "connected" }]);
    expect(html).toContain('id="events-page"');
    expect(html).toContain('id="events-feed"');
    expect(html).toContain('id="events-pause"');
    expect(html).toContain('id="events-clear"');
    expect(html).toContain("connected");
  });

  test("404 is friendly with a link home", () => {
    const html = notFoundHtml("#/nope");
    expect(html).toContain("#/nope");
    expect(html).toContain('href="#/chats"');
  });
});

describe("T67 privacy matrix", () => {
  test("renders every GOAL privacy field with its current value", () => {
    const html = privacyMatrixHtml({
      readReceipts: "all",
      lastSeen: "contacts",
      status: "all",
      groups: "all",
      profilePic: "all",
      online: "all",
    });
    for (const key of ["readReceipts", "lastSeen", "status", "groups", "profilePic", "online"]) {
      expect(html).toContain(`name="${key}"`);
    }
    expect(html.match(/value="all"/g)?.length).toBe(6);
  });

  test("privacy matrix escapes unknown values", () => {
    const html = privacyMatrixHtml({ lastSeen: "<script>x</script>" });
    expect(html).not.toContain("<script>x</script>");
  });
});
