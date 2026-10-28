import { expect, test } from "vite-plus/test";
import { readSubscriptionForm, subscriptionFormHtml } from "../src/subscriptions.ts";

const base = {
  name: "Contacts",
  chats: [] as string[],
  allChats: false,
  like: "",
  mentionOnly: false,
  prompt: "",
  mode: "inbox",
  session: "",
  command: "",
  args: "",
  env: "",
  enabled: true,
};

test("ticking 'Every DM from a saved contact' saves the @contacts selector, alone or with chats", () => {
  const alone = readSubscriptionForm({ ...base, savedContacts: true });
  expect(alone.ok && alone.value.chats).toEqual(["@contacts"]);
  const mixed = readSubscriptionForm({
    ...base,
    savedContacts: true,
    chats: ["120363000000000000@g.us"],
  });
  expect(mixed.ok && mixed.value.chats).toEqual(["@contacts", "120363000000000000@g.us"]);
});

test("editing a @contacts subscription shows the box ticked and no stray chat row", () => {
  const html = subscriptionFormHtml(
    {
      id: "s1",
      name: "Contacts",
      chats: ["@contacts"],
      filter: {},
      delivery: { mode: "inbox" },
      enabled: true,
      created: "2026-10-28T00:00:00Z",
    } as never,
    [],
    [],
  );
  expect(html).toMatch(/name="saved_contacts" checked/);
  expect(html).not.toContain('value="@contacts"');
});
