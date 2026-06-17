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
  readonly allowedContentTypes: readonly string[]; // exact, or "type/*" prefix wildcard
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
    "application/vnd.oasis.opendocument.*",
    "application/rtf",
    "text/*",
    "image/*",
    "audio/*",
    "video/*",
    "application/zip",
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

// The total-bytes ceiling above which a bulk ZIP download should hand off to an asynchronous job
// rather than stream inline. Read and recorded in the download audit row today; the async-job path
// that acts on it is built in a later phase. Default 2 GiB.
export const zipAsyncThresholdDefinition: FirmSettingDefinition<number> = {
  key: "fileManager.zipAsyncThresholdBytes",
  schema: z.number().int().positive(),
  defaultValue: 2 * GIBIBYTE,
};

// The maximum byte size of a document that the ingest pipeline will attempt to inspect for
// schema extraction, type detection, and metadata enrichment. Documents larger than this cap
// are marked as uninspectable and skip enrichment. Default 2 GiB.
export const inspectableSizeCapDefinition: FirmSettingDefinition<number> = {
  key: "fileManager.inspectableSizeCapBytes",
  schema: z.number().int().positive(),
  defaultValue: 2 * GIBIBYTE,
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

export function readInspectableSizeCap(database: SqlDatabase): Promise<number> {
  return readFirmSetting(database, inspectableSizeCapDefinition);
}

function contentTypeAllowed(allowed: readonly string[], contentType: string): boolean {
  const normalized = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  return allowed.some((pattern) => {
    if (pattern.endsWith("/*")) return normalized.startsWith(pattern.slice(0, -1));
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
