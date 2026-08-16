import type { ReviewDocumentSourceKind } from "./types.ts";

// WHAT MAKES TWO REVIEW DOCUMENTS THE SAME DOCUMENT, and nothing else in the pipeline gets to have
// an opinion about it.
//
// Two hash families could answer this and only one of them is an ANSWER. The content hash is an
// identity: two objects with the same SHA-256 are the same bytes, and a firm can say so under oath.
// The near-duplicate fingerprint on the same row is a SIMILARITY SCORE over normalized text — it
// collides by design, because that is what makes it useful for clustering — and suppressing a
// document from review on a similarity score would be deciding, on a heuristic, that a reviewer
// never sees a document. The fingerprint is stored for the clustering surface a later slice builds
// and is deliberately not read here.
//
// The identity differs by source kind, and that is not a detail. A raw-bytes hash of an email is the
// WRONG identity: two copies of one message differ in their transport headers, so hashing the bytes
// would call two copies of the same message two documents. The email record model already solved
// this with its own dedup key, and this reads that rather than inventing a second answer.

// The kind prefix is carried in the group identifier so a content hash and an email dedup key can
// never name one group by coincidence — they are drawn from different spaces, and a group is a claim
// that its members are the same document.
export const CONTENT_DEDUP_GROUP_PREFIX = "content-sha256:";
export const EMAIL_DEDUP_GROUP_PREFIX = "email-dedup-key:";

export interface DedupIdentityInput {
  readonly sourceKind: ReviewDocumentSourceKind;
  readonly contentSha256: string | null;
  readonly emailDedupKey: string | null;
}

// The group a document belongs to, DERIVED rather than allocated. Every copy computes the same
// string from its own facts with no coordination and no read, which is what lets two consumers
// running at once agree about the group before either of them has seen the other's row.
//
// Null when the document carries no identity at all. That is not a failure and it is not a group of
// one: it is the platform declining to assert that this document is or is not a copy of anything,
// which is the only honest thing to say about bytes whose hash nobody recorded. Such a document is
// extracted on its own terms and appears in the manifest with no group.
export function dedupGroupIdentifier(input: DedupIdentityInput): string | null {
  if (input.sourceKind === "email_message") {
    return input.emailDedupKey === null || input.emailDedupKey === ""
      ? null
      : `${EMAIL_DEDUP_GROUP_PREFIX}${input.emailDedupKey}`;
  }
  return input.contentSha256 === null || input.contentSha256 === ""
    ? null
    : `${CONTENT_DEDUP_GROUP_PREFIX}${input.contentSha256}`;
}
