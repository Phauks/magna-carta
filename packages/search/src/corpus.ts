import type { MatterId } from "@magna-carta/identifiers/types";

// The CORPUS is what a search index is partitioned by: the bounded set of documents one query runs
// over, one split belongs to, and one wholesale deletion can remove. Every scope-bearing operation in
// this package takes a corpus rather than a matter, because "the matter this document belongs to" and
// "the index this document belongs in" are two different questions that happen to have the same answer
// today. Separating them now is nearly free; separating them after a split has been published is not,
// because a split's R2 object key is DERIVED from the corpus (see split.ts) — so a widening later is a
// rewrite of every object in every firm's bucket rather than a type change.
//
// A corpus is a discriminated union, not an interface, so a second kind is an additive member: every
// consumer that only reads `corpus.id` keeps compiling, and every consumer that must actually behave
// differently per kind is found by the compiler at the moment the second kind is added. Today there is
// exactly one member — a matter — and the mapping is the identity: a matter's corpus IS that matter.
export type CorpusScope = { readonly kind: "matter"; readonly id: MatterId };

// The kinds of scope an index can be partitioned by. One today; the union is the extension point.
export type CorpusKind = CorpusScope["kind"];

// Every corpus identifier is a handle, and handles are self-describing (`matter_…`), which is why the
// derived object key needs the id alone and never the kind: two kinds can never collide on an id.
export type CorpusIdentifier = CorpusScope["id"];

// The identity mapping: index a matter's documents into the matter's own corpus. The only constructor
// there is today, and the reason every caller upstream of the index can keep passing a matter around.
export function corpusOfMatter(matterId: MatterId): CorpusScope {
  return { kind: "matter", id: matterId };
}
