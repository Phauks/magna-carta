import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { readImageFacts } from "@magna-carta/document-assembly/ooxml-image";
import { identifierField } from "@magna-carta/identifiers/field";
import type { TrustAccountId } from "@magna-carta/identifiers/types";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import { SaveStockRequest, SaveStockResponse } from "@magna-carta/trust/check-contract";
import {
  composeTrustCheckStockSave,
  readCurrentTrustCheckStock,
  readNextTrustCheckNumber,
  type TrustCheckStockSnapshot,
} from "@magna-carta/trust/checks";
import type { Bindings } from "../../../bindings.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import { decodeBase64, imageResponse, sha256Hex } from "../shared/image-bytes.ts";
import {
  commitTrustCheckWrite,
  trustCheckErrors,
  trustCheckOptions,
  trustCheckReadMeta,
  trustCheckStockRecord,
  trustCheckWriteMeta,
} from "./trust-check-support.ts";

// CHECK STOCK: where each field prints on an account's checks, saved as a new version each time, and
// the scan of a blank check the fields are placed over. The scan is shown behind the fields in the
// editor and never printed.

/** Where a stock's scan lives in the firm's bucket, under its account. */
const SCAN_PREFIX = "trust-check-scan/";

const trustAccountQuery = z.object({ trustAccountId: identifierField("trustAccount") });

const saveStockRoute = defineOpenAPIRoute(trustCheckWriteMeta("trust.saveCheckStock"), {
  method: "post",
  path: "/api/v1/trust/check-stock",
  description:
    "Saves a new version of the account's check stock: the page layout, where each field prints, a whole-page shift, the first number of the box in the printer, and optionally a scan of a blank check to place the fields over. No field may reach the MICR band.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: SaveStockRequest } }, required: true },
  },
  responses: {
    201: { description: "Saved", content: { "application/json": { schema: SaveStockResponse } } },
    400: trustCheckErrors[400],
    401: trustCheckErrors[401],
    403: trustCheckErrors[403],
    404: trustCheckErrors[404],
    409: trustCheckErrors[409],
    422: trustCheckErrors[422],
    429: trustCheckErrors[429],
  },
});

const scanRoute = defineOpenAPIRoute(trustCheckReadMeta("trust.checkStockScan"), {
  method: "get",
  path: "/api/v1/trust/check-stock/scan",
  description:
    "The scan of a blank check behind the account's current stock. Rides the session like every other read and is never publicly addressable.",
  request: { query: trustAccountQuery },
  responses: {
    200: {
      description: "The image",
      content: { "image/png": { schema: z.string() }, "image/jpeg": { schema: z.string() } },
    },
    401: trustCheckErrors[401],
    403: trustCheckErrors[403],
    404: trustCheckErrors[404],
    429: trustCheckErrors[429],
  },
});

export function registerTrustCheckStockRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // POST /api/v1/trust/check-stock
  app.openapi(
    { ...saveStockRoute, middleware: chokepointMiddleware(chokepoint, saveStockRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const accountId = request.trustAccountId as TrustAccountId;

      // The scan's bytes go to the bucket BEFORE the row that names them, so a row never points at
      // nothing. The key is the content's hash, so a retry writes the same object.
      let scan: { objectKey: string; sha256: string } | null | "keep" = "keep";
      if (request.scan === "remove") scan = null;
      else if (typeof request.scan === "object") {
        const bytes = decodeBase64(request.scan.imageBase64);
        const facts = bytes === undefined ? undefined : readImageFacts(bytes);
        if (bytes === undefined || facts === undefined || !facts.ok) {
          return problemJson(c, {
            type: "validation",
            title: "Not a usable picture",
            status: 422,
            detail: "The scan is not a readable PNG or JPEG.",
          });
        }
        const digest = await sha256Hex(bytes);
        const objectKey = `${SCAN_PREFIX}${accountId}/${digest}.${facts.value.extension}`;
        const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
        await bucket.put(objectKey, bytes, {
          sha256: digest,
          customMetadata: firmScopedObjectDimensions("check-stock-scan"),
        });
        scan = { objectKey, sha256: digest };
      }

      return commitTrustCheckWrite<z.infer<typeof SaveStockResponse>>(c, async (savedBy) => {
        let keptScan: { objectKey: string; sha256: string } | null = null;
        if (scan === "keep") {
          const current = await readCurrentTrustCheckStock(firm.firmDatabase, accountId);
          keptScan =
            current?.scanObjectKey != null && current.scanSha256 != null
              ? { objectKey: current.scanObjectKey, sha256: current.scanSha256 }
              : null;
        } else keptScan = scan;
        const composed = await composeTrustCheckStockSave(
          firm.firmDatabase,
          {
            trustAccountId: accountId,
            name: request.name,
            pageLayout: request.pageLayout,
            fields: request.fields,
            shiftXMils: request.shiftXMils,
            shiftYMils: request.shiftYMils,
            startingCheckNumber: request.startingCheckNumber,
            scan: keptScan,
            savedBy,
          },
          trustCheckOptions(),
        );
        const saved: TrustCheckStockSnapshot = {
          id: composed.stockId,
          trustAccountId: accountId,
          version: composed.version,
          name: request.name.trim(),
          pageLayout: request.pageLayout,
          fields: request.fields,
          shiftXMils: request.shiftXMils,
          shiftYMils: request.shiftYMils,
          startingCheckNumber: request.startingCheckNumber,
          scanObjectKey: keptScan?.objectKey ?? null,
          scanSha256: keptScan?.sha256 ?? null,
          savedBy,
          savedAt: new Date().toISOString(),
        };
        const nextCheckNumber = await readNextTrustCheckNumber(firm.firmDatabase, accountId, saved);
        return {
          write: composed.effect,
          body: { stock: trustCheckStockRecord(saved), nextCheckNumber },
        };
      });
    },
  );

  // GET /api/v1/trust/check-stock/scan
  app.openapi(
    { ...scanRoute, middleware: chokepointMiddleware(chokepoint, scanRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { trustAccountId } = c.req.valid("query");
      const stock = await readCurrentTrustCheckStock(
        firm.firmDatabase,
        trustAccountId as TrustAccountId,
      );
      const key = stock?.scanObjectKey ?? null;
      const contentType = key?.endsWith(".png") ? "image/png" : "image/jpeg";
      const response =
        key === null
          ? null
          : await imageResponse(resolveFirmBucket(c.env, firm.bucketName).bucket, key, contentType);
      if (response === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "This account's check stock has no scan.",
        });
      }
      return response;
    },
  );
}
