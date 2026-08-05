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
}

export interface TimelineSource {
  // Stable, and a WIRE CONTRACT: it appears in responses and in the `kind` filter, so it is
  // permanent once shipped.
  readonly key: string;
  // The closed set of entry kinds this source can emit.
  readonly kinds: readonly string[];
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
