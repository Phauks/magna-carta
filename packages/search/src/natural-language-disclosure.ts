// The disclosure a firm's administrator accepts before natural-language search may be turned on,
// and the version number that acceptance is recorded against.
//
// It is a code constant rather than a firm setting because it describes what the platform does,
// which a firm does not get to edit. Bump the version whenever what the feature COPIES, WHERE it
// copies to, or WHAT IT CAN DO changes — firm-wide scope and any form of generation are the two
// obvious ones. Every firm's stored acknowledgement then stops matching this number, the firm is
// asked again automatically, and no feed object is written under a version nobody accepted.
//
// Firm-level, from an administrator, not per-member. A member's typed question does reach an
// on-network embedding model, which the statement below says plainly; that is the same on-network
// boundary every other feature already sits inside, and it is not the kind of fact each member has
// to be asked about separately. What is being consented to here is that the firm's privileged
// material comes to rest somewhere new, and that is a firm's decision about its own client
// agreements.

export const NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION = 1;

// One statement, one sentence per fact a firm can actually evaluate. Nothing here is a promise the
// platform cannot keep — the two refusals (residency, and erasure from the managed store) are the
// load-bearing sentences, and they are refusals rather than hedges because the honest answer is
// that the documentation the platform was built against does not answer either question.
//
// Kept as a frozen array rather than one blob so a rendering surface can lay the points out without
// re-splitting prose, and so a diff of this file shows exactly which sentence changed on a version
// bump.
export const NATURAL_LANGUAGE_SEARCH_DISCLOSURE_STATEMENTS: readonly string[] = Object.freeze([
  "The extracted text of your firm's working documents — not the original files — is copied into Cloudflare-managed storage and a Cloudflare-managed search index, outside your firm's own file storage and outside your firm's own database. That store is not one this platform can name, inspect, enumerate, or partition.",
  "Embeddings and result reranking are computed by Cloudflare Workers AI. No third-party model provider is involved at any point, and nothing is generated: the feature returns passages from your firm's own documents, never composed prose.",
  "A member's typed question is transmitted to Cloudflare Workers AI so it can be matched against those passages.",
  "The search index is not authoritative. It is derived from documents your firm holds, and every result is re-checked against your firm's own records before it is shown to anyone.",
  "Data residency: the location of the managed index is not one this platform can specify or verify, and no guarantee is offered. A firm with a data-residency obligation should not enable this feature.",
  "Deletion: when you turn this off, the platform deletes the extracted text it wrote and can show you the record of having done so. Deletion of the managed index is a request made to Cloudflare whose completeness this platform cannot demonstrate. A firm that requires provable erasure from every store should not enable this feature.",
  "The search index is behind — by up to an hour plus the time a sync takes — and every result says how far behind it is.",
  "Cost: Cloudflare has this product in open beta with preview pricing and billing not yet enabled. When Cloudflare begins billing, this becomes a metered feature, and your firm will be told before that happens.",
  "Whether your firm's own client agreements permit any of this is your firm's judgement, not the platform's.",
]);

// The whole statement as one block, for a surface that wants to store or render it verbatim.
export function naturalLanguageSearchDisclosureText(): string {
  return NATURAL_LANGUAGE_SEARCH_DISCLOSURE_STATEMENTS.join("\n\n");
}
