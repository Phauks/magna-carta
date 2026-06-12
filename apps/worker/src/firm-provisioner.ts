import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { isFirmNameConflict } from "./control-plane-conflicts.ts";
import type { FirmResourceProvider } from "./firm-resource-provider.ts";

// The resumable provisioning orchestration (slice 0·4 design spec §5). Each step is guarded by
// the firm row's CURRENT state, so a crashed run resumes by re-invoking and completed steps no-op:
//
//   1. find-or-insert the firm row, status 'provisioning'   guard: row existence (UNIQUE name)
//   2. resourceProvider.createDatabase + record             guard: database_identifier IS NULL
//   3. migrate the firm database to head + mirror           guard: per_firm_schema_version = head
//   4. resourceProvider.createBucket + record               guard: bucket_name IS NULL
//   5. owner user + firm.provisioned audit + member.provision outbox + status='active'
//                                                           guard: status (commits as ONE batch)
//
// RESUME IDENTITY: the firm NAME, which is UNIQUE on the firm table. Firm ids are CSPRNG handles
// minted per attempt, and the idempotency record stores only a response — neither survives a
// crash as a lookup key, so the client-supplied name is the one stable handle a re-invocation can
// find its partial row by. Platform-admin-controlled input on a fleet of ~1 (the endpoint is
// secret-gated); revisit if firm creation ever becomes self-serve.
//
// THE FINAL STEP IS RETURNED, NOT COMMITTED: steps 1-4 each commit their own guarded write (they
// cannot ride one batch — resource creation and the firm-database migration are external calls),
// but step 5 is handed back as an EffectWrite so the route commits it through runIdempotentEffect
// in ONE atomic batch with the idempotency record. A crash before that commit stores no record,
// so a retry re-executes the handler and the guards above resume the work; replay only ever
// answers a response whose batch actually committed (ADR-0063).
//
// Concurrency note: crashed-run RESUME is the designed-for case. Two concurrent runs on the same
// name are serialized by UNIQUE(firm.name) / UNIQUE(firm.database_identifier) and — for the final
// batch — by UNIQUE(user.email) on the shared owner; the idempotency middleware's in-progress 409
// already fences same-key concurrency at the HTTP boundary.

export interface ProvisionFirmInput {
  readonly name: string;
  readonly owner: { readonly email: string; readonly name: string };
}

export interface FirmProvisionerDependencies {
  readonly controlPlaneDatabase: D1Database;
  readonly resourceProvider: FirmResourceProvider;
  // Bring the firm's database to the current per-firm schema head; answers the tag the mirror
  // column records (ADR-0065). The worker wiring resolves the binding and runs the fleet
  // migration runner; tests inject a counting fake.
  readonly migrateFirmDatabaseToHead: (
    databaseIdentifier: string,
  ) => Promise<{ latestTag: string }>;
  // The lineage head (perFirmHeadSchemaVersion()) — the step-3 skip guard compares the mirrored
  // version against this WITHOUT calling the port, so a resumed run leaves it untouched.
  readonly headSchemaVersion: string;
  readonly now?: () => string;
}

export type ProvisionFirmOutcome =
  | {
      // Steps 1-4 are durable; the caller must commit finalWrite (owner user + audit + outbox +
      // status flip) — through runIdempotentEffect on the route, or commitEffectBatch in tests.
      readonly kind: "ready-to-activate";
      readonly firmId: FirmId;
      readonly ownerUserId: UserId;
      readonly ownerEmail: string;
      readonly finalWrite: EffectWrite;
    }
  | {
      // The full no-op: this name is an active firm whose owner matches the request — answer it.
      readonly kind: "already-active";
      readonly firmId: FirmId;
      readonly owner: { readonly id: UserId; readonly email: string; readonly name: string };
    }
  | {
      // An ACTIVE firm already holds this name with a DIFFERENT owner — a name collision, not a
      // resume. The caller maps this to a conflict problem.
      readonly kind: "name-conflict";
      readonly firmId: FirmId;
    };

interface FirmRow {
  readonly id: FirmId;
  readonly status: string;
  readonly database_identifier: string | null;
  readonly per_firm_schema_version: string | null;
  readonly bucket_name: string | null;
}

const SELECT_FIRM_BY_NAME =
  "SELECT id, status, database_identifier, per_firm_schema_version, bucket_name FROM firm WHERE name = ?1";

export async function provisionFirm(
  dependencies: FirmProvisionerDependencies,
  input: ProvisionFirmInput,
): Promise<ProvisionFirmOutcome> {
  const database = dependencies.controlPlaneDatabase;
  const now = dependencies.now ?? (() => new Date().toISOString());
  // Lowercased like members.invite: Better Auth's email lookups lowercase their input, and the
  // owner's activation (password reset) must find the row this provisioning wrote.
  const ownerEmail = input.owner.email.trim().toLowerCase();

  // Step 1 — find-or-insert by the UNIQUE name (the resume identity).
  let firmRow = await database.prepare(SELECT_FIRM_BY_NAME).bind(input.name).first<FirmRow>();
  if (firmRow === null) {
    try {
      await database
        .prepare(
          "INSERT INTO firm (id, name, status, created_at) VALUES (?1, ?2, 'provisioning', ?3)",
        )
        .bind(newIdentifier("firm"), input.name, now())
        .run();
    } catch (caught) {
      // Lost a concurrent find-or-insert race: the winner's row is the firm — fall through to
      // the re-read below and resume against it.
      if (!isFirmNameConflict(caught)) throw caught;
    }
    firmRow = await database.prepare(SELECT_FIRM_BY_NAME).bind(input.name).first<FirmRow>();
    if (firmRow === null) {
      throw new Error(
        "firm row missing immediately after its find-or-insert — refusing to continue",
      );
    }
  }
  const firmId = firmRow.id;

  if (firmRow.status === "active") {
    // Fully provisioned already. Same owner → idempotent no-op answering the existing firm;
    // different owner → the name is genuinely taken.
    const owner = await database
      .prepare('SELECT id, email, name FROM "user" WHERE firm_id = ?1 AND email = ?2')
      .bind(firmId, ownerEmail)
      .first<{ id: UserId; email: string; name: string }>();
    if (owner === null) return { kind: "name-conflict", firmId };
    return { kind: "already-active", firmId, owner };
  }

  // Step 2 — create (or claim) the firm's database, then record it. The guarded UPDATE plus
  // UNIQUE(database_identifier) make the record idempotent and double-claim-proof.
  let databaseIdentifier = firmRow.database_identifier;
  if (databaseIdentifier === null) {
    ({ databaseIdentifier } = await dependencies.resourceProvider.createDatabase(firmId));
    await database
      .prepare(
        "UPDATE firm SET database_identifier = ?2 WHERE id = ?1 AND database_identifier IS NULL",
      )
      .bind(firmId, databaseIdentifier)
      .run();
  }

  // Step 3 — migrate the firm database to head, then mirror the version (ADR-0065). The mirror
  // updates in a separate commit from the migration itself (cross-database — no shared
  // transaction exists); a crash between them only costs a no-op re-run, exactly like the fleet
  // rollout's stale-mirror tolerance.
  if (firmRow.per_firm_schema_version !== dependencies.headSchemaVersion) {
    const { latestTag } = await dependencies.migrateFirmDatabaseToHead(databaseIdentifier);
    await database
      .prepare("UPDATE firm SET per_firm_schema_version = ?2 WHERE id = ?1")
      .bind(firmId, latestTag)
      .run();
  }

  // Step 4 — create (or re-claim) the firm's bucket, then record it.
  if (firmRow.bucket_name === null) {
    const { bucketName } = await dependencies.resourceProvider.createBucket(firmId);
    await database
      .prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1 AND bucket_name IS NULL")
      .bind(firmId, bucketName)
      .run();
  }

  // Step 5 — the activation batch, returned for the caller's atomic commit: the owner user
  // (unverified, account-less — activation runs through the password-reset flow, the Path A
  // members.invite verified), the firm.provisioned audit row, the member.provision outbox row
  // carrying the Owner/Admin role, and the status flip. One batch: 'active' implies the owner
  // exists, which is what makes status the step-5 guard.
  const ownerUserId = newIdentifier("user");
  const nowEpochMilliseconds = Date.now();
  return {
    kind: "ready-to-activate",
    firmId,
    ownerUserId,
    ownerEmail,
    finalWrite: {
      statements: [
        database
          .prepare(
            'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id) VALUES (?1, ?2, ?3, 0, ?4, ?4, ?5)',
          )
          .bind(ownerUserId, input.owner.name, ownerEmail, nowEpochMilliseconds, firmId),
        insertAuthAuditStatement(database, {
          id: newIdentifier("authAudit"),
          event: "firm.provisioned",
          // The actor is the platform admin — a secret-gated principal with no user row (the
          // named slice 0·4 seam), so the audit row is actor-less and the ids ride the metadata.
          userId: null,
          metadata: { firmId, ownerUserId },
          now: now(),
        }),
        database
          .prepare("UPDATE firm SET status = 'active' WHERE id = ?1 AND status = 'provisioning'")
          .bind(firmId),
      ],
      outboxMessages: [
        {
          topic: "member.provision",
          payload: {
            userId: ownerUserId,
            firmId,
            displayName: input.owner.name,
            roleName: "Owner/Admin",
          },
        },
      ],
    },
  };
}
