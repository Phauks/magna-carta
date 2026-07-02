// Canonical form: object keys sorted recursively (arrays keep order). Semantically-identical bodies
// share one fingerprint regardless of client key order.
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortKeysDeep(entry)]),
    );
  }
  return value;
}

// fingerprint = SHA-256(METHOD path \n canonical body). Includes the endpoint, so one key reused
// across endpoints trips the mismatch path. The fingerprint is a hash, never the body —
// large or sensitive payloads never land in the idempotency record through this path.
export async function fingerprintRequest(request: {
  method: string;
  path: string;
  body: unknown;
}): Promise<string> {
  const text = `${request.method.toUpperCase()} ${request.path}\n${
    request.body === undefined ? "" : canonicalJsonStringify(request.body)
  }`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
