import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { isFirmNameConflict } from "./control-plane-conflicts.ts";
import type { FirmResourceProvider } from "./firm-resource-provider.ts";

// The resumable provisioning orchestration. Each step is guarded by
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
// find its partial row by. The match is BYTE-EXACT (WHERE name = ?1), so the ROUTE owns name
// normalization: routes/firms.ts canonicalizes (trim + Unicode NFC) in its request schema before
// the name reaches this module — a trailing space or an NFD variant must resume the same row, not
// insert a second one. Platform-admin-controlled input on a fleet of ~1 (the endpoint is
// secret-gated); revisit if firm creation ever becomes self-serve.
//
// THE FINAL STEP IS RETURNED, NOT COMMITTED: steps 1-4 each commit their own guarded write (they
// cannot ride one batch — resource creation and the firm-database migration are external calls),
// but step 5 is handed back as an EffectWrite so the route commits it through runIdempotentEffect
// in ONE atomic batch with the idempotency record. A crash before that commit stores no record,
// so a retry re-executes the handler and the guards above resume the work; replay only ever
// answers a response whose batch actually committed.
//
// Concurrency note: crashed-run RESUME is the designed-for case. No in-progress idempotency
// record is ever written, so same-KEY concurrency is NOT fenced at the HTTP boundary — the real
// fence is UNIQUE(idempotency_key.key) at the final commit: a concurrent same-key loser's batch
// rolls back whole and the loser replays the winner's stored response. It may instead trip
// UNIQUE(user.email) first (both runs insert the shared owner) and answer 422 — self-healing,
// since a retry finds the winner's idempotency record or the now-active firm. Same-name runs
// under DIFFERENT keys: UNIQUE(firm.name) collapses step 1 onto one row and the step-2 claim
// verification kills a run whose created database was never recorded, but neither stops a run
// that ADOPTED the other's recorded claims — and with DIFFERENT owner emails no UNIQUE trips in
// the final batch, whose status flip is a guarded UPDATE that no-ops silently at 0 rows. The real
// final-step fence is the ACTIVATION FENCE in the batch below: an INSERT ... SELECT that collides
// with the firm's own PRIMARY KEY unless status is still 'provisioning', so the first activation
// to commit wins and every later activation batch aborts whole (the route maps the abort to a
// 409; a retry then observes the active firm).

export interface ProvisionFirmInput {
  readonly name: string;
  readonly owner: { readonly email: string; readonly name: string };
}

export interface FirmProvisionerDependencies {
  readonly controlPlaneDatabase: D1Database;
  readonly resourceProvider: FirmResourceProvider;
  // Bring the firm's database to the current per-firm schema head; answers the tag the mirror
  // column records. The worker wiring resolves the binding and runs the fleet
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
    // anyone else → the name is genuinely taken. The match is against the firm's RECORDED owner
    // (owner_user_id, written by the activation batch) — matching any user row in the firm would
    // let a mere invited member's email pass and be presented (and stored for replay) as owner.
    const owner = await database
      .prepare(
        'SELECT "user".id AS id, "user".email AS email, "user".name AS name FROM firm ' +
          'JOIN "user" ON "user".id = firm.owner_user_id WHERE firm.id = ?1 AND "user".email = ?2',
      )
      .bind(firmId, ownerEmail)
      .first<{ id: UserId; email: string; name: string }>();
    if (owner === null) return { kind: "name-conflict", firmId };
    return { kind: "already-active", firmId, owner };
  }

  // Step 2 — create (or claim) the firm's database, then record it. The IS NULL guard means only
  // ONE run's identifier ever lands, but a guarded UPDATE that no-ops never trips
  // UNIQUE(database_identifier) — a concurrent run may have recorded a DIFFERENT identifier, and
  // continuing would migrate a database no firm row records. So the claim is VERIFIED: a no-op
  // UPDATE re-reads the row and fails loud unless the recorded identifier is this run's own.
  let databaseIdentifier = firmRow.database_identifier;
  if (databaseIdentifier === null) {
    ({ databaseIdentifier } = await dependencies.resourceProvider.createDatabase(firmId));
    const claim = await database
      .prepare(
        "UPDATE firm SET database_identifier = ?2 WHERE id = ?1 AND database_identifier IS NULL",
      )
      .bind(firmId, databaseIdentifier)
      .run();
    if (claim.meta.changes !== 1) {
      const recorded = await database
        .prepare("SELECT database_identifier FROM firm WHERE id = ?1")
        .bind(firmId)
        .first<{ database_identifier: string | null }>();
      if (recorded?.database_identifier !== databaseIdentifier) {
        throw new Error(
          `concurrent provisioning detected for firm ${firmId}: this run obtained database ` +
            `"${databaseIdentifier}" but the firm row records ` +
            `"${recorded?.database_identifier ?? "(none)"}" — re-invoke to resume from the recorded state`,
        );
      }
    }
  }

  // Step 3 — migrate the firm database to head, then mirror the version. The mirror
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
  // carrying the Owner/Admin role, the activation fence, and the status flip that also records
  // the owner. One batch: 'active' implies the owner exists AND is recorded, which is what makes
  // status the step-5 guard and owner_user_id the already-active branch's owner of record.
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
          // The actor is the platform admin — a secret-gated principal with no user row,
          // so the audit row is actor-less and the ids ride the metadata.
          userId: null,
          metadata: { firmId, ownerUserId },
          now: now(),
        }),
        // THE ACTIVATION FENCE (see the concurrency note above): a guarded UPDATE cannot abort a
        // D1 batch at 0 rows, so this assertion makes the batch fail loud instead — when another
        // run already flipped the firm out of 'provisioning', the SELECT yields a row whose id
        // collides with the firm's own PRIMARY KEY and the whole batch rolls back
        // (isFirmActivationConflict detects it). While the status is still 'provisioning' the
        // WHERE filters everything and nothing inserts. MUST run BEFORE the status flip below —
        // after it, this transaction's own flip would trip the fence. Empirically pinned by the
        // interleaving test in test/firm-provisioner.test.ts.
        database
          .prepare(
            "INSERT INTO firm (id, name, created_at, status) SELECT ?1, '', '', '' " +
              "WHERE (SELECT status FROM firm WHERE id = ?1) <> 'provisioning'",
          )
          .bind(firmId),
        database
          .prepare(
            "UPDATE firm SET status = 'active', owner_user_id = ?2 WHERE id = ?1 AND status = 'provisioning'",
          )
          .bind(firmId, ownerUserId),
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
