import type { BundleOptions } from "./bundle-options.ts";
import { applyBundleLayout } from "./bundle-layout.ts";
import type { ResolvedZip } from "./zip-composition.ts";
import { buildContentsManifest, type ManifestEntry } from "./contents-manifest.ts";

// The build request the worker sends the bundle container. Byte-compatible with the container's Rust
// `BuildRequest` (camelCase serde). Bytes never appear here — only R2 keys, plus optional inline bytes
// for a generated CONTENTS file. The password rides `options.encryption` for the streamed encrypted lane
// only and is never persisted.
export interface BundleManifestEntry {
  readonly archivePath: string;
  readonly mtimeEpochSecs: number | null;
  readonly source:
    | { readonly source: "r2"; readonly r2Key: string }
    | { readonly source: "inline"; readonly bytesBase64: string };
}

export interface BundleManifest {
  readonly jobId: string;
  readonly format: BundleOptions["format"];
  readonly compression: BundleOptions["compression"];
  readonly encryption: { readonly password: string; readonly encryptFileNames: boolean } | null;
  readonly split: { readonly maxPartBytes: number } | null;
  readonly entries: readonly BundleManifestEntry[];
  readonly outputKeyPrefix: string;
}

// Encodes a UTF-8 string to standard base64. Iterating over the byte array one element at a time
// avoids spread-operator stack limits on large inputs and removes any dependency on Node's Buffer.
// btoa and TextEncoder are available in both the Workers runtime and Node.
function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export interface BuildBundleManifestArgs {
  readonly jobId: string;
  readonly resolved: ResolvedZip;
  readonly options: BundleOptions;
  /** The archive password. Must be non-null when options.encryption is non-null. */
  readonly password: string | null;
  readonly manifestEntries: readonly ManifestEntry[];
  readonly outputKeyPrefix: string;
  readonly mtimeByR2Key: ReadonlyMap<string, number | null>;
}

export function buildBundleManifest(args: BuildBundleManifestArgs): BundleManifest {
  const { jobId, resolved, options, password, manifestEntries, outputKeyPrefix, mtimeByR2Key } =
    args;

  const laidOut = applyBundleLayout(resolved, options);

  const fileEntries: BundleManifestEntry[] = laidOut.entries.map((entry) => ({
    archivePath: entry.path,
    mtimeEpochSecs: mtimeByR2Key.get(entry.r2Key) ?? null,
    source: { source: "r2", r2Key: entry.r2Key },
  }));

  const allEntries: BundleManifestEntry[] = [...fileEntries];

  if (options.manifest) {
    const contentsText = buildContentsManifest(manifestEntries);
    allEntries.push({
      archivePath: "CONTENTS.txt",
      mtimeEpochSecs: null,
      source: { source: "inline", bytesBase64: textToBase64(contentsText) },
    });
  }

  const encryption =
    options.encryption === null
      ? null
      : {
          // password is guaranteed non-null by callers that set encryption (the encrypted stream
          // lane always supplies it; the non-null assertion is safe by contract).
          password: password!,
          encryptFileNames: options.encryption.encryptFileNames,
        };

  const split =
    options.split === null ? null : { maxPartBytes: options.split.maxPartBytes };

  return {
    jobId,
    format: options.format,
    compression: options.compression,
    encryption,
    split,
    entries: allEntries,
    outputKeyPrefix,
  };
}
