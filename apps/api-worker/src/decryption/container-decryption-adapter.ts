import { z } from "@hono/zod-openapi";
import {
  DecryptionEngineFaultError,
  HashExtractionRefusedError,
  UnlockRefusedError,
  type DecryptionEnginePort,
  type ExtractedRecoveryHash,
  type UnlockedFile,
} from "./decryption-engine-port.ts";

// The recovery service's HTTP surface, narrowed to the one call this adapter makes. The
// RECOVERY_SERVICE Fetcher binding satisfies it; tests pass a fake so the adapter is exercised
// without a real recovery worker running in the pool.
export interface DecryptionEngineFetcher {
  fetch(request: Request): Promise<Response>;
}

// The engine's success reply. Validated rather than trusted: a malformed body means the far side is
// not the engine this adapter expects, which is a fault (a retryable throw) and never a fabricated
// hash.
const extractedRecoveryHashSchema: z.ZodType<ExtractedRecoveryHash> = z.object({
  format: z.enum(["pdf", "zip", "ooxml"]),
  hash: z.string().min(1),
  hashcatMode: z.number().int(),
  tier: z.enum(["cfCapable", "gpuRequired"]),
});

// The engine's refusal reply — a stable code naming what is wrong with the FILE. Validated on the
// same terms: an unrecognised code is the far side disagreeing with this adapter about the
// vocabulary, which is a fault rather than a refusal to read out to a member.
const refusalSchema = z.object({
  code: z.enum(["notEncrypted", "unsupported", "malformed"]),
});

// The engine's decrypt reply. Validated on the same terms as the hash: a body this adapter cannot
// read is the far side not being the engine it expects, which is a fault rather than a document.
const unlockedFileSchema: z.ZodType<UnlockedFile> = z.object({
  format: z.enum(["pdf", "zip", "ooxml"]),
  decryptedBase64: z.string(),
  filenameHint: z.string().nullable(),
});

// The engine's decrypt refusal — the hash refusal's vocabulary plus the one code only a decrypt can
// produce. `wrongPassword` is a verdict about what was submitted, exactly like the other three.
const unlockRefusalSchema = z.object({
  code: z.enum(["wrongPassword", "notEncrypted", "unsupported", "malformed"]),
});

// How many leading bytes of an /unlock body carry the password length: a big-endian u32. Pinned
// identically in containers/recovery/src/server.rs, which does the split — a Worker cannot import
// from a Container, so change one and change both in the same commit or every decrypt becomes a 400.
const UNLOCK_PASSWORD_LENGTH_PREFIX_BYTES = 4;

/**
 * Frame a decrypt request body: `[u32 big-endian password length][password UTF-8][file bytes]`.
 *
 * **The framing is the point, not an encoding choice.** A password put in a header, a query
 * parameter, or a path is a password in the one part of a request that proxies, access logs, and
 * trace metadata record by default. A password put in a JSON body is a password that a
 * deserializer's error text can quote back on a malformed request. A length-prefixed body is
 * neither: nothing between here and the engine reads it, and the engine's own framing complaints
 * name lengths only.
 */
function frameUnlockRequest(bytes: Uint8Array, password: string): Uint8Array {
  const passwordBytes = new TextEncoder().encode(password);
  const framed = new Uint8Array(
    UNLOCK_PASSWORD_LENGTH_PREFIX_BYTES + passwordBytes.byteLength + bytes.byteLength,
  );
  new DataView(framed.buffer).setUint32(0, passwordBytes.byteLength, false);
  framed.set(passwordBytes, UNLOCK_PASSWORD_LENGTH_PREFIX_BYTES);
  framed.set(bytes, UNLOCK_PASSWORD_LENGTH_PREFIX_BYTES + passwordBytes.byteLength);
  return framed;
}

// The worker-side ceiling on a single header read. The engine parses a header and returns; it does
// not search a keyspace, so this sits far below the shard timeout in recovery/recovery-backend.ts
// and exists only to turn a wedged Container into a retryable throw rather than a request that
// hangs on the member's own connection until the platform's subrequest timeout.
const EXTRACT_HASH_REQUEST_TIMEOUT_MS = 30 * 1000;

/**
 * Builds a DecryptionEnginePort over the recovery worker's Container. It POSTs the raw file bytes
 * to `/extract-hash` and maps the reply by status, which is the contract both sides pin:
 *
 * - **200** — the hash, zod-validated.
 * - **422** — `HashExtractionRefusedError`, a verdict about the file the route turns into a 400.
 * - **5xx**, a timeout, or a body that does not parse — `DecryptionEngineFaultError`, which the
 *   route turns into a retryable 503. A wired engine that cannot answer is not a fact about the
 *   member's file, and must never be reported as one.
 *
 * `requestTimeoutMs` overrides the wedged-Container backstop (a test passes a small value to drive
 * the abort path).
 */
export function containerDecryptionAdapter(
  container: DecryptionEngineFetcher,
  requestTimeoutMs: number = EXTRACT_HASH_REQUEST_TIMEOUT_MS,
): DecryptionEnginePort {
  return {
    async extractRecoveryHash(bytes: Uint8Array): Promise<ExtractedRecoveryHash> {
      let response: Response;
      try {
        response = await container.fetch(
          new Request("http://recovery/extract-hash", {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: bytes,
            // A wedged Container becomes a retryable throw (AbortError) here rather than a hang.
            signal: AbortSignal.timeout(requestTimeoutMs),
          }),
        );
      } catch (error) {
        // A transport failure or the abort above. Named as a fault so the route answers 503; the
        // message carries the failure only, never any part of the submitted file.
        throw new DecryptionEngineFaultError(
          `recovery service did not answer the header read: ${error instanceof Error ? error.name : "unknown error"}`,
        );
      }

      if (response.status === 422) {
        const refusal = refusalSchema.safeParse(await response.json().catch(() => null));
        if (!refusal.success) {
          throw new DecryptionEngineFaultError(
            "recovery service returned an unreadable refusal from the header read",
          );
        }
        throw new HashExtractionRefusedError(refusal.data.code);
      }
      if (response.status !== 200) {
        // Everything else — a 5xx from an engine that is down, a 4xx from a service that disagrees
        // with this adapter about the request. Neither is a property of the file, so both surface
        // as the same retryable fault rather than as a verdict a member would read as their fault.
        throw new DecryptionEngineFaultError(
          `recovery service returned status ${response.status} from the header read`,
        );
      }

      const parsed = extractedRecoveryHashSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        throw new DecryptionEngineFaultError(
          "recovery service returned an unreadable header-read result",
        );
      }
      return parsed.data;
    },

    async unlockWithPassword(bytes: Uint8Array, password: string): Promise<UnlockedFile> {
      // The password lives in the framed body and in no other part of this request. Nothing below
      // this line puts it in a URL, a header, a log, or a message — including the failure paths,
      // which name the transport or the status and never the input. See decryption-engine-port.ts.
      let response: Response;
      try {
        response = await container.fetch(
          new Request("http://recovery/unlock", {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: frameUnlockRequest(bytes, password),
            // A wedged Container becomes a retryable throw (AbortError) here rather than a hang.
            signal: AbortSignal.timeout(requestTimeoutMs),
          }),
        );
      } catch (error) {
        throw new DecryptionEngineFaultError(
          `recovery service did not answer the decrypt: ${error instanceof Error ? error.name : "unknown error"}`,
        );
      }

      if (response.status === 422) {
        const refusal = unlockRefusalSchema.safeParse(await response.json().catch(() => null));
        if (!refusal.success) {
          throw new DecryptionEngineFaultError(
            "recovery service returned an unreadable refusal from the decrypt",
          );
        }
        throw new UnlockRefusedError(refusal.data.code);
      }
      if (response.status !== 200) {
        // A 5xx from an engine that is down, or a 4xx from a service that disagrees with this
        // adapter about the request framing. Neither is a property of what the member submitted, so
        // both surface as the same retryable fault rather than as a wrong-password verdict — which
        // is the specific mistake to avoid here: telling someone their password is wrong because a
        // Container did not start.
        throw new DecryptionEngineFaultError(
          `recovery service returned status ${response.status} from the decrypt`,
        );
      }

      const parsed = unlockedFileSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        throw new DecryptionEngineFaultError("recovery service returned an unreadable decrypt");
      }
      return parsed.data;
    },
  };
}
