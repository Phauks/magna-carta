import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { Permission } from "@magna-carta/access-control/registry";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type { MatterId } from "@magna-carta/identifiers/types";
import type { MatterFileContentsSearcher } from "../file-contents.ts";
import type {
  AnswerShape,
  MatterSearchHit,
  MatterSearchRawRow,
  SourceMarking,
  SourceSkipReason,
} from "../types.ts";

// The read layer's one piece of machinery: a matter-search SOURCE is a declaration, not a write-path
// obligation. A subsystem becomes searchable by declaring where its rows live, how to read a bounded
// page of them, which capability gates them, and how to project one — never by writing a second copy
// of anything into an index this package owns.
//
// That is the whole architecture in one sentence, and its consequence is the property worth having:
// a consolidated search cannot DISAGREE with the section a hit links into, because it IS that
// section's own rows. The class of bug where the search says one thing and the Notes tab says
// another cannot be written here.
//
// It is the same declaration shape packages/calendar/src/sources uses for the federated timeline,
// deliberately: two federated reads over the same matters that invented two ways to say "here is
// where my rows live" would be two things to learn and two places for the visibility seam to be got
// wrong.

export interface SourceSearchRequest {
  readonly database: SqlDatabase;
  // The one matter being searched. Composed into every statement by the BUILDER, not by the source
  // — see build.ts. A source cannot decline it, so a source cannot search across matters.
  readonly matterId: MatterId;
  // The reader's text, already trimmed. Never interpolated: it reaches SQL as a binding, escaped for
  // LIKE by the builder.
  readonly query: string;
  // REQUIRED. Composed into the WHERE clause before the LIMIT — see @magna-carta/calendar/visibility.
  readonly visibility: VisibleMatterPredicate;
  // How many hits the caller wants. The builder reads one MORE than this, so "there is more" is
  // measured rather than guessed.
  readonly limit: number;
  // Whether records the firm has deleted or withdrawn join the answer. Off by default, and honored
  // only by the sources that DECLARE they can honor it (`supportsDeleted`). A source that cannot is
  // not silently passed the flag: a retracted note's body must stay unmatchable whatever a caller
  // asks for, and that is settled in packages/notes rather than re-decided here.
  readonly includeDeleted: boolean;
  // How a source reaches the index of the words inside this matter's files, which lives outside the
  // firm's database. Supplied by the application, which holds the service binding; absent wherever
  // nothing supplied one, and a source that needs it then reports itself unavailable.
  readonly fileContents?: MatterFileContentsSearcher | null;
}

// What a source that asks something OUTSIDE the firm's database found out before any statement ran.
//
// Such a source never answers from what the outside index said. The index names candidates; the
// source then issues an ordinary bounded statement over its own table, with those candidates as one
// more condition, and that statement binds the matter and composes the visibility predicate exactly
// as every other source's does. `arrange` is the one thing the index's answer still decides: the
// ORDER the surviving rows are read in, and what the index knew about each that the table does not.
export type PreparedSearch =
  | { readonly kind: "skipped"; readonly reason: SourceSkipReason }
  | {
      readonly kind: "candidates";
      readonly statements: readonly SqlStatement[];
      readonly arrange: (rows: readonly MatterSearchRawRow[]) => MatterSearchRawRow[];
      // What the outside index's own store adds to the rows a reader is about to be shown, after
      // the limit has cut the rest: an excerpt, read from where the text is kept. Run on the rows
      // the statement returned and nothing else, so it cannot add a result, only say more about one.
      readonly quote?: (rows: readonly MatterSearchRawRow[]) => Promise<MatterSearchRawRow[]>;
    };

export interface MatterSearchSource {
  // Stable, and a WIRE CONTRACT: it appears in responses and in the `in` filter, so it is permanent
  // once shipped.
  readonly key: string;
  // The matter section these rows belong to, matching a slug in the web app's section registry. It
  // drives the scope label, the group heading and the deep link, so those three can never disagree
  // about which tab a hit opens.
  readonly sectionSlug: string;
  // The read capability this source's rows sit behind. A source whose capability the member does not
  // hold is DROPPED before any statement is built — never filtered out of results afterwards.
  // `null` means every member of the firm may read it, which is how matter parties and the file list
  // are already gated.
  readonly permission: Permission | null;
  readonly answerShape: AnswerShape;
  // What this source actually matches, in the reader's words. Shown on the group.
  readonly matchedFields: readonly string[];
  // Whether this source projects a non-privileged excerpt, or DECLARES that it has none. Absence is
  // a decision with a reason — a source over a protected() column declares false and returns a
  // pointer, so the reader follows the link into that subsystem's own audited read.
  readonly declaresSnippet: boolean;
  // How this source's match is found again in the title and the excerpt of a hit, so the words
  // that answered can be marked. Applied by the runners after `project` (marks.ts), to the rows a
  // reader is about to be shown and to nothing else.
  readonly marking: SourceMarking;
  // Below this length the source cannot answer usefully and reports itself skipped rather than
  // returning an empty answer that reads like "nothing here".
  readonly minimumQueryLength: number;
  // Whether `includeDeleted` means anything to this source. Declared, so a caller cannot hand the
  // flag to a source that must never honor it.
  readonly supportsDeleted: boolean;
  // The bounded statements for this request. Returns an empty array when the request cannot match,
  // so the caller issues nothing rather than a query that cannot hit.
  readonly buildStatements: (request: SourceSearchRequest) => readonly SqlStatement[];
  // Declared only by a source that must ask something outside the firm's database first. When it is
  // present the runner calls it INSTEAD of `buildStatements`.
  readonly prepare?: (request: SourceSearchRequest) => Promise<PreparedSearch>;
  readonly project: (row: MatterSearchRawRow) => MatterSearchHit;
  // Declared only by a source that can also answer for EVERY MATTER THE READER MAY SEE. Absent, the
  // source answers inside one matter and nowhere else, and a search across matters reports it as
  // not searched instead of running it. See `AcrossMattersDeclaration`.
  readonly acrossMatters?: AcrossMattersDeclaration;
}

// What a search across matters hands a source. There is no matter in it, and that is the whole
// difference from `SourceSearchRequest`: the reach is every matter the visible-matter predicate
// admits, and the predicate is the only thing deciding which those are.
export interface AcrossMattersSearchRequest {
  readonly database: SqlDatabase;
  // The reader's text, already trimmed. A binding, never an instruction.
  readonly query: string;
  // REQUIRED, and composed into the WHERE clause before the LIMIT by the builder.
  readonly visibility: VisibleMatterPredicate;
  readonly limit: number;
  // The most index entries one statement may draw its candidates from. See
  // `recordIndexNewestMatchesFrom` in @magna-carta/search/record-index-query.
  readonly candidateCap: number;
}

// HOW A SOURCE ANSWERS ACROSS MATTERS, declared separately from how it answers inside one.
//
// `buildStatements` above cannot reach a second matter: the builder it uses binds the one it was
// given. This is a second, deliberate declaration, with its own builder
// (`visibleMattersSearchSelect` in build.ts) that binds no matter and composes the visible-matter
// predicate in its place. A source without this declaration is not widened by anything.
//
// The cost of a read with no matter to narrow by has to be bounded some other way, and the
// declaration says which:
//
//   "record-index"  the source's words are in the firm's record index, and its statement draws on
//                   the newest matches up to the request's cap. The read costs the same whatever
//                   the firm holds.
//   "names"         the source matches characters in a name on its own table, and its statement
//                   reads that table. The cost grows with the firm's rows of that one kind, so a
//                   source declares this only for a table whose rows are short and whose scan was
//                   measured (scripts/measure-across-matters.mts).
export interface AcrossMattersDeclaration {
  readonly reads: "record-index" | "names";
  // What is matched across matters, where that is less than inside one. A source that also matches
  // a number by scanning its table inside a matter matches only its words here.
  readonly matchedFields: readonly string[];
  readonly buildStatements: (request: AcrossMattersSearchRequest) => readonly SqlStatement[];
}

// The registry itself: a frozen list, reviewed when it changes. The read count per search scales
// with THIS, not with the firm's data — which is the distinction between a bounded fan-out and an
// N+1.
export class MatterSearchSourceRegistry {
  private readonly sources: readonly MatterSearchSource[];

  constructor(sources: readonly MatterSearchSource[]) {
    const keys = new Set<string>();
    for (const source of sources) {
      if (keys.has(source.key)) {
        throw new Error(`duplicate matter search source key: ${source.key}`);
      }
      keys.add(source.key);
    }
    this.sources = sources;
  }

  all(): readonly MatterSearchSource[] {
    return this.sources;
  }

  get(key: string): MatterSearchSource | undefined {
    return this.sources.find((source) => source.key === key);
  }

  // Narrows the REGISTRY before any statement is built. A search scoped to one section issues one
  // statement, not one per source — filtering the registry is what makes the DEFAULT scope the
  // cheapest query rather than the most expensive one, which is the opposite of how a search that
  // filtered afterwards would behave.
  //
  // An empty or absent selection means every source. There is deliberately no key meaning
  // "everything": the vocabulary must never grow a word that could be read as wider than this
  // matter.
  select(keys: readonly string[] | undefined): readonly MatterSearchSource[] {
    if (keys === undefined || keys.length === 0) return this.sources;
    const wanted = new Set(keys);
    return this.sources.filter((source) => wanted.has(source.key));
  }

  // The sources this principal may read, resolved from the capability set the chokepoint already
  // holds. Separate from `select` on purpose: a caller composes both, and the type makes it obvious
  // which narrowing is the reader's choice and which is the firm's rule.
  grantedTo(
    sources: readonly MatterSearchSource[],
    permissions: ReadonlySet<Permission>,
  ): readonly MatterSearchSource[] {
    return sources.filter(
      (source) => source.permission === null || permissions.has(source.permission),
    );
  }
}
