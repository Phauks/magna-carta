import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import type { OutboxRow } from "@magna-carta/data-access/outbox-relay";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { Bindings } from "./app.ts";
import { resolveFirmDatabase } from "./firm-binding-resolver.ts";

// The member.provision payload as the producers write it (routes/members.ts invite,
// firm-provisioner.ts owner activation): ids + non-privileged fields only (ADR-0038).
interface MemberProvisionPayload {
  readonly userId: string;
  readonly firmId: string;
  readonly displayName: string;
  readonly roleName: string | null;
}

// Malformed payloads THROW (never skip-silently): the relay increments attempts and dead-letters
// at max, which surfaces the bug instead of quietly dropping a member mirror (ADR-0038).
function parseMemberProvisionPayload(row: OutboxRow): MemberProvisionPayload {
  const parsed = JSON.parse(row.payload) as Partial<MemberProvisionPayload>;
  if (
    typeof parsed.userId !== "string" ||
    typeof parsed.firmId !== "string" ||
    typeof parsed.displayName !== "string" ||
    (parsed.roleName !== null && typeof parsed.roleName !== "string")
  ) {
    throw new Error(`member.provision ${row.id}: malformed payload`);
  }
  return {
    userId: parsed.userId,
    firmId: parsed.firmId,
    displayName: parsed.displayName,
    roleName: parsed.roleName ?? null,
  };
}

// The member.provision consumer (slice 0·4 design spec §6): mirrors a control-plane user into the
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
      userId: assertIdentifier(payload.userId, "user"),
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
        memberUserId: assertIdentifier(payload.userId, "user"),
        roleId: assertIdentifier(role.id, "role"),
      }),
    );
  }
  // One atomic batch: a crash can never leave the member row without its role (or vice versa).
  const batchDatabase: BatchDatabase = firmDatabase;
  await batchDatabase.batch(statements);
}
