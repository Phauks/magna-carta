import type { BundleOptions } from "@magna-carta/file-manager/bundle-options";

// The three delivery lanes for a bundle request. The lane is a pure function of the request options
// and has no side effects — the route dispatches on it, and tests exercise it in isolation.
//
// plain         — the existing client-zip fast lane: no container, no queue, streams inline or
//                 delegates to the coordinator with the plain manifest-hash cache key.
// heavyAsync    — a container build job (Rust compression / 7z / split volumes), queued via the
//                 coordinator. No password — the job message and artifact are persisted.
// encryptedStream — a container build streamed directly to the client: the password rides the live
//                 request only, no artifact is written, no cache key is stored.
export type BundleLane = "plain" | "heavyAsync" | "encryptedStream";

// Maps a bundle-options value (or its absence) to the delivery lane.
//
// Routing table:
//  undefined                                                        → plain  (legacy path, absent options)
//  format=zip AND compression=store AND encryption=null AND split=null → plain  (explicit defaults)
//  encryption !== null                                              → encryptedStream
//  anything else                                                    → heavyAsync
//
// The function never validates capability constraints (zip+split, encrypted+split, etc.) — that
// belongs to validateOptionsForFormat. Here only the structural routing properties matter.
export function selectBundleLane(options: BundleOptions | undefined): BundleLane {
  if (options === undefined) return "plain";

  const isPlainZip =
    options.format === "zip" &&
    options.compression === "store" &&
    options.encryption === null &&
    options.split === null;

  if (isPlainZip) return "plain";
  if (options.encryption !== null) return "encryptedStream";
  return "heavyAsync";
}
