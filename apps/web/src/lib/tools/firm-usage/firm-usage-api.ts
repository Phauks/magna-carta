/*
 * The Firm Usage tool's one read — the whole page is a single GET, computed server-side when asked.
 *
 * Mirrors the `firmUsage.get` operation in apps/api-worker/openapi/openapi.json. `apps/web`
 * hand-writes the response shapes it reads (the transport seam in $lib/api/request.ts says why), so
 * each type here is the wire shape the page actually reads and nothing more — fields the screen has
 * no use for are left off, and the page does the presenting.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** The permission a reader needs. A member without it is refused server-side. */
export const READ_FIRM_USAGE_PERMISSION = "tools:firmUsage";

/** One storage class's footprint in the firm's bucket. */
export interface StorageClassTotals {
  bytes: number;
  objects: number;
}

export interface FirmUsageStorage {
  totalBytes: number;
  totalObjects: number;
  byStorageClass: {
    standard: StorageClassTotals;
    infrequent_access: StorageClassTotals;
  };
}

/** One row per matter type in the firm's own catalog; null collects the matters with no type. */
export interface MattersByTypeRow {
  matterTypeName: string | null;
  prospective: number;
  open: number;
  closed: number;
  total: number;
}

export interface CountAndBytes {
  count: number;
  bytes: number;
}

/** The versioning breakdown: currentFiles + priorVersions = allVersions, deletedFiles beside them. */
export interface FirmUsageFiles {
  currentFiles: CountAndBytes;
  priorVersions: CountAndBytes;
  allVersions: CountAndBytes;
  deletedFiles: CountAndBytes;
}

export interface FirmUsageLocationRow {
  name: string;
  status: "active" | "closed";
  matters: number;
  members: number;
  custodyItems: number;
}

export interface FirmUsageByLocation {
  rows: FirmUsageLocationRow[];
  mattersWithoutLocation: number;
  // Custody-register items held under an external root (a bank vault, an offsite vendor) — real
  // holdings at none of the firm's offices.
  custodyItemsOffsite: number;
}

export interface FirmUsageDirectory {
  people: number;
  organizations: number;
  activeMembers: number;
}

/**
 * The AI meters, all-time. `notMetered` is a list of NAMED GAPS: what this feature costs that
 * cannot be measured per firm, so the surface says so rather than showing a zero.
 */
export interface FirmUsageAi {
  magnusTokens: { inputTokens: number; outputTokens: number; requests: number };
  searchQueries: { semantic: number; fullText: number };
  detection: { requests: number; words: number };
  notMetered: string[];
}

export interface FirmUsageResponse {
  storage: FirmUsageStorage;
  mattersByType: MattersByTypeRow[];
  files: FirmUsageFiles;
  byLocation: FirmUsageByLocation;
  directory: FirmUsageDirectory;
  aiUsage: FirmUsageAi;
}

/** The firm's usage snapshot, computed on this request — nothing is cached or stored. */
export function readFirmUsage(fetchImpl: typeof fetch): Promise<ApiOutcome<FirmUsageResponse>> {
  return requestJson(fetchImpl, "/api/v1/firm-usage");
}
