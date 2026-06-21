import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../app.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { buildSafeDeliveryHeaders } from "./preview-headers.ts";
import { verifyPreviewDeliveryToken } from "./preview-token.ts";

// Parse a single byte range against the object size. null = no Range header (serve the full body);
// "unsatisfiable" = malformed, multi-range, or out-of-bounds (-> 416). Only the simple single-range
// forms a media element issues for seeking are honored.
export function parseSingleByteRange(
  rangeHeader: string | null,
  totalSize: number,
): { offset: number; length: number } | "unsatisfiable" | null {
  if (rangeHeader === null || rangeHeader === "") return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (match === null) return "unsatisfiable";
  const startRaw = match[1];
  const endRaw = match[2];
  if (startRaw === "" && endRaw === "") return "unsatisfiable";
  let offset: number;
  let endInclusive: number;
  if (startRaw === "") {
    // Suffix range: last N bytes.
    const suffix = Number(endRaw);
    if (suffix <= 0) return "unsatisfiable";
    offset = Math.max(0, totalSize - suffix);
    endInclusive = totalSize - 1;
  } else {
    offset = Number(startRaw);
    endInclusive = endRaw === "" ? totalSize - 1 : Number(endRaw);
  }
  if (offset < 0 || offset >= totalSize || endInclusive < offset) return "unsatisfiable";
  if (endInclusive > totalSize - 1) endInclusive = totalSize - 1;
  return { offset, length: endInclusive - offset + 1 };
}

function appOriginFor(filesOrigin: string): string {
  // The app origin frame-ancestors entry: the trusted sibling host. files.<rest> -> app.<rest>.
  return `https://${filesOrigin.replace(/^files\./, "app.")}`;
}

// A minimal, non-JSON edge response for tamper/expiry/missing-object. 404 is used UNIFORMLY for every
// invalid-token and missing-object case (no 410 for verified-but-expired) so the edge never exposes an
// expiry/existence oracle: an unauthenticated caller cannot distinguish "tampered", "expired", and
// "reaped" from one another. NO error_ id, NO correlation surface, but still attachment + nosniff so
// even this body cannot be coaxed into an active document. Reasoning home: docs/conventions/security.md.
function previewNoLongerValid(): Response {
  return new Response("This preview link is no longer valid.", {
    status: 404,
    headers: {
      "Content-Disposition": "attachment",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

export function registerPreviewServeRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
): void {
  // A bare, host-guarded route — deliberately OUTSIDE the chokepoint (no session exists on the
  // cookieless host; authorization already happened at the API origin and is carried by the signed
  // token). It must register before the /api/v1 routes and before the ASSETS fallthrough, match only
  // on the files host, and return terminally — a files.* request that is not this path must never
  // fall through to the SPA shell. Reasoning home: docs/conventions/security.md.
  app.get("/api/files-preview/:token", async (c, next) => {
    const filesOrigin = c.env.FILES_ORIGIN;
    const hostname = new URL(c.req.url).hostname;
    // Host guard: only answer on the files host. Any other host falls through via next() so the
    // /api/v1 routes and ASSETS handler can answer normally — the SPA shell is never served here.
    if (filesOrigin === undefined || hostname !== filesOrigin) {
      return next();
    }
    const token = c.req.param("token");
    const nowSeconds = Math.floor(Date.now() / 1000);
    const payload = await verifyPreviewDeliveryToken(c.env.AUTH_SECRET, token, nowSeconds);
    if (payload === null) return previewNoLongerValid();

    // Derive EVERY response header + bucket + key ONLY from the verified payload, never the URL/query.
    const appOrigin = appOriginFor(filesOrigin);
    const rangeHeader = c.req.header("range") ?? null;
    const ifRange = c.req.header("if-range") ?? null;

    // Resolve the object. The null-object race (reaped between mint and fetch) is guarded explicitly
    // so a .body deref never throws into the telemetry error boundary (which would emit an error_ id
    // on the untrusted edge).
    // Today, there is exactly one R2 binding (c.env.R2), so bytes are fetched via the signed, opaque
    // payload.r2Key. The payload.bucket field is a forward seam for per-firm buckets: when multiple
    // R2 bindings exist in the future, select the binding by payload.bucket here.
    const head = await c.env.R2.head(payload.r2Key);
    if (head === null) return previewNoLongerValid();
    const totalSize = head.size;

    // If-Range conditional resume: when the client presents If-Range and it does not match the current
    // strong ETag, the object changed under the resume — ignore the Range and serve the full 200, so
    // the player re-fetches from a consistent body rather than splicing a stale range. Matching (or
    // absent) If-Range proceeds to the normal range/full path.
    const ifRangeMatches = ifRange === null || ifRange === head.httpEtag;
    const range = ifRangeMatches ? parseSingleByteRange(rangeHeader, totalSize) : null;

    const headers = buildSafeDeliveryHeaders({
      sniffedContentType: payload.sniffedContentType,
      appOrigin,
    });
    headers.set("ETag", head.httpEtag);

    if (range === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${totalSize}`);
      return new Response(null, { status: 416, headers });
    }

    if (range === null) {
      const object = await c.env.R2.get(payload.r2Key);
      if (object === null) return previewNoLongerValid();
      headers.set("Content-Length", String(totalSize));
      return new Response(object.body, { status: 200, headers });
    }

    const object = await c.env.R2.get(payload.r2Key, {
      range: { offset: range.offset, length: range.length },
    });
    if (object === null) return previewNoLongerValid();
    headers.set("Content-Length", String(range.length));
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${totalSize}`,
    );
    return new Response(object.body, { status: 206, headers });
  });
}
