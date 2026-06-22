import type { CleanVersionForPreview } from "./queries.ts";

// The shallow safe-rendition gate: a PURE decision over a clean version row, the one place where the
// verdict AND the content-type that frames it are decided together — so the grant descriptor and the
// cookieless header set can never disagree. Fail-safe direction is load-bearing: only a positive
// 'playable' (with a known sniffed type, standard tier, full encoding, non-derived role) unlocks
// inline media; a never-sniffed (NULL), undecidable, OR unrecognized verdict can never be served
// inline. A wrong verdict degrades to "undecodable video", never "rendered active document" (the bytes
// only ever reach the media decoder via the <video> subresource). 'derived' and non-'full' encoding
// are inert today (the current version is original + full) but future-proof the rendition + delta seams.
export type PreviewDecision =
  | { kind: "inline-media"; r2Key: string; sniffedContentType: string; sizeBytes: number | null }
  | {
      kind: "download-only";
      reason: "verdict" | "unknown-verdict" | "tiered" | "encoded" | "derived" | "unknown-type";
    };

export function decidePreview(version: CleanVersionForPreview): PreviewDecision {
  // Verdict check first: NULL (never scanned) and any unrecognized string both collapse to download-only.
  // Only the explicit 'playable' string advances — this is the stored-XSS regression guard.
  if (version.inlinePlayable !== "playable") {
    return {
      kind: "download-only",
      reason: version.inlinePlayable === null ? "unknown-verdict" : "verdict",
    };
  }
  // Content-type guard: a playable verdict without a known, HEADER-SAFE sniffed type cannot set the
  // response Content-Type header safely, so it must never be served inline. The pattern rejects empty,
  // CR/LF, and any non-printable byte — a header-unsafe value (reachable not via today's magic-byte
  // lookup but via a future transcode-rendition sniffed type, the documented forward seam) would make
  // Headers.set throw on the cookieless edge, so it degrades to download-only here rather than minting
  // an inline grant.
  if (version.sniffedContentType === null || !/^[\x20-\x7e]+$/.test(version.sniffedContentType)) {
    return { kind: "download-only", reason: "unknown-type" };
  }
  // Storage class: infrequent_access objects are not pulled to the edge for inline streaming.
  if (version.storageClass !== "standard") {
    return { kind: "download-only", reason: "tiered" };
  }
  // Encoding: only 'full' (verbatim bytes) can be streamed as-is; delta-encoded objects need
  // reconstruction before they can be served.
  if (version.storageEncoding !== "full") {
    return { kind: "download-only", reason: "encoded" };
  }
  // Artifact role: derived renditions (thumbnails, transcodes) are not served inline directly;
  // only the original is served through the preview path.
  if (version.artifactRole === "derived") {
    return { kind: "download-only", reason: "derived" };
  }
  return {
    kind: "inline-media",
    r2Key: version.r2Key,
    sniffedContentType: version.sniffedContentType,
    sizeBytes: version.sizeBytes,
  };
}
