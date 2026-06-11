import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { insertAuthAuditStatement } from "../src/auth-audit-statements.ts";
import { captured, stubD1 } from "./support/stub-d1.ts";

describe("insertAuthAuditStatement", () => {
  it("binds id, event, user id, canonical metadata JSON, and the instant", () => {
    const stub = stubD1();
    const id = newIdentifier("authAudit");
    const userId = newIdentifier("user");
    const statement = captured(
      insertAuthAuditStatement(stub.database, {
        id,
        event: "sign_in.success",
        userId,
        metadata: { method: "password", ip: "203.0.113.7" },
        now: "2026-06-10T00:00:00.000Z",
      }),
    );
    expect(statement.sql).toContain("INSERT INTO auth_audit");
    expect(statement.bindings).toEqual([
      id,
      "sign_in.success",
      userId,
      '{"ip":"203.0.113.7","method":"password"}', // canonical JSON — key order normalized
      "2026-06-10T00:00:00.000Z",
    ]);
  });

  it("binds NULL user id for pre-identification events and NULL for absent metadata", () => {
    const stub = stubD1();
    const id = newIdentifier("authAudit");
    const statement = captured(
      insertAuthAuditStatement(stub.database, {
        id,
        event: "sign_in.failure",
        userId: null,
        metadata: null,
        now: "2026-06-10T00:00:00.000Z",
      }),
    );
    expect(statement.bindings).toEqual([
      id,
      "sign_in.failure",
      null,
      null,
      "2026-06-10T00:00:00.000Z",
    ]);
  });

  it("refuses to stringify metadata carrying a `password` key — an ADR-0038 canary, not a guarantee", () => {
    const stub = stubD1();
    const build = (metadata: unknown) =>
      insertAuthAuditStatement(stub.database, {
        id: newIdentifier("authAudit"),
        event: "sign_in.failure",
        userId: null,
        metadata,
        now: "2026-06-10T00:00:00.000Z",
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
