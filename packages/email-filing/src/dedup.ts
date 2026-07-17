import type { ParsedMessage } from "@magna-carta/email";

// The basis a dedup key was derived from. Kept alongside the key so a caller can tell a
// Message-ID-backed convergence (identical in every recipient's copy) from a content-hash fallback
// (a best-effort match when an identifier was stripped or rewritten in transit).
export type DedupBasis = "messageId" | "contentHash";

export interface DedupDecision {
  readonly key: string;
  readonly basis: DedupBasis;
}

// Derive the per-firm dedup key for a parsed message.
//
// When the message carries a Message-ID, that value IS the identity — it is identical in every
// recipient's copy, so two people capturing the same mail converge to one row for free. The provenance
// is folded into the key (`messageId:header:` vs `messageId:mapi:`) rather than flattened away: a
// `.msg` MAPI-synthesized identifier is not the same bytes another recipient's `.eml` header carries,
// and collapsing them would falsely merge two genuinely different captures (the parse engine preserves
// this distinction for the same reason).
//
// When there is no identifier (stripped or never present), fall back to a content hash over the
// normalized headers plus the first text body — a canonical form that survives the whitespace and
// header-casing churn forwarders introduce, so cross-inbox copies still converge.
export async function deriveDedupKey(message: ParsedMessage): Promise<DedupDecision> {
  const identifier = message.messageIdentifier;
  if (identifier.value !== null && identifier.provenance !== "absent") {
    return { key: `messageId:${identifier.provenance}:${identifier.value}`, basis: "messageId" };
  }
  const canonical = canonicalizeForHash(message);
  const digest = await sha256Hex(canonical);
  return { key: `contentHash:${digest}`, basis: "contentHash" };
}

// The canonical string a content-hash key is taken over: the address/subject headers in a fixed order
// with canonical (lowercased) names and trimmed values, followed by the first text/plain body with
// runs of whitespace collapsed. Deterministic across two recipient copies of the same message even
// when a forwarder rewrote header casing or reflowed the body.
export function canonicalizeForHash(message: ParsedMessage): string {
  const headerLines: string[] = [];
  const pushAddresses = (name: string, addresses: ParsedMessage["from"]): void => {
    const rendered = addresses
      .map((address) => (address.address ?? "").trim().toLowerCase())
      .filter((value) => value.length > 0)
      .sort()
      .join(",");
    headerLines.push(`${name}:${rendered}`);
  };
  pushAddresses("from", message.from);
  pushAddresses("to", message.to);
  pushAddresses("cc", message.cc);
  headerLines.push(`subject:${(message.subject ?? "").trim()}`);
  const body = collapseWhitespace(message.textBodies[0] ?? "");
  return `${headerLines.join("\n")}\n\n${body}`;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
