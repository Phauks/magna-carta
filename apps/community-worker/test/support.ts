import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import { d1MigrationTarget } from "@magna-carta/database/d1-migration-target";
import { migrationsFromJournal } from "@magna-carta/database/migration";
import controlPlaneJournal from "@magna-carta/database/drizzle/control-plane/meta/_journal.json";
import baselineSql from "@magna-carta/database/drizzle/control-plane/20260704T041516_baseline.sql";
import emailCaptureRouteSql from "@magna-carta/database/drizzle/control-plane/20260803T222618_email-capture-route.sql";
import twoFactorLockoutFieldsSql from "@magna-carta/database/drizzle/control-plane/20260803T230717_two-factor-lockout-fields.sql";
import firmBucketNameUniqueSql from "@magna-carta/database/drizzle/control-plane/20260804T065814_firm-bucket-name-unique.sql";
import selfServeRegistrationAndInvitationsSql from "@magna-carta/database/drizzle/control-plane/20260811T224252_self-serve-registration-and-invitations.sql";
import communityBoardSql from "@magna-carta/database/drizzle/control-plane/20260813T072729_community-board.sql";

// The committed control-plane lineage, applied to the pool's D1. This worker never migrates
// anything in production — the application worker's scheduled handler is the sole applier — so this
// list exists only so the tests run against the real schema.
export async function applyControlPlaneMigrations(database: D1Database): Promise<void> {
  await runPendingMigrations(
    d1MigrationTarget(database),
    migrationsFromJournal(controlPlaneJournal, {
      "20260704T041516_baseline": baselineSql,
      "20260803T222618_email-capture-route": emailCaptureRouteSql,
      "20260803T230717_two-factor-lockout-fields": twoFactorLockoutFieldsSql,
      "20260804T065814_firm-bucket-name-unique": firmBucketNameUniqueSql,
      "20260811T224252_self-serve-registration-and-invitations":
        selfServeRegistrationAndInvitationsSql,
      "20260813T072729_community-board": communityBoardSql,
    }),
  );
}

export const FIRM_ONE = "firm_boardTestOne";
export const FIRM_TWO = "firm_boardTestTwo";
export const FIRM_THREE = "firm_boardTestThree";

export interface SeededMember {
  readonly userId: string;
  readonly firmId: string;
  readonly token: string;
  readonly cookie: string;
}

// A firm and a signed-in member of it, written straight into the control plane. Signing in happens
// on the application worker; this worker only recognises the resulting session row, so a test seeds
// the row rather than driving an authentication flow that does not live here.
export async function seedFirm(database: D1Database, firmId: string): Promise<void> {
  await database
    .prepare(
      `INSERT OR IGNORE INTO firm (id, name, status, release_channel, firm_key_version, root_key_version, support_requires_cosign, data_region, created_at)
       VALUES (?1, ?2, 'active', 'stable', 1, 1, 0, 'us', '2026-08-01T00:00:00.000Z')`,
    )
    .bind(firmId, `${firmId} name`)
    .run();
}

export async function seedMember(
  database: D1Database,
  input: {
    readonly userId: string;
    readonly firmId: string;
    readonly name: string;
    readonly emailVerified?: boolean;
    readonly expiresAt?: number;
  },
): Promise<SeededMember> {
  await seedFirm(database, input.firmId);
  await database
    .prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at, firm_id)
       VALUES (?1, ?2, ?3, ?4, 0, 0, ?5)`,
    )
    .bind(
      input.userId,
      input.name,
      `${input.userId}@example.test`,
      input.emailVerified === false ? 0 : 1,
      input.firmId,
    )
    .run();
  const token = `token_${input.userId}`;
  await database
    .prepare(
      `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
       VALUES (?1, ?2, ?3, 0, 0, ?4)`,
    )
    .bind(
      `session_${input.userId}`,
      input.expiresAt ?? Date.parse("2099-01-01T00:00:00.000Z"),
      token,
      input.userId,
    )
    .run();
  return {
    userId: input.userId,
    firmId: input.firmId,
    token,
    // Better Auth prefixes its cookie and appends a signature after a dot; the resolver matches the
    // name by suffix and takes the token before the dot, so the test presents the same shape.
    cookie: `__Secure-better-auth.session_token=${token}.signaturedoesnotdecidethis`,
  };
}

export async function makeOperator(database: D1Database, userId: string): Promise<void> {
  await database
    .prepare(
      `INSERT INTO platform_operator (user_id, granted_at, granted_by, expires_at, note)
       VALUES (?1, '2026-08-01T00:00:00.000Z', ?1, NULL, 'board test')`,
    )
    .bind(userId)
    .run();
}
