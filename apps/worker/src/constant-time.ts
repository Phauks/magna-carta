// Constant-time string comparison for secret checks (the platform-admin key). Both sides are
// folded through SHA-256 first so the inputs handed to timingSafeEqual are fixed-length — neither
// the secret's length nor a length mismatch can leak through timing (timingSafeEqual itself
// THROWS on unequal lengths). timingSafeEqual is the Workers runtime's constant-time primitive
// (a workerd extension on SubtleCrypto, available since compatibility with the 2022 runtime —
// typed by @cloudflare/workers-types).
export async function constantTimeStringEquals(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(leftDigest, rightDigest);
}
