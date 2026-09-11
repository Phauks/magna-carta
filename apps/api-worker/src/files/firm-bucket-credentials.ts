import type { DataRegion } from "@magna-carta/database/data-region";
import { jurisdictionForRegion } from "@magna-carta/database/data-region";

/*
 * Short-lived credentials scoped to ONE firm's bucket — how the Worker reaches a firm's objects
 * without holding a key that reaches everyone's.
 *
 * WHAT THIS NARROWS. A firm's bucket cannot be a binding (there is no runtime API that turns a bucket
 * name into an R2Bucket), so the Worker signs S3 calls instead — and the credential it signed them
 * with reaches EVERY bucket in the account, for as long as it exists. That is a wider key than the
 * work needs: a request serving one firm's file has no business being able to address another firm's
 * bucket at all. R2 will mint a credential derived from that parent key and scoped to a single
 * bucket, with a lifetime, so the key actually used on the object plane can reach one firm for one
 * window rather than everyone forever.
 *
 * It does not remove the parent key, which still has to exist somewhere to derive from. What it
 * removes is the parent key's presence on the path that handles requests: a bug, an injection or a
 * leaked signed URL on the object plane now exposes one bucket for at most the remaining lifetime,
 * where before it exposed the account.
 *
 * THE ONE RULE THAT IS NOT OBVIOUS: a presigned URL dies with the credential that signed it, whatever
 * its own X-Amz-Expires says. R2's response carries no expiry — only the ttlSeconds the request asked
 * for — so the expiry is computed here at mint time and every hand-out re-checks it. A credential
 * with less life left than the URL being signed is not returned; it is re-minted. Skip that check and
 * a member gets an upload URL good for an hour that stops working in four minutes, which reads
 * exactly like the storage refusing the upload and is diagnosed the same slow way.
 *
 * Object permission, never admin: this path gets, puts, lists and deletes objects. It never needs to
 * read or write the bucket's own configuration, and a credential that cannot do so cannot be made to.
 */

const API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * How long a minted credential lives. Comfortably longer than the longest URL anyone signs with it
 * (an hour, for an upload or a check-in) so the same credential serves many requests, and short
 * enough that a leaked one is a window rather than a standing grant.
 */
const CREDENTIAL_TTL_SECONDS = 7200;

/**
 * How much life a cached credential must have left BEYOND the expiry being signed. Covers the gap
 * between signing a URL and the client following it, and keeps a credential from being handed out at
 * the very edge of its life.
 */
const SAFETY_MARGIN_SECONDS = 300;

/** What R2 answers, plus the expiry it does not tell us and we therefore have to compute. */
export interface ScopedBucketCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken: string;
  /** Milliseconds since the epoch, from ttlSeconds at mint time — R2 returns no expiry of its own. */
  readonly expiresAtMilliseconds: number;
}

export interface MintOptions {
  readonly accountId: string;
  /** An account API token with R2 edit. The parent of every credential minted here. */
  readonly apiToken: string;
  /** The S3 access key id the credential is derived from; R2 requires it named explicitly. */
  readonly parentAccessKeyId: string;
  readonly bucketName: string;
  readonly region: DataRegion;
  readonly ttlSeconds?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

/** Raised when R2 will not mint. Never fall back to the parent key — that is the whole point. */
export class BucketCredentialError extends Error {
  constructor(bucketName: string, detail: string) {
    super(`could not mint scoped credentials for ${bucketName}: ${detail}`);
    this.name = "BucketCredentialError";
  }
}

/**
 * Mint one credential scoped to one bucket. A jurisdiction bucket is only visible to the API under
 * its own jurisdiction header, exactly as it is only addressable at its own S3 endpoint.
 */
export async function mintScopedBucketCredentials(
  options: MintOptions,
): Promise<ScopedBucketCredentials> {
  const {
    accountId,
    apiToken,
    parentAccessKeyId,
    bucketName,
    region,
    ttlSeconds = CREDENTIAL_TTL_SECONDS,
    fetchImpl = fetch,
    now = Date.now,
  } = options;
  const jurisdiction = jurisdictionForRegion(region);
  const mintedAt = now();

  let response: Response;
  try {
    response = await fetchImpl(`${API_BASE}/accounts/${accountId}/r2/temp-access-credentials`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
        ...(jurisdiction === undefined ? {} : { "cf-r2-jurisdiction": jurisdiction }),
      },
      body: JSON.stringify({
        bucket: bucketName,
        parentAccessKeyId,
        // Objects, not administration: this path never touches the bucket's own configuration.
        permission: "object-read-write",
        ttlSeconds,
      }),
    });
  } catch (caught) {
    throw new BucketCredentialError(
      bucketName,
      caught instanceof Error ? caught.message : "nothing answered",
    );
  }

  const envelope = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    errors?: { message?: string }[];
    result?: { accessKeyId?: string; secretAccessKey?: string; sessionToken?: string };
  };
  if (!response.ok || envelope.success === false) {
    const detail =
      (envelope.errors ?? []).map((error) => error.message ?? "").join("; ") ||
      `HTTP ${String(response.status)}`;
    throw new BucketCredentialError(bucketName, detail);
  }
  const { accessKeyId, secretAccessKey, sessionToken } = envelope.result ?? {};
  if (
    accessKeyId === undefined ||
    secretAccessKey === undefined ||
    sessionToken === undefined ||
    accessKeyId === "" ||
    secretAccessKey === "" ||
    sessionToken === ""
  ) {
    // A 200 with a member missing is not a credential. Saying so here beats signing with `undefined`
    // and reading the failure off a rejected upload.
    throw new BucketCredentialError(bucketName, "the response carried no complete credential");
  }
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken,
    expiresAtMilliseconds: mintedAt + ttlSeconds * 1000,
  };
}

/**
 * A per-isolate cache of minted credentials, one entry per bucket.
 *
 * Minting is a round trip to the Cloudflare API, and a firm's bucket is addressed many times per
 * request, so without a cache the hardening would cost an outbound call per object operation. The
 * cache holds a credential only while it has more life left than the caller needs — see the rule at
 * the top of this file — so an entry is never returned merely because it has not expired yet.
 */
export class ScopedCredentialCache {
  readonly #entries = new Map<string, ScopedBucketCredentials>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /**
   * A credential good for signing something that expires `neededSeconds` from now, minting one if
   * what is cached cannot cover it.
   */
  async credentialsFor(
    options: MintOptions & { readonly neededSeconds: number },
  ): Promise<ScopedBucketCredentials> {
    const key = `${options.region}:${options.bucketName}`;
    const cached = this.#entries.get(key);
    if (cached !== undefined && this.#covers(cached, options.neededSeconds)) return cached;
    const minted = await mintScopedBucketCredentials({ ...options, now: this.#now });
    this.#entries.set(key, minted);
    return minted;
  }

  /** Whether this credential outlives what is about to be signed with it, with margin to spare. */
  #covers(credentials: ScopedBucketCredentials, neededSeconds: number): boolean {
    const remaining = credentials.expiresAtMilliseconds - this.#now();
    return remaining > (neededSeconds + SAFETY_MARGIN_SECONDS) * 1000;
  }

  /** For tests, and for a deployment that wants to drop everything after a credential rotation. */
  clear(): void {
    this.#entries.clear();
  }
}
