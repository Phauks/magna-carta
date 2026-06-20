// Pseudonymous, stable identifier hashing for usage analytics. HMAC-SHA-256 under a long-lived
// server pepper: a bare SHA-256 of a low-entropy id (the firm-id space is small and enumerable) is
// reversible, so the keyed pepper is the privacy control. Fail-closed: with no pepper there is no
// privacy guarantee, so the caller must emit nothing rather than leak a raw or unsalted id.
export async function pseudonymize(
  pepper: string | undefined,
  identifier: string,
): Promise<string | null> {
  if (pepper === undefined || pepper === "") return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(identifier));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
