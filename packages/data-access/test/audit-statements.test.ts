import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { insertAuditLogStatement } from "../src/audit-statements.ts";
import { captured, stubD1 } from "./support/stub-d1.ts";

describe("insertAuditLogStatement", () => {
  it("binds id, event, actor, subject, canonical metadata JSON, and the instant", () => {
    const stub = stubD1();
    const id = newIdentifier("auditLog");
    const actorUserId = newIdentifier("user");
    const subjectId = newIdentifier("matter");
    const statement = captured(
      insertAuditLogStatement(stub.database, {
        id,
        event: "matter.opened",
        actorUserId,
        subjectId,
        metadata: { matterNumber: "RENO-26-0001", previousStatus: "prospective" },
        now: "2026-06-13T00:00:00.000Z",
      }),
    );
    expect(statement.sql).toContain("INSERT INTO audit_log");
    expect(statement.bindings).toEqual([
      id,
      "matter.opened",
      actorUserId,
      subjectId,
      // canonical JSON — key order normalized
      '{"matterNumber":"RENO-26-0001","previousStatus":"prospective"}',
      "2026-06-13T00:00:00.000Z",
    ]);
  });

  it("binds NULL actor, subject, and metadata when absent", () => {
    const stub = stubD1();
    const id = newIdentifier("auditLog");
    const statement = captured(
      insertAuditLogStatement(stub.database, {
        id,
        event: "firm.provisioned",
        actorUserId: null,
        subjectId: null,
        metadata: null,
        now: "2026-06-13T00:00:00.000Z",
      }),
    );
    expect(statement.bindings).toEqual([
      id,
      "firm.provisioned",
      null,
      null,
      null,
      "2026-06-13T00:00:00.000Z",
    ]);
  });

  it("refuses to stringify metadata carrying a `password` key — a canary, not a guarantee", () => {
    const stub = stubD1();
    const build = (metadata: unknown) =>
      insertAuditLogStatement(stub.database, {
        id: newIdentifier("auditLog"),
        event: "matter.updated",
        actorUserId: null,
        subjectId: null,
        metadata,
        now: "2026-06-13T00:00:00.000Z",
      });
    expect(() => build({ password: "hunter2" })).toThrow(/password/);
    // The canary walks nested objects and is case-insensitive on the key name.
    expect(() => build({ context: { Password: "hunter2" } })).toThrow(/password/);
    // Substring match — keys merely CONTAINING the word trip it too.
    expect(() => build({ newPassword: "hunter3" })).toThrow(/password/);
    expect(() => build({ context: { currentPassword: "hunter2" } })).toThrow(/password/);
    expect(() => build({ passwordHash: "deadbeef" })).toThrow(/password/);
    // A *value* mentioning the word is fine — only a key trips the canary.
    expect(() => build({ method: "password" })).not.toThrow();
  });
});
