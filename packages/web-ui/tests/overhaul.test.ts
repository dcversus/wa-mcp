import { describe, expect, test } from "vite-plus/test";
import { initials, notFoundHtml, profilePageHtml } from "../src/pages.ts";
import { contactsPageHtml } from "../src/contacts.ts";

describe("T67 layout pass", () => {
  test("initials derives up-to-two leading characters", () => {
    expect(initials("Test group")).toBe("TG");
    expect(initials("vasilisa")).toBe("V");
    expect(initials("")).toBe("?");
  });
});

describe("T67 empty states + 404", () => {
  test("contacts page renders rows, search and empty-state text", () => {
    const populated = contactsPageHtml({
      contacts: [
        {
          jid: "1@s.whatsapp.net",
          displayName: "V",
          phone: null,
          name: "V",
          pushname: null,
          username: null,
          alias: null,
          source: "whatsapp",
        },
      ],
      total: 1,
      query: "",
      saved: true,
    });
    expect(populated).toContain('id="contacts-list"');
    expect(populated).toContain('data-rename-contact="1@s.whatsapp.net"');
    const empty = contactsPageHtml({ contacts: [], total: 0, query: "", saved: true });
    expect(empty).toContain("No contacts yet. Contacts appear automatically as you chat.");
  });

  test("404 is friendly with a link home", () => {
    const html = notFoundHtml("#/nope");
    expect(html).toContain("#/nope");
    expect(html).toContain('href="#/contacts"');
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
