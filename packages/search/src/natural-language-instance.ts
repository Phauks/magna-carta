import { PLATFORM_EMBEDDING_MODEL_ID } from "@magna-carta/inference/catalog";
import type { FirmId } from "@magna-carta/identifiers/types";

// The managed natural-language search instance a firm's opt-in creates and its opt-out destroys:
// its name, the one configuration every firm's instance is created under, and the lifecycle states
// the control-plane row moves through.
//
// ONE INSTANCE PER FIRM. Namespaces cap far below the number of firms this platform is built for,
// and a shared instance across firms is refused outright — a query against firm A's instance must
// be unable to reach firm B's bytes for the same reason a query against firm A's database is. That
// buys structural isolation BETWEEN firms and leaves scoping WITHIN a firm to a filter argument,
// which is why nothing here treats the filter as the confidentiality boundary: read-time
// re-authorization through the firm-scoped data-access layer is.

// ── The instance name ───────────────────────────────────────────────────────

// The name is DERIVED from the firm identifier, never minted, on the same discipline as the split
// key beside it (split.ts): a repeated create converges on the same name, so a provisioning step
// that died halfway is restartable rather than leaky, and a second create is a no-op rather than a
// second instance nobody has a handle to.
//
// It is OPAQUE. Instance names appear in the managed service's own account-level surfaces, which are
// not partitioned per firm, so the name carries no firm name, no client name, and no human-readable
// text at all. Anyone reading that dashboard learns how many instances exist and nothing else.
//
// It is NOT a platform identifier handle, which is why this does not call `deriveIdentifier`: the
// name has to satisfy the managed service's own character rules rather than ours, so it is a
// lower-case hexadecimal digest behind a fixed prefix. The exact bytes are a compatibility contract
// with every instance already created — changing this function orphans them.
const INSTANCE_NAME_PREFIX = "mc";
const INSTANCE_NAME_DIGEST_LENGTH = 32;

export async function naturalLanguageInstanceName(firmId: FirmId): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`naturalLanguageSearchInstance:${firmId}`),
  );
  const hexadecimal = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${INSTANCE_NAME_PREFIX}-${hexadecimal.slice(0, INSTANCE_NAME_DIGEST_LENGTH)}`;
}

// ── The metadata schema ─────────────────────────────────────────────────────

// The custom metadata fields declared on the instance at creation.
//
// THIS IS A FOUNDATION, NOT A SETTING, and the reason is the whole of why it is declared complete
// here rather than grown later: changing an instance's metadata schema triggers a full re-index of
// every document in it, for every firm at once. So the list is declared once, closed, and read from
// this constant by everything that needs it — a second literal spelling of these names anywhere is
// a second place the schema can drift from what the instances were actually created with, which a
// fitness test beside this file refuses.
//
// Four are declared and one slot is deliberately left unallocated. Allocating it later costs a
// re-index per firm — bounded and re-runnable, but not free — so the cost is recorded here rather
// than discovered.
export const NATURAL_LANGUAGE_METADATA_FIELDS = Object.freeze([
  // The scope dimension every query filters on. Duplicated from the object key's own folder
  // structure deliberately: a range query over a path prefix is a fragile thing to hang a scope on,
  // and an equality match on a single key is the simplest filter shape there is.
  "matter",
  // The client a matter belongs to. A client-scoped search is the obvious second question after a
  // matter-scoped one, and client-level walls are how walls are usually drawn in practice.
  // Declared now because declaring it later re-indexes every firm.
  "client",
  // What class of object this is. Every fed object carries `working-document`; the reserved classes
  // are never written. Declaring and filtering on it from the first day is what means that if a
  // work-product class is ever fed into this index, the predicate that excludes it already exists
  // and already runs, and a surface that wants to include it has to say so.
  "object_class",
  // The ethical-wall group, for the day walls are built. Declared-and-empty is free; adding the
  // field later is a re-index of every firm's instance.
  "confidentiality_scope",
] as const);

export type NaturalLanguageMetadataField = (typeof NATURAL_LANGUAGE_METADATA_FIELDS)[number];

// ── The configuration ───────────────────────────────────────────────────────

// The configuration generation. Recorded on the control-plane row beside the instance, so an
// instance created under an older configuration is identifiable without interrogating the service.
// Bump it when any value below changes.
export const NATURAL_LANGUAGE_INSTANCE_CONFIGURATION_GENERATION = 1;

export interface NaturalLanguageInstanceConfiguration {
  /** Fixed at creation and unchangeable afterwards — the platform's embedding pin, enforced by the service. */
  readonly embeddingModelId: string;
  /** Vector plus keyword. Costs a lower per-instance file ceiling and buys a lexical fallback for defined terms an embedding blurs. */
  readonly indexingMode: "hybrid";
  /** The documented minimum. The index is behind by at least this much and every answer says so. */
  readonly syncIntervalMinutes: number;
  readonly metadataFields: readonly NaturalLanguageMetadataField[];
  /** A rewrite is a model composing a different question on the member's behalf, unshown and unlogged. The member's words are the query. */
  readonly queryRewriting: false;
  /** A cross-encoder the platform does not have and would not build, running on the same on-network models as the embedding. */
  readonly reranking: true;
  readonly rerankingModelId: string;
  /** Never configured. This surface returns passages the firm's own lawyers wrote; nothing composes prose. */
  readonly responseGeneration: null;
  /**
   * Off, and not as a preference. The cache keys on the question text with an isolation scope the
   * service does not document: instance-per-firm contains it across firms and does NOT contain it
   * across matters inside one. Two members asking a similar question against two different matters
   * is the exact failure, and a saved query does not buy a cross-matter hazard of any size.
   */
  readonly similarityCache: false;
  /**
   * Never enabled. They are unauthenticated by default on a hostname that is never rotated — a
   * disclosure surface rather than a feature. Every query goes through the platform's own API.
   */
  readonly publicEndpoints: false;
}

// The one configuration, for every firm. A single constant rather than an options object assembled
// at the call site: two firms whose instances differ in any value below would be two products.
export const NATURAL_LANGUAGE_INSTANCE_CONFIGURATION: NaturalLanguageInstanceConfiguration =
  Object.freeze({
    // Read from the platform's own model pin rather than spelled here. Every stored vector is a
    // function of the model that produced it and the service fixes the model at creation, so the two
    // must agree exactly; a literal here would be a second place for them to disagree. It is also
    // what keeps this module from naming a model provider, which is a decision that belongs to the
    // one inference chokepoint and nowhere else.
    embeddingModelId: PLATFORM_EMBEDDING_MODEL_ID,
    indexingMode: "hybrid",
    syncIntervalMinutes: 60,
    metadataFields: NATURAL_LANGUAGE_METADATA_FIELDS,
    queryRewriting: false,
    reranking: true,
    rerankingModelId: "@cf/baai/bge-reranker-base",
    responseGeneration: null,
    similarityCache: false,
    publicEndpoints: false,
  });

// ── Lifecycle ───────────────────────────────────────────────────────────────

// What the control-plane row says exists. `absent` is a recorded state rather than a missing row:
// a firm that has opted out and been torn down is a different fact from a firm that never opted in,
// and the difference is what makes a teardown's record readable afterwards.
export type NaturalLanguageInstanceState = "provisioning" | "ready" | "tearing-down" | "absent";

export const NATURAL_LANGUAGE_INSTANCE_STATES: readonly NaturalLanguageInstanceState[] =
  Object.freeze(["provisioning", "ready", "tearing-down", "absent"]);

// ── The keep-alive ──────────────────────────────────────────────────────────

// An instance that receives no search request for this many days has its scheduled syncs paused. A
// firm that searches rarely would then meet a month-stale index on its next question with no
// warning, so one trivial full-text query per ready instance rides the existing scheduled sweep,
// well inside the window, and is metered like any other query so it is never mistaken for a
// member's.
export const NATURAL_LANGUAGE_INACTIVITY_PAUSE_DAYS = 31;

// The keep-alive's own query text. A constant, and deliberately not a member's words: nothing about
// a firm's matters is in it, so it can appear in whatever the managed service logs about its own
// requests without disclosing anything.
export const NATURAL_LANGUAGE_KEEP_ALIVE_QUERY = "keepalive";
