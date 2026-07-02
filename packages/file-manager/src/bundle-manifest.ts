import type { BundleOptions } from "./bundle-options.ts";
import { applyBundleLayout } from "./bundle-layout.ts";
import type { ResolvedZip } from "./zip-composition.ts";
import { buildContentsManifest, type ManifestEntry } from "./contents-manifest.ts";

// The build request the worker sends the bundle container. Byte-compatible with the container's Rust
// `BuildRequest` (camelCase serde). Bytes never appear here — only R2 keys, plus optional inline bytes
// for a generated CONTENTS file. The password rides `options.encryption` for the streamed encrypted lane
// only and is never persisted.
// The discriminator is flattened onto the entry (`source: "r2" | "inline"` + its data alongside the
// shared fields), matching the container's Rust `Entry` (a struct with a `#[serde(flatten)]`
// internally-tagged `EntrySource` enum). Wire JSON: `{archivePath, mtimeEpochSecs, source:"r2", r2Key}`
// or `{archivePath, mtimeEpochSecs, source:"inline", bytesBase64}`.
export type BundleManifestEntry = {
  readonly archivePath: string;
  readonly mtimeEpochSecs: number | null;
} & (
  | { readonly source: "r2"; readonly r2Key: string }
  | { readonly source: "inline"; readonly bytesBase64: string }
);

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
    source: "r2",
    r2Key: entry.r2Key,
  }));

  const allEntries: BundleManifestEntry[] = [...fileEntries];

  if (options.manifest) {
    const contentsText = buildContentsManifest(manifestEntries);
    allEntries.push({
      archivePath: "CONTENTS.txt",
      mtimeEpochSecs: null,
      source: "inline",
      bytesBase64: textToBase64(contentsText),
    });
  }

  let encryption: BundleManifest["encryption"] = null;
  if (options.encryption !== null) {
    // The contract is that a caller requesting encryption supplies the password; enforce it at runtime
    // (not just a non-null assertion) so a null password can never reach the manifest as `{password: null}`.
    if (password === null) {
      throw new Error("buildBundleManifest: a password is required when options.encryption is set");
    }
    encryption = { password, encryptFileNames: options.encryption.encryptFileNames };
  }

  const split = options.split === null ? null : { maxPartBytes: options.split.maxPartBytes };

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
