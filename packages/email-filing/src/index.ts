// @magna-carta/email-filing — the pure record-model + capture-orchestration core for filing email to
// matters. Dedup, thread-DAG linking, and the parsed-message → record-row mapping live here as pure
// functions (no I/O); `captureEmail` orchestrates them over injected ports (parse, R2, statements) so
// the two entrances — the forward/CC Email Worker and the authenticated file-to-matter API — converge
// on one operation and one record.

export { deriveDedupKey, canonicalizeForHash } from "./dedup.ts";
export type { DedupBasis, DedupDecision } from "./dedup.ts";
export { linkThread, candidateParents, normalizeSubject } from "./thread.ts";
export type { ThreadLookup, ThreadLinkDecision } from "./thread.ts";
export { toRecordRows, normalizeAddress } from "./record.ts";
export { captureEmail } from "./capture.ts";
export type {
  CapturePorts,
  CaptureRequest,
  CaptureResult,
  CaptureLinkPlan,
  CaptureWritePlan,
  PersistedOriginal,
} from "./capture.ts";
export {
  checkFilingConflict,
  raiseEmailFiledNotification,
  DKIM_VERDICT_UNVERIFIED,
} from "./seams.ts";
export type {
  FilingConflictInput,
  FilingConflictResult,
  EmailFiledNotification,
} from "./seams.ts";
export type {
  CapturedVia,
  DkimVerdict,
  EmailMessageRow,
  EmailParticipantRow,
  EmailThreadRow,
  MessageIdProvenance,
  ParticipantKind,
  RecordContext,
  RecordRows,
} from "./record.ts";
