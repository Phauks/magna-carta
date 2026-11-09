import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { CONFLICTS_PERSONNEL_TOPIC } from "@magna-carta/conflicts/recheck-cause";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import type { OutboxRow } from "@magna-carta/data-access/outbox-relay";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import type { Bindings } from "./app.ts";
import { firmDatabaseFor } from "./firm-database/firm-database-proxy.ts";

// The member.provision payload as the producers write it (routes/members.ts invite,
// firm-provisioner.ts owner activation): ids + non-privileged fields only.
interface MemberProvisionPayload {
  readonly userId: UserId;
  readonly firmId: FirmId;
  readonly displayName: string;
  readonly roleName: string | null;
}

// Malformed payloads THROW (never skip-silently): the relay increments attempts and dead-letters
// at max, which surfaces the bug instead of quietly dropping a member mirror. Both ids
// are asserted HERE, exactly once — downstream code consumes the branded types — and every
// malformed-payload failure carries the uniform `member.provision ${row.id}:` prefix.
//
// roleName must be EXPLICITLY present as `string | null` — an ABSENT field (undefined after
// JSON.parse) is malformed and dead-letters. Coercing a missing roleName to null would silently
// mirror a ROLELESS owner (a locked-out firm — no firm:manageMembers), which the reconciliation
// backstop can't catch (it only detects missing member ROWS). Both real producers always write the
// field explicitly: members.ts sends `roleName: null`, firm-provisioner sends `roleName: "Admin"`.
function parseMemberProvisionPayload(row: OutboxRow): MemberProvisionPayload {
  try {
    const parsed = JSON.parse(row.payload) as {
      userId?: unknown;
      firmId?: unknown;
      displayName?: unknown;
      roleName?: unknown;
    };
    if (
      typeof parsed.displayName !== "string" ||
      (parsed.roleName !== null && typeof parsed.roleName !== "string")
    ) {
      throw new Error("malformed payload");
    }
    return {
      userId: assertIdentifier(parsed.userId, "user"),
      firmId: assertIdentifier(parsed.firmId, "firm"),
      displayName: parsed.displayName,
      roleName: parsed.roleName,
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new Error(`member.provision ${row.id}: ${message}`, { cause: caught });
  }
}

// The member.provision consumer: mirrors a control-plane user into the
// firm's per-firm member table and assigns the named seeded role. At-least-once safe end to end —
// insertMemberStatement is ON CONFLICT DO NOTHING and the role assignment dedups on
// UNIQUE(member_user_id, role_id) — so a redelivery (or an overlapping sweep) is a no-op.
//
// An unknown role name throws: the relay turns the throw into attempts += 1 and dead-letters at max
// attempts — failure stays visible, the message is never half-applied (the member row and role
// assignment commit in ONE batch). The firm's per-firm FirmDatabase Durable Object is addressed by
// the payload's firmId and self-migrates the per-firm lineage on first access, so every firm is
// reachable by name — no control-plane lookup to resolve a database handle.
export async function consumeMemberProvision(env: Bindings, row: OutboxRow): Promise<void> {
  const payload = parseMemberProvisionPayload(row);

  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, payload.firmId);

  const statements: SqlStatement[] = [
    insertMemberStatement(firmDatabase, {
      userId: payload.userId,
      displayName: payload.displayName,
      now: new Date().toISOString(),
    }),
  ];
  if (payload.roleName !== null) {
    // Seeded role handles are committed literals in the per-firm migration (0002_member-rbac.sql);
    // the producer names the role and the id is resolved here at consume time — the worker never
    // hardcodes rol_ handles.
    const roleResult = await firmDatabase
      .prepare("SELECT id, parent_role_id AS parentRoleId FROM role WHERE name = ?1")
      .bind(payload.roleName)
      .all<{ id: string; parentRoleId: string | null }>();
    const role = roleResult.results[0];
    if (role === undefined) {
      throw new Error(`member.provision ${row.id}: unknown role "${payload.roleName}"`);
    }
    // A sub-role arrives with its parent: the parent's own row is what carries the parent's
    // permissions to the member, so an invited Partner who held only Partner would hold only what
    // Partner adds to Attorney.
    for (const roleId of role.parentRoleId === null ? [role.id] : [role.parentRoleId, role.id]) {
      statements.push(
        insertRoleAssignmentStatement(firmDatabase, {
          id: newIdentifier("memberRole"),
          memberUserId: payload.userId,
          roleId: assertIdentifier(roleId, "role"),
        }),
      );
    }
  }
  // One atomic batch: a crash can never leave the member row without its role (or vice versa).
  // Deliberate pin: the BatchDatabase annotation proves at compile time that the firm-database proxy
  // still satisfies the data-access batch port — a port drift fails here, not at runtime.
  //
  // The batch carries ONE extra row: a per-firm outbox message announcing the new member. Rule 1.10
  // imputes a lawyer's conflicts to the whole firm, so a roster change can alter the answer on a
  // matter whose parties never moved at all — the lateral hire is the classic case. Announcing it
  // here rather than resolving it here keeps the fan-out (every open matter) where fan-outs belong.
  // insertMemberStatement is ON CONFLICT DO NOTHING, so a redelivery re-emits; the ledger's partial
  // unique index makes that a no-op downstream.
  const batchDatabase: BatchDatabase = firmDatabase;
  await commitEffectBatch(
    batchDatabase,
    {
      statements,
      outboxMessages: [{ topic: CONFLICTS_PERSONNEL_TOPIC, payload: { userId: payload.userId } }],
    },
    { now: () => new Date().toISOString() },
  );
}
