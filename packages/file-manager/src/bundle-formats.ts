import type { BundleFormat, BundleOptions } from "./bundle-options.ts";

// One source of truth for what each output format can do. The UI gates its option controls off this,
// the worker validates a request against it, and the container builder reads the same table — so a new
// format is one row here, never a change spread across callers.
export interface FormatCapabilities {
  readonly extension: string; // the artifact's file extension, no dot
  readonly supportsCompression: boolean;
  readonly supportsEncryption: boolean;
  readonly supportsHeaderEncryption: boolean; // encrypt the file LIST, not just contents
  readonly supportsSplit: boolean;
}

export const FORMAT_CAPABILITIES: Record<BundleFormat, FormatCapabilities> = {
  zip: {
    extension: "zip",
    supportsCompression: true,
    supportsEncryption: true,
    supportsHeaderEncryption: false, // ZIP AES leaves the file list visible
    supportsSplit: false, // PKWARE disk-spanning (.z01) is not writable by any Rust crate; split is 7z-only
  },
  sevenZip: {
    extension: "7z",
    supportsCompression: true,
    supportsEncryption: true,
    supportsHeaderEncryption: true,
    supportsSplit: true,
  },
};

export function capabilitiesFor(format: BundleFormat): FormatCapabilities {
  return FORMAT_CAPABILITIES[format];
}

// Cross-field, capability-aware validation beyond the schema's structural checks. Returns one human
// string per violation; an empty array means the options are coherent for their format.
export function validateOptionsForFormat(options: BundleOptions): readonly string[] {
  const capabilities = capabilitiesFor(options.format);
  const errors: string[] = [];
  if (options.encryption?.encryptFileNames === true && !capabilities.supportsHeaderEncryption) {
    errors.push(`${options.format} cannot encrypt file names; only encrypts file contents`);
  }
  if (options.encryption !== null && !capabilities.supportsEncryption) {
    errors.push(`${options.format} does not support encryption`);
  }
  if (options.split !== null && !capabilities.supportsSplit) {
    errors.push(`${options.format} does not support splitting`);
  }
  return errors;
}
