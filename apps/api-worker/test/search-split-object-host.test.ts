import { env, SELF } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterId, ReviewSetId } from "@magna-carta/identifiers/types";
import { objectClassOf, matterOfObject } from "@magna-carta/object-dimensions/dimensions";
import { corpusOfMatter, corpusOfReviewSet } from "@magna-carta/search/corpus";
import { splitObjectKey } from "@magna-carta/search/split";
import type { IndexSplitId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  SPLIT_OBJECT_HOST,
  SPLIT_OBJECT_PATH_PREFIX,
  SPLIT_OBJECT_SIZE_HEADER,
  SPLIT_OBJECT_TOKEN_HEADER,
} from "../src/search/split-object-host.ts";
import { mintSplitObjectToken } from "../src/search/split-object-token.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// The R2 side of the search engine's range reader. The engine holds no credentials: it calls this
// surface with a capability token minted for one corpus, and each call becomes exactly one R2
// operation. What is worth proving here is the two things that would be silently wrong otherwise —
// that a ranged read really is ranged (the whole cost model of the split format rests on it), and that
// the token, not the request line, is what decides whose bytes are reachable.

const BUCKET = "magna-carta-test-split-object-bucket";
const CREATED_AT = "2026-08-14T00:00:00.000Z";

// A split's worth of recognisable bytes: byte i is i mod 251, so any range that comes back can be
// checked against the offset it was asked for rather than merely against its length.
const SPLIT_BYTES = new Uint8Array(4096).map((_, index) => index % 251);

let firmId: string;
let corpus: ReturnType<typeof corpusOfMatter>;
let otherCorpus: ReturnType<typeof corpusOfMatter>;
let objectKey: string;

async function readToken(): Promise<string> {
  return mintSplitObjectToken(
    {
      firmId,
      corpusKind: corpus.kind,
      corpusId: corpus.id,
      write: false,
      exp: Date.now() + 60_000,
    },
    { AUTH_SECRET: env.AUTH_SECRET },
  );
}

async function writeToken(): Promise<string> {
  return mintSplitObjectToken(
    { firmId, corpusKind: corpus.kind, corpusId: corpus.id, write: true, exp: Date.now() + 60_000 },
    { AUTH_SECRET: env.AUTH_SECRET },
  );
}

function call(
  key: string,
  init: RequestInit & { token: string; range?: string },
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(SPLIT_OBJECT_TOKEN_HEADER, init.token);
  if (init.range !== undefined) headers.set("range", init.range);
  return SELF.fetch(`https://example.com${SPLIT_OBJECT_PATH_PREFIX}${key}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    // A streamed body is what the publish path really sends; half duplex is what the runtime needs.
    ...(init.body === undefined ? {} : { duplex: "half" }),
  } as RequestInit);
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm");
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, database_identifier, bucket_name, status, created_at) VALUES (?1, 'Split Host Firm', 'DB_FIRM_POOL_1', ?2, 'active', ?3)",
  )
    .bind(firmId, BUCKET, CREATED_AT)
    .run();
  corpus = corpusOfMatter(newIdentifier("matter") as MatterId);
  otherCorpus = corpusOfMatter(newIdentifier("matter") as MatterId);
  objectKey = splitObjectKey(corpus, newIdentifier("indexSplit") as IndexSplitId);
  await env.R2.put(objectKey, SPLIT_BYTES);
});

describe("the split-object host serves exactly the read the engine asked for", () => {
  it("answers a HEAD with the split's total size, so the footer can be found from the tail", async () => {
    const response = await call(objectKey, { method: "HEAD", token: await readToken() });
    expect(response.status).toBe(200);
    expect(response.headers.get(SPLIT_OBJECT_SIZE_HEADER)).toBe(String(SPLIT_BYTES.byteLength));
  });

  it("returns exactly the requested byte range and nothing around it", async () => {
    // The engine reads a term-dictionary block or a postings list as one closed range. If the host
    // returned more than that — a padded read, a whole object behind a range — every read count the
    // engine was measured on would understate what a deployment actually transfers.
    const response = await call(objectKey, { token: await readToken(), range: "bytes=1000-1099" });
    expect(response.status).toBe(206);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.byteLength).toBe(100);
    expect(body).toEqual(SPLIT_BYTES.slice(1000, 1100));
  });

  it("refuses an unranged GET rather than serving the whole split", async () => {
    // The expensive shape is made inexpressible rather than merely discouraged: a caller that forgets
    // the range gets a refusal, not a gigabyte.
    const response = await call(objectKey, { token: await readToken() });
    expect(response.status).toBe(416);
  });

  it("refuses a malformed or open-ended range", async () => {
    for (const range of ["bytes=100-", "bytes=-100", "bytes=200-100", "bytes=0-10,20-30"]) {
      const response = await call(objectKey, { token: await readToken(), range });
      expect(response.status, range).toBe(416);
    }
  });
});

describe("the token, not the request line, decides what is reachable", () => {
  it("refuses a call with no token", async () => {
    const response = await SELF.fetch(
      `https://example.com${SPLIT_OBJECT_PATH_PREFIX}${objectKey}`,
      { headers: { range: "bytes=0-9" } },
    );
    expect(response.status).toBe(404);
  });

  it("refuses a tampered token", async () => {
    const token = await readToken();
    const tampered = `${token.slice(0, -2)}${token.endsWith("aa") ? "bb" : "aa"}`;
    const response = await call(objectKey, { token: tampered, range: "bytes=0-9" });
    expect(response.status).toBe(404);
  });

  it("refuses an expired token", async () => {
    const expired = await mintSplitObjectToken(
      {
        firmId,
        corpusKind: corpus.kind,
        corpusId: corpus.id,
        write: false,
        exp: Date.now() - 1000,
      },
      { AUTH_SECRET: env.AUTH_SECRET },
    );
    const response = await call(objectKey, { token: expired, range: "bytes=0-9" });
    expect(response.status).toBe(404);
  });

  it("refuses a key outside the token's own corpus", async () => {
    // The engine reads several splits per query, so the key has to come from the request line — which
    // is exactly why it is constrained to the prefix the TOKEN's corpus derives. A token for one matter
    // cannot name another matter's split even though both sit in the same bucket.
    const token = await mintSplitObjectToken(
      {
        firmId,
        corpusKind: otherCorpus.kind,
        corpusId: otherCorpus.id,
        write: false,
        exp: Date.now() + 60_000,
      },
      { AUTH_SECRET: env.AUTH_SECRET },
    );
    const response = await call(objectKey, { token, range: "bytes=0-9" });
    expect(response.status).toBe(404);
  });

  it("refuses a traversal out of the corpus prefix", async () => {
    const escape = `search/${corpus.id}/splits/../../${otherCorpus.id}/splits/a.split`;
    const response = await call(escape, { token: await readToken(), range: "bytes=0-9" });
    expect(response.status).toBe(404);
  });

  it("refuses a write presented with a read token", async () => {
    // A query must not be able to overwrite the splits it is reading, and the split it would overwrite
    // is one it is allowed to read — so the capability, not the key, has to be the gate.
    const response = await call(objectKey, {
      method: "PUT",
      token: await readToken(),
      body: new Uint8Array([1, 2, 3]),
    });
    expect(response.status).toBe(404);
    const unchanged = await env.R2.get(objectKey);
    expect((await unchanged?.arrayBuffer())?.byteLength).toBe(SPLIT_BYTES.byteLength);
  });
});

describe("publishing a split", () => {
  it("writes the bytes and stamps the object's dimensions from the token's corpus", async () => {
    // An object nothing can scope is the one thing the dimension stamp exists to prevent, and a split
    // is exactly the kind of object a later reader of the bucket has to be able to place.
    const key = splitObjectKey(corpus, newIdentifier("indexSplit") as IndexSplitId);
    const payload = new Uint8Array(512).map((_, index) => (index * 7) % 251);
    const response = await call(key, {
      method: "PUT",
      token: await writeToken(),
      body: payload,
    });
    expect(response.status).toBe(200);

    const written = await env.R2.get(key);
    expect(written).not.toBeNull();
    expect(new Uint8Array(await written!.arrayBuffer())).toEqual(payload);
    expect(objectClassOf(written!.customMetadata)).toBe("search-split");
    expect(matterOfObject(written!.customMetadata)).toBe(corpus.id);
  });

  it("files a REVIEW SET's split under its matter, not under the review set", async () => {
    // The matter dimension is what the storage meter counts against and what a lifecycle rule and a
    // legal hold are expressed over. For a matter corpus the corpus IS the matter and the two
    // coincide; for a review-set corpus they do not, and stamping the review set's own handle here
    // would file a firm's discovery bytes under a matter that does not exist — recoverable only by a
    // metadata rewrite of the whole bucket.
    const matterId = newIdentifier("matter") as MatterId;
    const reviewSetId = newIdentifier("reviewSet") as ReviewSetId;
    const memberId = newIdentifier("user");
    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    await database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'S', 'active', ?2)",
      )
      .bind(memberId, CREATED_AT)
      .run();
    await database
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
      )
      .bind(matterId, memberId, CREATED_AT)
      .run();
    await database
      .prepare(
        "INSERT INTO review_set (id, matter_id, name, state, document_ceiling, created_by, created_at, updated_at) " +
          "VALUES (?1, ?2, 'Plaintiff production', 'open', 250000, ?3, ?4, ?4)",
      )
      .bind(reviewSetId, matterId, memberId, CREATED_AT)
      .run();

    const reviewSetCorpus = corpusOfReviewSet(reviewSetId);
    const key = splitObjectKey(reviewSetCorpus, newIdentifier("indexSplit") as IndexSplitId);
    const token = await mintSplitObjectToken(
      {
        firmId,
        corpusKind: reviewSetCorpus.kind,
        corpusId: reviewSetCorpus.id,
        write: true,
        exp: Date.now() + 60_000,
      },
      { AUTH_SECRET: env.AUTH_SECRET },
    );
    const response = await call(key, {
      method: "PUT",
      token,
      body: new Uint8Array(256).map((_, index) => index % 251),
    });
    expect(response.status).toBe(200);

    const written = await env.R2.get(key);
    expect(written).not.toBeNull();
    expect(matterOfObject(written!.customMetadata)).toBe(matterId);
    expect(matterOfObject(written!.customMetadata)).not.toBe(reviewSetId);
    // And the key is still under the review set's own prefix — the object is filed under the matter
    // and lives in the corpus, which are two different questions.
    expect(key.startsWith(`search/${reviewSetId}/`)).toBe(true);
  });

  it("refuses to publish for a review set the firm does not hold, rather than mis-filing it", async () => {
    const missing = newIdentifier("reviewSet") as ReviewSetId;
    const key = splitObjectKey(
      corpusOfReviewSet(missing),
      newIdentifier("indexSplit") as IndexSplitId,
    );
    const token = await mintSplitObjectToken(
      { firmId, corpusKind: "reviewSet", corpusId: missing, write: true, exp: Date.now() + 60_000 },
      { AUTH_SECRET: env.AUTH_SECRET },
    );
    const response = await call(key, { method: "PUT", token, body: new Uint8Array(16) });
    expect(response.status).toBe(404);
    expect(await env.R2.get(key)).toBeNull();
  });

  it("is readable through the ranged path it was written for", async () => {
    // Publish then range-read is the whole loop: a split the engine wrote must be a split the engine
    // can walk, through the same surface, without anything materialising it whole in between.
    const key = splitObjectKey(corpus, newIdentifier("indexSplit") as IndexSplitId);
    const payload = new Uint8Array(2048).map((_, index) => index % 251);
    expect(
      (await call(key, { method: "PUT", token: await writeToken(), body: payload })).status,
    ).toBe(200);

    const head = await call(key, { method: "HEAD", token: await readToken() });
    expect(head.headers.get(SPLIT_OBJECT_SIZE_HEADER)).toBe("2048");
    const tail = await call(key, { token: await readToken(), range: "bytes=2040-2047" });
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(payload.slice(2040));
  });
});

describe("the constants the engine reaches this host by", () => {
  it("names the host the search worker intercepts and the header its reader looks for", () => {
    // A worker cannot import from another worker, so these three literals live in three files:
    // here, apps/search-worker/src/split-object-forwarding.ts, and
    // containers/search/src/object_client.rs. Each side pins them, because a rename that lands on
    // only one turns every engine read into blocked egress or a reader that cannot find a footer —
    // a runtime failure with no compile-time warning anywhere.
    expect(SPLIT_OBJECT_HOST).toBe("splits.magna-carta.internal");
    expect(SPLIT_OBJECT_PATH_PREFIX).toBe("/search-objects/");
    // The PUT route registers this path as a literal (so the dimension fitness scan can tell a route
    // from a bucket write), which is the fourth place the prefix is written down.
    expect(SPLIT_OBJECT_TOKEN_HEADER).toBe("x-mc-split-token");
    expect(SPLIT_OBJECT_SIZE_HEADER).toBe("x-mc-split-size");
  });
});
