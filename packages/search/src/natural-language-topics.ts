import type { FileId, MatterId } from "@magna-carta/identifiers/types";

// The per-firm outbox topics the natural-language search feature dispatches work on.
//
// EVERYTHING HEAVY IS QUEUE-DISPATCHED, and these three are why: provisioning an instance, tearing
// one down, and deleting a scope's feed objects are each proportional to something a request handler
// must not wait on — a service round trip, a firm's whole corpus, a matter's whole document set.
// Each rides the per-firm outbox, so the message lands in the SAME atomic batch as the state change
// that caused it: a firm whose opt-in committed has a provisioning message, and a firm whose opt-in
// rolled back has neither.
//
// They travel on the shared per-firm job queue rather than a queue of their own. A dedicated lane
// buys isolation from a noisy neighbour, and there is no neighbour here: these are rare, small
// messages, and the shared bus already carries the relay, the dispatch table, and the dead-letter
// discipline they would otherwise each need built again.

export const NATURAL_LANGUAGE_INSTANCE_PROVISION_TOPIC = "aiSearch.instanceProvisionRequested";
export const NATURAL_LANGUAGE_INSTANCE_TEARDOWN_TOPIC = "aiSearch.instanceTeardownRequested";
export const NATURAL_LANGUAGE_FEED_DELETION_TOPIC = "aiSearch.feedDeletionRequested";

// The payload carries identifiers and a closed scope label, and has no field a document's text, a
// member's question, or a client's name could travel in. That is structural rather than careful:
// there is no slot for them.
export interface NaturalLanguageInstanceProvisionPayload {
  readonly disclosureVersion: number;
}

export interface NaturalLanguageInstanceTeardownPayload {
  /** Recorded so the teardown's audit row can say which acceptance the firm was operating under when it opted out. */
  readonly disclosureVersion: number;
}

// The three scopes a deletion may be asked for, and no fourth. A free-form predicate is how a
// deletion job comes to delete a set nobody can describe afterwards.
export type NaturalLanguageFeedDeletionPayload =
  | { readonly scope: "document-version"; readonly fileId: FileId; readonly version: number }
  | { readonly scope: "matter"; readonly matterId: MatterId }
  | { readonly scope: "firm" };

export const NATURAL_LANGUAGE_TOPICS: readonly string[] = Object.freeze([
  NATURAL_LANGUAGE_INSTANCE_PROVISION_TOPIC,
  NATURAL_LANGUAGE_INSTANCE_TEARDOWN_TOPIC,
  NATURAL_LANGUAGE_FEED_DELETION_TOPIC,
]);
