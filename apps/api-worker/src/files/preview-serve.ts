import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../bindings.ts";
import type { AppVariables } from "../http/chokepoint/ports.ts";
import { buildSafeDeliveryHeaders } from "./preview-headers.ts";
import { resolveFirmBucket } from "./firm-bucket.ts";
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

function frameAncestorsFor(filesOrigin: string): string {
  // Who may embed a preview rendition: ANY app subdomain under the shared parent of the files host —
  // firms get branded per-firm subdomains (<firm>.<parent>), and the cookieless delivery host is one
  // neutral sibling under the same parent. So frame-ancestors is a wildcard over the parent, not a
  // single fixed app host. This does not weaken authorization: the signed, firm-scoped token names a
  // single object, so a firm only ever holds tokens for its own files — the embedding origin was
  // never the gate. files.<parent> -> *.<parent> (strip the first label).
  return `https://*.${filesOrigin.replace(/^[^.]+\./, "")}`;
}

/**
 * The requesting page, when it is one of the app's own: an https origin on a subdomain of the same
 * parent the files host sits under (frame-ancestors names the same set), and never the files host
 * itself. Anything else, a missing Origin included, is granted nothing.
 */
export function readerOriginFor(origin: string | null, filesOrigin: string): string | null {
  if (origin === null) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.origin !== origin) return null;
  const parent = filesOrigin.replace(/^[^.]+\./, "");
  if (url.hostname === filesOrigin || !url.hostname.endsWith(`.${parent}`)) return null;
  return url.origin;
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
  app.get("/api/files-preview/:token", async (c) => {
    const filesOrigin = c.env.FILES_ORIGIN;
    const hostname = new URL(c.req.url).hostname;
    // Host guard: only answer on the files host. Any request to this path on any other host
    // returns the same bare 404 as a forged/expired token — the preview path has no legitimate use
    // outside the files host. No fall-through: the SPA shell must never be served in response to
    // this path, regardless of host.
    if (filesOrigin === undefined || hostname !== filesOrigin) {
      return previewNoLongerValid();
    }
    const token = c.req.param("token");
    const nowSeconds = Math.floor(Date.now() / 1000);
    const payload = await verifyPreviewDeliveryToken(c.env.AUTH_SECRET, token, nowSeconds);
    if (payload === null) return previewNoLongerValid();

    // Defense in depth: the signed verdict must be 'playable' to stream inline bytes. The grant only
    // ever mints inline tokens for a 'playable' verdict, so this is belt-and-suspenders that the
    // cookieless edge independently refuses to serve a token carrying any other verdict.
    if (payload.verdict !== "playable") return previewNoLongerValid();

    // Derive EVERY response header + bucket + key ONLY from the verified payload, never the URL/query.
    const frameAncestors = frameAncestorsFor(filesOrigin);
    const rangeHeader = c.req.header("range") ?? null;
    const ifRange = c.req.header("if-range") ?? null;

    // Resolve the object. The null-object race (reaped between mint and fetch) is guarded explicitly
    // so a .body deref never throws into the telemetry error boundary (which would emit an error_ id
    // on the untrusted edge).
    // Both the bucket and the key come from the signed payload and never from the URL, and they are
    // resolved together through files/firm-bucket.ts — the handle these bytes are read through is the
    // one that names payload.bucket, so a preview can only ever serve from the bucket its token named.
    // Any transient R2 infrastructure failure is caught here so it never propagates to the global
    // telemetry boundary (which would emit an error_ correlation id on the untrusted cookieless edge).
    // Infrastructure errors are indistinguishable from a reaped object from the caller's perspective.
    const { bucket } = resolveFirmBucket(c.env, payload.bucket);
    let head: R2Object | null;
    try {
      head = await bucket.head(payload.r2Key);
    } catch {
      return previewNoLongerValid();
    }
    if (head === null) return previewNoLongerValid();
    const totalSize = head.size;

    // If-Range conditional resume: when the client presents If-Range and it does not match the current
    // strong ETag, the object changed under the resume — ignore the Range and serve the full 200, so
    // the player re-fetches from a consistent body rather than splicing a stale range. Matching (or
    // absent) If-Range proceeds to the normal range/full path.
    const ifRangeMatches = ifRange === null || ifRange === head.httpEtag;
    const range = ifRangeMatches ? parseSingleByteRange(rangeHeader, totalSize) : null;

    // Header construction is guarded exactly like the R2 calls above: a header-unsafe stored
    // Content-Type (e.g. a CR/LF in a future transcode-rendition sniffed type) makes Headers.set
    // throw, and the cookieless edge must NEVER throw into the telemetry boundary (that would emit an
    // error_ id on the untrusted, unauthenticated host). decidePreview already degrades a
    // header-unsafe sniffed type to download-only so no inline token is minted; this is the
    // edge-local backstop that keeps the guarantee true even if a token is minted by other means.
    let headers: Headers;
    try {
      headers = buildSafeDeliveryHeaders({
        sniffedContentType: payload.sniffedContentType,
        frameAncestors,
        readerOrigin: readerOriginFor(c.req.header("origin") ?? null, filesOrigin),
      });
      headers.set("ETag", head.httpEtag);
    } catch {
      return previewNoLongerValid();
    }

    if (range === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${totalSize}`);
      return new Response(null, { status: 416, headers });
    }

    if (range === null) {
      let object: R2ObjectBody | null;
      try {
        object = await bucket.get(payload.r2Key);
      } catch {
        return previewNoLongerValid();
      }
      if (object === null) return previewNoLongerValid();
      headers.set("Content-Length", String(totalSize));
      return new Response(object.body, { status: 200, headers });
    }

    let object: R2ObjectBody | null;
    try {
      object = await bucket.get(payload.r2Key, {
        range: { offset: range.offset, length: range.length },
      });
    } catch {
      return previewNoLongerValid();
    }
    if (object === null) return previewNoLongerValid();
    headers.set("Content-Length", String(range.length));
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${totalSize}`,
    );
    return new Response(object.body, { status: 206, headers });
  });

  // Files-host catch-all: any path on the files host that did NOT match the preview route
  // (registered above) returns a bare 404 — no SPA shell, no HTML, no error_ id. The preview
  // origin is a locked-down delivery surface; only signed preview tokens have a valid use there.
  // This catch-all sits before the ASSETS fallthrough so a request to files.* for any non-preview
  // path can never be answered by the SPA. Reasoning home: docs/conventions/security.md.
  app.all("*", (c, next) => {
    const filesOrigin = c.env.FILES_ORIGIN;
    const hostname = new URL(c.req.url).hostname;
    if (filesOrigin !== undefined && hostname === filesOrigin) {
      return previewNoLongerValid();
    }
    return next();
  });
}
