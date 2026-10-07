import { describe, expect, test } from "vite-plus/test";
import {
  chatListHtml,
  contactsPageHtml,
  groupsPageHtml,
  initials,
  notFoundHtml,
  profilePageHtml,
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
    expect(html).toMatch(/<time class="chat-time">[^<]+<\/time>/);
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
    expect(empty).toContain("No contacts yet. They appear once your phone syncs.");
  });

  test("groups page renders subject/description editing + empty state", () => {
    const html = groupsPageHtml([]);
    expect(html).toContain('id="group-create"');
    expect(html).toContain("No groups yet");
    const withGroups = groupsPageHtml([{ jid: "1@g.us", name: "G", unreadCount: 0 }]);
    expect(withGroups).toContain('data-group-jid="1@g.us"');
  });

  test("404 is friendly with a link home", () => {
    const html = notFoundHtml("#/nope");
    expect(html).toContain("#/nope");
    expect(html).toContain('href="#/chats"');
  });
});

describe("T67 privacy — superseded by the native-style profile mirror (T142-W3)", () => {
  test("profilePageHtml renders every known privacy field with its live value selected", () => {
    const html = profilePageHtml({
      blocklist: [],
      me: { pn: null, name: "V", status: null },
      privacy: {
        readreceipts: "all",
        last: "contacts",
        status: "all",
        groupadd: "all",
        profile: "all",
        online: "all",
      },
    });
    for (const key of ["last", "status", "groupadd", "profile", "online", "readreceipts"]) {
      expect(html).toContain(`data-privacy-key="${key}"`);
    }
    const allSelected = (html.match(/<option value="all" selected/g) ?? []).length;
    expect(allSelected).toBe(5);
    const lastSelect = (html.match(/<select data-privacy-key="last">[\s\S]*?<\/select>/) ?? [
      "",
    ])[0];
    expect(lastSelect).toContain('<option value="contacts" selected>My contacts</option>');
    expect(lastSelect).not.toContain('value="contact_blacklist" selected');
  });

  test("a live value outside the vocabulary renders as an escaped extra option", () => {
    const html = profilePageHtml({
      blocklist: [],
      me: { pn: null, name: "V", status: null },
      privacy: { last: "<script>x</script>" },
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("selected");
  });
});
