/*
 * THE NARROWING REGISTRY — every way a review set's documents can be narrowed, declared once as
 * data, and the criteria set that carries an answer to three different consumers.
 *
 * ONE CONTROL, MANY CRITERIA. A list screen has one place to narrow (the standing ruling in
 * docs/conventions/design-corrections.md): where several mechanisms narrow the same list, they sit
 * behind one control, because from where a reader sits they answer one question. Answering it in
 * three places is how somebody ends up staring at an empty table with a filter set on a control
 * they are not looking at. So the classic faceted rail down the side of a review screen is not what
 * this is — every narrowing below is a property of the row, and the control that sets them is one.
 *
 * A SELECTION IS A CRITERIA SET, NEVER A LIST OF IDENTIFIERS. This is the property the whole
 * surface turns on, and it is worth stating where the type is defined rather than in a design
 * document nobody reads twice. Three consumers take a `CriteriaSet` without knowing where it came
 * from: the document list pages it, a bulk coding act freezes and materializes it, and production
 * membership resolves it. Because they take criteria rather than identifiers, the day the keyword
 * provider below stops being `soon`, bulk tagging over search results works with NO CHANGE to bulk
 * tagging. Passing identifiers instead would buy nothing today and would have to be undone then.
 *
 * IT RIDES THE ADDRESS, which follows from the same decision. A criteria set serializes into the
 * query string, so a narrowed queue is a link a supervising attorney can send to a reviewer and the
 * reviewer walks the same documents in the same order.
 *
 * AND IT NEVER AUTHORIZES. Criteria narrow; the per-review-set access list decides who may see
 * anything at all, composed into SQL ahead of every LIMIT, on the server, on every read. A criteria
 * provider that tried to express "only the documents this member may see" would be a second answer
 * to a question that has one, and the second answer is the one that goes wrong quietly.
 *
 * HOW IT GROWS: one entry. A provider whose server-side narrowing is not built yet is declared here
 * anyway, at stage `soon`, with what it waits on — it renders visible and disabled with that line,
 * which is the standing rule for a designed-but-unserved capability. That is what lets this surface
 * ship with its built narrowings live and show the shape of the finished control on the same day.
 *
 * A PROVIDER'S CONTROL NEED NOT BE THE POPOVER, and two of them are not — `setFrom` below says so.
 * A family is named by opening a document; the NAME SEARCH is the screen's own search field, which
 * is the product's one control for searching within a screen and sits in the action row where every
 * other list screen keeps it. Routing it through this registry rather than filtering rows in the
 * browser is what makes it a real narrowing: it reaches the whole corpus rather than the page in
 * hand, it rides the address so a searched queue is a link somebody can send, and a bulk coding act
 * over it composes on the same day, because it is a criteria set like any other.
 */
import { formatInstantDate } from "@magna-carta/design-system/formatters";
import type { MaturityStage } from "@magna-carta/design-system/maturity";
import type { DiscoveryLoad, RecordCustodian, ReviewDocumentQuery } from "./discovery-api.ts";
import {
  EXCEPTION_CODE_ORDER,
  PROCESSING_STATE_ORDER,
  exceptionCodeEntry,
  loadLaneEntry,
  processingStateEntry,
  type ReviewDocumentExceptionCode,
  type ReviewDocumentProcessingState,
} from "./discovery-vocabulary.ts";

/**
 * A narrowing, as a value.
 *
 * A key with no entry is not set; a key whose value is the empty string is not set either, so
 * clearing a control and never touching it produce the same criteria set and therefore the same
 * address. Deliberately a flat record of strings: it survives a round trip through a query string
 * without a schema, which is what makes it shareable.
 */
export type CriteriaSet = Readonly<Record<string, string>>;

/** One choice a provider offers. */
export interface CriteriaOption {
  readonly value: string;
  readonly label: string;
  /** One line, where the label alone would not say what picking it means. */
  readonly hint?: string;
}

/** What the review set can tell a provider about itself when it builds its options. */
export interface CriteriaContext {
  readonly recordCustodians: readonly RecordCustodian[];
  readonly loads: readonly DiscoveryLoad[];
}

/** How a provider renders and what kind of answer it holds. */
export type CriteriaShape =
  /** Pick one from a list — either a closed vocabulary or one the review set serves. */
  | {
      readonly kind: "choice";
      readonly options: (context: CriteriaContext) => readonly CriteriaOption[];
    }
  /** Free text. The keyword provider's shape. */
  | { readonly kind: "text" }
  /** Two dates. Held as one value, `from..to`, so the criteria set stays flat. */
  | { readonly kind: "date-range" };

interface CriteriaProviderBase {
  /** Its slot in the criteria set, and the query parameter it rides in the address. */
  readonly key: string;
  readonly label: string;
  /** One line: what narrowing by this actually answers. Shown under the control. */
  readonly describes: string;
  readonly shape: CriteriaShape;
  /**
   * Where this narrowing is SET, for the ones whose control is not the narrowing popover.
   *
   * Two of them are not, and for good reasons that are nothing alike: a family is named by opening a
   * document, and the name search is the screen's own search field, which is the product's one
   * control for searching within a screen and belongs in the action row beside every other screen's.
   * Declared here rather than left implicit, because the popover still has to SHOW those narrowings
   * — a reader looking at a short list must be able to see every reason it is short, from the one
   * control that answers that question — and showing one with an editing control that does nothing
   * is worse than showing it with a line saying where it is set.
   */
  readonly setFrom?: string;
}

/** A narrowing the server serves today. */
export interface BuiltCriteriaProvider extends CriteriaProviderBase {
  readonly stage: Exclude<MaturityStage, "soon">;
  /**
   * How this narrowing turns into the server read.
   *
   * THE WHOLE POINT OF THE FIELD. Five of these compose into the document list's own query; the
   * keyword one will compose into the search index port instead, and a later one may compose into
   * neither. Because the composition is declared per provider, the control that sets them does not
   * know or care which read answers, and adding one that reads somewhere else changes nothing else.
   */
  readonly compose: (value: string, query: ReviewDocumentQuery) => ReviewDocumentQuery;
}

/** A narrowing the design named and the server does not serve yet. */
export interface SoonCriteriaProvider extends CriteriaProviderBase {
  readonly stage: "soon";
  /** What it waits on, as a noun phrase the disabled control completes into a sentence. */
  readonly waitsOn: string;
  /**
   * Which read will answer it once it is built. Declared now because it is the fact that decides
   * whether this is a small change or a large one, and because a reader of this file should be able
   * to see that not every narrowing is a WHERE clause on one table.
   */
  readonly willComposeInto: "the document list" | "the search index";
}

export type CriteriaProvider = BuiltCriteriaProvider | SoonCriteriaProvider;

export function providerIsBuilt(provider: CriteriaProvider): provider is BuiltCriteriaProvider {
  return provider.stage !== "soon";
}

/*
 * The providers, in the order the control offers them.
 *
 * Five of the six built ones are the filters the document list read was measured with, each with its
 * own sort-bearing index so a narrowed page never falls to a temporary b-tree. The order is the
 * order a reviewer reaches for them: whose records, which delivery, what happened to it, and why it
 * did not get further.
 *
 * The sixth, the name search, is the one that is NOT index-backed and is placed where it is for that
 * reason as much as any other: it is a LIKE scan the server runs after every clause above has
 * narrowed, bounded to one review set the member may see and stopped by the page limit. That cost is
 * stated in the read that pays it (packages/discovery/src/review-reads.ts) rather than hidden behind
 * a control that looks like the rest.
 */
export const CRITERIA_PROVIDERS: readonly CriteriaProvider[] = [
  {
    key: "custodian",
    label: "Custodian of Record",
    describes: "Whose electronic records these were.",
    stage: "ready",
    shape: {
      kind: "choice",
      options: (context) =>
        context.recordCustodians.map((custodian) => ({
          value: custodian.id,
          label: custodian.displayName,
        })),
    },
    compose: (value, query) => ({ ...query, recordCustodianId: value }),
  },
  {
    key: "load",
    label: "Load",
    describes: "The delivery this document arrived on.",
    stage: "ready",
    shape: {
      kind: "choice",
      options: (context) =>
        context.loads.map((load) => ({
          value: load.id,
          label: load.sourceDescription ?? loadLaneEntry(load.lane).label,
          hint: formatInstantDate(load.initiatedAt),
        })),
    },
    compose: (value, query) => ({ ...query, discoveryLoadId: value }),
  },
  {
    key: "state",
    label: "Read or not read",
    describes: "How far the document got. Every document ends read or not read, never neither.",
    stage: "ready",
    shape: {
      kind: "choice",
      options: () =>
        PROCESSING_STATE_ORDER.map((state) => ({
          value: state,
          label: processingStateEntry(state).label,
          hint: processingStateEntry(state).meaning,
        })),
    },
    compose: (value, query) => ({
      ...query,
      processingState: value as ReviewDocumentProcessingState,
    }),
  },
  {
    key: "exception",
    label: "Reason it was not read",
    describes:
      "The named reason a document could not be read. One document may carry several reasons.",
    stage: "ready",
    shape: {
      kind: "choice",
      options: () =>
        EXCEPTION_CODE_ORDER.map((code) => ({
          value: code,
          label: exceptionCodeEntry(code).label,
          hint: exceptionCodeEntry(code).meaning,
        })),
    },
    compose: (value, query) => ({ ...query, exceptionCode: value as ReviewDocumentExceptionCode }),
  },
  {
    key: "family",
    label: "Family",
    describes:
      "A message and its attachments, or an archive and its entries. Narrowing to one family shows " +
      "everything that arrived together.",
    stage: "ready",
    // No options list: a family is named by a document, so it is set by opening one rather than by
    // picking from a menu. It is declared here so the address can carry it and the control can show
    // it set and clear it.
    shape: { kind: "choice", options: () => [] },
    setFrom: "a document",
    compose: (value, query) => ({ ...query, familyId: value }),
  },
  {
    key: "search",
    label: "Name",
    describes:
      "The document's name, or its path in the production. To search the words inside it, use Keyword below.",
    stage: "ready",
    shape: { kind: "text" },
    setFrom: "the search field above the list",
    compose: (value, query) => ({ ...query, search: value }),
  },
  {
    key: "keyword",
    label: "Keyword",
    describes: "Words inside the document, not its name.",
    stage: "soon",
    shape: { kind: "text" },
    waitsOn: "the search engine being deployed",
    willComposeInto: "the search index",
  },
  {
    key: "dates",
    label: "Date range",
    describes: "The document's date. Documents with no date are left out when you narrow by date.",
    stage: "soon",
    shape: { kind: "date-range" },
    waitsOn: "the document list gaining a date filter",
    willComposeInto: "the document list",
  },
  {
    key: "coding",
    label: "Coding",
    describes: "How the document has been coded, including uncoded and conflicting.",
    stage: "soon",
    shape: { kind: "choice", options: () => [] },
    waitsOn: "the coding surface",
    willComposeInto: "the document list",
  },
  {
    key: "near-duplicates",
    label: "Near-duplicate cluster",
    describes: "Documents that are nearly the same as one another.",
    stage: "soon",
    shape: { kind: "choice", options: () => [] },
    waitsOn: "clustering over the fingerprints every document already carries",
    willComposeInto: "the document list",
  },
];

/** A provider by key, or undefined for a key nothing declares. */
export function criteriaProvider(key: string): CriteriaProvider | undefined {
  return CRITERIA_PROVIDERS.find((provider) => provider.key === key);
}

/** Whether anything is set. An empty value counts as unset, so clearing empties the whole set. */
export function criteriaAreSet(criteria: CriteriaSet): boolean {
  return Object.values(criteria).some((value) => value.trim() !== "");
}

/** How many narrowings are set — the number the one control carries. */
export function criteriaCount(criteria: CriteriaSet): number {
  return Object.values(criteria).filter((value) => value.trim() !== "").length;
}

/**
 * The criteria set turned into the document list's own query.
 *
 * A provider that is not built contributes NOTHING rather than throwing: an address carrying a
 * criteria set from a future version of the app should narrow by what this version understands and
 * ignore the rest, because the alternative is a link that renders an error instead of a list.
 */
export function composeDocumentQuery(criteria: CriteriaSet): ReviewDocumentQuery {
  let query: ReviewDocumentQuery = {};
  for (const provider of CRITERIA_PROVIDERS) {
    if (!providerIsBuilt(provider)) continue;
    const value = criteria[provider.key];
    if (value === undefined || value.trim() === "") continue;
    query = provider.compose(value, query);
  }
  return query;
}

/** The criteria set as it rides the address. Only declared keys, and only ones actually set. */
export function criteriaToSearchParameters(criteria: CriteriaSet): URLSearchParams {
  const parameters = new URLSearchParams();
  for (const provider of CRITERIA_PROVIDERS) {
    const value = criteria[provider.key];
    if (value !== undefined && value.trim() !== "") parameters.set(provider.key, value);
  }
  return parameters;
}

/** The criteria set read back off an address. Anything nothing declares is dropped. */
export function criteriaFromSearchParameters(parameters: URLSearchParams): CriteriaSet {
  const criteria: Record<string, string> = {};
  for (const provider of CRITERIA_PROVIDERS) {
    const value = parameters.get(provider.key);
    if (value !== null && value.trim() !== "") criteria[provider.key] = value;
  }
  return criteria;
}

/** One narrowing set or cleared, returning a new set — never a mutation of the one passed in. */
export function withCriterion(criteria: CriteriaSet, key: string, value: string): CriteriaSet {
  const next: Record<string, string> = { ...criteria };
  if (value.trim() === "") delete next[key];
  else next[key] = value;
  return next;
}

/*
 * Every declaration is checked the moment this module loads, so a provider that cannot be rendered
 * honestly is a failure before anything is drawn rather than a control that says nothing. A soon
 * provider with no dependency sentence is the mistake this catches: it renders disabled either way,
 * and without the line it is a dead control a reader cannot interpret.
 */
const seenKeys = new Set<string>();
for (const provider of CRITERIA_PROVIDERS) {
  if (seenKeys.has(provider.key)) {
    throw new Error(`Two narrowing criteria declare the key "${provider.key}".`);
  }
  seenKeys.add(provider.key);
  if (!providerIsBuilt(provider) && provider.waitsOn.trim() === "") {
    throw new Error(
      `The "${provider.key}" criterion is not served and says nothing about why. Declare ` +
        "`waitsOn`: the disabled control carries that line.",
    );
  }
}
