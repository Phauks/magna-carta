import type { FileId, MatterId, ReviewDocumentId, ReviewSetId } from "@magna-carta/identifiers/types";

// The CORPUS is what a search index is partitioned by: the bounded set of documents one query runs
// over, one split belongs to, and one wholesale deletion can remove. Every scope-bearing operation in
// this package takes a corpus rather than a matter, because "the matter this document belongs to" and
// "the index this document belongs in" are two different questions that happen to have the same answer
// for a matter's own files. Separating them was nearly free; separating them after a split had been
// published would not have been, because a split's R2 object key is DERIVED from the corpus (see
// split.ts) — so a widening later is a rewrite of every object in every firm's bucket rather than a
// type change.
//
// A corpus is a discriminated union, not an interface, so a second kind is an additive member: every
// consumer that only reads `corpus.id` keeps compiling, and every consumer that must actually behave
// differently per kind is found by the compiler at the moment the second kind is added.
//
// THE TWO KINDS INDEX THE SAME DOCUMENT TWICE, ON PURPOSE. A file that is both a matter document and a
// review document under a received production has a split in each corpus. That is a duplicated derived
// cache, and it buys the thing a shared index cannot give: a review set can be deleted wholesale and
// PROVABLY, because every object it ever put in the bucket sits under one prefix that nothing else
// writes to. A clawed-back production has to leave no trace, and "we filtered it out of the query" is
// not the same statement as "the bytes are gone".
export type CorpusScope =
  | { readonly kind: "matter"; readonly id: MatterId }
  | { readonly kind: "reviewSet"; readonly id: ReviewSetId };

// The kinds of scope an index can be partitioned by.
export type CorpusKind = CorpusScope["kind"];

// Every corpus identifier is a handle, and handles are self-describing (`matter_…`, `reviewSet_…`),
// which is why the derived object key needs the id alone and never the kind: two kinds can never
// collide on an id.
export type CorpusIdentifier = CorpusScope["id"];

// What a corpus's members are named by. A matter corpus indexes File Manager files, keyed by file and
// version; a review-set corpus indexes REVIEW DOCUMENTS, which are already version-pinned pointers —
// the review document id names one document at one version and nothing else, so there is no second
// version of one to disambiguate.
//
// A union rather than a widened `string`, so a caller cannot hand a review document to a matter corpus
// or the reverse without the compiler saying so.
export type IndexedDocumentId = FileId | ReviewDocumentId;

// The identity mapping: index a matter's documents into the matter's own corpus.
export function corpusOfMatter(matterId: MatterId): CorpusScope {
  return { kind: "matter", id: matterId };
}

// A review set's own corpus. Also an identity mapping, and deliberately NOT the review set's matter:
// material an opposing party produced may be attorney's-eyes-only under a protective order, and a
// matter-scoped query that could reach it would be a disclosure nobody authorized.
export function corpusOfReviewSet(reviewSetId: ReviewSetId): CorpusScope {
  return { kind: "reviewSet", id: reviewSetId };
}
