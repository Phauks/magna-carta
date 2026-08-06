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
export type { FilingConflictInput, FilingConflictResult, EmailFiledNotification } from "./seams.ts";
export {
  candidateMatterNumbers,
  rankMatterSuggestions,
  MAX_SUBJECT_NUMBER_CANDIDATES,
} from "./matter-suggestion.ts";
export type {
  MatterSuggestion,
  MatterSuggestionConfidence,
  MatterSuggestionEvidence,
  MatterSuggestionRanking,
  MatterSuggestionSignal,
} from "./matter-suggestion.ts";
export {
  resolveAutoFileDecision,
  AUTO_FILE_ACTIVITY_WINDOW_LIMIT,
  AUTO_FILE_MAX_FIRES_PER_WINDOW,
  AUTO_FILE_MAX_UNDOS_IN_RECENT_FIRES,
  AUTO_FILE_RECENT_FIRE_WINDOW,
} from "./auto-file-rules.ts";
export type {
  AutoFileCandidateRule,
  AutoFileDecision,
  AutoFileDemotionReason,
  AutoFileEvidence,
  AutoFileExistingLink,
  AutoFilePromotion,
  AutoFileRuleKind,
  AutoFileRuleState,
  AutoFileSuppressionReason,
  AutoFileSuspendedReason,
  AutoFileSuspensionRecommendation,
  AutoFileTargetMatter,
} from "./auto-file-rules.ts";
export { verifyDkim, UNVERIFIED } from "./dkim.ts";
export type {
  DkimKeyLookup,
  DkimKeyLookupResult,
  DkimVerification,
  DkimVerdictReason,
  DkimVerifyOptions,
} from "./dkim.ts";
export {
  sniffMessageFormat,
  mediaTypeForMessageFormat,
  fileNameForMessageFormat,
  MAX_CAPTURED_MESSAGE_BYTES,
  EML_MEDIA_TYPE,
  MSG_MEDIA_TYPE,
} from "./message-format.ts";
export type { MessageFormat } from "./message-format.ts";
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
