import type { MatterId } from "@magna-carta/identifiers/types";
import { matterOfFeedObjectKey, matterScopedFilter } from "./filter-construction.ts";
import type { EngineHit, EngineSearchResult, WallProbeEngine } from "./reference-engine.ts";
import type { SyntheticCorpus } from "./synthetic-corpus.ts";

// The two wall probes the retrieval route is gated on, as runnable protocol. Each takes any
// WallProbeEngine, so the identical protocol runs locally against the reference model (proving the
// protocol's own sensitivity) and, on first deploy, against the live binding through a thin adapter
// (proving the service). The verdicts are structured evidence, not booleans: a failure names every
// offending hit so the record of a failed run is the record.

// Probe parameters, pinned: fifty results and a zero threshold are the most permissive request the
// service accepts, so nothing is hidden by ranking cutoffs — if an out-of-scope document can surface
// at all, this request shape gives it every chance to.
export const PROBE_MAX_RESULTS = 50;
export const PROBE_MATCH_THRESHOLD = 0;

export interface OutOfScopeHit {
  readonly query: string;
  readonly objectKey: string;
  // Undefined when the key does not even parse as a feed key — itself out of scope.
  readonly resolvedMatter: MatterId | undefined;
}

// Resolve every hit's matter from its object key — the same recovery re-authorization performs — and
// return the ones that are not the expected matter. A hit whose key does not parse is out of scope by
// definition: an index entry we cannot attribute cannot be shown to anyone.
export function outOfScopeHits(
  hits: readonly EngineHit[],
  query: string,
  expectedMatter: MatterId,
): readonly OutOfScopeHit[] {
  const offending: OutOfScopeHit[] = [];
  for (const hit of hits) {
    const resolvedMatter = matterOfFeedObjectKey(hit.objectKey);
    if (resolvedMatter !== expectedMatter) {
      offending.push({ query, objectKey: hit.objectKey, resolvedMatter });
    }
  }
  return offending;
}

export interface CrossMatterExclusionVerdict {
  readonly pass: boolean;
  readonly queriesRun: number;
  readonly hitsExamined: number;
  readonly engineErrors: readonly string[];
  readonly offendingHits: readonly OutOfScopeHit[];
}

// The exclusion probe: for EVERY document of the excluded matter, query its verbatim passage — the
// text chosen to make that out-of-scope document the single best possible unfiltered hit — under the
// scoped filter for the queried matter. Pass requires zero hits resolving outside the queried matter
// across the whole run, and zero engine errors: one leaked hit is a failure, and an error on a
// well-formed filter makes the run inconclusive, which is also a failure.
export async function runCrossMatterExclusionProbe(
  engine: WallProbeEngine,
  corpus: SyntheticCorpus,
  scope: { readonly queriedMatter: MatterId; readonly excludedMatter: MatterId } = {
    queriedMatter: corpus.matterA,
    excludedMatter: corpus.matterB,
  },
): Promise<CrossMatterExclusionVerdict> {
  const filter = matterScopedFilter(scope.queriedMatter);
  const engineErrors: string[] = [];
  const offendingHits: OutOfScopeHit[] = [];
  let queriesRun = 0;
  let hitsExamined = 0;

  for (const document of corpus.documentsOfMatter(scope.excludedMatter)) {
    const query = document.verbatimPassage;
    const result = await engine.search({
      query,
      filters: filter,
      maxNumResults: PROBE_MAX_RESULTS,
      matchThreshold: PROBE_MATCH_THRESHOLD,
    });
    queriesRun += 1;
    if (!result.ok) {
      engineErrors.push(`query ${queriesRun}: ${result.error}`);
      continue;
    }
    hitsExamined += result.hits.length;
    offendingHits.push(...outOfScopeHits(result.hits, query, scope.queriedMatter));
  }

  return {
    pass: engineErrors.length === 0 && offendingHits.length === 0,
    queriesRun,
    hitsExamined,
    engineErrors,
    offendingHits,
  };
}

// How an engine handled a filter it must reject. "returned-zero-hits" is fail-closed but silent —
// safe for confidentiality, but still a probe failure, because a scoping mechanism that swallows its
// own misconfiguration cannot be told apart from one that is working; the requirement is a loud error.
export type FilterRejectionBehavior =
  | "errored"
  | "returned-zero-hits"
  | "returned-filtered-hits"
  | "accepted-and-ignored";

export interface RejectionCaseVerdict {
  readonly behavior: FilterRejectionBehavior;
  readonly pass: boolean;
  readonly detail: string;
}

export interface FailOpenVerdict {
  readonly pass: boolean;
  readonly queriesRunPerCase: number;
  // A value that matches nothing must return nothing — fail-closed on the value axis.
  readonly nonexistentValue: RejectionCaseVerdict;
  // A field outside the declared schema must be rejected loudly.
  readonly unknownField: RejectionCaseVerdict;
  // A syntactically malformed filter must be rejected loudly.
  readonly malformedFilter: RejectionCaseVerdict;
}

function classifyRejectionCase(
  result: EngineSearchResult,
  unfiltered: EngineSearchResult,
  mustError: boolean,
): RejectionCaseVerdict {
  if (!result.ok) {
    return { behavior: "errored", pass: mustError, detail: result.error };
  }
  if (result.hits.length === 0) {
    return {
      behavior: "returned-zero-hits",
      pass: !mustError,
      detail: "no hits returned",
    };
  }
  // Hits came back from a filter that matches nothing legitimate. If they mirror the unfiltered
  // response, the filter was accepted and ignored — the fail-open shape that can bear no weight.
  const unfilteredKeys = new Set(unfiltered.ok ? unfiltered.hits.map((hit) => hit.objectKey) : []);
  const mirrored = result.hits.filter((hit) => unfilteredKeys.has(hit.objectKey)).length;
  const behavior: FilterRejectionBehavior =
    mirrored > 0 ? "accepted-and-ignored" : "returned-filtered-hits";
  return {
    behavior,
    pass: false,
    detail: `${result.hits.length} hits returned (${mirrored} shared with the unfiltered response)`,
  };
}

function worstOf(cases: readonly RejectionCaseVerdict[]): RejectionCaseVerdict {
  // Severity order: accepted-and-ignored is the worst observation, an error is the best.
  const order: readonly FilterRejectionBehavior[] = [
    "accepted-and-ignored",
    "returned-filtered-hits",
    "returned-zero-hits",
    "errored",
  ];
  const sorted = cases.toSorted(
    (left, right) => order.indexOf(left.behavior) - order.indexOf(right.behavior),
  );
  const worst = sorted[0];
  if (worst === undefined) throw new Error("no rejection cases were run");
  return { ...worst, pass: cases.every((verdict) => verdict.pass) };
}

// The fail-open probe: the same adversarial queries, sent with (a) a well-formed filter on a matter
// handle that exists nowhere, (b) a filter naming a field absent from the declared schema, and (c) a
// syntactically malformed filter. The nonexistent value must return zero hits; the other two must
// error. Every query in the sample runs every case, and the WORST observed behavior per case is the
// verdict — one silent acceptance among a thousand rejections is still fail-open.
export async function runFailOpenProbe(
  engine: WallProbeEngine,
  corpus: SyntheticCorpus,
): Promise<FailOpenVerdict> {
  const nonexistentMatterFilter = matterScopedFilter("matter_wallprobenonexistent00" as MatterId);
  const unknownFieldFilter = { practice_group: { $eq: "litigation" } };
  const malformedFilterShape = { matter: "not-a-condition-object" };

  const nonexistentValueCases: RejectionCaseVerdict[] = [];
  const unknownFieldCases: RejectionCaseVerdict[] = [];
  const malformedFilterCases: RejectionCaseVerdict[] = [];
  let queriesRunPerCase = 0;

  for (const document of corpus.documentsOfMatter(corpus.matterB)) {
    const query = document.verbatimPassage;
    const base = { query, maxNumResults: PROBE_MAX_RESULTS, matchThreshold: PROBE_MATCH_THRESHOLD };
    const unfiltered = await engine.search(base);
    queriesRunPerCase += 1;

    const nonexistent = await engine.search({ ...base, filters: nonexistentMatterFilter });
    if (!nonexistent.ok) {
      nonexistentValueCases.push({
        behavior: "errored",
        pass: false,
        detail: `a well-formed filter on a nonexistent value must not error: ${nonexistent.error}`,
      });
    } else {
      nonexistentValueCases.push(classifyRejectionCase(nonexistent, unfiltered, false));
    }

    unknownFieldCases.push(
      classifyRejectionCase(
        await engine.search({ ...base, filters: unknownFieldFilter }),
        unfiltered,
        true,
      ),
    );
    malformedFilterCases.push(
      classifyRejectionCase(
        await engine.search({ ...base, filters: malformedFilterShape }),
        unfiltered,
        true,
      ),
    );
  }

  const nonexistentValue = worstOf(nonexistentValueCases);
  const unknownField = worstOf(unknownFieldCases);
  const malformedFilter = worstOf(malformedFilterCases);
  return {
    pass: nonexistentValue.pass && unknownField.pass && malformedFilter.pass,
    queriesRunPerCase,
    nonexistentValue,
    unknownField,
    malformedFilter,
  };
}
