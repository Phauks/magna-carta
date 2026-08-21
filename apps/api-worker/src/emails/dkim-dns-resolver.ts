import type { DkimKeyLookup, DkimKeyLookupResult } from "@magna-carta/email-filing/dkim";

// The DNS half of DKIM verification. A Worker has no resolver, so the selector's key record is fetched
// over DNS-over-HTTPS; this module is the only place in the capture path that reaches the network for
// anything other than storage, and it is deliberately narrow — one TXT query, a bounded response, and
// no input that is not a domain name the message itself named.
//
// The one thing this must get right is telling "no such record" apart from "the lookup broke". A
// selector that has rotated away leaves no record and is a fact about the message; a resolver timeout
// is a fact about us, and recording it as the signer's failure would defame a sender for our outage.
// Everything ambiguous resolves to a temporary failure.
//
// The SSRF rule in docs/conventions/invariants.md does not bind here and must not be read as skipped:
// the outbound TARGET is a fixed resolver from deployment config, never a user-supplied address. What
// IS untrusted is the name being queried — it comes from the message's own d= and s= tags — so it is
// constrained to a plain domain-name charset before it can shape the query at all.

const DEFAULT_RESOLVER_URL = "https://cloudflare-dns.com/dns-query";

// A DKIM key record is a few hundred bytes; a response far past that is not one, and reading it would
// only feed a hostile resolver more of this worker's memory.
const MAX_RESPONSE_BYTES = 64 * 1024;

// The lookup sits inside a queue consumer, not a request handler, but it still must not stall a batch
// behind an unresponsive resolver.
const LOOKUP_TIMEOUT_MILLISECONDS = 5_000;

// DNS response codes: 0 NOERROR, 3 NXDOMAIN. Anything else is a server-side condition that may clear.
const RESPONSE_NO_ERROR = 0;
const RESPONSE_NAME_ERROR = 3;
const TYPE_TXT = 16;

interface DohAnswer {
  readonly type?: number;
  readonly data?: string;
}

interface DohResponse {
  readonly Status?: number;
  readonly Answer?: readonly DohAnswer[];
}

/**
 * Build the key lookup the DKIM verifier consumes. `resolverUrl` lets a deployment point at its own
 * DNS-over-HTTPS endpoint; the default is a public resolver.
 */
export function createDkimKeyLookup(resolverUrl: string = DEFAULT_RESOLVER_URL): DkimKeyLookup {
  return async (name: string): Promise<DkimKeyLookupResult> => {
    // The name comes from the message's own d=/s= tags, so it is untrusted: refuse anything that is
    // not a plain domain name rather than letting it shape the query URL.
    if (!isPlainDomainName(name)) return { kind: "notFound" };

    const url = new URL(resolverUrl);
    url.searchParams.set("name", name);
    url.searchParams.set("type", "TXT");

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MILLISECONDS),
      });
    } catch {
      return { kind: "temporaryFailure" };
    }
    if (!response.ok) return { kind: "temporaryFailure" };

    let payload: DohResponse;
    try {
      const body = await response.text();
      if (body.length > MAX_RESPONSE_BYTES) return { kind: "temporaryFailure" };
      payload = JSON.parse(body) as DohResponse;
    } catch {
      return { kind: "temporaryFailure" };
    }

    if (payload.Status === RESPONSE_NAME_ERROR) return { kind: "notFound" };
    if (payload.Status !== RESPONSE_NO_ERROR) return { kind: "temporaryFailure" };

    const records = (payload.Answer ?? [])
      .filter((answer) => answer.type === TYPE_TXT && typeof answer.data === "string")
      .map((answer) => joinTextStrings(answer.data as string));
    return records.length === 0 ? { kind: "notFound" } : { kind: "records", records };
  };
}

/**
 * A TXT record longer than 255 octets is published as several strings, which resolvers render as
 * adjacent quoted segments. DKIM keys routinely exceed 255 octets, so the segments must be joined with
 * nothing between them — a record split mid-base64 is otherwise unusable.
 */
export function joinTextStrings(data: string): string {
  const quoted = data.match(/"(?:[^"\\]|\\.)*"/g);
  if (quoted === null) return data.trim();
  return quoted.map((segment) => segment.slice(1, -1).replace(/\\(.)/g, "$1")).join("");
}

function isPlainDomainName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,253}$/.test(name);
}
