import { beforeAll, describe, expect, it } from "vitest";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import {
  selectNotificationFeedStatement,
  selectUnreadNotificationCountStatement,
  type NotificationFeedRawRow,
} from "../src/read-statements.ts";

/*
 * SEARCHING A FEED WHOSE WORDS ARE NOT IN THE RECORD.
 *
 * A notification row carries identifiers, closed labels, counts and dates and no sentence — the
 * words a member reads are composed client-side from the kind and the declared facts. So the search
 * here takes an unusual shape: the client resolves the query into the KINDS and CATEGORIES whose
 * words match and sends those with the raw term, which this side matches against the matter number.
 *
 * These run against a real migrated database rather than inspecting SQL, because the properties
 * worth pinning are about which ROWS come back — particularly the two that would be invisible in a
 * statement assertion: that the arms are OR-ed rather than AND-ed, and that a search can never
 * widen the read past the member it is scoped to.
 */

const READER = "user_searchreader000";
const OTHER = "user_searchother0000";
const MATTER_A = "matter_search000001";
const MATTER_B = "matter_search000002";
const AT = "2026-01-01T00:00:00.000Z";

let handle: ReturnType<typeof createMigratedNodeDatabase>;

/** One event with one recipient row for each named member. */
async function seedNotification(
  database: ReturnType<typeof createMigratedNodeDatabase>["database"],
  random: ReturnType<typeof seededRandomSource>,
  row: {
    readonly kind: string;
    readonly category: string;
    readonly matterId: string | null;
    readonly at: string;
    readonly recipients: readonly string[];
  },
): Promise<void> {
  const eventId = newIdentifier("notificationEvent", random);
  await database
    .prepare(
      "INSERT INTO notification_event (id, kind, category, severity, subject_kind, subject_id, matter_id, occurred_at, facts, dedupe_key, created_at) VALUES (?1, ?2, ?3, 'informational', 'matter', ?4, ?5, ?6, NULL, ?7, ?6)",
    )
    .bind(
      eventId,
      row.kind,
      row.category,
      row.matterId ?? "matter_none00000000",
      row.matterId,
      row.at,
      `${row.kind}:${eventId}`,
    )
    .run();
  for (const recipient of row.recipients) {
    await database
      .prepare(
        "INSERT INTO notification_recipient (id, notification_event_id, recipient_user_id, state, read_at, dismissed_at, created_at) VALUES (?1, ?2, ?3, 'unread', NULL, NULL, ?4)",
      )
      .bind(newIdentifier("notificationRecipient", random), eventId, recipient, row.at)
      .run();
  }
}

beforeAll(async () => {
  handle = createMigratedNodeDatabase("per-firm");
  const database = handle.database;
  const random = seededRandomSource(29);

  for (const member of [READER, OTHER]) {
    await database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, 'Member', 'active', 0, ?2)",
      )
      .bind(member, AT)
      .run();
  }
  // Two matters with numbers a person would actually quote back.
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, matter_number, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'Vance', 'open', '2026-0042', ?2, 0, ?3, ?3)",
    )
    .bind(MATTER_A, READER, AT)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, matter_number, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'Ashford', 'open', '2026-0099', ?2, 0, ?3, ?3)",
    )
    .bind(MATTER_B, READER, AT)
    .run();

  await seedNotification(database, random, {
    kind: "deadlines.deadline.overdue",
    category: "deadlines",
    matterId: MATTER_A,
    at: "2026-01-01T01:00:00.000Z",
    recipients: [READER],
  });
  await seedNotification(database, random, {
    kind: "billing.invoice.finalized",
    category: "billing",
    matterId: MATTER_B,
    at: "2026-01-01T02:00:00.000Z",
    recipients: [READER],
  });
  // Another member's only. A search that dropped the member scope would surface this.
  await seedNotification(database, random, {
    kind: "deadlines.deadline.overdue",
    category: "deadlines",
    matterId: MATTER_A,
    at: "2026-01-01T03:00:00.000Z",
    recipients: [OTHER],
  });
});

function feed(scope: Parameters<typeof selectNotificationFeedStatement>[1]) {
  return selectNotificationFeedStatement(handle.database, scope, {
    cursor: undefined,
    pageSize: 50,
  }).all<NotificationFeedRawRow>();
}

const READER_SCOPE = { recipientUserId: READER, visibility: visibleMatterPredicate() };

describe("the feed's search", () => {
  it("narrows to the kinds the client resolved the query to", async () => {
    const { results } = await feed({ ...READER_SCOPE, kinds: ["deadlines.deadline.overdue"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("deadlines.deadline.overdue");
  });

  it("narrows to a category, which is how an unrecognised kind stays findable", async () => {
    // A kind this client has no words for renders as the category's noun, so searching that noun
    // has to reach it even though no kind matched.
    const { results } = await feed({ ...READER_SCOPE, searchCategories: ["billing"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.category).toBe("billing");
  });

  it("matches the matter number, the one member-facing text the row carries", async () => {
    const { results } = await feed({ ...READER_SCOPE, search: "2026-0099" });
    expect(results).toHaveLength(1);
    expect(results[0]?.matter_number).toBe("2026-0099");
  });

  it("OR-s the three arms rather than requiring all of them", async () => {
    // The whole point: a query that matched a kind AND a different matter's number returns both.
    // AND-ed, this would return nothing, and nothing is what a member would be told.
    const { results } = await feed({
      ...READER_SCOPE,
      kinds: ["deadlines.deadline.overdue"],
      search: "2026-0099",
    });
    expect(results).toHaveLength(2);
  });

  it("reads an empty kind list as 'the query matched no kind', not 'match no row'", async () => {
    // The distinction that decides whether a search for a matter number works at all: the client
    // sends kinds: [] whenever the term matched none of its words.
    const { results } = await feed({ ...READER_SCOPE, kinds: [], search: "2026-0042" });
    expect(results).toHaveLength(1);
  });

  it("narrows nothing when no arm is supplied", async () => {
    const { results } = await feed(READER_SCOPE);
    expect(results).toHaveLength(2);
  });

  it("can never widen the read past the member it is scoped to", async () => {
    // The other member holds a row of exactly this kind. A search is a narrowing, never a way out
    // of the scope the read was asked in.
    const { results } = await feed({ ...READER_SCOPE, kinds: ["deadlines.deadline.overdue"] });
    expect(results).toHaveLength(1);
    expect(results.every((row) => row.matter_id === MATTER_A)).toBe(true);
  });

  it("escapes a reader's wildcards rather than obeying them", async () => {
    // "%" unescaped would match every numbered matter; escaped it matches the literal character,
    // which no matter number here contains.
    const { results } = await feed({ ...READER_SCOPE, search: "%" });
    expect(results).toHaveLength(0);
  });

  it("leaves the unread badge alone", async () => {
    // The badge counts what is waiting for a member, which is a fact about their work rather than
    // about the box they last typed in.
    const row = await selectUnreadNotificationCountStatement(handle.database, READER_SCOPE).first<{
      unread_count: number;
    }>();
    expect(row?.unread_count).toBe(2);
  });
});
