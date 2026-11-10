import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";
import type { RecordQueryScope } from "../src/record-index-query.ts";
import { RECORD_TEXT_ENTRY_TABLE } from "../src/record-index-schema.ts";
import { selectRecordIndexPointersStatement } from "../src/record-index-statements.ts";

// A migrated per-firm database with two matters in it, and one seeding function per indexed table.
//
// Two matters because nearly everything the index must get right is about what does NOT come back:
// a fixture with one matter passes every scoping test while proving nothing.

export type Raw = ReturnType<typeof createMigratedNodeDatabase>["raw"];

export const MEMBER = "user_recordIndexTester0";
export const MATTER = "matter_recordIndex000000000000000" as MatterId;
export const OTHER_MATTER = "matter_recordIndexOther0000000000" as MatterId;

export const INSTANT = "2026-08-01T09:00:00.000Z";

export function quote(value: string | null): string {
  return value === null ? "NULL" : `'${value.replace(/'/gu, "''")}'`;
}

// The member and the two matters every record below hangs from. Written through plain statements, so
// it works at any point in the lineage that has these two tables.
export function seedMatters(raw: Raw): void {
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) ` +
      `VALUES ('${MEMBER}', 'Index Tester', 'active', '${INSTANT}')`,
  );
  for (const [id, title] of [
    [MATTER, "Herrera v Alvarez"],
    [OTHER_MATTER, "Brown estate"],
  ] as const) {
    raw.exec(
      `INSERT INTO matter (id, title, status, responsible_member_id, opened_at, created_at, updated_at) ` +
        `VALUES ('${id}', '${title}', 'open', '${MEMBER}', '${INSTANT}', '${INSTANT}', '${INSTANT}')`,
    );
  }
}

export function migratedDatabase(): { database: SqlDatabase; raw: Raw } {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  seedMatters(raw);
  return { database, raw };
}

export function seedNote(
  raw: Raw,
  options: { id: string; matterId: string; body: string; occurredOn?: string | null },
): void {
  raw.exec(
    `INSERT INTO matter_note (id, matter_id, author_user_id, body, occurred_on, created_at, updated_at) ` +
      `VALUES ('${options.id}', '${options.matterId}', '${MEMBER}', ${quote(options.body)}, ` +
      `${quote(options.occurredOn ?? null)}, '${INSTANT}', '${INSTANT}')`,
  );
}

export function seedTimeEntry(
  raw: Raw,
  options: { id: string; matterId: string; narrative: string; workDate?: string },
): void {
  raw.exec(
    `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, ` +
      `raw_duration_minutes, narrative, billable, currency, status, source, created_at, updated_at) ` +
      `VALUES ('${options.id}', '${options.matterId}', '${MEMBER}', ` +
      `'${options.workDate ?? "2026-07-01"}', 30, 30, ${quote(options.narrative)}, 1, 'USD', ` +
      `'draft', 'manual', '${INSTANT}', '${INSTANT}')`,
  );
}

export function seedCostEntry(
  raw: Raw,
  options: { id: string; matterId: string; description: string },
): void {
  raw.exec(
    `INSERT INTO cost_entry (id, matter_id, incurred_date, amount_minor, currency, ` +
      `disbursement_class, billable, status, source, description, created_at, updated_at) ` +
      `VALUES ('${options.id}', '${options.matterId}', '2026-07-02', 1500, 'USD', 'hard', 1, ` +
      `'draft', 'manual', ${quote(options.description)}, '${INSTANT}', '${INSTANT}')`,
  );
}

export function seedEvent(
  raw: Raw,
  options: { id: string; matterId: string; title: string; description?: string | null },
): void {
  raw.exec(
    `INSERT INTO matter_event (id, matter_id, title, description, starts_on, time_zone, ` +
      `recorded_at, created_at, updated_at) VALUES ('${options.id}', '${options.matterId}', ` +
      `${quote(options.title)}, ${quote(options.description ?? null)}, '2026-07-03', ` +
      `'America/Chicago', '${INSTANT}', '${INSTANT}', '${INSTANT}')`,
  );
}

export function seedCommunication(
  raw: Raw,
  options: {
    id: string;
    matterId: string | null;
    summary?: string | null;
    body?: string | null;
    callerIdName?: string | null;
  },
): void {
  // Text belongs to a message and a summary to a call; the table refuses a body on a voice row.
  const channel = options.body === undefined || options.body === null ? "voice" : "sms";
  raw.exec(
    `INSERT INTO communication (id, matter_id, channel, direction, counterparty_number, ` +
      `occurred_at, producer, logged_by_user_id, summary, body, caller_id_name, created_at, updated_at) ` +
      `VALUES ('${options.id}', ${quote(options.matterId)}, '${channel}', 'inbound', '+15555550142', ` +
      `'${INSTANT}', 'member', '${MEMBER}', ${quote(options.summary ?? null)}, ${quote(options.body ?? null)}, ` +
      `${quote(options.callerIdName ?? null)}, '${INSTANT}', '${INSTANT}')`,
  );
}

export function seedTask(
  raw: Raw,
  options: { id: string; matterId: string | null; title: string; body?: string | null },
): void {
  raw.exec(
    `INSERT INTO matter_task (id, matter_id, title, body, created_by, created_at, updated_at) ` +
      `VALUES ('${options.id}', ${quote(options.matterId)}, ${quote(options.title)}, ` +
      `${quote(options.body ?? null)}, '${MEMBER}', '${INSTANT}', '${INSTANT}')`,
  );
}

export function seedConversation(
  raw: Raw,
  options: { id: string; matterId: string | null; title?: string | null },
): void {
  raw.exec(
    `INSERT INTO magnus_conversation (id, title, created_by, matter_id, created_at, updated_at) ` +
      `VALUES ('${options.id}', ${quote(options.title ?? null)}, '${MEMBER}', ` +
      `${quote(options.matterId)}, '${INSTANT}', '${INSTANT}')`,
  );
}

export function seedTurn(
  raw: Raw,
  options: {
    id: string;
    conversationId: string;
    sequence: number;
    content: string | null;
    status?: "pending" | "complete" | "failed" | "refused";
  },
): void {
  raw.exec(
    `INSERT INTO magnus_turn (id, conversation_id, sequence, speaker, content, status, created_at) ` +
      `VALUES ('${options.id}', '${options.conversationId}', ${String(options.sequence)}, ` +
      `'member', ${quote(options.content)}, '${options.status ?? "complete"}', '${INSTANT}')`,
  );
}

// The record identifiers a reader's text finds within a scope, in the index's own order.
export async function find(
  database: SqlDatabase,
  text: string,
  scope: RecordQueryScope,
): Promise<string[]> {
  const statement = selectRecordIndexPointersStatement({ database, text, scope, limit: 100 });
  if (statement === null) return [];
  const { results } = await statement.all<{ record_id: string }>();
  return results.map((row) => row.record_id);
}

export interface EntryRow {
  readonly source: string;
  readonly record_id: string;
  readonly container_id: string | null;
  readonly matter_id: string | null;
  readonly sort_key: string;
}

// Every entry the index holds, without the row ids a rebuild is free to reassign.
export function entries(raw: Raw): EntryRow[] {
  return raw
    .prepare(
      `SELECT source, record_id, container_id, matter_id, sort_key FROM ${RECORD_TEXT_ENTRY_TABLE} ` +
        `ORDER BY source, record_id`,
    )
    .all()
    .map((row) => ({ ...row })) as unknown as EntryRow[];
}

// The full-text table's own consistency check, and the count of its rows against the entries: the
// two halves of the index must describe the same set of records.
export function assertIndexConsistent(raw: Raw): void {
  raw.exec(`INSERT INTO record_text_fts (record_text_fts) VALUES ('integrity-check')`);
  const entryCount = raw.prepare(`SELECT COUNT(*) AS n FROM ${RECORD_TEXT_ENTRY_TABLE}`).get() as {
    n: number;
  };
  const orphaned = raw
    .prepare(
      `SELECT COUNT(*) AS n FROM record_text_fts_docsize ` +
        `WHERE id NOT IN (SELECT id FROM ${RECORD_TEXT_ENTRY_TABLE})`,
    )
    .get() as { n: number };
  const missing = raw
    .prepare(
      `SELECT COUNT(*) AS n FROM ${RECORD_TEXT_ENTRY_TABLE} ` +
        `WHERE id NOT IN (SELECT id FROM record_text_fts_docsize)`,
    )
    .get() as { n: number };
  if (orphaned.n !== 0 || missing.n !== 0) {
    throw new Error(
      `the index's two tables disagree over ${String(entryCount.n)} entries: ` +
        `${String(orphaned.n)} full-text row(s) with no entry, ${String(missing.n)} entry row(s) with no words`,
    );
  }
}
