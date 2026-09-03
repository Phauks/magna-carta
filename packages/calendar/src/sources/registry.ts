import type { Permission } from "@magna-carta/access-control/registry";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { TimeColumnShape } from "../types.ts";
import type { VisibleMatterPredicate } from "../visibility.ts";

// The read layer's one piece of machinery: a timeline SOURCE is a declaration, not a write-path
// obligation. A subsystem joins the timeline by declaring where its rows live, how to read a bounded
// page of them, and how to project one — never by writing a second copy of anything.
//
// That is the whole architecture in one sentence, and its consequence is the property worth having:
// a federated timeline cannot DISAGREE with the register it is built from, because it IS that
// register. The class of bug where the calendar says one thing and the custody ledger says another
// cannot be written here.

// What a caller wants read. A matter timeline names one matter; a firm-wide window names none and
// bounds by date instead.
export interface TimelineScope {
  readonly matterId?: string;
  // Civil-date bounds, inclusive. A source over an instant column compares them as date prefixes,
  // which is exactly right for a text-ordered ISO-8601 column and needs no zone to be known in SQL.
  readonly fromDate?: string;
  readonly toDate?: string;
  // "Events this member is a participant in, or whose matter they are responsible for", resolved as
  // a predicate. Only the sources that can answer it honor it; the rest declare that they cannot.
  readonly memberUserId?: string;
}

// The keyset position, shared by every source: one cursor over one comparable sort key, so there is
// no per-source cursor vector to encode, decode, or keep in step.
export interface TimelineCursor {
  readonly sortKey: string;
  readonly id: string;
}

export interface SourceReadRequest {
  readonly database: SqlDatabase;
  readonly scope: TimelineScope;
  // REQUIRED. Composed into the WHERE clause before the LIMIT — see src/visibility.ts.
  readonly visibility: VisibleMatterPredicate;
  readonly cursor: TimelineCursor | undefined;
  // The merge reads pageSize + 1 from every source so it can tell "there is more" from "that is
  // all" after trimming; the extra rows are discarded.
  readonly limit: number;
  readonly ascending: boolean;
  // Resolved by a bounded pre-read for the sources that reach their matter through a join. Empty
  // means "this matter has none", which a source turns into no statement at all rather than a query
  // that cannot match.
  readonly joinKeys?: readonly string[];
}

// One row of a source's result, as the raw shape the source's own SELECT produced.
export interface TimelineRawRow {
  readonly sort_key: string;
  readonly row_id: string;
  // What a reader OPENS, where that is not the row itself. A custody movement is the row the
  // timeline walks and the identity a keyset compares, but the screen it opens into is organised
  // by packet — so the deep link carries the packet, and collapsing the two would either break the
  // ordering or land the reader on a page that cannot resolve the id. Matter-search draws the same
  // line for the same reason. Equal to row_id wherever the row is its own destination.
  readonly link_id?: string | null;
  readonly matter_id: string | null;
  readonly kind: string;
  readonly actor_user_id?: string | null;
  readonly label?: string | null;
}

// What a caller receives. A timeline entry is a REFERENCE, not a record: identifiers, a kind, a sort
// key, an actor where there is one, and a deep link. It carries NO privileged content. Where a
// source has a genuinely non-privileged summary it declares one; where it does not, it declares that
// it has none and the row renders by kind alone — an email's subject line is privileged content, and
// putting it on a firm-wide read spanning every matter is exactly the leak this rule prevents.
// Absence is a declared decision, never an oversight. Detail comes from following the link into the
// owning subsystem's own access-gated read: one extra request for the one row a person opened,
// rather than a redaction problem on every row of every page.
export interface TimelineEntry {
  readonly sourceKey: string;
  readonly kind: string;
  readonly sortKey: string;
  readonly rowId: string;
  readonly matterId: string | null;
  readonly actorUserId: string | null;
  readonly label: string | null;
  readonly link: string;
  // THE DESCRIPTION, present only on a matter-scoped read that asked for one. Null on every entry
  // the federated read projects: the words come from the owning source's own `describe`, for one
  // matter, behind that source's own permission — never from the cross-matter projection above.
  readonly title: string | null;
  readonly typeText: string | null;
  readonly facts: Readonly<Record<string, unknown>> | null;
}

// What a source is asked when a matter-scoped read wants its rows named: this matter, these rows.
// Never "every row" — the ids are the page on screen, bounded by the page size — and never another
// matter, which the builder binds rather than trusting the source to.
export interface DescribeRequest {
  readonly database: SqlDatabase;
  readonly matterId: string;
  readonly rowIds: readonly string[];
  // REQUIRED, exactly as on the page read: a description is a second read of the same row and
  // composes the same predicate, so a row the page could not show cannot be named either.
  readonly visibility: VisibleMatterPredicate;
}

// The fixed columns every describe statement projects — the same words matter-search projects
// for a hit, so a subsystem names a row once and both consolidations read it.
export interface DescribedRawRow {
  readonly row_id: string;
  // What the reader recognises it by: a file's name, a note's opening line, an event's title.
  readonly title: string;
  // The subsystem's own word for what this row IS — a document type, an event type — or NULL where
  // the source's noun is the right word already.
  readonly type_text: string | null;
  // The subsystem's own fields as one JSON object (SQLite's json_object), or NULL. Read ONLY by
  // that subsystem's own presentation; the consolidating read carries it opaque.
  readonly facts_json: string | null;
}

export interface RowDescription {
  readonly title: string;
  readonly typeText: string | null;
  readonly facts: Readonly<Record<string, unknown>> | null;
}

// What a source's rows are anchored to for visibility. A 'matter'-anchored source composes the
// visible-matter predicate exactly as it always has, fitness-enforced. A 'firm'-anchored source
// DECLARES that its rows are firm-visible by construction — a firm event has no matter, so it
// structurally cannot compose a matter predicate, and under the trusted-insider posture every
// member sees the firm's own calendar (an ethical wall is a MATTER screen with nothing to bind to
// on a firm meeting). The fitness pass asserts the declaration both ways: every matter-anchored
// statement carries the predicate marker, and every firm-anchored source is one of a REVIEWED
// ALLOWLIST. Absence of the predicate is a declared decision with a named reviewer, never a silent
// exemption — the declaresLabel:false idiom applied to visibility. If screening firm events is ever
// needed (a partners-only compensation meeting), that is a NEW declared anchor with its own
// predicate, never a loosening of this one.
export type VisibilityAnchor = "matter" | "firm";

export interface TimelineSource {
  // Stable, and a WIRE CONTRACT: it appears in responses and in the `kind` filter, so it is
  // permanent once shipped.
  readonly key: string;
  // The closed set of entry kinds this source can emit.
  readonly kinds: readonly string[];
  // Declared, never inferred — see VisibilityAnchor above.
  readonly visibilityAnchor: VisibilityAnchor;
  // Declared, never inferred: the merge compares sort keys as TEXT, and only canonical instants sort
  // chronologically that way.
  readonly timeColumnShape: TimeColumnShape;
  // Whether this source declares a non-privileged label, or declares that it has none.
  readonly declaresLabel: boolean;
  // A source reached through a bounded pre-read (a matter's custody packets, its trust ledger leaf)
  // names the pre-read here. Absent on every source that reaches its matter directly.
  readonly resolveJoinKeys?: (
    database: SqlDatabase,
    scope: TimelineScope,
  ) => Promise<readonly string[]>;
  // Whether this source can answer a member filter. A source that cannot is DROPPED from a
  // member-filtered read rather than returning everything — silently ignoring the filter would put
  // other people's matters on the answer to "what is on my calendar".
  readonly supportsMemberFilter: boolean;
  // The bounded statements for this scope. Returns an empty array when the scope cannot match (an
  // empty join-key set), so the caller issues nothing rather than a query that cannot hit.
  readonly buildStatements: (request: SourceReadRequest) => readonly SqlStatement[];
  readonly project: (row: TimelineRawRow) => TimelineEntry;
  // The read capability a DESCRIPTION of these rows sits behind — null where every member of the
  // firm may read the record (the file list, the ledgers). It gates `describe` and nothing else:
  // the entry itself carries no content, so the federated read keeps showing that a note was
  // written to a member who may not read notes; what it withholds is the words. Matter-search
  // declares the same field for the same reason, and the two registries name the same capability
  // for the same rows.
  readonly permission: Permission | null;
  // Name a page of this source's rows for ONE matter. Optional: a source without one keeps the
  // platform's own sentence on the screen. Called only by a matter-scoped read that asked to
  // describe, for a member standing inside that matter and holding `permission`; the firm-wide
  // read never calls it, so nothing it projects reaches a cross-matter answer and the no-label
  // discipline on the projection above is untouched. Returns [] where nothing can be named.
  readonly describe?: (request: DescribeRequest) => readonly SqlStatement[];
}

// The registry itself: a frozen list, reviewed when it changes. The read count per page scales with
// THIS, not with the firm's data — which is the distinction between a bounded fan-out and an N+1.
export class TimelineSourceRegistry {
  private readonly sources: readonly TimelineSource[];

  constructor(sources: readonly TimelineSource[]) {
    const keys = new Set<string>();
    for (const source of sources) {
      if (keys.has(source.key)) {
        throw new Error(`duplicate timeline source key: ${source.key}`);
      }
      keys.add(source.key);
    }
    this.sources = sources;
  }

  all(): readonly TimelineSource[] {
    return this.sources;
  }

  get(key: string): TimelineSource | undefined {
    return this.sources.find((source) => source.key === key);
  }

  // Narrows the REGISTRY before any statement is built. A request filtered to one source issues one
  // statement, not one per source — filtering the registry is what makes "filter before you page"
  // true at the level above the SQL.
  select(keys: readonly string[] | undefined): readonly TimelineSource[] {
    if (keys === undefined || keys.length === 0) return this.sources;
    const wanted = new Set(keys);
    return this.sources.filter((source) => wanted.has(source.key));
  }
}
