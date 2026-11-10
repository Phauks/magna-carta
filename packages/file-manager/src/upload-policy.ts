import {
  readFirmSetting,
  type FirmSettingDefinition,
} from "@magna-carta/data-access/setting-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { z } from "zod";
import { FileManagerValidationError } from "./validation.ts";

// Per-firm upload policy: a size cap, a content-type allow-list, and an extension blocklist. Enforced
// at presign against the DECLARED size/type, then re-verified at the ingest gate against the real
// bytes (the sniffed type) — a declared lie cannot smuggle a blocked type past the gate.
export interface UploadPolicy {
  readonly maxSizeBytes: number;
  readonly allowedContentTypes: readonly string[]; // exact, or a trailing-`*` prefix wildcard
  // (e.g. "text/*", or "application/vnd.openxmlformats-officedocument.*" for all OOXML types)
  readonly blockedExtensions: readonly string[]; // lowercase, dot-prefixed (".exe")
}

const GIBIBYTE = 1024 * 1024 * 1024;

// The permissive launch policy: common document/image/audio/video/archive/email types, executables
// and scripts blocked by extension (and by sniffed type at the gate). A firm can tighten it; the
// stored value is validated on read, so a corrupt write falls back to this default rather than
// bricking uploads.
export const DEFAULT_UPLOAD_POLICY: UploadPolicy = {
  maxSizeBytes: 50 * GIBIBYTE,
  allowedContentTypes: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.*",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    // The gate re-checks against the SNIFFED type, and every pre-2007 Office document sniffs as the
    // compound-file container rather than as msword/ms-excel/ms-powerpoint above — those three names
    // only ever arrive as a client's declaration. Without the container type here, allowing the
    // declared names allows nothing: each .doc/.xls/.ppt clears initiate and is quarantined at the
    // gate. Executables that share the container (.msi) are refused by the extension blocklist below.
    "application/x-cfb",
    "application/vnd.oasis.opendocument.*",
    "application/rtf",
    "text/*",
    "image/*",
    "audio/*",
    "video/*",
    "application/zip",
    // Windows browsers declare a .zip as application/x-zip-compressed (and some legacy stacks as
    // application/x-compressed), so allowing only application/zip refuses every zip uploaded from
    // Windows at initiate. The gate still re-checks the SNIFFED type, which reports the real
    // container, so admitting the declared aliases widens nothing at the byte level.
    "application/x-zip-compressed",
    "application/x-compressed",
    "application/x-7z-compressed",
    "application/x-tar",
    "application/gzip",
    "application/x-rar-compressed",
    "message/rfc822",
    "application/vnd.ms-outlook",
  ],
  blockedExtensions: [
    ".exe",
    ".bat",
    ".cmd",
    ".com",
    ".scr",
    ".msi",
    ".dll",
    ".sh",
    ".ps1",
    ".vbs",
    ".js",
    ".mjs",
    ".jar",
    ".app",
    ".deb",
    ".rpm",
  ],
};

const uploadPolicySchema: z.ZodType<UploadPolicy> = z.object({
  maxSizeBytes: z.number().int().positive(),
  allowedContentTypes: z.array(z.string()),
  blockedExtensions: z.array(z.string()),
});

export const uploadPolicyDefinition: FirmSettingDefinition<UploadPolicy> = {
  key: "fileManager.uploadPolicy",
  schema: uploadPolicySchema,
  defaultValue: DEFAULT_UPLOAD_POLICY,
};

// Single-shot PUT at or below the threshold; multipart above it. Default 100 MB.
export const modeThresholdDefinition: FirmSettingDefinition<number> = {
  key: "fileManager.modeThresholdBytes",
  schema: z.number().int().positive(),
  defaultValue: 100 * 1024 * 1024,
};

// Superseded by liveMaxFileCountDefinition + liveMaxTotalBytesDefinition below: a single byte ceiling
// missed the real driver — a selection of many small files is just as retry-unfriendly to stream
// inline as one large one. The download route now decides on the two knobs (count OR bytes), not this.
// Kept readable for one release so an already-stored firm value isn't orphaned mid-migration. Default 2 GiB.
export const zipAsyncThresholdDefinition: FirmSettingDefinition<number> = {
  key: "fileManager.zipAsyncThresholdBytes",
  schema: z.number().int().positive(),
  defaultValue: 2 * GIBIBYTE,
};

// Above either knob the bulk download hands off to the async build job instead of streaming inline.
// File count and total bytes are independent triggers: a huge fan-out of small files (count) is as
// stream-unfriendly as a few large ones (bytes). The route hands off when fileCount > liveMaxFileCount
// OR totalBytes > liveMaxTotalBytes. Defaults: 1000 files, 2 GiB.
export const liveMaxFileCountDefinition: FirmSettingDefinition<number> = {
  key: "fileManager.liveMaxFileCount",
  schema: z.number().int().positive(),
  defaultValue: 1000,
};

export const liveMaxTotalBytesDefinition: FirmSettingDefinition<number> = {
  key: "fileManager.liveMaxTotalBytes",
  schema: z.number().int().positive(),
  defaultValue: 2 * GIBIBYTE,
};

const MEBIBYTE = 1024 * 1024;

// THE MOST A WORKER WILL HOLD IN MEMORY TO INSPECT ONE DOCUMENT: 40 MiB.
//
// Inspecting a document means reading the whole of it into the isolate — the ingest gate feeds the
// digest and the scan engine from one in-memory copy, and the inline routes (OCR, repair, integrity,
// decryption, seal) decode or load the whole body — and a Worker isolate has 128 MB in total. The
// figure is sized against that budget, not against how large a document a firm would like scanned:
//
//   - the ingest gate holds the body ONCE (allocated at its reported size, the digest computed while
//     it fills), so its peak is the document plus one chunk off the wire — under a third of the
//     isolate, leaving the rest for the runtime's own heap, the loaded modules, and the other work of
//     the queue batch;
//   - it is at or above the largest message either email capture entrance accepts (40 MiB), so no
//     filed email is passed over by the scan merely for its size.
//
// Anything larger is not refused: the ingest gate streams it through the digest without buffering and
// commits it as `unscanned` with the detail `oversize`, which is what a long meeting recording or a
// large evidence file is. A multi-gigabyte default here, which this replaced, sent a one-hour
// recording down the in-memory lane and out of memory on every attempt, so it never committed at all.
export const IN_MEMORY_INSPECTION_CEILING_BYTES = 40 * MEBIBYTE;

// The maximum byte size of a document a firm wants inspected (scanned, sniffed, enriched). A firm may
// set it LOWER than the platform ceiling above; it can never raise the effective value past it, because
// the ceiling is a fact about Worker memory rather than a policy — readInspectableSizeCap applies it on
// every read, and runIngest applies it again for a caller that builds its input by hand. Documents over
// the effective cap commit as uninspectable and skip enrichment. Default: the ceiling.
export const inspectableSizeCapDefinition: FirmSettingDefinition<number> = {
  key: "fileManager.inspectableSizeCapBytes",
  schema: z.number().int().positive(),
  defaultValue: IN_MEMORY_INSPECTION_CEILING_BYTES,
};

// The signature-engine identity (engine + signature-database version) that scans run under, set by
// the engine-rollout/deploy process. A re-scan is triggered on access only when a version's stored
// scan_engine_version differs from this; the dedup cache is keyed on it so a database update is a
// deliberate cache miss. Default null: when unset, the re-scan path must fall through to a real scan
// and never fabricate a cache key from a missing version — correctness over the dedup skip.
export const scanEngineVersionDefinition: FirmSettingDefinition<string | null> = {
  key: "fileManager.scanEngineVersion",
  schema: z.string().min(1).nullable(),
  defaultValue: null,
};

// Constraints on archive expansion limits for the scan engine: max directory depth, max entries
// per archive, max uncompressed total, and max expansion ratio (uncompressed / compressed).
// These prevent zip bombs and pathological archives from consuming unbounded resources.
export interface ArchiveCaps {
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxUncompressedBytes: number;
  readonly maxExpansionRatio: number;
}

export const archiveCapsDefinition: FirmSettingDefinition<ArchiveCaps> = {
  key: "fileManager.archiveCaps",
  schema: z.object({
    maxDepth: z.number().int().positive(),
    maxEntries: z.number().int().positive(),
    maxUncompressedBytes: z.number().int().positive(),
    maxExpansionRatio: z.number().int().positive(),
  }),
  defaultValue: {
    maxDepth: 16,
    maxEntries: 10000,
    maxUncompressedBytes: 4 * GIBIBYTE,
    maxExpansionRatio: 100,
  },
};

export function readUploadPolicy(database: SqlDatabase): Promise<UploadPolicy> {
  return readFirmSetting(database, uploadPolicyDefinition);
}

export function readArchiveCaps(database: SqlDatabase): Promise<ArchiveCaps> {
  return readFirmSetting(database, archiveCapsDefinition);
}

// The firm's cap, bounded by what a Worker can hold: a stored value above the ceiling (written before
// the ceiling existed, or by hand) reads as the ceiling, so no caller that buffers a document on the
// strength of this number can be talked into an out-of-memory.
export async function readInspectableSizeCap(database: SqlDatabase): Promise<number> {
  const firmCap = await readFirmSetting(database, inspectableSizeCapDefinition);
  return Math.min(firmCap, IN_MEMORY_INSPECTION_CEILING_BYTES);
}

export function readScanEngineVersion(database: SqlDatabase): Promise<string | null> {
  return readFirmSetting(database, scanEngineVersionDefinition);
}

export function readLiveMaxFileCount(database: SqlDatabase): Promise<number> {
  return readFirmSetting(database, liveMaxFileCountDefinition);
}

export function readLiveMaxTotalBytes(database: SqlDatabase): Promise<number> {
  return readFirmSetting(database, liveMaxTotalBytesDefinition);
}

function contentTypeAllowed(allowed: readonly string[], contentType: string): boolean {
  const normalized = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  return allowed.some((pattern) => {
    // A trailing `*` is a prefix wildcard. Supports both the MIME `type/*` form ("text/*") AND the
    // longer dotted prefixes the OOXML/OpenDocument families need
    // ("application/vnd.openxmlformats-officedocument.*"), which `/*`-only matching silently dropped —
    // so Word/Excel/PowerPoint/OpenDocument uploads were rejected despite being in the default policy.
    if (pattern.endsWith("*")) return normalized.startsWith(pattern.slice(0, -1));
    return normalized === pattern;
  });
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

// Throws a named-code refusal when the declared size or type violates the policy. The size check is
// against the declared size; the gate re-checks the real size too.
export function checkUploadPolicy(
  policy: UploadPolicy,
  candidate: { sizeBytes: number | null; contentType: string | null; fileName: string },
): void {
  if (candidate.sizeBytes !== null && candidate.sizeBytes > policy.maxSizeBytes) {
    throw new FileManagerValidationError(
      "upload-policy-size",
      `upload exceeds the ${policy.maxSizeBytes}-byte limit`,
    );
  }
  if (policy.blockedExtensions.includes(extensionOf(candidate.fileName))) {
    throw new FileManagerValidationError(
      "upload-policy-type",
      `file extension is blocked: ${candidate.fileName}`,
    );
  }
  if (
    candidate.contentType !== null &&
    !contentTypeAllowed(policy.allowedContentTypes, candidate.contentType)
  ) {
    throw new FileManagerValidationError(
      "upload-policy-type",
      `content type is not allowed: ${candidate.contentType}`,
    );
  }
}
