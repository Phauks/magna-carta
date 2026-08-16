import type { FileId, FirmId } from "@magna-carta/identifiers/types";
import type { CorpusScope } from "./corpus.ts";

// NaturalLanguageSearchPort — the chokepoint the natural-language surface reaches the managed index
// through, named in this platform's vocabulary rather than a vendor's. Every outcome is a typed
// value and nothing throws, the discipline SearchIndexPort beside it already shares: a caller
// pattern-matches rather than catches.
//
// A SEPARATE PORT FROM SearchIndexPort, deliberately. `SearchIndexPort.query` is shaped by the
// keyword engine and the split catalog — it takes the split keys the caller resolved from the
// per-firm catalog, because the caller owns firm scoping and the engine never reaches the database.
// A managed index has no splits and no catalog to prune against, and forcing it into that signature
// would put a meaningless parameter on every call. What the two share is worth sharing: `CorpusScope`
// and the pointer discipline of `SearchHit`.
//
// THE POINTER DISCIPLINE IS THE WHOLE SAFETY ARGUMENT, so it is restated here rather than assumed. A
// hit carries pointers, and the caller re-resolves every one of them through the firm-scoped
// data-access layer and re-checks it against the caller's entitlement BEFORE any of its text is
// returned. The metadata filter the adapter sends is a recall and cost optimization — it keeps the
// result budget spent on documents the caller can actually see — and it is not the boundary. A hit
// that fails re-authorization is dropped, and the drop is a platform defect of the most serious
// kind rather than a routine condition.

// What a caller asks for. There is no filter argument and there is no place to put one: every
// metadata filter value the adapter sends is derived server-side from the authenticated session and
// the route's own path, and a request body field that reached a filter would be the whole
// vulnerability. `objectClasses` is the caller's INCLUDE list over a closed vocabulary — not a
// free-form string — so a surface that wants a class it does not get by default has to name it.
export interface NaturalLanguageSearchInput {
  readonly firmId: FirmId;
  /** The corpus the query runs over. One matter today; a firm-wide shape is its own decision. */
  readonly corpus: CorpusScope;
  /** The member's own words. Never logged, never audited, never put in a URL. */
  readonly text: string;
  readonly limit: number;
  readonly objectClasses: readonly "working-document"[];
}

// One returned passage, before re-authorization. It carries the pointers needed to resolve and
// re-check the document through the data-access layer, plus the chunk text the index returned —
// which may be DISPLAYED only after its pointer has passed that check, and is never the source of
// the citation. A renamed document cites its current name because the citation is hydrated from the
// firm's own records; a deleted one produces no hit at all rather than a dangling citation.
export interface NaturalLanguagePassage {
  readonly objectKey: string;
  readonly documentId: FileId;
  readonly version: number;
  readonly page?: number;
  readonly text: string;
  readonly score: number;
}

// How far behind the index is, on every response, whether or not the count is zero — a zero is
// informative, and an absent envelope reads as no warning rather than as no lag.
export interface NaturalLanguageFreshness {
  /** The instant of the last completed sync, from the instance's own sync status. */
  readonly indexedThrough: string | null;
  /** Feed objects written since that instant and not yet removed. From the platform's own catalog: exact, and cheap. */
  readonly pendingDocumentCount: number;
}

// The failure outcomes, each a state to report rather than an error to log.
//
//   instance-not-provisioned — no instance exists for this firm, or the deployment carries no
//                              binding to reach one. A firm that has just opted in has a
//                              provisioning job in flight and an index with nothing in it, and a
//                              deployment with no binding has an obviously-unavailable feature.
//                              Both are facts to state, and neither is a silent empty result.
//   not-enabled             — the firm's gate is shut. Read again here and not only at enqueue
//                              time, so a gate closed since a session started refuses rather than
//                              answering out of an index that is being deleted.
//   adapter-error           — the one outbound call failed. Carries a transport detail for the log
//                              and NEVER the query text.
export type NaturalLanguageSearchFailureReason =
  | "instance-not-provisioned"
  | "not-enabled"
  | "adapter-error";

export interface NaturalLanguageSearchFailure {
  readonly ok: false;
  readonly reason: NaturalLanguageSearchFailureReason;
  readonly detail?: string;
}

export type NaturalLanguageSearchResult =
  | {
      readonly ok: true;
      readonly passages: readonly NaturalLanguagePassage[];
      readonly freshness: NaturalLanguageFreshness;
    }
  | NaturalLanguageSearchFailure;

export interface NaturalLanguageSearchPort {
  naturalLanguageSearch(input: NaturalLanguageSearchInput): Promise<NaturalLanguageSearchResult>;
}

// ── Smart constructors ──────────────────────────────────────────────────────

export function naturalLanguagePassagesFound(
  passages: readonly NaturalLanguagePassage[],
  freshness: NaturalLanguageFreshness,
): NaturalLanguageSearchResult {
  return { ok: true, passages, freshness };
}

export function naturalLanguageInstanceNotProvisioned(
  detail?: string,
): NaturalLanguageSearchFailure {
  return detail === undefined
    ? { ok: false, reason: "instance-not-provisioned" }
    : { ok: false, reason: "instance-not-provisioned", detail };
}

export function naturalLanguageSearchNotEnabled(): NaturalLanguageSearchFailure {
  return { ok: false, reason: "not-enabled" };
}

export function naturalLanguageSearchAdapterError(detail: string): NaturalLanguageSearchFailure {
  return { ok: false, reason: "adapter-error", detail };
}

// ── The default resolution ──────────────────────────────────────────────────

// The port a deployment resolves to when it carries no binding to a managed index.
//
// IT IS A TYPED OUTCOME SELECTED ON THE ABSENCE OF CONFIGURATION, and the two things it must not be
// are worth naming because both have been shipped elsewhere and both read as working code. It is not
// a throw at construction — a deployment missing a binding must serve every other surface normally
// and report this one unavailable, not fail to start. And it is not a fallback that quietly
// SUCCEEDS: an adapter that resolves cleanly with an empty result is indistinguishable from a
// corpus in which nothing matched, which is the failure mode where a lawyer finds nothing and
// concludes there is nothing.
//
// So the honest answer for an unconfigured deployment is the same one a firm mid-provisioning gets:
// the instance is not there. This is reached through the production resolver on the ordinary path,
// never injected by a test.
export const notProvisionedNaturalLanguageSearchPort: NaturalLanguageSearchPort = {
  naturalLanguageSearch: () =>
    Promise.resolve(
      naturalLanguageInstanceNotProvisioned("no managed search binding in this deployment"),
    ),
};
