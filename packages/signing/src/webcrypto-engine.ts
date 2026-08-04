// Points pkijs at the ambient WebCrypto. Shared by every module here that drives pkijs (the CMS
// producer and the platform-identity generator), so the engine is configured exactly once per
// process and callers never coordinate. Runs anywhere WebCrypto does — the Cloudflare Worker via
// workerd, and node 22 for tests and provisioning.

import * as pkijs from "pkijs";

let engineConfigured = false;

/** Point pkijs at the ambient WebCrypto once. Idempotent, so callers need not coordinate. */
export function ensureEngine(): void {
  if (engineConfigured) return;
  const engine = new pkijs.CryptoEngine({
    name: "magna-carta-webcrypto",
    crypto: crypto as unknown as Crypto,
  });
  // pkijs 3.4's `CryptoEngine` does not declare the KEM methods its own `ICryptoEngine` lists, so
  // the type rejects it though it is exactly the engine `setEngine` expects.
  pkijs.setEngine("magna-carta-webcrypto", engine as unknown as pkijs.ICryptoEngine);
  engineConfigured = true;
}
