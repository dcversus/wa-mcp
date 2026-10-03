import type { Store } from "./schema.ts";

export interface TemplateRow {
  name: string;
  body: string;
}

export function upsertTemplate(store: Store, template: TemplateRow): void {
  // the v1 templates table carries created_at NOT NULL
  store.db
    .prepare(
      "INSERT INTO templates (name, body, created_at) VALUES (?, ?, ?)\n      ON CONFLICT(name) DO UPDATE SET body = excluded.body",
    )
    .run(template.name, template.body, new Date().toISOString());
}

export function listTemplates(store: Store): TemplateRow[] {
  return store.db.prepare("SELECT name, body FROM templates ORDER BY name").all() as TemplateRow[];
}

export function getTemplate(store: Store, name: string): TemplateRow | undefined {
  return store.db.prepare("SELECT name, body FROM templates WHERE name = ?").get(name) as
    | TemplateRow
    | undefined;
}

/** T82 line89: substitute {{var}} placeholders. Unknown variables are
 * reported (left in place) so the caller can return a VALIDATION_ERROR. */
export function renderTemplate(
  body: string,
  vars: Record<string, string>,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = body.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name];
    if (typeof value !== "string") {
      missing.push(name);
      return `{{${name}}}`;
    }
    return value;
  });
  return { text, missing };
}
