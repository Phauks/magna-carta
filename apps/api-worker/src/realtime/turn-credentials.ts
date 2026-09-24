import type { Bindings } from "../bindings.ts";

// Minting relay credentials from Cloudflare Realtime's TURN service, in ONE home.
//
// Two surfaces need them for different reasons — a meeting hands them to a browser so two
// participants behind different networks can find each other, and the connection tool spends them
// measuring packet loss — and they had a copy each: the same URL, the same bearer header, the same
// defensive parse, diverging one edit at a time. What is NOT shared is what to do when the mint
// fails, because the two surfaces genuinely differ there: a meeting degrades to the public
// resolution server rather than refusing entry to a room that is otherwise working, while a
// measurement that cannot be taken has nothing to report.
//
// THE KEY NEVER LEAVES THIS WORKER, and the upstream text never leaves this module: the body can
// echo the key id, so the result carries a LABEL for what went wrong and none of what was said. The
// media-routing client takes the same posture with its own credential for the same reason
// (../meetings/sfu-client.ts).
//
// `fetch` is a parameter rather than the global so a test drives every branch without a network and
// without the real credentials existing anywhere.

const TURN_KEYS_BASE_URL = "https://rtc.live.cloudflare.com/v1/turn/keys";

/** One entry a browser hands its own connection: an address, and a credential where one is needed. */
export interface IceServer {
  readonly urls: string | string[];
  readonly username?: string;
  readonly credential?: string;
}

/**
 * What a mint produced.
 *
 * Three outcomes rather than a value-or-null, because only two of them are about this deployment's
 * ability to mint at all: `not-configured` is a deployment that does not relay and is not a fault,
 * while `failed` is a service that should have answered and did not — one is never recorded as an
 * error and the other always is.
 */
export type IceServerMint =
  | { readonly kind: "minted"; readonly servers: readonly IceServer[] }
  | { readonly kind: "not-configured" }
  | { readonly kind: "failed"; readonly cause: "unreachable" | "refused" | "unreadable" };

/**
 * Mints the relay credentials for one caller, or says why it could not.
 *
 * The TTL is the caller's, because the two surfaces want different lives out of one credential: a
 * meeting's lasts about as long as a meeting, a measurement's about as long as a measurement. Both
 * are short on purpose — a relay authorization is billed to this account.
 */
export async function generateIceServers(
  env: Bindings,
  ttlSeconds: number,
  fetchImplementation: typeof fetch = fetch.bind(globalThis),
): Promise<IceServerMint> {
  const keyId = env.REALTIME_TURN_TOKEN_ID;
  const apiToken = env.REALTIME_TURN_TOKEN_SECRET;
  // Both halves or neither: one without the other is a half-finished configuration, and treating it
  // as configured would spend a request to learn what the bindings already say.
  if (!keyId || !apiToken) return { kind: "not-configured" };

  let upstream: Response;
  try {
    upstream = await fetchImplementation(
      `${TURN_KEYS_BASE_URL}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: ttlSeconds }),
      },
    );
  } catch {
    // The thrown cause is deliberately not carried: it can hold the request URL, which holds the
    // key id.
    return { kind: "failed", cause: "unreachable" };
  }
  if (!upstream.ok) return { kind: "failed", cause: "refused" };

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return { kind: "failed", cause: "unreadable" };
  }
  const servers = iceServersFrom(payload);
  // An answer this Worker cannot read is the same fact to a caller as one that never arrived: there
  // are no servers to hand on either way, and both are a deployment question rather than a
  // caller's.
  return servers.length === 0
    ? { kind: "failed", cause: "unreadable" }
    : { kind: "minted", servers };
}

/**
 * The entry carrying a username and a credential, which is the only one a measurement can spend.
 *
 * Found by the fields it needs rather than by position: the answer lists several servers and only
 * the relay ones are authenticated.
 */
export function credentialedServer(
  servers: readonly IceServer[],
): { username: string; credential: string } | null {
  for (const server of servers) {
    if (server.username !== undefined && server.credential !== undefined) {
      return { username: server.username, credential: server.credential };
    }
  }
  return null;
}

// Parsed defensively rather than trusted: the answer crosses a version boundary this Worker does not
// control, and a malformed entry handed to a browser fails inside its connection machinery, far from
// anything that could name the cause.
function iceServersFrom(payload: unknown): IceServer[] {
  if (payload === null || typeof payload !== "object") return [];
  const servers = (payload as { iceServers?: unknown }).iceServers;
  const entries = Array.isArray(servers) ? servers : [servers];
  const parsed: IceServer[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const { urls, username, credential } = entry as {
      urls?: unknown;
      username?: unknown;
      credential?: unknown;
    };
    const addresses =
      typeof urls === "string"
        ? urls
        : Array.isArray(urls) && urls.every((one) => typeof one === "string")
          ? (urls as string[])
          : null;
    if (addresses === null) continue;
    parsed.push({
      urls: addresses,
      ...(typeof username === "string" ? { username } : {}),
      ...(typeof credential === "string" ? { credential } : {}),
    });
  }
  return parsed;
}
