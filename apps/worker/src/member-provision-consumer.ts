import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
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
import { resolveFirmDatabase } from "./firm-binding-resolver.ts";

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
// field explicitly: members.ts sends `roleName: null`, firm-provisioner sends `roleName: "Owner/Admin"`.
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
    throw new Error(`member.provision ${row.id}: ${message}`);
  }
}

// The member.provision consumer: mirrors a control-plane user into the
// firm's per-firm member table and assigns the named seeded role. At-least-once safe end to end —
// insertMemberStatement is ON CONFLICT DO NOTHING and the role assignment dedups on
// UNIQUE(member_user_id, role_id) — so a redelivery (or an overlapping sweep) is a no-op.
//
// Every unresolvable state throws: unknown firm, firm without a recorded database, a database this
// deployment cannot reach, an unknown role name. The relay turns the throw into attempts += 1 and
// dead-letters at max attempts — failure stays visible, the message is never half-applied (the
// member row and role assignment commit in ONE batch).
export async function consumeMemberProvision(env: Bindings, row: OutboxRow): Promise<void> {
  const payload = parseMemberProvisionPayload(row);

  const firmRow = await env.DB_CONTROL.prepare("SELECT database_identifier FROM firm WHERE id = ?1")
    .bind(payload.firmId)
    .first<{ database_identifier: string | null }>();
  if (firmRow === null) {
    throw new Error(`member.provision ${row.id}: unknown firm ${payload.firmId}`);
  }
  if (firmRow.database_identifier === null) {
    throw new Error(`member.provision ${row.id}: firm ${payload.firmId} has no database recorded`);
  }
  const firmDatabase = resolveFirmDatabase(env, firmRow.database_identifier);
  if (firmDatabase === null) {
    throw new Error(
      `member.provision ${row.id}: firm ${payload.firmId} database is not reachable from this deployment`,
    );
  }

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
    const role = await firmDatabase
      .prepare("SELECT id FROM role WHERE name = ?1")
      .bind(payload.roleName)
      .first<{ id: string }>();
    if (role === null) {
      throw new Error(`member.provision ${row.id}: unknown role "${payload.roleName}"`);
    }
    statements.push(
      insertRoleAssignmentStatement(firmDatabase, {
        id: newIdentifier("memberRole"),
        memberUserId: payload.userId,
        roleId: assertIdentifier(role.id, "role"),
      }),
    );
  }
  // One atomic batch: a crash can never leave the member row without its role (or vice versa).
  // Deliberate pin: the BatchDatabase annotation proves at compile time that D1Database still
  // satisfies the data-access batch port — a port drift fails here, not at runtime.
  const batchDatabase: BatchDatabase = firmDatabase;
  await batchDatabase.batch(statements);
}
