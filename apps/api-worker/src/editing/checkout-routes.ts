import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { EffectStatement } from "@magna-carta/data-access/effect-batch";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import {
  getActiveExclusiveLock,
  getCheckoutById,
  getOpenCheckout,
  insertDocumentCheckoutStatement,
  setCheckoutStatusStatement,
} from "@magna-carta/file-manager/checkout-statements";
import { initiateCheckin, restoreVersion } from "@magna-carta/file-manager/file-service";
import {
  markVersionReconciledStatement,
  setFileEditStateStatement,
} from "@magna-carta/file-manager/file-statements";
import {
  getConflictPendingVersions,
  getCurrentCleanVersion,
} from "@magna-carta/file-manager/queries";
import { FileManagerValidationError } from "@magna-carta/file-manager/validation";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { DocumentCheckoutId, FileId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { identifierField, identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { copyObjectPreservingDimensions } from "../files/object-stamping.ts";
import { presignerForEnv } from "../files/presigner-wiring.ts";

// How long a checkout's download URL is valid. Short — the client fetches the working copy promptly;
// the offline edit then lives on the client until check-in.
const CHECKOUT_DOWNLOAD_TTL_SECONDS = 300;
// How long the check-in's presigned PUT is valid (the client uploads the returning bytes promptly).
const CHECKIN_UPLOAD_TTL_SECONDS = 3600;
// The check-in session's lifetime: an abandoned (never-uploaded) check-in session is aborted by the
// stale-pending sweep after this window, abandoning its pending version.
const CHECKIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
// The returning bytes are fully untrusted and re-sniffed at the ingest gate, so the PUT is signed with a
// neutral content type the client uploads under — never a client-asserted type the host would trust.
const CHECKIN_UPLOAD_CONTENT_TYPE = "application/octet-stream";

const CheckoutRequest = z
  .object({
    // The kind of claim. 'offline_working_copy' (the default) is the optimistic, never-block offline
    // copy — many may be out at once. 'exclusive' is an opt-in single-holder lock that forces every
    // other member's edit launch read-only until released.
    lockType: z.enum(["offline_working_copy", "exclusive"]).optional(),
  })
  .openapi("CheckoutRequest");

const CheckoutResponse = z
  .object({
    // The opaque handle for this checkout — presented on check-in to reconcile against its base.
    checkoutId: z.string(),
    // A short-TTL presigned GET the client downloads the working copy directly from R2 (the bytes
    // never flow through the Worker).
    presignedGetUrl: z.string(),
  })
  .openapi("CheckoutResponse");

// Takes an offline working copy of a document: records a document_checkout against the current
// committed version (the base the eventual check-in reconciles against) and returns a presigned GET of
// that version's bytes. The optimistic model never blocks — multiple offline copies may be out at once;
// each check-in reconciles independently against its own base. Audited.
export const checkoutMeta: RouteMeta = {
  operationId: "documents.checkout",
  surface: "app",
  authenticated: true,
  permission: "documents:checkout",
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const checkoutRoute = defineOpenAPIRoute(checkoutMeta, {
  method: "post",
  path: "/api/v1/documents/{fileId}/checkout",
  request: {
    params: z.object({ fileId: identifierPathParam("file", "fileId") }),
    body: { content: { "application/json": { schema: CheckoutRequest } }, required: false },
  },
  description:
    "Take a checkout of a document: an optimistic offline working copy (default) or an opt-in exclusive lock. Records a checkout against the current version and returns a short-lived presigned download URL for that version's bytes.",
  responses: {
    200: {
      description: "The checkout handle and the presigned download URL",
      content: { "application/json": { schema: CheckoutResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks documents:checkout",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The file does not exist in this firm, or has no committed version to check out",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "An exclusive lock was requested but one is already held",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const CheckinRequest = z
  .object({
    // The checkout this working copy was taken under — its base is what the returning bytes reconcile
    // against.
    checkoutId: identifierField("documentCheckout"),
  })
  .openapi("CheckinRequest");

const CheckinResponse = z
  .object({
    // The pending version the returning bytes land as (it stays invisible until the ingest gate clears
    // it and reconciliation routes it to current or a conflicting copy).
    versionId: z.string(),
    // The server-derived R2 key the presigned PUT targets (the client cannot choose it).
    key: z.string(),
    method: z.literal("PUT"),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
  })
  .openapi("CheckinResponse");

// Returns an offline working copy: validates the presented checkout, mints a pending version (carrying
// the checkout id) plus an upload session, and returns a presigned PUT into the quarantine-ingest
// pipeline. The returning bytes are never opened by the host before the gate clears them; once clean,
// they reconcile against the file's current version (fast-forward or a flagged conflicting copy).
// Audited; governed by the same documents:checkout capability as taking the copy out.
export const checkinMeta: RouteMeta = {
  operationId: "documents.checkin",
  surface: "app",
  authenticated: true,
  permission: "documents:checkout",
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const checkinRoute = defineOpenAPIRoute(checkinMeta, {
  method: "post",
  path: "/api/v1/documents/{fileId}/checkin",
  request: {
    params: z.object({ fileId: identifierPathParam("file", "fileId") }),
    body: { content: { "application/json": { schema: CheckinRequest } }, required: true },
  },
  description:
    "Return an offline working copy: validates the checkout, mints a pending version, and returns a " +
    "presigned PUT for the edited bytes. The bytes route the quarantine ingest, then reconcile against " +
    "the document's current version (fast-forward or a flagged conflicting copy).",
  responses: {
    200: {
      description: "The pending check-in version and the presigned upload URL",
      content: { "application/json": { schema: CheckinResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks documents:checkout",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No such file in this firm, or no active offline checkout of it with that id",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const ReconcileRequest = z
  .object({
    // Which copy becomes authoritative: keep the current version (discard the offline edit), promote
    // the incoming offline edit to current, or keep both (current unchanged, the edit retained in
    // history). The conflicting copy is retained forever regardless.
    keep: z.enum(["current", "incoming", "both"]),
    // An optional human note recorded with the resolution (e.g. why a side was chosen).
    resolvedNote: z.string().min(1).optional(),
  })
  .openapi("ReconcileRequest");

const ReconcileResponse = z
  .object({
    status: z.literal("reconciled"),
    // The conflicting copy that was resolved (still retained in history).
    reconciledVersionId: z.string(),
    // The file's current version after the resolution (advanced only when keep='incoming').
    currentVersionId: z.string(),
  })
  .openapi("ReconcileResponse");

// Resolves a divergent check-in: a human picks which copy is authoritative. Flips the conflicting copy
// conflict_pending -> reconciled (clearing the document's reconciliation flag), promotes it to current
// when keep='incoming', releases the reconciling checkout, and audits document.reconciled with the
// actor and the chosen resolution. The conflicting copy is retained forever regardless of the choice.
export const reconcileMeta: RouteMeta = {
  operationId: "documents.reconcile",
  surface: "app",
  authenticated: true,
  permission: "documents:reconcile",
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const reconcileRoute = defineOpenAPIRoute(reconcileMeta, {
  method: "post",
  path: "/api/v1/documents/{fileId}/reconcile",
  request: {
    params: z.object({ fileId: identifierPathParam("file", "fileId") }),
    body: { content: { "application/json": { schema: ReconcileRequest } }, required: true },
  },
  description:
    "Resolve a divergent check-in by choosing which copy is authoritative (keep the current version, " +
    "promote the incoming offline edit, or keep both). Flags the conflicting copy reconciled, releases " +
    "the checkout, and audits the resolution. The conflicting copy is retained.",
  responses: {
    200: {
      description: "The conflict was resolved",
      content: { "application/json": { schema: ReconcileResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks documents:reconcile",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No such file in this firm, or it has nothing awaiting reconciliation",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const ForceReleaseResponse = z
  .object({
    status: z.literal("released"),
    // The checkout/lock that was released and the member it was taken from (the displaced holder).
    releasedCheckoutId: z.string(),
    displacedHolderId: z.string(),
  })
  .openapi("ForceReleaseResponse");

// Force-releases another member's lock on a document — an exclusive lock, or a stranded offline
// checkout (e.g. a deactivated member's). Releases the active checkout, frees the document
// (edit_state -> idle), and audits both the actor and the displaced holder. The conflicting/version
// state is untouched: this only clears the hold.
export const forceReleaseMeta: RouteMeta = {
  operationId: "documents.forceRelease",
  surface: "app",
  authenticated: true,
  permission: "documents:forceReleaseLock",
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const forceReleaseRoute = defineOpenAPIRoute(forceReleaseMeta, {
  method: "post",
  path: "/api/v1/documents/{fileId}/force-release",
  request: { params: z.object({ fileId: identifierPathParam("file", "fileId") }) },
  description:
    "Force-release another member's lock on a document (an exclusive lock or a stranded offline " +
    "checkout): releases the active checkout, frees the document, and audits both the actor and the " +
    "displaced holder.",
  responses: {
    200: {
      description: "The lock was released",
      content: { "application/json": { schema: ForceReleaseResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks documents:forceReleaseLock",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No such file in this firm, or it has no active lock to release",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerDocumentCheckoutRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...checkoutRoute, middleware: chokepointMiddleware(chokepoint, checkoutRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const memberId = requireChokepointUserId(c);
      const bucket = resolveFirmBucket(c.env, firm.bucketName).bucketName;
      const fileId = c.req.param("fileId") as FileId;

      const lockType = c.req.valid("json")?.lockType ?? "offline_working_copy";

      const version = await getCurrentCleanVersion(firm.firmDatabase, fileId);
      if (version === undefined) {
        return problemJson(c, {
          type: "not-found",
          status: 404,
          title: "Not found",
          detail: "No such document with a committed version to check out.",
        });
      }

      // An exclusive lock is single-holder: refuse a second one while one is active. Offline working
      // copies are optimistic and never block, so they skip this check.
      if (lockType === "exclusive") {
        const existing = await getActiveExclusiveLock(firm.firmDatabase, fileId);
        if (existing !== undefined) {
          return problemJson(c, {
            type: "conflict",
            status: 409,
            title: "Already locked",
            detail: "This document already has an active exclusive lock.",
          });
        }
      }

      const checkoutId = newIdentifier("documentCheckout");
      const now = new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertDocumentCheckoutStatement(firm.firmDatabase, {
              id: checkoutId,
              fileId,
              holderMemberId: memberId,
              lockType,
              baseVersionId: version.id,
              acquiredAt: now,
            }),
            // An exclusive lock marks the document checked_out (others launch read-only); an offline
            // working copy is optimistic and leaves the editing posture untouched.
            ...(lockType === "exclusive"
              ? [setFileEditStateStatement(firm.firmDatabase, fileId, "checked_out", now)]
              : []),
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "document.checkout_opened",
              actorUserId: memberId,
              subjectId: fileId,
              metadata: { lockType },
              now,
            }),
          ],
          // Domain event — a working copy / exclusive lock was taken (subscribers: audit, notifications).
          outboxMessages: [
            { topic: "document.checked_out", payload: { fileId, checkoutId, lockType } },
          ],
        },
        { now: () => now },
      );

      const presignedGetUrl = await presignerForEnv(c.env).presignGet(
        bucket,
        version.r2Key,
        CHECKOUT_DOWNLOAD_TTL_SECONDS,
      );
      return c.json({ checkoutId, presignedGetUrl }, 200);
    },
  );

  app.openapi(
    { ...checkinRoute, middleware: chokepointMiddleware(chokepoint, checkinRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const memberId = requireChokepointUserId(c);
      const bucket = resolveFirmBucket(c.env, firm.bucketName).bucketName;
      const fileId = c.req.param("fileId") as FileId;
      const { checkoutId } = c.req.valid("json");

      // The checkout must be an active offline working copy of THIS file. A released/reconciling/stale
      // checkout, a foreign-file checkout, or an unknown id is not a valid return target → not-found
      // (never leaking whether the id exists in another firm/file).
      const checkout = await getCheckoutById(firm.firmDatabase, checkoutId as DocumentCheckoutId);
      if (
        checkout === undefined ||
        checkout.fileId !== fileId ||
        checkout.lockType !== "offline_working_copy" ||
        checkout.status !== "active"
      ) {
        return problemJson(c, {
          type: "not-found",
          status: 404,
          title: "Not found",
          detail: "No active offline checkout of this document with that id.",
        });
      }

      const now = () => new Date().toISOString();
      let initiated: Awaited<ReturnType<typeof initiateCheckin>>;
      try {
        initiated = await initiateCheckin(
          firm.firmDatabase,
          {
            fileId,
            checkoutId: checkoutId as DocumentCheckoutId,
            declaredSize: null,
            declaredContentType: null,
            uploadedBy: memberId,
            expiresAt: new Date(Date.now() + CHECKIN_SESSION_TTL_MS).toISOString(),
          },
          { clock: { now }, actorUserId: memberId },
        );
      } catch (caught) {
        // The document went away while the offline copy was out — deleted, or never there at all.
        // Both answer not-found, matching every read of the same file; the copy stays on the client
        // and an undelete makes check-in possible again.
        if (
          caught instanceof FileManagerValidationError &&
          (caught.code === "file-deleted" || caught.code === "unknown-file")
        ) {
          return problemJson(c, {
            type: "not-found",
            status: 404,
            title: "Not found",
            detail: "No such document in this firm.",
          });
        }
        throw caught;
      }
      await commitEffectBatch(firm.firmDatabase, initiated.effect, { now });

      const presigned = await presignerForEnv(c.env).presignPut(
        bucket,
        initiated.r2Key,
        CHECKIN_UPLOAD_CONTENT_TYPE,
        CHECKIN_UPLOAD_TTL_SECONDS,
        initiated.dimensions,
      );
      return c.json(
        {
          versionId: initiated.versionId,
          key: initiated.r2Key,
          method: "PUT" as const,
          url: presigned.url,
          // The presigner's set exactly: it already carries the content type it signed, and a
          // second spelling beside it is merged by the browser into one doubled value the
          // signature does not cover (the defect routes/uploads.ts records).
          headers: presigned.headers,
        },
        200,
      );
    },
  );

  app.openapi(
    { ...reconcileRoute, middleware: chokepointMiddleware(chokepoint, reconcileRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const memberId = requireChokepointUserId(c);
      const fileId = c.req.param("fileId") as FileId;
      const { keep, resolvedNote } = c.req.valid("json");

      // The document's reconciliation flag IS its conflict_pending version(s). Resolve EVERY one in a
      // single pass — concurrent offline copies can diverge, so resolving only the newest would orphan
      // the rest as permanently-unreconcilable. `primary` (newest) is the copy keep='incoming' promotes.
      const conflicts = await getConflictPendingVersions(firm.firmDatabase, fileId);
      const primary = conflicts[0];
      if (primary === undefined) {
        return problemJson(c, {
          type: "not-found",
          status: 404,
          title: "Not found",
          detail: "No document awaiting reconciliation with that id.",
        });
      }

      const now = () => new Date().toISOString();
      const statements: EffectStatement[] = [];
      const outboxMessages: OutboxMessage[] = [
        { topic: "document.reconciled", payload: { fileId, versionId: primary.id, keep } },
      ];

      // keep='incoming' promotes the chosen offline edit by cutting it FORWARD as a new current version
      // (never regressing the monotonic current pointer): copy the conflicting copy's bytes into a fresh
      // version that becomes current. 'current'/'both' leave current untouched. The conflicting copies
      // are retained forever regardless.
      if (keep === "incoming") {
        const restored = await restoreVersion(
          firm.firmDatabase,
          { fileId, sourceVersionId: primary.id, uploadedBy: memberId },
          { clock: { now }, actorUserId: memberId },
          async (fromKey, toKey) => {
            const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
            await copyObjectPreservingDimensions(bucket, fromKey, toKey, "working-document");
          },
        );
        statements.push(...restored.effect.statements);
        outboxMessages.push(...restored.effect.outboxMessages);
      }

      // Mark every conflicting copy reconciled (clears the flag) and release each one's reconciling
      // checkout — leaving none orphaned. The copies are RETAINED (never deleted) and keep their metered
      // bytes by design: a conflicting copy is legal-hold-safe, so its storage counts as real storage.
      // Resolution does not decrement the meter; the daily storage reconciliation is the source of truth.
      for (const conflict of conflicts) {
        statements.push(markVersionReconciledStatement(firm.firmDatabase, conflict.id));
        if (conflict.checkoutId !== null) {
          statements.push(
            setCheckoutStatusStatement(firm.firmDatabase, conflict.checkoutId, "released"),
          );
        }
      }
      statements.push(
        insertAuditLogStatement(firm.firmDatabase, {
          id: newIdentifier("auditLog"),
          event: "document.reconciled",
          actorUserId: memberId,
          subjectId: fileId,
          metadata: {
            keep,
            resolvedCount: conflicts.length,
            ...(resolvedNote !== undefined ? { resolvedNote } : {}),
          },
          now: now(),
        }),
      );
      await commitEffectBatch(firm.firmDatabase, { statements, outboxMessages }, { now });

      const currentVersion = await getCurrentCleanVersion(firm.firmDatabase, fileId);
      return c.json(
        {
          status: "reconciled" as const,
          reconciledVersionId: primary.id,
          currentVersionId: currentVersion?.id ?? primary.id,
        },
        200,
      );
    },
  );

  app.openapi(
    { ...forceReleaseRoute, middleware: chokepointMiddleware(chokepoint, forceReleaseRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const memberId = requireChokepointUserId(c);
      const fileId = c.req.param("fileId") as FileId;

      // Release the active exclusive lock if one is held; otherwise a stranded offline checkout (the
      // deactivated-member cleanup). No active lock of either kind → nothing to release.
      const lock =
        (await getActiveExclusiveLock(firm.firmDatabase, fileId)) ??
        (await getOpenCheckout(firm.firmDatabase, fileId));
      if (lock === undefined) {
        return problemJson(c, {
          type: "not-found",
          status: 404,
          title: "Not found",
          detail: "No active lock to release on this document.",
        });
      }

      const now = () => new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            setCheckoutStatusStatement(firm.firmDatabase, lock.id, "released"),
            // Only an exclusive lock held the editing posture (checked_out); releasing it frees the
            // document to idle. An offline working copy never set edit_state, so its release leaves it
            // untouched (it may be 'coediting' for others — do not clobber that).
            ...(lock.lockType === "exclusive"
              ? [setFileEditStateStatement(firm.firmDatabase, fileId, "idle", now())]
              : []),
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "document.lock_force_released",
              actorUserId: memberId,
              subjectId: fileId,
              // Both parties are recorded: the actor (actorUserId) and the displaced holder.
              metadata: { displacedHolder: lock.holderMemberId, lockType: lock.lockType },
              now: now(),
            }),
          ],
          // Domain event — a lock/checkout was released (subscribers: audit, notifications).
          outboxMessages: [
            {
              topic: "document.lock_released",
              payload: {
                fileId,
                checkoutId: lock.id,
                displacedHolder: lock.holderMemberId,
                lockType: lock.lockType,
              },
            },
          ],
        },
        { now },
      );

      return c.json(
        {
          status: "released" as const,
          releasedCheckoutId: lock.id,
          displacedHolderId: lock.holderMemberId,
        },
        200,
      );
    },
  );
}
