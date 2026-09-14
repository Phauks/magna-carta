import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { listConversations, searchesContent } from "../src/statements.ts";

/*
 * WHAT THE RAIL'S SEARCH REACHES, AND WHOSE.
 *
 * The rule under test is a confidentiality boundary, not a detail of SQL. This package's CLAUDE.md
 * holds that transcripts are discoverable material and that no surface may sweep them across the
 * firm's records until the discovery surface owns an explicit include-or-exclude control for it.
 * One member searching their OWN conversations is not that act; the administrative read across
 * every member's is adjacent enough to it that the two must not be one code path nobody re-reads.
 *
 * So: content is in scope exactly when the read is scoped to a member, and the statement is
 * asserted rather than the helper alone — a helper that answered correctly while the SQL did
 * something else would be the failure this is written against.
 */

const USER = "user_0000000000000000000000" as UserId;
const MATTER = "matter_000000000000000000000" as MatterId;

interface Recorded {
  readonly sql: string;
  readonly bindings: readonly unknown[];
}

function recordingDatabase(): { database: SqlDatabase; recorded: Recorded[] } {
  const recorded: Recorded[] = [];
  const database = {
    prepare(sql: string) {
      const statement = {
        sql,
        bind(...values: unknown[]) {
          recorded.push({ sql, bindings: values });
          return statement;
        },
        async run() {
          return { meta: { changes: 0 } };
        },
        async all<T>() {
          return { results: [] as T[] };
        },
        async first<T>(): Promise<T | null> {
          return null;
        },
      };
      return statement as unknown as SqlStatement;
    },
  };
  return { database: database as unknown as SqlDatabase, recorded };
}

async function listed(options: Parameters<typeof listConversations>[1]): Promise<Recorded> {
  const { database, recorded } = recordingDatabase();
  await listConversations(database, options);
  const statement = recorded[0];
  if (statement === undefined) throw new Error("no statement was prepared");
  return statement;
}

describe("searchesContent", () => {
  it("is true only for a member's own conversations with a real term", () => {
    expect(searchesContent({ createdBy: USER, search: "lease" })).toBe(true);
    // The administrative read: titles alone.
    expect(searchesContent({ search: "lease" })).toBe(false);
    // Not a search at all.
    expect(searchesContent({ createdBy: USER })).toBe(false);
    expect(searchesContent({ createdBy: USER, search: "" })).toBe(false);
  });
});

describe("listConversations, searching", () => {
  it("reaches the transcript on a member's own conversations", async () => {
    const statement = await listed({ createdBy: USER, search: "Henderson lease" });
    expect(statement.sql).toContain("magnus_turn");
    expect(statement.sql).toContain("content LIKE ?");
    expect(statement.sql).toContain("title LIKE ?");
    // The term reaches both halves, escaped and wrapped once each.
    expect(statement.bindings).toContain("%Henderson lease%");
    expect(statement.bindings.filter((binding) => binding === "%Henderson lease%")).toHaveLength(2);
  });

  it("reaches ONLY titles on the administrative read across every member", async () => {
    const statement = await listed({ search: "Henderson lease" });
    expect(statement.sql).toContain("title LIKE ?");
    // The boundary. A firm-wide read must not scan what anybody said.
    expect(statement.sql).not.toContain("magnus_turn");
    expect(statement.sql).not.toContain("content LIKE");
  });

  it("escapes a reader's wildcards rather than obeying them", async () => {
    const statement = await listed({ createdBy: USER, search: "50%_split" });
    expect(statement.bindings).toContain("%50\\%\\_split%");
    expect(statement.sql).toContain("ESCAPE");
  });

  it("treats a blank term as no search at all", async () => {
    const statement = await listed({ createdBy: USER, search: "   " });
    expect(statement.sql).not.toContain("LIKE");
  });

  it("keeps the matter filter and the search as separate narrowings", async () => {
    const statement = await listed({ createdBy: USER, matterId: MATTER, search: "lease" });
    expect(statement.sql).toContain("matter_id = ?");
    expect(statement.bindings).toContain(MATTER);
    expect(statement.bindings).toContain("%lease%");
  });

  it("never lets a search widen the scope it was asked in", async () => {
    // The member predicate survives beside the search: a query is a narrowing, never a way out of
    // the read's own scope.
    const statement = await listed({ createdBy: USER, search: "lease" });
    expect(statement.sql).toContain("created_by = ?");
    expect(statement.bindings).toContain(USER);
    expect(statement.sql).toContain("state <> 'deleted'");
  });
});
