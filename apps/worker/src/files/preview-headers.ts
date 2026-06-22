// The safe-delivery header set stamped on every cookieless preview 200/206/416. Untrusted bytes are
// served from a cookieless origin so a malicious file reaches only the media decoder, never a
// privileged origin or an HTML/script parser. Content-Disposition: attachment is a no-op for a
// <video>/<audio> subresource (so the file plays) yet honored for a top-level navigation (so a direct
// hit downloads) — kept verbatim, never relaxed to inline. The Content-Type is the SERVER-sniffed
// type, never the attacker-controlled declared type, and never an octet-stream fallback. No
// Access-Control-Allow-Origin is sent: a native <video src> subresource needs no CORS, so the host
// grants none. Reasoning home: docs/conventions/security.md (untrusted file handling).
export interface SafeDeliveryHeaderInput {
  readonly sniffedContentType: string;
  readonly appOrigin: string;
}

export function buildSafeDeliveryHeaders(input: SafeDeliveryHeaderInput): Headers {
  const headers = new Headers();
  headers.set("Content-Disposition", "attachment");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Type", input.sniffedContentType);
  headers.set(
    "Content-Security-Policy",
    `sandbox; default-src 'none'; frame-ancestors ${input.appOrigin}`,
  );
  headers.set("Cache-Control", "private, no-store");
  headers.set("Accept-Ranges", "bytes");
  return headers;
}
