export const PACKAGE_NAME = "@magna-carta/file-type";
export type { RawIdentifyResult } from "./raw.ts";
export { UNKNOWN_LABELS } from "./raw.ts";
export type { ExtensionMatch, FileTypeReport } from "./report.ts";
export { buildFileTypeReport } from "./report.ts";
export { canonicalExtensions, humanLabel } from "./labels.ts";
export { claimedExtensionOf } from "./filename.ts";
