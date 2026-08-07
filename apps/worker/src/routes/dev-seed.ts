import type { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import {
  commitVersionStatement,
  fileVersionKey,
  insertFileStatement,
  insertFileVersionStatement,
  quarantineVersionStatement,
  setFileCurrentVersionStatement,
} from "@magna-carta/file-manager/file-statements";
import { insertFolderStatement } from "@magna-carta/file-manager/folder-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, FolderId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { matterScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type { Bindings } from "../app.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { createAuth } from "../auth.ts";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { devUploadEmulationActive } from "../files/presigner-wiring.ts";

// The DEVELOPMENT-ONLY firm seeder. Local dev (`vp run worker-dev`) starts with an empty control
// plane: no firm, no user, no data — so every authenticated API call 401s and the SPA renders
// nothing real. This route stands up a complete, signed-in-ready tenant in one call so a developer
// can log in and see real seeded data flow through the typed hooks. It provisions, idempotently:
//   - a dev firm (a stable name, so a re-run resumes the same tenant) plus its wrapped firm key,
//   - a credentialed owner user with a KNOWN dev email + password, mirrored as Owner/Admin,
//   - a matter, two folders, and a handful of files visible through the file-manager reads
//     (committed clean versions with current_version_id set and R2 objects present), including a
//     re-scan-flagged file and a quarantined file so the enriched summary fields have something to
//     show. It returns the dev credentials plus the firm/matter ids.
//
// It writes real bytes to object storage and mints a real session-capable user, so it is gated
// exactly like routes/dev-r2-upload.ts: it serves ONLY when the real R2 S3 credential set is absent
// (devUploadEmulationActive) — the same fail-closed signal that reroutes uploads to the Worker under
// `wrangler dev`. A production deploy carries those credentials, so the guard answers a bare 404
// before any work runs; the route is unreachable in production and never enters the OpenAPI contract
// (a plain app.post under /api/__dev, like dev-r2-upload). It sits OUTSIDE the chokepoint on purpose:
// it bootstraps the very first user, so it cannot require a pre-existing session.

type DevSeedApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// A stable firm name is the seeder's resume identity — firm.name is UNIQUE (the provisioner's own
// resume handle), so a re-run finds this row instead of colliding.
const DEV_FIRM_NAME = "Local Development Firm";
// The KNOWN dev credentials the route returns and the developer signs in with. A dev-only literal by
// design — not a real secret. The user is created with a scrypt-hashed password through the same auth
// context sign-in verifies against, so sign-in works with exactly these values.
const DEV_OWNER_EMAIL = "owner@dev.magnacarta.test";
const DEV_OWNER_PASSWORD = "local-dev-password";
const DEV_OWNER_NAME = "Development Owner";
// A stable matter title, the resume identity for the data seeding: a re-run that finds this matter
// leaves its files untouched rather than seeding a second copy.
const DEV_MATTER_TITLE = "Sandbox Matter";
// The Miniflare R2 binding is named "R2"; recording it as the firm's bucket lets download/preview
// resolve the bound bucket under `wrangler dev`.
const DEV_BUCKET_NAME = "R2";

// Guard: answer a bare 404 (route invisible, no work) whenever the real R2 S3 credential set is
// present — i.e. in production. Registered OUTSIDE any auth, reading the same credential state that
// selects the dev upload transport, so the seeder is reachable exactly where local dev already
// reroutes uploads to the Worker, and never otherwise.
const requireDevSeedEmulation: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AppVariables;
}> = (c, next) => {
  if (!devUploadEmulationActive(c.env)) return Promise.resolve(c.notFound());
  return next();
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Finds the dev firm by its stable name, or provisions it (control-plane firm row + wrapped firm
// key). Returns the firmId either way and whether it already existed (so the response can report a
// resumed vs a fresh seed). Detect-and-reuse keeps a re-run off the firm.name / database_identifier
// UNIQUE constraints.
async function ensureFirm(env: Bindings): Promise<{ firmId: FirmId; created: boolean }> {
  const existing = await env.DB_CONTROL.prepare(
    "SELECT id, wrapped_firm_key FROM firm WHERE name = ?1",
  )
    .bind(DEV_FIRM_NAME)
    .first<{ id: FirmId; wrapped_firm_key: string | null }>();

  if (existing !== null) {
    // Backfill the firm key if a prior partial run left it null, so protected reads/writes work.
    if (existing.wrapped_firm_key === null) {
      await env.DB_CONTROL.prepare("UPDATE firm SET wrapped_firm_key = ?2 WHERE id = ?1")
        .bind(existing.id, await wrapNewFirmKey(env))
        .run();
    }
    return { firmId: assertIdentifier(existing.id, "firm"), created: false };
  }

  const firmId = newIdentifier("firm");
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, database_identifier, bucket_name, wrapped_firm_key, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  )
    .bind(
      firmId,
      DEV_FIRM_NAME,
      `dev-${firmId}`,
      DEV_BUCKET_NAME,
      await wrapNewFirmKey(env),
      new Date().toISOString(),
    )
    .run();
  return { firmId, created: true };
}

async function wrapNewFirmKey(env: Bindings): Promise<string> {
  const rootKek = await importRootKek(env.ROOT_KEK);
  return wrapFirmKey(rootKek, generateFirmKeyBytes());
}

// Finds the dev owner by email, or creates a verified user + credential account through the Better
// Auth adapter (the same hasher sign-in verifies against). Public signup is disabled, so the user is
// seeded straight through the adapter, exactly as the test-auth helper does.
async function ensureOwnerUser(env: Bindings, firmId: FirmId): Promise<UserId> {
  const existing = await env.DB_CONTROL.prepare('SELECT id FROM "user" WHERE email = ?1')
    .bind(DEV_OWNER_EMAIL)
    .first<{ id: string }>();
  if (existing !== null) return assertIdentifier(existing.id, "user");

  const auth = createAuth(env, () => Promise.resolve());
  const context = await auth.$context;
  const now = new Date();
  const user = await context.adapter.create<Record<string, unknown>, { id: string }>({
    model: "user",
    data: {
      name: DEV_OWNER_NAME,
      email: DEV_OWNER_EMAIL,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      firmId,
    },
  });
  await context.adapter.create({
    model: "account",
    data: {
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await context.password.hash(DEV_OWNER_PASSWORD),
      createdAt: now,
      updatedAt: now,
    },
  });
  return assertIdentifier(user.id, "user");
}

// Mirrors the owner into the firm's member table and assigns the seeded Owner/Admin role. Both
// inserts are ON CONFLICT DO NOTHING, so a re-run is a no-op. Reading the role first also triggers
// the per-firm FirmDatabase DO to self-migrate, so the seeded role row exists.
async function ensureOwnerMember(firmDatabase: ProxyBatchDatabase, userId: UserId): Promise<void> {
  const ownerRole = await firmDatabase
    .prepare("SELECT id FROM role WHERE name = 'Owner/Admin'")
    .first<{ id: string }>();
  if (ownerRole === null) {
    throw new Error("seeded Owner/Admin role missing from the firm database");
  }
  await insertMemberStatement(firmDatabase, {
    userId,
    displayName: DEV_OWNER_NAME,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(firmDatabase, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(ownerRole.id, "role"),
  }).run();
}

// One clean file with a single committed version — insert the file, its pending version, commit it
// (which sets the clean facts and verdict), point current_version_id at it, and write the placeholder
// bytes to R2 at the version key. status='clean' + current_version_id set is the visibility gate the
// file-manager reads enforce, so the file shows in listFiles with its enriched version fields.
async function seedCleanFile(
  env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  input: {
    readonly matterId: MatterId;
    readonly folderId: FolderId | null;
    readonly name: string;
    readonly content: string;
    readonly sniffedContentType: string;
    readonly scanVerdict: "unscanned" | "clean" | "flagged";
    readonly uploadedBy: UserId;
    readonly now: string;
  },
): Promise<void> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = fileVersionKey(fileId, versionId);
  const bytes = new TextEncoder().encode(input.content);
  await insertFileStatement(firmDatabase, {
    id: fileId,
    matterId: input.matterId,
    folderId: input.folderId,
    name: input.name,
    documentTypeId: null,
    createdAt: input.now,
  }).run();
  await insertFileVersionStatement(firmDatabase, {
    id: versionId,
    fileId,
    versionNumber: 1,
    r2Key,
    declaredContentType: input.sniffedContentType,
    uploadedBy: input.uploadedBy,
    createdAt: input.now,
  }).run();
  await commitVersionStatement(firmDatabase, {
    versionId,
    sizeBytes: bytes.byteLength,
    sniffedContentType: input.sniffedContentType,
    contentSha256: await sha256Hex(bytes),
    scanVerdict: input.scanVerdict,
    // A never-scanned version records no engine; a scanned/flagged one names the seeder as the engine.
    scanEngineVersion: input.scanVerdict === "unscanned" ? null : "dev-seed",
    scanDetail:
      input.scanVerdict === "flagged"
        ? "Seeded flagged sample: a re-scan marked this committed version as suspect (demonstration only)."
        : null,
    committedAt: input.now,
  }).run();
  await setFileCurrentVersionStatement(firmDatabase, fileId, versionId, input.now).run();
  // Seeded bytes are stamped exactly as an uploaded version would be, so a local environment is a
  // faithful rehearsal of the production one rather than a corpus of unscoped objects.
  await env.R2.put(r2Key, bytes, {
    customMetadata: matterScopedObjectDimensions({
      objectClass: "working-document",
      matterId: input.matterId,
    }),
  });
}

// One quarantined file: a first upload whose version the scan rejected. It has a pending-then-
// quarantined version and NO current_version_id, so it surfaces only in the opt-in
// includePendingAndQuarantined listing, carrying its quarantine reason.
async function seedQuarantinedFile(
  firmDatabase: ProxyBatchDatabase,
  input: {
    readonly matterId: MatterId;
    readonly folderId: FolderId | null;
    readonly name: string;
    readonly uploadedBy: UserId;
    readonly now: string;
  },
): Promise<void> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = fileVersionKey(fileId, versionId);
  await insertFileStatement(firmDatabase, {
    id: fileId,
    matterId: input.matterId,
    folderId: input.folderId,
    name: input.name,
    documentTypeId: null,
    createdAt: input.now,
  }).run();
  await insertFileVersionStatement(firmDatabase, {
    id: versionId,
    fileId,
    versionNumber: 1,
    r2Key,
    declaredContentType: "application/octet-stream",
    uploadedBy: input.uploadedBy,
    createdAt: input.now,
  }).run();
  await quarantineVersionStatement(
    firmDatabase,
    versionId,
    "Rejected by the malware scan (seeded quarantined sample).",
  ).run();
}

// Seeds the matter, folders, and files — but only when the dev matter does not already exist, so a
// re-run resumes rather than seeding a second copy. Returns the matter id (found or created).
async function ensureSeededData(
  env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  ownerUserId: UserId,
): Promise<{ matterId: MatterId; fileCount: number; created: boolean }> {
  const existing = await firmDatabase
    .prepare("SELECT id FROM matter WHERE title = ?1 LIMIT 1")
    .bind(DEV_MATTER_TITLE)
    .first<{ id: string }>();
  if (existing !== null) {
    const count = await firmDatabase
      .prepare("SELECT COUNT(*) AS n FROM file WHERE matter_id = ?1")
      .bind(existing.id)
      .first<{ n: number }>();
    return {
      matterId: assertIdentifier(existing.id, "matter"),
      fileCount: count?.n ?? 0,
      created: false,
    };
  }

  const now = new Date().toISOString();
  const matterId = newIdentifier("matter");
  await firmDatabase
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, ?4)",
    )
    .bind(matterId, DEV_MATTER_TITLE, ownerUserId, now)
    .run();

  const pleadingsId = newIdentifier("folder");
  const correspondenceId = newIdentifier("folder");
  await insertFolderStatement(firmDatabase, {
    id: pleadingsId,
    matterId,
    parentFolderId: null,
    name: "Pleadings",
    createdAt: now,
  }).run();
  await insertFolderStatement(firmDatabase, {
    id: correspondenceId,
    matterId,
    parentFolderId: null,
    name: "Correspondence",
    createdAt: now,
  }).run();

  await seedCleanFile(env, firmDatabase, {
    matterId,
    folderId: pleadingsId,
    name: "Complaint.txt",
    content: "Seeded complaint document for local development.\n",
    sniffedContentType: "text/plain",
    scanVerdict: "clean",
    uploadedBy: ownerUserId,
    now,
  });
  await seedCleanFile(env, firmDatabase, {
    matterId,
    folderId: pleadingsId,
    name: "Motion to Dismiss.txt",
    content: "Seeded motion document for local development.\n",
    sniffedContentType: "text/plain",
    scanVerdict: "clean",
    uploadedBy: ownerUserId,
    now,
  });
  await seedCleanFile(env, firmDatabase, {
    matterId,
    folderId: correspondenceId,
    name: "Client Letter.txt",
    content: "Seeded correspondence for local development.\n",
    sniffedContentType: "text/plain",
    scanVerdict: "unscanned",
    uploadedBy: ownerUserId,
    now,
  });
  await seedCleanFile(env, firmDatabase, {
    matterId,
    folderId: null,
    name: "Suspect Attachment.txt",
    content: "Seeded sample flagged by a re-scan for local development.\n",
    sniffedContentType: "text/plain",
    scanVerdict: "flagged",
    uploadedBy: ownerUserId,
    now,
  });
  await seedQuarantinedFile(firmDatabase, {
    matterId,
    folderId: correspondenceId,
    name: "Rejected Upload.bin",
    uploadedBy: ownerUserId,
    now,
  });

  return { matterId, fileCount: 5, created: true };
}

export function registerDevSeedRoute(app: DevSeedApp): void {
  app.post("/api/__dev/seed", requireDevSeedEmulation, async (c) => {
    const { firmId } = await ensureFirm(c.env);
    const ownerUserId = await ensureOwnerUser(c.env, firmId);
    const firmDatabase = firmDatabaseFor(c.env.FIRM_DATABASE, firmId);
    await ensureOwnerMember(firmDatabase, ownerUserId);
    const seeded = await ensureSeededData(c.env, firmDatabase, ownerUserId);

    return c.json({
      firmId,
      firmName: DEV_FIRM_NAME,
      matterId: seeded.matterId,
      fileCount: seeded.fileCount,
      // The known dev credentials — sign in at /login with these.
      credentials: { email: DEV_OWNER_EMAIL, password: DEV_OWNER_PASSWORD },
      signInEndpoint: "/api/auth/sign-in/email",
    });
  });
}
