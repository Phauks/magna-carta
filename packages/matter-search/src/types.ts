import type { MatterId } from "@magna-carta/identifiers/types";

// What a matter search answers with. These are wire types: the route serializes them almost
// unchanged, and the browser renders them through a presentation registry that knows a source's
// icon and heading but nothing about its transport.

// The two shapes a set of records comes in, and they are never presented alike. A LISTING is in a
// stable order the caller can walk to the end of; a RANKED answer is in the server's relevance order
// and is never re-sorted by a client, because re-sorting an arbitrary slice puts the best of that
// slice at the top where it reads as the best of the matter's record.
export type AnswerShape = "listing" | "ranked";

// Why a source is absent from an answer it would otherwise have contributed to. Absence is always
// explained: a reader who cannot tell "nothing matched" from "you cannot see this" learns that the
// matter holds nothing when it may hold a great deal.
export type SourceSkipReason =
  // The member does not hold this source's read capability. Resolved before any statement is built.
  | "permission"
  // The query is shorter than this source can answer usefully — a trigram index needs three
  // characters, a substring scan needs two.
  | "query-too-short"
  // The source's own backing service was asked and did not answer. A fault, and usually a passing
  // one, so "we did not look inside your files" is never silence.
  | "engine-unavailable"
  // The source's backing service is not part of this deployment yet. Not a fault and not passing:
  // nothing a reader does, and no second try, changes it.
  | "engine-not-connected"
  // The firm has not turned on the index this source reads. Different from the engine being
  // unreachable, because this one a firm's administrator can change.
  | "not-indexed";

// One row of a source's result, as the raw shape its own SELECT produced. Every source projects
// into the same fixed column set, which is what lets one builder compose every statement.
export interface MatterSearchRawRow {
  readonly row_id: string;
  // What a reader OPENS, when that is not the row itself. An invoice line is the row a search
  // matches and the identity a keyset walks, but the screen it links into is organised by invoice —
  // so the two are different facts and collapsing them would either break the ordering or land the
  // reader on a page that cannot resolve the id. NULL wherever the row is its own destination,
  // which is every other source.
  readonly link_id?: string | null;
  readonly matter_id: string;
  // The stable order key — a canonical instant for a recency-ordered source, a case-folded name for
  // an alphabetical one. Compared as TEXT, exactly as the federated timeline compares its own.
  readonly sort_key: string;
  // What the reader recognizes the record by: a file's name, a packet's name, a party's display
  // name. Never null — a source with nothing to name a row by cannot be a source.
  readonly title: string;
  // The DECLARED excerpt, or NULL where the source declares it has none. See `declaresSnippet`.
  readonly snippet: string | null;
  // A short second line: a role, a status, a folder. NULL where the source has none.
  readonly secondary: string | null;
  readonly actor_user_id: string | null;
}

// A ranked or listed result. It carries a pointer and, where the source declares one, an excerpt —
// and never anything the reader could not already open on the section the link leads to.
export interface MatterSearchHit {
  readonly sourceKey: string;
  readonly id: string;
  readonly title: string;
  readonly snippet: string | null;
  readonly secondary: string | null;
  readonly actorUserId: string | null;
  readonly sortKey: string;
  // Where a person follows this hit: the owning section, behind that section's own access gate.
  readonly link: string;
}

// One source's contribution to an answer. Either it answered, or it says why it did not.
export interface MatterSearchGroup {
  readonly source: string;
  readonly section: string;
  readonly answerShape: AnswerShape;
  // What this source matched on, in the reader's words. Rendered on the group so nobody has to
  // guess why a hit is a hit — "file names", "the note's current text".
  readonly matchedFields: readonly string[];
  // Whether this source can honor a request to include records the firm has deleted. On the wire
  // because the CLIENT has to decide whether to offer the control at all, and the alternative is a
  // browser that keeps its own list of which sources have deleted sets — a second place that knows
  // what the registry knows, free to fall behind it.
  readonly supportsDeleted: boolean;
  readonly hits: readonly MatterSearchHit[];
  // True when the source holds more than was returned. Measured by reading one row past the limit,
  // never estimated — so a group can say "more" without ever claiming a total it did not count.
  readonly hasMore: boolean;
  readonly skipped: SourceSkipReason | null;
}

export interface MatterSearchAnswer {
  readonly matterId: MatterId;
  readonly query: string;
  readonly groups: readonly MatterSearchGroup[];
}
