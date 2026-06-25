import { HASH_ALGORITHMS, type BaselineComparison, type HashResult } from "./types.ts";

export interface ReceiptInput {
  readonly tool: { readonly name: string; readonly version: string };
  readonly firmName: string | null;
  readonly file: {
    readonly name: string | null;
    readonly fileId: string | null;
    readonly versionId: string | null;
  };
  readonly hashes: HashResult;
  // null for the standalone surface (no in-system file, no baseline, no audit record).
  readonly verification: {
    readonly baselineSha256: string | null;
    readonly comparison: BaselineComparison;
    readonly verifiedBy: string | null;
    readonly auditLogId: string | null;
  } | null;
  readonly computedAt: string;
}

export type ReceiptPayload = ReceiptInput;

// The structured receipt is the input verbatim — a single shape returned as JSON by the API and
// rendered to text for download. Kept as a function so a future signed/PDF receipt slots in here.
export function buildReceipt(input: ReceiptInput): ReceiptPayload {
  return input;
}

const RESULT_LABEL: Record<BaselineComparison, string> = {
  match: "MATCH",
  mismatch: "MISMATCH — bytes differ from the recorded baseline",
  "no-baseline": "NO BASELINE — no ingest digest recorded for this version",
};

const DIGEST_FIELD: Record<(typeof HASH_ALGORITHMS)[number], keyof HashResult> = {
  MD5: "md5",
  "SHA-1": "sha1",
  "SHA-256": "sha256",
  "SHA-384": "sha384",
  "SHA-512": "sha512",
};

// A fixed-width, human-readable receipt suitable for a .txt download or printing. Contains digests,
// byte size, the server timestamp, and (for a verify) the baseline result and audit correlation —
// never file contents.
export function renderReceiptText(payload: ReceiptPayload): string {
  const lines: string[] = [];
  lines.push(`${payload.tool.name} (v${payload.tool.version}) — hash receipt`);
  if (payload.firmName !== null) lines.push(`Firm: ${payload.firmName}`);
  if (payload.file.name !== null) lines.push(`File: ${payload.file.name}`);
  if (payload.file.fileId !== null) lines.push(`File ID: ${payload.file.fileId}`);
  if (payload.file.versionId !== null) lines.push(`Version ID: ${payload.file.versionId}`);
  lines.push(`Size: ${payload.hashes.sizeBytes} bytes`);
  lines.push(`Computed at: ${payload.computedAt}`);
  lines.push("");
  for (const algorithm of HASH_ALGORITHMS) {
    lines.push(`${algorithm.padEnd(8)} ${payload.hashes[DIGEST_FIELD[algorithm]]}`);
  }
  if (payload.verification !== null) {
    lines.push("");
    lines.push(`Baseline match: ${RESULT_LABEL[payload.verification.comparison]}`);
    if (payload.verification.baselineSha256 !== null) {
      lines.push(`Baseline SHA-256: ${payload.verification.baselineSha256}`);
    }
    if (payload.verification.verifiedBy !== null) {
      lines.push(`Verified by: ${payload.verification.verifiedBy}`);
    }
    if (payload.verification.auditLogId !== null) {
      lines.push(`Audit record: ${payload.verification.auditLogId}`);
    }
  }
  return lines.join("\n");
}
