// The safe-delivery header set stamped on every cookieless preview 200/206/416. Untrusted bytes are
// served from a cookieless origin so a malicious file reaches only the media decoder, never a
// privileged origin or an HTML/script parser. Content-Disposition: attachment is a no-op for a
// <video>/<audio> subresource (so the file plays) yet honored for a top-level navigation (so a direct
// hit downloads) — kept verbatim, never relaxed to inline. The Content-Type is the SERVER-sniffed
// type, never the attacker-controlled declared type, and never an octet-stream fallback.
// Access-Control-Allow-Origin is sent only to one of the app's own pages (readerOrigin, chosen by the
// serve route from the app's own host, the same set frame-ancestors names) and never as a wildcard: the player
// loads the recording with crossorigin="anonymous" so it can draw a frame into a canvas and read it
// back (a screenshot, a hover thumbnail), which a browser refuses for an un-granted cross-origin
// picture. Granting the app's own origin adds no reach: the token in the address already lets that
// page download the same bytes. A request from anywhere else gets no grant, and the media element
// still plays without one when it asks without crossorigin. frameAncestors is the CSP frame-ancestors source — the app origins allowed to embed a
// rendition. It names the app's host and a WILDCARD over it (every branded per-firm app subdomain), not a
// single fixed app host, because firms get per-firm subdomains. The embedding origin is never the
// authorization gate (the signed, firm-scoped token names one object), so widening it cannot cross
// tenants. Reasoning home: docs/conventions/security.md (untrusted file handling).
export interface SafeDeliveryHeaderInput {
  readonly sniffedContentType: string;
  readonly frameAncestors: string;
  /** The app page reading the bytes, when it is one of ours; granted CORS read access alone. */
  readonly readerOrigin?: string | null;
}

export function buildSafeDeliveryHeaders(input: SafeDeliveryHeaderInput): Headers {
  const headers = new Headers();
  headers.set("Content-Disposition", "attachment");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Type", input.sniffedContentType);
  headers.set(
    "Content-Security-Policy",
    `sandbox; default-src 'none'; frame-ancestors ${input.frameAncestors}`,
  );
  headers.set("Cache-Control", "private, no-store");
  headers.set("Accept-Ranges", "bytes");
  // The answer differs by who asked, so a cache must key it by the Origin header too.
  headers.set("Vary", "Origin");
  if (input.readerOrigin !== undefined && input.readerOrigin !== null) {
    headers.set("Access-Control-Allow-Origin", input.readerOrigin);
    headers.set("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges");
  }
  return headers;
}
