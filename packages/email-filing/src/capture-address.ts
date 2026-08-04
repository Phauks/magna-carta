// The shape of a forward/CC capture address, shared by the worker that MINTS one and the inbound
// Email Worker that RESOLVES one. Kept in its own dependency-free module so the receiving worker —
// which deliberately carries no runtime dependencies beyond the platform — can import the domain
// default without pulling in the rest of this package.
//
// Every capture address lives on one subdomain as `<token>@<rootDomain>`, because Cloudflare Email
// Routing supports exactly one zone-level catch-all rule and no per-subdomain wildcards: the firm
// therefore cannot live in the hostname, and the opaque local-part token carries it instead.

export const DEFAULT_CAPTURE_ROOT_DOMAIN = "in.magnacarta.esq";

// Compose the address a person actually forwards mail to. Lower-cased whole: the receiving worker
// lower-cases the local part before resolving it, and hostnames are case-insensitive, so emitting the
// canonical form is what makes a copied-and-pasted address match the minted token.
export function captureAddressFor(token: string, rootDomain: string): string {
  return `${token}@${rootDomain}`.toLowerCase();
}
