import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import type { DataRegion } from "@magna-carta/database/data-region";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { isFirmNameConflict } from "./control-plane-conflicts.ts";
import type { FirmResourceProvider } from "./firm-resource-provider.ts";
import { insertCredentialAccountStatement } from "./joining-credentials.ts";

// The resumable provisioning orchestration. Each step is guarded by
// the firm row's CURRENT state, so a crashed run resumes by re-invoking and completed steps no-op:
//
//   1. find-or-insert the firm row, status 'provisioning'   guard: row existence (UNIQUE name)
//   2. resourceProvider.createBucket + record               guard: bucket_name IS NULL
//   2b. notifications, expiry rules and CORS on the bucket   unconditional (idempotent PUTs)
//   3. owner user + firm.provisioned audit + member.provision outbox + status='active'
//                                                           guard: status (commits as ONE batch)
//
// The firm's per-firm database needs NO provisioning step: it is the firmId-addressed FirmDatabase
// Durable Object, which exists for every firm id and self-migrates to head on first access — so
// provisioning creates only the firm's R2 bucket and control-plane rows.
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
// THE FINAL STEP IS RETURNED, NOT COMMITTED: steps 1-2 each commit their own guarded write (the
// bucket creation is an external call that cannot ride one batch), but step 3 is handed back as an
// EffectWrite so the route commits it through runIdempotentEffect in ONE atomic batch with the
// idempotency record. A crash before that commit stores no record, so a retry re-executes the
// handler and the guards above resume the work; replay only ever answers a response whose batch
// actually committed.
//
// Concurrency note: crashed-run RESUME is the designed-for case. No in-progress idempotency
// record is ever written, so same-KEY concurrency is NOT fenced at the HTTP boundary — the real
// fence is UNIQUE(idempotency_key.key) at the final commit: a concurrent same-key loser's batch
// rolls back whole and the loser replays the winner's stored response. It may instead trip
// UNIQUE(user.email) first (both runs insert the shared owner) and answer 422 — self-healing,
// since a retry finds the winner's idempotency record or the now-active firm. Same-name runs
// under DIFFERENT keys: UNIQUE(firm.name) collapses step 1 onto one row, and with DIFFERENT owner
// emails no UNIQUE trips in the final batch, whose status flip is a guarded UPDATE that no-ops
// silently at 0 rows. The real final-step fence is the ACTIVATION FENCE in the batch below: an
// INSERT ... SELECT that collides with the firm's own PRIMARY KEY unless status is still
// 'provisioning', so the first activation to commit wins and every later activation batch aborts
// whole (the route maps the abort to a 409; a retry then observes the active firm).

export interface ProvisionFirmInput {
  readonly name: string;
  // The human-facing name, when it differs from the resume handle above. The operator door leaves
  // it unset — there the typed name IS the name. The self-serve door sets it, because there `name`
  // is a platform-generated handle and the firm's real name must not be a UNIQUE column: firm names
  // are not unique in the world, and a unique one would refuse the second Smith Law, let a stranger
  // probe for any firm by trying to register its name, and make squatting cost one email address.
  readonly displayName?: string;
  // `userId` names an account that ALREADY EXISTS and is founding this firm from inside the app —
  // the account-first door. Absent for the two doors where the owner has no account yet (the
  // operator door and a registration started under the superseded founding door), where the
  // activation batch creates one. The difference is one statement in step 3 and one mail the
  // caller does not send; everything else about provisioning is identical.
  readonly owner: {
    readonly email: string;
    readonly name: string;
    readonly userId?: UserId;
    // The password the owner CHOSE when they registered, already hashed (joining-credentials.ts).
    // Present on the self-serve door, where the person picked one and proved the mailbox by spending
    // the confirmation token — so the owner is created verified, WITH a credential, and no
    // activation mail is owed. Absent on the operator door, where a platform admin types a name and
    // an address and there is no password to have chosen: that owner is created account-less and
    // activates through the password-reset flow, which creates the credential when it lands.
    readonly credentialHash?: string;
  };
}

export interface FirmProvisionerDependencies {
  readonly controlPlaneDatabase: D1Database;
  readonly resourceProvider: FirmResourceProvider;
  // The base64 root key-encryption key (the ROOT_KEK secret) the firm-key mint step (step 2c)
  // wraps each freshly minted firm key under. The raw firm-key bytes are never persisted — only
  // the wrapped form lands in the firm row.
  readonly rootKekBase64: string;
  readonly now?: () => string;
}

export type ProvisionFirmOutcome =
  | {
      // Steps 1-2 are durable; the caller must commit finalWrite (owner user + audit + outbox +
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
  readonly bucket_name: string | null;
  readonly wrapped_firm_key: string | null;
  readonly data_region: DataRegion;
}

const SELECT_FIRM_BY_NAME =
  "SELECT id, status, bucket_name, wrapped_firm_key, data_region FROM firm WHERE name = ?1";

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
          "INSERT INTO firm (id, name, display_name, status, created_at) VALUES (?1, ?2, ?3, 'provisioning', ?4)",
        )
        .bind(newIdentifier("firm"), input.name, input.displayName ?? null, now())
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

  // Step 2 — create (or re-claim) the firm's bucket, then record it. The region drives physical
  // placement (jurisdiction + location hint) — it is set once at find-or-insert and never changes.
  if (firmRow.bucket_name === null) {
    const { bucketName } = await dependencies.resourceProvider.createBucket(
      firmId,
      firmRow.data_region,
    );
    await database
      .prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1 AND bucket_name IS NULL")
      .bind(firmId, bucketName)
      .run();
  }

  // Step 2b — configure the bucket's object-create notification → files-ingest. Run UNCONDITIONALLY
  // (not gated on the bucket-was-just-created branch): a run that created the bucket but crashed
  // before this would otherwise never configure notifications on resume. Idempotent (PUT), so the
  // re-run on a resume is harmless.
  await dependencies.resourceProvider.configureBucketNotifications(firmId, firmRow.data_region);

  // Step 2b(ii) — apply the bucket's expiry rules, unconditionally and for the same reason: a run
  // that created the bucket and crashed before this would otherwise leave a firm whose transient
  // artifacts never expire, which nothing downstream would ever notice.
  await dependencies.resourceProvider.configureBucketLifecycle(firmId, firmRow.data_region);

  // Step 2b(iii) — apply the bucket's CORS policy, unconditionally for the same reason. The
  // file-manager upload PUTs bytes from the browser straight to a presigned URL on this bucket, and
  // a bucket with no policy refuses the preflight — so without this step a firm cannot upload a
  // single file, and the only thing the app can say is that nothing answered.
  await dependencies.resourceProvider.configureBucketCors(firmId, firmRow.data_region);

  // Step 2c — mint the firm's data key. Guarded by wrapped_firm_key IS NULL so a resume mints
  // nothing, AND by the firm never having been shredded (a firm.key_shredded audit row): a shredded
  // firm's null key is permanent, never re-minted. Mint = 32 random bytes, AES-KW-wrapped under the
  // root KEK; only the wrapped form is stored (the raw bytes are never persisted), so the firm's
  // protected columns become writable/readable. firm_key_version/root_key_version already default 1.
  if (firmRow.wrapped_firm_key === null) {
    const shredded = await database
      .prepare(
        "SELECT 1 AS present FROM auth_audit WHERE event = 'firm.key_shredded' AND metadata LIKE '%' || ?1 || '%' LIMIT 1",
      )
      .bind(firmId)
      .first<{ present: number }>();
    if (shredded === null) {
      const rootKek = await importRootKek(dependencies.rootKekBase64);
      const wrappedFirmKey = await wrapFirmKey(rootKek, generateFirmKeyBytes());
      await database
        .prepare("UPDATE firm SET wrapped_firm_key = ?2 WHERE id = ?1 AND wrapped_firm_key IS NULL")
        .bind(firmId, wrappedFirmKey)
        .run();
    }
  }

  // Step 3 — the activation batch, returned for the caller's atomic commit: the owner user
  // (unverified, account-less — activation runs through the password-reset flow, the Path A
  // members.invite verified), the firm.provisioned audit row, the member.provision outbox row
  // carrying the Admin role, the activation fence, and the status flip that also records
  // the owner. One batch: 'active' implies the owner exists AND is recorded, which is what makes
  // status the step-3 guard and owner_user_id the already-active branch's owner of record.
  const adoptedOwnerUserId = input.owner.userId;
  const ownerUserId = adoptedOwnerUserId ?? newIdentifier("user");
  // Only meaningful when the owner is CREATED here. An adopted account already holds whatever
  // credential its own joining path gave it, and overwriting that from a registration would be a
  // password change nobody asked for.
  const ownerCredentialHash =
    adoptedOwnerUserId === undefined ? input.owner.credentialHash : undefined;
  const nowEpochMilliseconds = Date.now();
  return {
    kind: "ready-to-activate",
    firmId,
    ownerUserId,
    ownerEmail,
    finalWrite: {
      statements: [
        // The owner. Either created here — with the credential they chose when they registered, or
        // account-less and activated afterwards through the password-reset flow when the door had
        // no password to carry — or ADOPTED, when the person founding the firm already has an
        // account and is signed in as they ask for it.
        //
        // The adoption is two statements because a guarded UPDATE cannot abort a D1 batch at zero
        // rows. The first is a FENCE in the shape the activation fence below already uses: it
        // inserts a row colliding with this user's own primary key unless the account still belongs
        // to no firm, so a second pass over the same account — a redelivered outbox row, or a
        // person who founded a firm and redeemed an invitation in the same minute — aborts the
        // whole batch instead of quietly moving them between firms.
        ...(adoptedOwnerUserId === undefined
          ? [
              database
                .prepare(
                  'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, firm_id) VALUES (?1, ?2, ?3, ?6, ?4, ?4, ?5)',
                )
                .bind(
                  ownerUserId,
                  input.owner.name,
                  ownerEmail,
                  nowEpochMilliseconds,
                  firmId,
                  // Verified exactly when the owner arrived by spending a token mailed to this
                  // address — which is the same possession proof email verification asks for, and
                  // the only door that carries a chosen password. The operator door proves nothing
                  // about the mailbox, so its owner stays unverified until the reset link lands.
                  ownerCredentialHash === undefined ? 0 : 1,
                ),
              // The credential in the SAME batch as the user, so an owner row can never commit
              // without a password to sign in with — the state that made a missing activation mail
              // an account nobody could ever reach.
              ...(ownerCredentialHash === undefined
                ? []
                : [
                    insertCredentialAccountStatement(database, {
                      userId: ownerUserId,
                      passwordHash: ownerCredentialHash,
                      nowEpochMilliseconds,
                    }),
                  ]),
            ]
          : [
              database
                .prepare(
                  "INSERT INTO \"user\" (id, name, email, firm_id) SELECT ?1, '', '', NULL " +
                    'WHERE (SELECT firm_id FROM "user" WHERE id = ?1) IS NOT NULL',
                )
                .bind(adoptedOwnerUserId),
              database
                .prepare(
                  'UPDATE "user" SET firm_id = ?2, updated_at = ?3 WHERE id = ?1 AND firm_id IS NULL',
                )
                .bind(adoptedOwnerUserId, firmId, nowEpochMilliseconds),
            ]),
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
            roleName: "Admin",
          },
        },
      ],
    },
  };
}
