import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { MagnusConversationId, MagnusTurnId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  conversationDeletedAudit,
  conversationReadByAdministratorAudit,
  conversationRenamedAudit,
  conversationStartedAudit,
  memberAcknowledgedAudit,
  settingChangedAudit,
  turnCompletedAudit,
  turnFailedAudit,
  turnSubmittedAudit,
  type MagnusWriteContext,
} from "../src/audit.ts";
import { deleteConversation, startConversation } from "../src/conversation.ts";
import { MAGNUS_TURN_MAX_BYTES, MEMBER_TURN_MAX_BYTES } from "../src/limits.ts";
import {
  TURN_REMOVE_GUARD,
  completeTurn,
  removeTurn,
  settleTurnFailure,
  submitTurn,
  turnChangeRefusal,
} from "../src/turn.ts";
import type { TurnRow } from "../src/types.ts";

const CONVERSATION = "magnusConversation_00000000000000000" as MagnusConversationId;
const MAGNUS_TURN = "magnusTurn_000000000000000000000" as MagnusTurnId;
const USER = "user_0000000000000000000000" as UserId;

// Records every prepared statement and its bindings, so a test can assert what would reach the
// database without one.
interface RecordedStatement extends SqlStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
}

function recordingDatabase() {
  const recorded: RecordedStatement[] = [];
  const database = {
    prepare(sql: string) {
      const statement = {
        sql,
        bindings: [] as unknown[],
        bind(...values: unknown[]) {
          const bound = { ...statement, bindings: values } as RecordedStatement;
          recorded.push(bound);
          return bound;
        },
        async run() {
          return { meta: { changes: 0 } };
        },
        async all<T>() {
          return { results: [] as T[] };
        },
        // Nothing is stored, so there is no first row — the SqlStatement contract in full, so this
        // recorder stays substitutable for the real database as the writers under test evolve.
        async first<T>(): Promise<T | null> {
          return null;
        },
      };
      return statement as unknown as SqlStatement;
    },
  };
  return { database, recorded };
}

function context(): MagnusWriteContext {
  return {
    clock: { now: () => "2026-08-06T12:00:00.000Z" },
    actorUserId: USER,
    randomSource: seededRandomSource(7),
  };
}

describe("submitting a turn", () => {
  it("composes the member turn, the pending Magnus turn, an audit row, and one outbox message", () => {
    const { database, recorded } = recordingDatabase();
    const result = submitTurn(database, context(), {
      conversationId: CONVERSATION,
      content: "can I still amend",
      nextSequence: 4,
      disclosureVersion: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effect.statements).toHaveLength(3);
    expect(result.effect.outboxMessages).toHaveLength(1);
    expect(recorded.filter((statement) => statement.sql.includes("magnus_turn"))).toHaveLength(2);
  });

  it("gives the pending Magnus turn the NEXT sequence, so ordering is explicit", () => {
    const { database, recorded } = recordingDatabase();
    submitTurn(database, context(), {
      conversationId: CONVERSATION,
      content: "hello",
      nextSequence: 10,
      disclosureVersion: 1,
    });
    const turnInserts = recorded.filter((statement) =>
      statement.sql.startsWith("INSERT INTO magnus_turn"),
    );
    expect(turnInserts[0]?.bindings[2]).toBe(10);
    expect(turnInserts[1]?.bindings[2]).toBe(11);
    expect(turnInserts[0]?.bindings[3]).toBe("member");
    expect(turnInserts[1]?.bindings[3]).toBe("magnus");
    // The pending Magnus turn carries no content, which is what makes it the thing to wait on.
    expect(turnInserts[1]?.bindings[4]).toBeNull();
  });

  it("refuses an over-cap member turn rather than throwing", () => {
    const { database } = recordingDatabase();
    const result = submitTurn(database, context(), {
      conversationId: CONVERSATION,
      content: "x".repeat(MEMBER_TURN_MAX_BYTES + 1),
      nextSequence: 0,
      disclosureVersion: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failureLabel).toBe("too-large");
  });

  it("puts NO turn content in the outbox payload — identifiers only", () => {
    const { database } = recordingDatabase();
    const secret = "Alvarez pretrial order, Judge Kim";
    const result = submitTurn(database, context(), {
      conversationId: CONVERSATION,
      content: secret,
      nextSequence: 0,
      disclosureVersion: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = JSON.stringify(result.effect.outboxMessages[0]?.payload);
    expect(payload).not.toContain(secret);
    expect(payload).toContain(result.magnusTurnId);
  });
});

describe("settling a turn", () => {
  it("refuses an over-cap answer rather than storing a truncated transcript", () => {
    const { database } = recordingDatabase();
    const result = completeTurn(database, context(), {
      conversationId: CONVERSATION,
      magnusTurnId: MAGNUS_TURN,
      content: "y".repeat(MAGNUS_TURN_MAX_BYTES + 1),
      modelId: "anthropic/claude-opus-5-5",
      snapshotId: "snap",
      inputTokens: 1,
      outputTokens: 1,
      contextTruncated: false,
      effort: null,
    });
    expect(result.ok).toBe(false);
  });

  it("guards the completion on the turn still being pending — the re-bill stop at the database", () => {
    const { database, recorded } = recordingDatabase();
    completeTurn(database, context(), {
      conversationId: CONVERSATION,
      magnusTurnId: MAGNUS_TURN,
      content: "an answer",
      modelId: "anthropic/claude-opus-5-5",
      snapshotId: "snap",
      inputTokens: 3,
      outputTokens: 4,
      contextTruncated: true,
      effort: null,
    });
    const update = recorded.find((statement) => statement.sql.startsWith("UPDATE magnus_turn"));
    expect(update?.sql).toContain("status = 'pending'");
  });

  it("writes a closed label and never an upstream body", () => {
    const { database, recorded } = recordingDatabase();
    settleTurnFailure(database, context(), {
      conversationId: CONVERSATION,
      magnusTurnId: MAGNUS_TURN,
      status: "refused",
      failureLabel: "not-eligible",
      modelId: null,
    });
    const update = recorded.find((statement) => statement.sql.startsWith("UPDATE magnus_turn"));
    expect(update?.bindings[2]).toBe("not-eligible");
  });
});

describe("audit metadata is structurally content-free", () => {
  // Every builder is exercised, and every one of them is put through the same redaction guard the
  // audit write path applies. The stronger guarantee is in the TYPES: none of these builders has a
  // field a turn's content could be passed in, so a caller who wanted to log what somebody typed
  // would have to change a signature here, which is a visible act rather than an oversight.
  it("every builder produces metadata the redaction chokepoint accepts, carrying only identifiers and closed labels", () => {
    const { database, recorded } = recordingDatabase();
    const ctx = context();
    conversationStartedAudit(database, ctx, { conversationId: CONVERSATION, matterId: null });
    turnSubmittedAudit(database, ctx, {
      conversationId: CONVERSATION,
      memberTurnId: MAGNUS_TURN,
      magnusTurnId: MAGNUS_TURN,
      disclosureVersion: 1,
    });
    turnCompletedAudit(database, ctx, {
      conversationId: CONVERSATION,
      magnusTurnId: MAGNUS_TURN,
      modelId: "anthropic/claude-opus-5-5",
      snapshotId: "snap",
      inputTokens: 12,
      outputTokens: 34,
    });
    turnFailedAudit(database, ctx, {
      conversationId: CONVERSATION,
      magnusTurnId: MAGNUS_TURN,
      failureLabel: "model-unavailable",
      modelId: null,
    });
    conversationRenamedAudit(database, ctx, { conversationId: CONVERSATION, cleared: false });
    conversationDeletedAudit(database, ctx, { conversationId: CONVERSATION, turnCount: 4 });
    conversationReadByAdministratorAudit(database, ctx, {
      conversationId: CONVERSATION,
      authorUserId: USER,
    });
    memberAcknowledgedAudit(database, ctx, { userId: USER, disclosureVersion: 1 });
    settingChangedAudit(database, ctx, { settingKey: "magnus.enabled", newValue: "true" });

    // Reaching here at all is the assertion: every builder above committed its metadata through the
    // audit write path, which runs the redaction guard and refuses outright rather than warning.
    const auditRows = recorded.filter((statement) => statement.sql.includes("audit_log"));
    expect(auditRows).toHaveLength(9);
    // And nothing any builder produced is free text: every metadata value is an identifier, a
    // number, a closed label, or null.
    for (const row of auditRows) {
      const serialized = row.bindings[4];
      expect(typeof serialized === "string" || serialized === null).toBe(true);
      const metadata = JSON.parse(typeof serialized === "string" ? serialized : "null") as Record<
        string,
        unknown
      > | null;
      for (const value of Object.values(metadata ?? {})) {
        expect(["string", "number", "object"]).toContain(typeof value);
        if (typeof value === "string") expect(value.includes(" ")).toBe(false);
      }
    }
  });

  it("the guard the builders commit through is live — an unredacted key is refused, not warned about", () => {
    const { database } = recordingDatabase();
    expect(() =>
      domainAuditStatement(database, {
        event: "magnus.turn_submitted",
        subjectId: CONVERSATION,
        actorUserId: USER,
        clock: { now: () => "2026-08-06T12:00:00.000Z" },
        randomSource: seededRandomSource(7),
        metadata: { newPassword: "hunter2" },
      }),
    ).toThrow();
  });
});

describe("starting and deleting a conversation", () => {
  it("mints a magnusConversation handle and audits the start", () => {
    const { database } = recordingDatabase();
    const started = startConversation(database, context(), {
      title: null,
      createdBy: USER,
      matterId: null,
    });
    expect(started.conversationId.startsWith("magnusConversation_")).toBe(true);
    expect(started.effect.statements).toHaveLength(2);
  });

  it("deletes every turn and leaves the conversation a tombstone with no title", () => {
    const { database, recorded } = recordingDatabase();
    deleteConversation(database, context(), { conversationId: CONVERSATION, turnCount: 3 });
    const deletion = recorded.find((statement) =>
      statement.sql.startsWith("DELETE FROM magnus_turn"),
    );
    expect(deletion).toBeDefined();
    const tombstone = recorded.find((statement) =>
      statement.sql.startsWith("UPDATE magnus_conversation SET state = 'deleted'"),
    );
    expect(tombstone?.sql).toContain("title = NULL");
  });
});

describe("changing a member's own message", () => {
  const MEMBER_TURN = "magnusTurn_000000000000000000001" as MagnusTurnId;

  function memberTurn(overrides: Partial<TurnRow> = {}): TurnRow {
    return {
      id: MEMBER_TURN,
      conversationId: CONVERSATION,
      sequence: 1,
      speaker: "member",
      content: "a question",
      status: "complete",
      failureLabel: null,
      modelId: null,
      snapshotId: null,
      inputTokens: null,
      outputTokens: null,
      contextTruncated: false,
      effort: null,
      thinking: null,
      removedAt: null,
      supersededAt: null,
      replacesTurnId: null,
      createdAt: "2026-08-06T00:00:00.000Z",
      completedAt: "2026-08-06T00:00:00.000Z",
      ...overrides,
    };
  }

  it("refuses an answer, a turn already gone, and any change while an answer is pending", () => {
    expect(turnChangeRefusal(memberTurn(), false)).toBeNull();
    expect(turnChangeRefusal(memberTurn({ speaker: "magnus" }), false)).toBe("not-yours");
    expect(turnChangeRefusal(memberTurn({ removedAt: "2026-08-06T01:00:00.000Z" }), false)).toBe(
      "already-gone",
    );
    expect(turnChangeRefusal(memberTurn({ supersededAt: "2026-08-06T01:00:00.000Z" }), false)).toBe(
      "already-gone",
    );
    expect(turnChangeRefusal(memberTurn(), true)).toBe("answer-pending");
  });

  it("an edit sets aside the message and everything after it, then records the new message naming it", () => {
    const { database, recorded } = recordingDatabase();
    const result = submitTurn(database, context(), {
      conversationId: CONVERSATION,
      content: "a better question",
      nextSequence: 5,
      disclosureVersion: 1,
      replaces: { turnId: MEMBER_TURN, sequence: 1 },
    });
    expect(result.ok).toBe(true);
    const supersede = recorded.find((statement) => statement.sql.includes("superseded_at = ?3"));
    expect(supersede?.bindings).toEqual([CONVERSATION, 1, "2026-08-06T12:00:00.000Z"]);
    // Setting aside comes first, so the new pair is never among the rows it sets aside.
    expect(recorded.indexOf(supersede!)).toBe(0);
    const inserts = recorded.filter((statement) =>
      statement.sql.startsWith("INSERT INTO magnus_turn"),
    );
    expect(inserts[0]?.bindings).toContain(MEMBER_TURN);
  });

  it("a removal hides the message alone without touching its words, guarded against one already gone", () => {
    const { database, recorded } = recordingDatabase();
    const effect = removeTurn(database, context(), {
      conversationId: CONVERSATION,
      memberTurnId: MEMBER_TURN,
      magnusTurnId: MAGNUS_TURN,
    });
    const first = effect.statements[0];
    expect(first !== undefined && "guard" in first ? first.guard : null).toBe(TURN_REMOVE_GUARD);
    const update = recorded.find((statement) => statement.sql.startsWith("UPDATE magnus_turn"));
    expect(update?.sql).toContain("SET removed_at = ?2");
    expect(update?.sql).not.toContain("content");
    expect(update?.bindings).toEqual([CONVERSATION, "2026-08-06T12:00:00.000Z", MEMBER_TURN]);
  });
});
