import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { guarded } from "@magna-carta/data-access/effect-batch";
import { DIRECTORY_IDENTIFIER_TABLE } from "@magna-carta/directory/statements";
import { readMatterParties } from "@magna-carta/directory/party";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { ConflictsCheckId } from "@magna-carta/identifiers/types";
import { conflictsAuditStatement, type ConflictsWriteOptions } from "./audit.ts";
import {
  boundCandidateHits,
  CANDIDATE_WRITE_CEILING,
  type CandidateTruncation,
} from "./candidate-bound.ts";
import {
  claimRunStatement,
  completeRunStatement,
  failRunStatement,
  openCheckRun,
  readLatestNumberedCheckForMatter,
  readRun,
  reportRunProgressStatement,
  type OpenedRun,
  type RunProgress,
  type RunStage,
} from "./check-run.ts";
import {
  asksForAnyPlace,
  asksForRecordPlaces,
  NAME_FLOOR,
  NAME_RESULT_CEILING,
  NUMBER_FLOOR,
  readPartyNeedles,
  searchContent,
  type FoundIn,
} from "./content-search.ts";
import { assignTier, describeEvidence } from "./evidence.ts";
import { FILE_QUERY_CEILING, searchFiles, type FileContentsSearcher } from "./file-search.ts";
import { expandGraph, WALK_CEILING, type ExpansionTruncation } from "./expansion.ts";
import { findImputationHits, findMemberEntities } from "./imputation.ts";
import { matchPartyBatch } from "./matching.ts";
import { nicknameCatalogueIsPopulated } from "@magna-carta/directory/nickname";
import { readSubjectFactsBatch } from "./subject-facts.ts";
import { runConflictsEffect } from "./run-conflicts-effect.ts";
import { readConflictsPolicy, resolveScope, type ScopeRequest } from "./settings.ts";
import {
  availabilityOf,
  FILES_SOURCE,
  MAGNUS_CONVERSATIONS_SOURCE,
  MESSAGING_SOURCE,
  NICKNAME_EQUIVALENCE_SOURCE,
  TASKS_SOURCE,
  PRIOR_FIRM_HISTORY_SOURCE,
} from "./sources.ts";
import {
  CONFLICTS_CHECK_TABLE,
  CONFLICTS_HIT_TABLE,
  insertCheckStatement,
  insertHitStatement,
} from "./statements.ts";
import { CONFLICTS_HIT_SURFACED_TOPIC } from "./topics.ts";
import type {
  ConflictsCause,
  ConflictsTrigger,
  ConflictsTriggerSource,
  SourceAvailability,
  SourceClass,
} from "./types.ts";

export interface RunCheckInput {
  readonly trigger: ConflictsTrigger;
  readonly matterId?: string;
  readonly subjectEntityIds: readonly string[];
  readonly scope: ScopeRequest;
  // How the run was started. Omitted means a person asked for it, which is what every caller that
  // predates the automated paths means and what the row records as NULL.
  readonly triggerSource?: ConflictsTriggerSource;
  // The corpus changes this run covers. Several accumulated causes are named on ONE check rather
  // than producing one check each, and every one of them is listed — coalescing collapses causes
  // into a single check, never out of existence.
  readonly causes?: readonly ConflictsCause[];
}

// What a run has been opened as, so the execution knows which record it writes.
export interface RunToExecute {
  readonly runId: ConflictsCheckId;
  readonly input: RunCheckInput;
  // How the run reaches the file contents index, which only the application can supply. Without one,
  // a run asked to search Files records it as not searched.
  readonly fileContents?: FileContentsSearcher;
}

// The sentence a run failed with. Generic on purpose: the error itself goes to the telemetry
// pipeline, and a database message on a row a firm reads back would be the wrong words in the one
// place they cannot be edited.
export const RUN_FAILURE =
  "The search stopped before it finished, and nothing was recorded. Run it again.";

// The identifier ids (and their types) attached to the given entities — NEVER the sealed ciphertext
// or blind-index column. This is what "recorded by reference" means: the log can point back at the
// sealed row through readIdentifier for an authorized, audited decrypt, but the row itself carries
// nothing that leaks the plaintext.
async function readIdentifierReferences(
  context: DirectoryIdentifierContext,
  entityIds: readonly string[],
): Promise<Array<{ id: string; type: string }>> {
  if (entityIds.length === 0) return [];
  const placeholders = entityIds.map((_, index) => `?${index + 1}`).join(", ");
  const { results } = await context.database
    .prepare(
      `SELECT id, identifier_type FROM ${DIRECTORY_IDENTIFIER_TABLE} WHERE entity_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY id ASC`,
    )
    .bind(...entityIds)
    .all<{ id: string; identifier_type: string }>();
  return results.map((row) => ({ id: row.id, type: row.identifier_type }));
}

// Whether any earlier check on this matter surfaced anything at all. One bounded existence probe over
// the (check_id) index, read BEFORE the batch is composed like everything else here — D1 has no
// interactive transactions.
//
// It answers one question and only for the notification: a matter that has never surfaced a hit and
// now surfaces one has changed in a way somebody should be told about, whatever tier it landed at.
// Nothing about the check itself depends on it, and nothing is written from it.
async function matterHasEarlierHits(
  context: DirectoryIdentifierContext,
  matterId: string,
): Promise<boolean> {
  const { results } = await context.database
    .prepare(
      `SELECT 1 AS present
         FROM ${CONFLICTS_HIT_TABLE}
         JOIN ${CONFLICTS_CHECK_TABLE} ON ${CONFLICTS_CHECK_TABLE}.id = ${CONFLICTS_HIT_TABLE}.check_id
        WHERE ${CONFLICTS_CHECK_TABLE}.subject_matter_id = ?1
        LIMIT 1`,
    )
    .bind(matterId)
    .all<{ present: number }>();
  return results.length > 0;
}

// EXECUTING AN OPENED RUN: the search, reported as it goes, settled with its record.
//
// The run is CLAIMED first, guarded on its status, so a second executor — a replayed request, a
// retried invocation — finds nothing to claim and returns without searching. Progress is written onto
// the run row at each stage with a heartbeat, which is what a screen polls and what tells a dead run
// from a slow one. The search record, its hits and the run's settlement commit in ONE batch, so the
// run reads completed exactly when its record exists; a throw anywhere settles the run as failed and
// is rethrown for the caller's telemetry.
//
// Returns the record's id, which is the run's id, or null when there was nothing to claim.
export async function executeCheckRun(
  context: DirectoryIdentifierContext,
  run: RunToExecute,
  options: Omit<ConflictsWriteOptions, "idempotency">,
): Promise<ConflictsCheckId | null> {
  const { database } = context;
  const claimed = await claimRunStatement(database, run.runId, options.clock.now()).run();
  if (claimed.meta.changes === 0) return null;

  // Every progress report doubles as the cancellation check: the write is guarded on the run still
  // running, so a run a member stopped finds no row to report onto, and the search stops there
  // rather than spending the rest of the invocation on an answer nobody will record.
  const report = async (stage: RunStage, progress: RunProgress): Promise<void> => {
    const reported = await reportRunProgressStatement(
      database,
      run.runId,
      stage,
      progress,
      options.clock.now(),
    ).run();
    if (reported.meta.changes === 0) throw new RunStoppedError();
  };

  try {
    await search(context, run, options, report);
    return run.runId;
  } catch (error) {
    if (error instanceof RunStoppedError || (await runWasCancelled(database, run.runId))) {
      return null;
    }
    await failRunStatement(database, run.runId, RUN_FAILURE, options.clock.now()).run();
    throw error;
  }
}

// Thrown inside the search when its run is no longer running: a member cancelled it, or a read
// settled it as stale. Neither is a fault, and neither is reported as one.
class RunStoppedError extends Error {
  constructor() {
    super("the run is no longer running");
    this.name = "RunStoppedError";
  }
}

// Whether the run was cancelled. A cancel that lands between the last progress report and the
// settling batch makes that batch's guarded completion refuse, which arrives here as an ordinary
// error; this tells that case apart from a real failure.
async function runWasCancelled(
  database: DirectoryIdentifierContext["database"],
  runId: ConflictsCheckId,
): Promise<boolean> {
  try {
    const row = await readRun(database, runId);
    return row !== null && row.cancelled_at !== null;
  } catch {
    // A database that cannot answer this cannot have recorded a cancel either; the original error
    // is the one worth reporting.
    return false;
  }
}

async function search(
  context: DirectoryIdentifierContext,
  run: RunToExecute,
  options: Omit<ConflictsWriteOptions, "idempotency">,
  report: (stage: RunStage, progress: RunProgress) => Promise<void>,
): Promise<void> {
  const { input } = run;
  const checkId = run.runId;

  // Read everything before composing the batch: D1 has no interactive transactions.
  const policy = await readConflictsPolicy(context.database);
  const scope = resolveScope(policy, input.scope);
  const inScope = new Set(scope.sources);

  // Seed the search from the explicit subject parties plus, when a matter is supplied, its live parties.
  const seedIds = new Set(input.subjectEntityIds);
  if (input.matterId !== undefined) {
    for (const party of await readMatterParties(context.database, input.matterId)) {
      seedIds.add(party.entityId);
    }
  }
  await report("sources", { sourcesSearched: scope.sources.length, subjectParties: seedIds.size });

  // The check's own instant, taken once. Edge expiry is judged against it rather than against an
  // ambient clock read inside the traversal, so a long walk cannot have two different opinions about
  // whether a relationship had ended, and a recorded path is reproducible.
  const now = options.clock.now();

  await report("walking", { entitiesReached: seedIds.size });
  const expansion = inScope.has("graph")
    ? await expandGraph(context.database, [...seedIds], {
        asOf: now,
        onRound: (reached) => report("walking", { entitiesReached: reached }),
      })
    : {
        entities: [...seedIds].map((entityId) => ({ entityId, path: [] as never[] })),
        truncation: null as ExpansionTruncation | null,
        longestPathLength: 0,
      };
  const expanded = expansion.entities;

  // Match every entity in the expanded set. A seed carries an empty path; an expanded entity carries
  // the edges that reached it, which is the hit's explanation.
  //
  // Two set-valued reads, not two reads per entity: one subject-facts read per node table over the
  // whole closure, then each blocking channel once over the whole closure. A closure walked to its
  // end without this is thousands of queries in one invocation, which is why the batching is the
  // foundation the unbounded walk stands on rather than an optimization of it.
  interface CandidateHit {
    entityId: string;
    sourceClass: SourceClass;
    coParty: boolean;
    tier: number;
    matchedFields: string[];
    path: unknown;
    // Where in the firm's own records the party was found; absent for a Directory result.
    foundIn?: FoundIn;
  }
  const similarityHits: CandidateHit[] = [];

  await report("matching", { entitiesReached: expanded.length, entitiesMatched: 0 });
  const subjectFacts = await readSubjectFactsBatch(
    context,
    expanded.map((entity) => entity.entityId),
  );
  const matchesBySubject = await matchPartyBatch(
    context,
    expanded
      .map((entity) => subjectFacts.get(entity.entityId))
      .filter((subject) => subject !== undefined),
    scope.strictness,
    // The name roles are a firm SETTING, resolved once with the rest of the scope and recorded
    // verbatim on the row below. Passing them rather than letting the matcher decide is what keeps
    // the roles a check compared against and the roles its record NAMES the same list.
    { nameRoles: scope.nameRoles, trigramMatching: scope.trigramMatching },
  );

  for (const entity of expanded) {
    // An entity whose row did not resolve is skipped, exactly as the per-entity read skipped it.
    if (!subjectFacts.has(entity.entityId)) continue;
    for (const match of matchesBySubject.get(entity.entityId) ?? []) {
      // An entity never conflicts with itself, so the current search subject is dropped. But a match
      // landing on a DIFFERENT subject party is a genuine co-party surfacing — a positional conflict
      // (a related entity that is also a named party, e.g. the opposing party turns out to be the
      // client's parent company) or a co-party name/identifier collision — so it is recorded, flagged
      // co-party so a reviewer triages it apart from a conflict with a prior client, never dropped.
      if (match.entityId === entity.entityId) continue;
      similarityHits.push({
        entityId: match.entityId,
        sourceClass: entity.path.length === 0 ? "party" : "graph",
        coParty: seedIds.has(match.entityId),
        tier: assignTier(match.evidence),
        matchedFields: describeEvidence(match.evidence),
        path: entity.path,
      });
    }
  }
  await report("matching", {
    entitiesReached: expanded.length,
    entitiesMatched: subjectFacts.size,
    candidatesSurfaced: similarityHits.length,
  });

  // The write ceiling applies HERE, to the similarity channels only — they are the pair whose output
  // is the closure times the corpus. Imputation below is an identity join over one matter's own party
  // list: it is bounded by the matter, it is tier 1 by construction, and a bound that could refuse a
  // firm member who genuinely IS a party would be refusing the strongest thing the engine can find.
  //
  // The bound sits after the matcher rather than inside it on purpose. `matchPartyBatch` is held to
  // returning exactly the per-entity matcher's hit set by test/matcher-equivalence.test.ts, and a bound
  // reaching into either path would make that proof about a narrowed answer instead of the answer.
  // Bounding the run's OUTPUT leaves the matchers identical and the proof intact by construction.
  const bounded = boundCandidateHits(similarityHits, CANDIDATE_WRITE_CEILING);
  const hits: CandidateHit[] = [...bounded.hits];
  const candidateTruncation: CandidateTruncation | null = bounded.truncation;

  if (inScope.has("imputation")) {
    if (input.matterId !== undefined) {
      for (const imputed of await findImputationHits(context.database, [input.matterId])) {
        hits.push({
          entityId: imputed.entityId,
          sourceClass: "imputation",
          // Imputation is its own distinct class already; the co-party flag is for the party/graph
          // channels, so an imputed hit is never additionally flagged.
          coParty: false,
          // Identity, not similarity: an exact join is the strongest evidence there is.
          tier: 1,
          // Names the role, never the member's account handle: the handle is not a name a reader
          // knows, and the hit already names the person through its entity.
          matchedFields: [`a firm employee is a party on the matter (${imputed.role})`],
          path: [],
        });
      }
    } else {
      // No matter to join against, so the question becomes whether anybody this check reached is
      // one of the firm's own people. The same identity join, over the closure instead of a matter.
      const pathByEntity = new Map(expanded.map((entity) => [entity.entityId, entity.path]));
      for (const member of await findMemberEntities(
        context.database,
        expanded.map((entity) => entity.entityId),
      )) {
        hits.push({
          entityId: member.entityId,
          sourceClass: "imputation",
          coParty: false,
          tier: 1,
          matchedFields: ["is a firm employee"],
          path: pathByEntity.get(member.entityId) ?? [],
        });
      }
    }
  }
  // THE FIRM'S OWN RECORDS: calls, texts, email, tasks and Magnus conversations, searched for the
  // parties the check was asked about. Not the walked closure: a related entity reached through the
  // graph is a Directory finding, and looking for every one of them in every message would bury the
  // parties actually named. Results share the write ceiling with the Directory's, after them, so the
  // batch can never exceed what one transaction carries; a refusal is recorded like any other.
  const places = scope.places;
  let placeResultsFound = 0;
  let placeResultsRefused = 0;
  let fileOutcome: Awaited<ReturnType<typeof searchFiles>> | null = null;
  let namesAtCeiling = 0;
  if (asksForAnyPlace(places)) {
    await report("places", {
      entitiesReached: expanded.length,
      entitiesMatched: subjectFacts.size,
      candidatesSurfaced: similarityHits.length,
    });
    const needles = await readPartyNeedles(context.database, [...seedIds], scope.nameRoles);
    const recordSearch = asksForRecordPlaces(places)
      ? await searchContent(context.database, needles, places)
      : { hits: [], namesAtCeiling: 0 };
    namesAtCeiling = recordSearch.namesAtCeiling;
    const recordHits = recordSearch.hits;
    fileOutcome = await searchFiles(
      context.database,
      needles,
      places.files,
      run.fileContents ?? null,
    );
    const found = [...recordHits, ...fileOutcome.hits];
    const room = Math.max(0, CANDIDATE_WRITE_CEILING - hits.length);
    placeResultsFound = found.length;
    placeResultsRefused = Math.max(0, found.length - room);
    for (const contentHit of found.slice(0, room)) {
      hits.push({
        entityId: contentHit.entityId,
        sourceClass: "content",
        coParty: false,
        tier: contentHit.tier,
        matchedFields: [...contentHit.matchedFields],
        path: [],
        foundIn: contentHit.foundIn,
      });
    }
    await report("places", {
      entitiesReached: expanded.length,
      entitiesMatched: subjectFacts.size,
      candidatesSurfaced: similarityHits.length,
      placeResults: found.length,
    });
  }
  await report("candidates", {
    entitiesReached: expanded.length,
    entitiesMatched: subjectFacts.size,
    candidatesSurfaced: similarityHits.length,
    candidatesRecorded: hits.length,
    ...(asksForAnyPlace(places) ? { placeResults: placeResultsFound } : {}),
  });

  const scopeRecord: Record<string, SourceAvailability> = {};
  for (const sourceClass of scope.sources) scopeRecord[sourceClass] = availabilityOf(sourceClass);
  // Prior-firm lateral history is a registered source with no table. Record it, never omit it.
  scopeRecord[PRIOR_FIRM_HISTORY_SOURCE] = "unavailable";
  // Nickname equivalents: the catalogue exists and ships empty, so the dimension is recorded as one
  // the check could not search. Read rather than asserted — the day a firm curates a catalogue this
  // stops claiming otherwise without anybody editing this file.
  scopeRecord[NICKNAME_EQUIVALENCE_SOURCE] = (await nicknameCatalogueIsPopulated(context.database))
    ? "searched"
    : "unavailable";
  // The firm's own records, recorded searched exactly when they were asked for. A place nobody asked
  // for is absent, like a Directory technique nobody asked for, and reads as not searched.
  if (places.messaging.length > 0) scopeRecord[MESSAGING_SOURCE] = "searched";
  if (places.tasks.length > 0) scopeRecord[TASKS_SOURCE] = "searched";
  if (places.magnus) scopeRecord[MAGNUS_CONVERSATIONS_SOURCE] = "searched";
  // Files is recorded searched only when the file contents index answered; a run that could not
  // reach it records why rather than reading as searched and empty.
  if (places.files.length > 0) {
    scopeRecord[FILES_SOURCE] = fileOutcome?.status === "searched" ? "searched" : "unavailable";
  }

  const triggerSource = input.triggerSource ?? null;

  // WHETHER TO ANNOUNCE THIS RUN. A check a person asked for never announces: the person who asked is
  // looking at the result, and a notification for it would train the firm to ignore the channel by
  // the time an automated one matters. An automated check announces when it found something a person
  // has not seen — the strongest two evidence tiers, or a matter's first hit ever, whatever its tier.
  //
  // Both facts are known here, from this run's own hits plus one existence probe, so the announcement
  // carries counts and nothing downstream has to query for anything. A hit written in this batch is
  // undisposed by construction: its identifier was minted a few lines ago, so no disposition can name
  // it, and there is nothing to check for.
  const strongUndisposedHits = hits.filter((hit) => hit.tier <= 2).length;
  const announce =
    triggerSource !== null &&
    triggerSource !== "manual" &&
    input.matterId !== undefined &&
    hits.length > 0 &&
    (strongUndisposedHits > 0 || !(await matterHasEarlierHits(context, input.matterId)));

  // Identifiers are recorded BY REFERENCE. No plaintext value ever enters the log.
  //
  // `traversal` records the walk VERBATIM: that every relationship was followed to closure, how deep
  // the closure ran, the ceiling in force and, when the ceiling stopped the walk, that it stopped and
  // how much it did not see. A reader of a years-old row must not have to know what the code did on
  // the day the check ran, and a truncated expansion must never read as a completed one: that is the
  // depth analogue of the rule that a source recording `unavailable` never reads as searched and
  // clean. The key names are the ones rows written under the old hop budgets carry, so one parser
  // reads both.
  const inputs = {
    subjectEntityIds: [...seedIds].toSorted(),
    expandedEntityIds: expanded.map((entity) => entity.entityId).toSorted(),
    identifierRefs: await readIdentifierReferences(context, [...seedIds]),
    skippedIdentifierTypes: ["dob", "ssn_last_four"],
    // WHAT THE NAME COMPARISON ACTUALLY DID, recorded verbatim beside the traversal and read the same
    // way. `strictness` stays on the row as the human-facing preset name, but a preset is a word whose
    // meaning moves as channels are added, and a reader of a years-old check must not have to know
    // what the word meant that day. So the row names the channels and the name roles instead.
    matching: {
      nameKeys: ["normalized_display", "normalized_match_key", "normalized_match_key_bare"],
      phoneticSchemes:
        scope.strictness === "balanced"
          ? ["double_metaphone_primary"]
          : ["double_metaphone_primary", "double_metaphone_secondary"],
      // `null` means every role the corpus holds, which is a different statement from a list that
      // happens to name them all: a firm that adds a name role later is covered by the first.
      nameRoles: scope.nameRoles,
      // Whether names were also compared by trigram overlap. A person may turn it off at the
      // balanced band; the record says so, because it narrows what the check could find.
      trigramMatching: scope.trigramMatching,
    },
    traversal: {
      followedToClosure: true,
      longestPathLength: expansion.longestPathLength,
      // The platform's ceiling on one walk, under the key the old cap wrote to, so a reader of any
      // row finds the bound in force under one name.
      closureCap: WALK_CEILING,
      corporateFamily: "transitive",
      expiredEdgesTraversed: true,
      truncated: expansion.truncation !== null,
      ...(expansion.truncation === null
        ? {}
        : {
            entitiesReached: expansion.truncation.entitiesReached,
            unexploredFrontierSize: expansion.truncation.unexploredFrontierSize,
            unexpandedReachedCount: expansion.truncation.unexpandedReachedCount,
          }),
    },
    // WHAT THE RUN SURFACED VERSUS WHAT IT WROTE. Recorded beside `traversal` and read the same way:
    // the ceiling in force always, and — when it bit — how many candidates were refused and at which
    // tiers. `truncated: false` is the ordinary case and says the written hits are everything the
    // channels found; a row predating this record carries no `candidates` key at all, which reads as
    // the row not saying rather than as the search having been complete.
    // WHAT WAS SEARCHED BEYOND THE DIRECTORY, and how, so a reader of the row knows what "searched"
    // covered: which channels and task statuses, that names are compared whole and only from
    // NAME_FLOOR characters, that numbers match on their last NUMBER_FLOOR-or-more digits, and that an
    // email's body is not in reach. Absent on a run that asked for none of them.
    ...(asksForAnyPlace(places)
      ? {
          places: {
            messaging: places.messaging,
            tasks: places.tasks,
            magnus: places.magnus,
            files: places.files,
            ...(fileOutcome === null || places.files.length === 0
              ? {}
              : {
                  filesSearched: fileOutcome.status === "searched",
                  fileMattersInReach: fileOutcome.mattersInReach,
                  fileMattersSearched: fileOutcome.mattersSearched,
                  fileMattersNotSearched: fileOutcome.mattersNotSearched,
                  fileMattersFailed: fileOutcome.mattersFailed,
                  fileQueryCeiling: FILE_QUERY_CEILING,
                }),
            partiesSearched: seedIds.size,
            nameResultCeiling: NAME_RESULT_CEILING,
            namesAtCeiling,
            nameFloor: NAME_FLOOR,
            numberFloor: NUMBER_FLOOR,
            emailBodiesSearched: false,
            resultsFound: placeResultsFound,
            resultsRefused: placeResultsRefused,
          },
        }
      : {}),
    candidates: {
      candidateCap: CANDIDATE_WRITE_CEILING,
      truncated: candidateTruncation !== null,
      ...(candidateTruncation === null
        ? {}
        : {
            candidatesSurfaced: candidateTruncation.candidatesSurfaced,
            candidatesWritten: candidateTruncation.candidatesWritten,
            candidatesRefused: candidateTruncation.candidatesRefused,
            refusedByTier: candidateTruncation.refusedByTier,
          }),
    },
  };

  const settledAt = options.clock.now();
  await runConflictsEffect(context.database, undefined, options.clock, () => ({
    statements: [
      insertCheckStatement(context.database, {
        id: checkId,
        trigger: input.trigger,
        subjectMatterId: input.matterId ?? null,
        subjectPartiesJson: JSON.stringify(inputs.subjectEntityIds),
        scopeJson: JSON.stringify(scopeRecord),
        strictness: scope.strictness,
        // The shipped column meant the widest hop budget in force. There is no budget now, so it
        // records how deep the closure actually ran — a true fact about the corpus, and never a
        // number smaller than the walk. `traversal.followedToClosure` is what says which reading a
        // row takes.
        depth: expansion.longestPathLength,
        inputsJson: JSON.stringify(inputs),
        floorRaised: scope.floorRaised,
        actorUserId: options.actorUserId,
        triggerSource,
        // Every cause the run covers, or null when a person asked for it and the cause is simply
        // that they did.
        causeJson:
          input.causes === undefined || input.causes.length === 0
            ? null
            : JSON.stringify(input.causes),
        createdAt: now,
      }),
      ...hits.map((hit) =>
        insertHitStatement(context.database, {
          id: newIdentifier("conflictsHit", options.randomSource),
          checkId,
          entityId: hit.entityId,
          sourceClass: hit.sourceClass,
          evidenceTier: hit.tier as 1 | 2 | 3 | 4,
          matchedFieldsJson: JSON.stringify(hit.matchedFields),
          graphPathJson: JSON.stringify(hit.path),
          coParty: hit.coParty,
          foundInJson: hit.foundIn === undefined ? null : JSON.stringify(hit.foundIn),
          createdAt: now,
        }),
      ),
      // The run settles in the same commit as its record, so a completed run always has one.
      guarded(completeRunStatement(context.database, checkId, settledAt), "conflicts-run.complete"),
      conflictsAuditStatement(context.database, options, "conflicts.check.run", checkId),
    ],
    // The announcement, in the same atomic batch as the check and its hits, so the message exists if
    // and only if the rows it describes committed. COUNTS AND HANDLES ONLY: no entity name, no
    // matched field, no identifier of any kind. A notification row outlives the access check that
    // justified it, so what it may carry has to be decided where the privileged data is, which is
    // here — the subject is resolved behind the deep link through this package's own access-checked
    // read, exactly as every other notification's is.
    outboxMessages: announce
      ? [
          {
            topic: CONFLICTS_HIT_SURFACED_TOPIC,
            payload: {
              checkId,
              matterId: input.matterId,
              hitCount: hits.length,
              strongHitCount: strongUndisposedHits,
            },
          },
        ]
      : [],
    responseCode: 201,
    responseBody: { id: checkId },
    value: checkId,
    fromBody: (body) => (body as { id: ConflictsCheckId }).id,
  }));
}

// Where a run of a check that names a matter lands: under the check most recently filed on that
// matter, so an automated re-check is a further run of the matter's check rather than an unrelated
// row in the firm's log; or as a new numbered check where the matter has none yet.
async function homeForMatterRun(
  context: DirectoryIdentifierContext,
  matterId: string | undefined,
): Promise<{ readonly numberedCheckId: ConflictsCheckId } | null> {
  if (matterId === undefined) return null;
  const latest = await readLatestNumberedCheckForMatter(context.database, matterId);
  return latest === null ? null : { numberedCheckId: latest.id };
}

// The synchronous composition: open a run and execute it, in the invocation that asked. This is what
// the automated paths and the fixtures call — a queue consumer or a cron pass has nobody watching a
// screen, and its budget is its own. A run a person asked for is opened by its route and executed
// after the response, through the same two functions.
export async function runConflictsCheck(
  context: DirectoryIdentifierContext,
  input: RunCheckInput,
  options: ConflictsWriteOptions,
  fileContents?: FileContentsSearcher,
): Promise<ConflictsCheckId> {
  const opened: OpenedRun = await openCheckRun(
    context.database,
    {
      request: {
        trigger: input.trigger,
        matterId: input.matterId ?? null,
        subjectEntityIds: [...input.subjectEntityIds],
        scope: input.scope,
      },
      triggerSource: input.triggerSource ?? null,
      under: await homeForMatterRun(context, input.matterId),
    },
    options,
  );
  const executed = await executeCheckRun(
    context,
    { runId: opened.runId, input, ...(fileContents === undefined ? {} : { fileContents }) },
    options,
  );
  // A replayed idempotency key returns the run the first request opened, which has been executed
  // already (or is being executed now); its id is the record's id either way.
  return executed ?? opened.runId;
}
