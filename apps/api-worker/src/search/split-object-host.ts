import type { OpenAPIHono } from "@hono/zod-openapi";
import { readReviewSet } from "@magna-carta/discovery/review-set-statements";
import type { MatterId, ReviewSetId } from "@magna-carta/identifiers/types";
import { matterScopedObjectDimensions } from "@magna-carta/object-dimensions";
import type { Context } from "hono";
import type { Bindings } from "../bindings.ts";
import type { AppVariables } from "../http/chokepoint/ports.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import {
  authorizedSplitPrefix,
  verifySplitObjectToken,
  type SplitObjectTokenClaims,
} from "./split-object-token.ts";

// THE SPLIT-OBJECT HOST — the R2 side of the search engine's range reader.
//
// The keyword engine is native Rust in a Container (containers/search). A Container here has no R2
// credentials and no egress, so it reads and writes its splits by calling this host: the engine issues
// an ordinary HTTP request to a non-routable internal host, the search worker's container outbound
// interception forwards it over a service binding into this Worker, and this handler turns it into one
// R2 operation. Cookieless and token-guarded, OUTSIDE the chokepoint — the same shape as the WOPI
// callback surface (apps/api-worker/src/editing/wopi-host.ts), for the same reason: the caller is a
// container, not a browser session.
//
// THE ONE RULE THIS FILE EXISTS TO KEEP: it issues exactly the read the engine asked for, and nothing
// else. No prefetch, no read-ahead, no whole-object fetch behind a range request, no buffering of a
// body it is only passing through. Every ranged read is an R2 Class B operation in a deployment and the
// engine's read count is what it was measured on (crates/search-eval), so a helpful optimization here
// would silently change the cost model the split format was designed around. An unranged GET is
// therefore REFUSED rather than served whole: making the expensive shape inexpressible is what keeps it
// from appearing by accident.

// The internal host the engine addresses. It never resolves on the public internet — the container's
// outbound interception catches it (apps/search-worker/src/search-index-container.ts) and forwards it
// here. Naming it a non-routable `.internal` host makes "this is not real egress" obvious at both ends.
// It MUST stay in sync with the search worker's interception table: change one and change the other in
// the same commit.
export const SPLIT_OBJECT_HOST = "splits.magna-carta.internal";

// The path prefix the engine addresses inside that host. The split's R2 key follows it verbatim.
export const SPLIT_OBJECT_PATH_PREFIX = "/search-objects/";

// The header the engine presents its capability token in. A header rather than a query parameter so a
// token never lands in an access log line beside the key it authorizes.
export const SPLIT_OBJECT_TOKEN_HEADER = "x-mc-split-token";

// The split's total size, answered on a HEAD. It duplicates content-length deliberately: a bodyless
// response is one a runtime may rewrite the content-length of, and a reader that cannot learn the true
// length cannot find the footer at the tail. Kept in sync with the engine's reader
// (containers/search/src/object_client.rs), which reads this first and falls back to content-length.
export const SPLIT_OBJECT_SIZE_HEADER = "x-mc-split-size";

type SplitObjectContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

// A parsed `Range: bytes=<first>-<last>` header. Only the single closed range is accepted: the engine
// asks for one exact span per read (crates/search-core's SplitDirectory), so an open-ended or
// multi-range request is not something the engine emits and is refused rather than interpreted.
export interface ParsedByteRange {
  readonly offset: number;
  readonly length: number;
}

export function parseSingleByteRange(header: string | null): ParsedByteRange | null {
  if (header === null) return null;
  const match = /^bytes=(\d+)-(\d+)$/.exec(header.trim());
  if (match === null) return null;
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first) return null;
  return { offset: first, length: last - first + 1 };
}

// The object key a request names, or null when it names something this token cannot reach. Two checks,
// and both have to hold: the key sits under the prefix the token's corpus derives, and it contains no
// traversal segment that could climb back out of it. A key is otherwise taken verbatim — the engine
// reads the keys the catalog gave it, and those are derived (@magna-carta/search/split), never typed.
export function authorizedObjectKey(
  pathname: string,
  claims: SplitObjectTokenClaims,
): string | null {
  if (!pathname.startsWith(SPLIT_OBJECT_PATH_PREFIX)) return null;
  const key = decodeURIComponent(pathname.slice(SPLIT_OBJECT_PATH_PREFIX.length));
  if (key === "" || key.includes("..") || key.startsWith("/")) return null;
  return key.startsWith(authorizedSplitPrefix(claims)) ? key : null;
}

// Every refusal on this surface answers the same way and says nothing. The caller is our own engine, so
// a detailed error helps no legitimate caller, while a surface that distinguishes "wrong token" from
// "no such split" tells anyone who reaches it which keys exist.
function refuse(): Response {
  return new Response(null, { status: 404 });
}

async function authorize(c: SplitObjectContext): Promise<SplitObjectTokenClaims | null> {
  const token = c.req.header(SPLIT_OBJECT_TOKEN_HEADER);
  if (token === undefined || token === "") return null;
  return verifySplitObjectToken(token, c.env, Date.now());
}

// The firm's bucket, resolved from the VERIFIED token's firm and nowhere else. Going through
// resolveFirmBucket keeps this path on the one decision every other path uses about which bucket holds
// a firm's bytes (apps/api-worker/src/files/firm-bucket.ts); a firm with no provisioned bucket resolves to
// null here and the surface refuses, rather than reading through a bound handle the firm does not own.
async function firmBucketFor(
  c: SplitObjectContext,
  claims: SplitObjectTokenClaims,
): Promise<R2Bucket | null> {
  const firm = await c.env.DB_CONTROL.prepare("SELECT bucket_name FROM firm WHERE id = ?1")
    .bind(claims.firmId)
    .first<{ bucket_name: string | null }>();
  if (firm === null || firm.bucket_name === null) return null;
  return resolveFirmBucket(c.env, firm.bucket_name).bucket;
}

// THE MATTER A SPLIT'S OBJECT IS FILED UNDER, which is not the corpus once there are two kinds of one.
//
// Every object in a firm's bucket carries its matter as a dimension: it is what the storage meter
// counts against, what a lifecycle rule and a legal hold are expressed over, and what a reader of the
// bucket places an object by. For a matter corpus the corpus identifier IS the matter and the two
// coincide. For a REVIEW-SET corpus they do not, and stamping the review set's handle into the matter
// dimension would file a firm's discovery bytes under a matter that does not exist.
//
// Resolved from the firm's own database rather than carried on the token, and that is the safer of the
// two: a claim is something a mint site can get wrong once and every object thereafter is mis-filed,
// where a read of the review set's own row cannot disagree with the review set. It costs one indexed
// read on the WRITE path only — a split is published once per document, and no query pays it.
async function matterDimensionFor(
  c: SplitObjectContext,
  claims: SplitObjectTokenClaims,
): Promise<MatterId | null> {
  if (claims.corpusKind !== "reviewSet") return claims.corpusId as MatterId;
  const database = firmDatabaseFor(c.env.FIRM_DATABASE, claims.firmId);
  const reviewSet = await readReviewSet(database, claims.corpusId as ReviewSetId);
  // A review set that is not there is not a review set whose bytes we file somewhere plausible: an
  // unstamped or wrongly-stamped object is one nothing can place, and the repair is a metadata rewrite
  // of the whole bucket. Refusing the write is recoverable; a mis-filed object is not.
  return reviewSet?.matter_id ?? null;
}

export function registerSplitObjectHostRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
): void {
  // GET and HEAD share one route, because Hono resolves a HEAD against the GET handler and a separate
  // HEAD registration would simply never run. The two are distinguished inside, on the method:
  //
  //   HEAD — the split's total size, which is what lets the engine's reader locate the footer from the
  //          tail before it reads anything else. One R2 head, no body.
  //   GET  — one range, streamed straight through, with R2 asked for exactly the offset and length the
  //          engine named, so the bytes that leave storage are the bytes the engine walks. A request
  //          with no `Range` is refused rather than served whole (the rule at the top of this file).
  app.get(`${SPLIT_OBJECT_PATH_PREFIX}*`, async (c) => {
    const claims = await authorize(c);
    if (claims === null) return refuse();
    const key = authorizedObjectKey(new URL(c.req.url).pathname, claims);
    if (key === null) return refuse();

    if (c.req.method === "HEAD") {
      const bucket = await firmBucketFor(c, claims);
      if (bucket === null) return refuse();
      const head = await bucket.head(key);
      if (head === null) return refuse();
      // The size travels in a header of our own as well as in content-length: a runtime is entitled to
      // rewrite content-length on a bodyless response, and the reader cannot locate a footer without
      // the real length. One of the two always survives, and the reader prefers ours.
      return new Response(null, {
        status: 200,
        headers: {
          "content-length": String(head.size),
          [SPLIT_OBJECT_SIZE_HEADER]: String(head.size),
          "accept-ranges": "bytes",
        },
      });
    }

    const range = parseSingleByteRange(c.req.header("range") ?? null);
    if (range === null) {
      return new Response(null, { status: 416, headers: { "accept-ranges": "bytes" } });
    }

    const bucket = await firmBucketFor(c, claims);
    if (bucket === null) return refuse();
    const object = await bucket.get(key, { range });
    if (object === null || object.body === null) return refuse();
    // Streamed, never read into a buffer here: the body is a pass-through and the Worker holds none of
    // it (the bulk-bytes rule in apps/api-worker/CLAUDE.md).
    return new Response(object.body, {
      status: 206,
      headers: {
        "content-length": String(Math.min(range.length, object.size)),
        "content-type": "application/octet-stream",
      },
    });
  });

  // PUT — publish a split. The only write on this surface, and it is gated on the token's write claim,
  // so the token a query carries cannot reach it. The body streams into R2 with the object's dimensions
  // stamped from the token's own corpus, never from anything the request said about itself.
  // The path is spelled out rather than built from the constant above, so the fitness scan that
  // requires every bucket write to carry its dimensions can see this is a route registration and not a
  // `put` of an object key (apps/api-worker/test/r2-object-dimension-scan.test.ts recognizes a literal
  // path). The two are held equal by a test beside that one.
  app.put("/search-objects/*", async (c) => {
    const claims = await authorize(c);
    if (claims === null || !claims.write) return refuse();
    const key = authorizedObjectKey(new URL(c.req.url).pathname, claims);
    if (key === null) return refuse();
    const body = c.req.raw.body;
    if (body === null) return refuse();

    const bucket = await firmBucketFor(c, claims);
    if (bucket === null) return refuse();
    // The matter the object is filed under, resolved from the token's own corpus and never from
    // anything the request said about itself — see matterDimensionFor for why a review-set corpus
    // cannot simply stamp its own identifier here.
    const matterId = await matterDimensionFor(c, claims);
    if (matterId === null) return refuse();
    const written = await bucket.put(key, body, {
      customMetadata: matterScopedObjectDimensions({
        objectClass: "search-split",
        matterId,
      }),
    });
    if (written === null) return refuse();
    return Response.json({ objectKey: key, sizeBytes: written.size }, { status: 200 });
  });
}
