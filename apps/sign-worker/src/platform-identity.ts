import { fromBase64, toArrayBuffer } from "@magna-carta/signing";

// The worker's environment: the platform signing identity as Worker secrets. Both optional so the
// worker deploys before they are set (deferred activation — the seal returns "not configured" until
// then). PLATFORM_SEAL_KEY is the PKCS#8 private key, base64; PLATFORM_SEAL_CERT is the DER
// certificate, base64.
export interface SignWorkerEnv {
  readonly PLATFORM_SEAL_KEY?: string;
  readonly PLATFORM_SEAL_CERT?: string;
  /**
   * Where a reader writes about a certificate itself, printed on every Certificate of Completion.
   * A plain variable, not a secret. Unset, the certificate names the platform and gives no address.
   */
  readonly CERTIFICATE_SUPPORT_EMAIL?: string;
}

/** The resolved platform signing identity: a non-extractable signing key and the signer certificate. */
export interface PlatformIdentity {
  readonly signingKey: CryptoKey;
  /** DER-encoded certificate (the CMS layer parses it). */
  readonly certificate: Uint8Array;
}

/**
 * Resolve the platform signing identity from the worker's secrets, or `null` when the seal is not
 * configured (either secret absent). Returning `null` — rather than throwing — is the deferred
 * activation posture: the worker degrades to an honest "not configured" until an operator sets the
 * secrets, mirroring the scan worker's no-engine mode. The private key is imported **non-extractable**
 * so it can only sign, never be read back out.
 */
export async function resolvePlatformIdentity(
  env: SignWorkerEnv,
): Promise<PlatformIdentity | null> {
  if (env.PLATFORM_SEAL_KEY === undefined || env.PLATFORM_SEAL_CERT === undefined) {
    return null;
  }
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(fromBase64(env.PLATFORM_SEAL_KEY)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return { signingKey, certificate: fromBase64(env.PLATFORM_SEAL_CERT) };
}
