// Address routing for the forward/CC capture entrance. A capture address encodes the firm in the
// subdomain and the matter token in the local part: `<localPart>@<firmSubdomain>.<rootDomain>`. The firm
// is resolved against the control plane here (this worker has no per-firm database handle); the local
// part rides through as the capture token, which the capture consumer resolves to a candidate matter
// against the firm's own capture-address store. An address that is not a capture address for this zone,
// or names an unknown firm, does not route.

export interface ParsedCaptureAddress {
  readonly firmSubdomain: string;
  readonly localPart: string;
}

// Split a destination address into its firm subdomain and local part, or null when it is not a capture
// address for `rootDomain` (wrong zone, no firm subdomain label, or an empty local part).
export function parseCaptureAddress(
  address: string,
  rootDomain: string,
): ParsedCaptureAddress | null {
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  const localPart = address.slice(0, at).trim().toLowerCase();
  const host = address
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (localPart.length === 0) return null;
  const suffix = `.${rootDomain.toLowerCase()}`;
  if (!host.endsWith(suffix)) return null;
  const firmSubdomain = host.slice(0, host.length - suffix.length);
  // Exactly one label of firm subdomain — no nested labels, no empty subdomain.
  if (firmSubdomain.length === 0 || firmSubdomain.includes(".")) return null;
  return { firmSubdomain, localPart };
}

export interface CaptureRouting {
  readonly firmId: string;
  readonly bucketName: string | null;
  // The local part, carried to the capture consumer which resolves it to a candidate matter (a
  // per-matter token proposes its matter; the firm catch-all or an unknown token lands unrouted).
  readonly captureToken: string;
}

// Resolve a firm subdomain to its control-plane firm row, or null when unknown. The worker supplies the
// real control-plane query; tests inject a fake (the email() binding cannot run in the local pool).
export type FirmResolver = (
  firmSubdomain: string,
) => Promise<{ firmId: string; bucketName: string | null } | null>;

// Resolve a destination address to its firm routing, or null when it does not route (not a capture
// address, or an unknown firm).
export async function resolveCaptureRouting(
  address: string,
  rootDomain: string,
  resolveFirm: FirmResolver,
): Promise<CaptureRouting | null> {
  const parsed = parseCaptureAddress(address, rootDomain);
  if (parsed === null) return null;
  const firm = await resolveFirm(parsed.firmSubdomain);
  if (firm === null) return null;
  return { firmId: firm.firmId, bucketName: firm.bucketName, captureToken: parsed.localPart };
}
