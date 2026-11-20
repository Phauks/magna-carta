import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { readImageFacts } from "@magna-carta/document-assembly/ooxml-image";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { InOutEntryId } from "@magna-carta/identifiers/types";
import { PickUpRequest } from "@magna-carta/in-out-log/contract";
import { recordPickUp } from "@magna-carta/in-out-log/entry-service";
import { readIdentityScan, type IdentityScanInput } from "@magna-carta/in-out-log/entry-statements";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type { Bindings } from "../../../bindings.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import { decodeBase64, imageResponse, sha256Hex } from "../shared/image-bytes.ts";
import {
  AcknowledgedResponse,
  commitEffect,
  entryIdParam,
  errors,
  serviceOptions,
  writeErrors,
  writeMeta,
} from "./shared.ts";

// PICK UP, and the picture of the ID the collector showed (owner, 2026-11-20).
//
// The picture travels with the pick up rather than as a second request, so a pick up and its proof
// are one act: the bytes go to the firm's bucket first, keyed by the entry and their own hash, and
// the row naming them commits in the pick up's own batch. A row therefore never names an object that
// is not there. When the batch is refused (somebody else picked it up first) the object is removed
// again unless a row already names it, because a picture of somebody's ID is not a thing to leave
// lying in a bucket.
//
// Seeing the picture is a write too: the view is audited before the bytes leave, as a transcript
// read is, and it takes the log's manage permission rather than its read, because an ID is the most
// sensitive thing this log holds.

const OBJECT_PREFIX = "in-out-identity-scan/";

const pickUpRoute = defineOpenAPIRoute(writeMeta("pickUp"), {
  method: "post",
  path: "/api/v1/in-out-entries/{entryId}/pick-up",
  description:
    "Pick Up: records who collected the entry, one of the people it is to or somebody else, " +
    "whether their identity was checked, and who handed it over. A picture of the ID they showed " +
    "may be saved with it, only where the ID was checked; it is read to be a PNG or a JPEG.",
  request: {
    headers: idempotencyKeyHeader,
    params: entryIdParam,
    body: { content: { "application/json": { schema: PickUpRequest } }, required: true },
  },
  responses: {
    200: {
      description: "Picked up",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    ...writeErrors,
  },
});

const identityScanRoute = defineOpenAPIRoute(
  {
    ...writeMeta("identityScan"),
    // A read of the bytes, recorded as it is served. Nothing changes, so a retry needs no key.
    idempotency: "optional",
  },
  {
    method: "get",
    path: "/api/v1/in-out-entries/{entryId}/identity-scan",
    description:
      "The picture of the ID shown at pick up, in the type it was read to be when saved. Each view " +
      "is audited before the bytes are sent. Never publicly addressable and never cached.",
    request: { params: entryIdParam },
    responses: {
      200: {
        description: "The picture",
        content: { "image/png": { schema: z.string() }, "image/jpeg": { schema: z.string() } },
      },
      401: errors[401],
      403: errors[403],
      404: errors[404],
      429: errors[429],
    },
  },
);

type PickUpApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

type StoredScan =
  | { readonly ok: true; readonly scan: IdentityScanInput }
  | { readonly ok: false; readonly detail: string };

async function storeIdentityScan(
  bucket: R2Bucket,
  entryId: string,
  imageBase64: string,
): Promise<StoredScan> {
  const bytes = decodeBase64(imageBase64);
  if (bytes === undefined) return { ok: false, detail: "The picture is not valid base64." };
  const facts = readImageFacts(bytes);
  if (!facts.ok) return { ok: false, detail: facts.detail };
  const digest = await sha256Hex(bytes);
  const objectKey = `${OBJECT_PREFIX}${entryId}/${digest}.${facts.value.extension}`;
  await bucket.put(objectKey, bytes, {
    sha256: digest,
    customMetadata: firmScopedObjectDimensions("in-out-identity-scan"),
  });
  return {
    ok: true,
    scan: {
      objectKey,
      sha256: digest,
      contentType: facts.value.contentType as IdentityScanInput["contentType"],
      sizeBytes: bytes.byteLength,
      widthPixels: facts.value.widthPixels,
      heightPixels: facts.value.heightPixels,
    },
  };
}

export function registerPickUpRoutes(app: PickUpApp, chokepoint: Chokepoint): void {
  // POST /api/v1/in-out-entries/{entryId}/pick-up
  app.openapi(
    { ...pickUpRoute, middleware: chokepointMiddleware(chokepoint, pickUpRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { entryId } = c.req.valid("param");
      const { identityScanBase64, ...request } = c.req.valid("json");
      if (identityScanBase64 !== undefined && !request.identityChecked) {
        return problemJson(c, {
          type: "validation",
          title: "In/Out Log request invalid",
          status: 422,
          detail: "a picture of an ID is saved only where the ID was checked",
        });
      }
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      let identityScan: IdentityScanInput | null = null;
      if (identityScanBase64 !== undefined) {
        const stored = await storeIdentityScan(bucket, entryId, identityScanBase64);
        if (!stored.ok) {
          return problemJson(c, {
            type: "validation",
            title: "Not a usable picture",
            status: 422,
            detail: stored.detail,
          });
        }
        identityScan = stored.scan;
      }
      const options = serviceOptions(userId);
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await recordPickUp(
          firm.firmDatabase,
          entryId as InOutEntryId,
          { ...request, identityScan },
          options,
        );
        return { body: { ok: true }, effect };
      });
      if (!outcome.ok) {
        if (identityScan !== null) {
          const kept = await readIdentityScan(
            firm.firmDatabase,
            entryId as InOutEntryId,
            options.visibility,
          );
          if (kept?.object_key !== identityScan.objectKey) {
            try {
              await bucket.delete(identityScan.objectKey);
            } catch {
              // Best effort: the refusal is the answer the desk needs; the object is only stray.
            }
          }
        }
        return outcome.problem;
      }
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // GET /api/v1/in-out-entries/{entryId}/identity-scan
  app.openapi(
    { ...identityScanRoute, middleware: chokepointMiddleware(chokepoint, identityScanRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { entryId } = c.req.valid("param");
      const options = serviceOptions(userId);
      const scan = await readIdentityScan(
        firm.firmDatabase,
        entryId as InOutEntryId,
        options.visibility,
      );
      const notFound = () =>
        problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No picture of an ID was saved with this entry.",
        });
      if (scan === undefined) return notFound();
      // Recorded before the bytes leave: who looked at which entry's ID, and nothing about the ID.
      const now = options.clock.now();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            domainAuditStatement(firm.firmDatabase, {
              event: "inOutLog.identityScan.viewed",
              subjectId: entryId,
              actorUserId: options.actorUserId,
              clock: { now: () => now },
              randomSource: cryptoRandomSource,
              metadata: { scanId: scan.id },
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const response = await imageResponse(bucket, scan.object_key, scan.content_type);
      return response ?? notFound();
    },
  );
}
