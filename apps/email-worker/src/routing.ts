// Address routing for the forward/CC capture entrance. Cloudflare Email Routing supports exactly one
// catch-all shape — a single zone-level rule — so every capture address lives on ONE subdomain,
// `<token>@<rootDomain>`, and the whole local part is an opaque, server-minted routing token. The token
// is resolved against the control-plane token->firm index here (this worker holds no per-firm database
// handle); it then rides through to the capture consumer, which resolves it to a candidate matter against
// the firm's own capture-address store. An address on another zone, or an unminted/revoked token, does
// not route.

export interface ParsedCaptureAddress {
  readonly token: string;
}

// Extract the capture token (the local part) from a destination address on `rootDomain`, or null when it
// is not a capture address for this zone — a different host, or an empty local part. The token is
// lower-cased to match the minted form; the host must equal `rootDomain` exactly (a nested subdomain is
// not this zone's catch-all).
export function parseCaptureAddress(
  address: string,
  rootDomain: string,
): ParsedCaptureAddress | null {
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  const token = address.slice(0, at).trim().toLowerCase();
  const host = address
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (token.length === 0) return null;
  if (host !== rootDomain.toLowerCase()) return null;
  return { token };
}

export interface CaptureRouting {
  readonly firmId: string;
  readonly bucketName: string | null;
  // The capture token, carried to the capture consumer which resolves it to a candidate matter (a
  // per-matter token proposes its matter; a firm catch-all token lands with no matter, staff route it).
  readonly captureToken: string;
}

// Resolve a capture token to its firm, or null when the token is unknown or revoked. The worker supplies
// the real control-plane query; tests inject a fake (the email() binding cannot run in the local pool).
export type FirmResolver = (
  token: string,
) => Promise<{ firmId: string; bucketName: string | null } | null>;

// Resolve a destination address to its firm routing, or null when it does not route (not a capture
// address for this zone, or an unminted/revoked token).
export async function resolveCaptureRouting(
  address: string,
  rootDomain: string,
  resolveFirm: FirmResolver,
): Promise<CaptureRouting | null> {
  const parsed = parseCaptureAddress(address, rootDomain);
  if (parsed === null) return null;
  const firm = await resolveFirm(parsed.token);
  if (firm === null) return null;
  return { firmId: firm.firmId, bucketName: firm.bucketName, captureToken: parsed.token };
}
