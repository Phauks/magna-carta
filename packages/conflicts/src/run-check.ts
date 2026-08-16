import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { DIRECTORY_IDENTIFIER_TABLE } from "@magna-carta/directory/statements";
import { readMatterParties } from "@magna-carta/directory/party";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { ConflictsCheckId } from "@magna-carta/identifiers/types";
import { conflictsAuditStatement, type ConflictsWriteOptions } from "./audit.ts";
import { boundCandidateHits, type CandidateTruncation } from "./candidate-bound.ts";
import { assignTier, describeEvidence } from "./evidence.ts";
import { expandGraph, type ExpansionTruncation } from "./expansion.ts";
import { findImputationHits } from "./imputation.ts";
import { matchPartyBatch } from "./matching.ts";
import { nicknameCatalogueIsPopulated } from "@magna-carta/directory/nickname";
import { readSubjectFactsBatch } from "./subject-facts.ts";
import { runConflictsEffect } from "./run-conflicts-effect.ts";
import { readConflictsPolicy, resolveScope, type ScopeRequest } from "./settings.ts";
import {
  availabilityOf,
  NICKNAME_EQUIVALENCE_SOURCE,
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

export async function runConflictsCheck(
  context: DirectoryIdentifierContext,
  input: RunCheckInput,
  options: ConflictsWriteOptions,
): Promise<ConflictsCheckId> {
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

  // The check's own instant, taken once. Edge expiry is judged against it rather than against an
  // ambient clock read inside the traversal, so a long walk cannot have two different opinions about
  // whether a relationship had ended, and a recorded path is reproducible.
  const now = options.clock.now();

  const expansion = inScope.has("graph")
    ? await expandGraph(context.database, [...seedIds], {
        edgeClassBudgets: scope.edgeClassBudgets,
        closureCap: scope.closureCap,
        asOf: now,
      })
    : {
        entities: [...seedIds].map((entityId) => ({ entityId, path: [] as never[] })),
        truncation: null as ExpansionTruncation | null,
      };
  const expanded = expansion.entities;

  // Match every entity in the expanded set. A seed carries an empty path; an expanded entity carries
  // the edges that reached it, which is the hit's explanation.
  //
  // Two set-valued reads, not two reads per entity: one subject-facts read per node table over the
  // whole closure, then each blocking channel once over the whole closure. A traversal widened to a
  // five-hundred-entity cap without this is roughly two and a half thousand queries in one
  // invocation, which is why the batching lands in the same change as the widening rather than after
  // a measurement — it is the foundation the cap stands on, not an optimization of it.
  interface CandidateHit {
    entityId: string;
    sourceClass: SourceClass;
    coParty: boolean;
    tier: number;
    matchedFields: string[];
    path: unknown;
  }
  const similarityHits: CandidateHit[] = [];

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
    { nameRoles: scope.nameRoles },
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

  // The candidate bound applies HERE, to the similarity channels only — they are the pair whose output
  // is the closure times the corpus. Imputation below is an identity join over one matter's own party
  // list: it is bounded by the matter, it is tier 1 by construction, and a bound that could refuse a
  // firm member who genuinely IS a party would be refusing the strongest thing the engine can find.
  //
  // The bound sits after the matcher rather than inside it on purpose. `matchPartyBatch` is held to
  // returning exactly the per-entity matcher's hit set by test/matcher-equivalence.test.ts, and a bound
  // reaching into either path would make that proof about a narrowed answer instead of the answer.
  // Bounding the run's OUTPUT leaves the matchers identical and the proof intact by construction.
  const bounded = boundCandidateHits(similarityHits, scope.candidateCap);
  const hits: CandidateHit[] = [...bounded.hits];
  const candidateTruncation: CandidateTruncation | null = bounded.truncation;

  if (inScope.has("imputation") && input.matterId !== undefined) {
    for (const imputed of await findImputationHits(context.database, [input.matterId])) {
      hits.push({
        entityId: imputed.entityId,
        sourceClass: "imputation",
        // Imputation is its own distinct class already; the co-party flag is for the party/graph
        // channels, so an imputed hit is never additionally flagged.
        coParty: false,
        // Identity, not similarity: an exact join is the strongest evidence there is.
        tier: 1,
        matchedFields: [`firm member ${imputed.memberUserId} is a party (${imputed.role})`],
        path: [],
      });
    }
  }

  const scopeRecord: Record<string, SourceAvailability> = {};
  for (const sourceClass of scope.sources) scopeRecord[sourceClass] = availabilityOf(sourceClass);
  // Imputation needs a matter to join firm members against; without one it never ran, no matter how
  // the availability table above classifies the source class in general.
  if (inScope.has("imputation") && input.matterId === undefined) {
    scopeRecord["imputation"] = "unavailable";
  }
  // Prior-firm lateral history is a registered source with no table. Record it, never omit it.
  scopeRecord[PRIOR_FIRM_HISTORY_SOURCE] = "unavailable";
  // Nickname equivalents: the catalogue exists and ships empty, so the dimension is recorded as one
  // the check could not search. Read rather than asserted — the day a firm curates a catalogue this
  // stops claiming otherwise without anybody editing this file.
  scopeRecord[NICKNAME_EQUIVALENCE_SOURCE] = (await nicknameCatalogueIsPopulated(context.database))
    ? "searched"
    : "unavailable";

  const checkId = newIdentifier("conflictsCheck", options.randomSource);
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
  // `traversal` records the walk VERBATIM — the budget per edge class, the closure cap, and, when the
  // cap stopped the walk, that it stopped and how much it did not see. A reader of a years-old row
  // must not have to know what the code did with the strictness word and the depth integer on the day
  // the check ran, and a truncated expansion must never read as a completed one: that is the depth
  // analogue of the rule that a source recording `unavailable` never reads as searched and clean.
  const inputs = {
    subjectEntityIds: [...seedIds].sort(),
    expandedEntityIds: expanded.map((entity) => entity.entityId).sort(),
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
    },
    traversal: {
      edgeClassBudgets: scope.edgeClassBudgets,
      // Corporate-family edges are traversed transitively at no hop cost, so the closure cap is the
      // only thing that bounds them. Recorded as a word rather than a number because there is no
      // number that would be true.
      corporateFamily: "transitive",
      closureCap: scope.closureCap,
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
    // the cap in force always, and — when it bit — how many candidates were refused and at which
    // tiers. `truncated: false` is the ordinary case and says the written hits are everything the
    // channels found; a row predating this record carries no `candidates` key at all, which reads as
    // the row not saying rather than as the search having been complete.
    candidates: {
      candidateCap: scope.candidateCap,
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

  return runConflictsEffect(context.database, options.idempotency, options.clock, () => ({
    statements: [
      insertCheckStatement(context.database, {
        id: checkId,
        trigger: input.trigger,
        subjectMatterId: input.matterId ?? null,
        subjectPartiesJson: JSON.stringify(inputs.subjectEntityIds),
        scopeJson: JSON.stringify(scopeRecord),
        strictness: scope.strictness,
        depth: scope.depth,
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
          createdAt: now,
        }),
      ),
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
