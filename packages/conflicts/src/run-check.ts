import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { DIRECTORY_IDENTIFIER_TABLE } from "@magna-carta/directory/statements";
import { readMatterParties } from "@magna-carta/directory/party";
import { readPerson } from "@magna-carta/directory/person";
import { readOrganization } from "@magna-carta/directory/organization";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { ConflictsCheckId } from "@magna-carta/identifiers/types";
import { conflictsAuditStatement, type ConflictsWriteOptions } from "./audit.ts";
import { assignTier, describeEvidence } from "./evidence.ts";
import { expandGraph } from "./expansion.ts";
import { findImputationHits } from "./imputation.ts";
import { type MatchPartyInput, matchParty } from "./matching.ts";
import { runConflictsEffect } from "./run-conflicts-effect.ts";
import { readConflictsPolicy, resolveScope, type ScopeRequest } from "./settings.ts";
import { availabilityOf, PRIOR_FIRM_HISTORY_SOURCE } from "./sources.ts";
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

// The entity id prefixes are self-describing (see packages/directory/src/entity-kind.ts, which this
// package does not depend on directly): "directoryPerson_..." or "directoryOrganization_...". Used
// only to pick which node table to read — never to skip validating that the row actually exists.
function subjectKindOf(entityId: string): "person" | "organization" | null {
  if (entityId.startsWith("directoryPerson_")) return "person";
  if (entityId.startsWith("directoryOrganization_")) return "organization";
  return null;
}

// The entity's current name parts and kind, shaped for matchParty. Returns null for an entity id that
// does not resolve to a live person or organization row (an unknown prefix, or a row that has been
// hard-deleted, which the directory otherwise never does) so the caller can skip it rather than crash
// a whole check over one bad reference.
async function readSubjectFacts(
  context: DirectoryIdentifierContext,
  entityId: string,
): Promise<MatchPartyInput | null> {
  const kind = subjectKindOf(entityId);
  if (kind === null) return null;
  try {
    if (kind === "person") {
      const person = await readPerson(context.database, entityId as never);
      return {
        kind: "person",
        given: person.given ?? undefined,
        family: person.family ?? undefined,
        // The full rendered name so the tier-2 exact-name probe compares against the corpus's stored
        // normalized_display — given + family alone mis-tiers any party with a middle name or suffix.
        displayName: person.displayName ?? undefined,
        // Carries the subject's id so matchParty can fire the exact-identifier (tier 1) channel over
        // its sealed identifiers by blind-index equality — a name-mismatched SSN twin is caught here.
        entityId,
      };
    }
    const organization = await readOrganization(context.database, entityId as never);
    return {
      kind: "organization",
      legalName: organization.legalName ?? undefined,
      displayName: organization.displayName ?? undefined,
      entityId,
    };
  } catch (error) {
    // A genuinely-absent row (an unknown id, or the hard-delete the directory never performs) is the
    // only skippable case. Any other failure — a transient database error — must fail the whole check
    // loudly: silently dropping a seed while the log still records the source as "searched" would turn
    // an infrastructure error into a search that reports nothing, the exact miss this engine exists to
    // prevent.
    if (error instanceof Error && error.message.includes("not found")) return null;
    throw error;
  }
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

  const expanded = inScope.has("graph")
    ? await expandGraph(context.database, [...seedIds], scope.depth)
    : [...seedIds].map((entityId) => ({ entityId, path: [] as never[] }));

  // Match every entity in the expanded set. A seed carries an empty path; an expanded entity carries
  // the edges that reached it, which is the hit's explanation.
  const hits: Array<{
    entityId: string;
    sourceClass: SourceClass;
    coParty: boolean;
    tier: number;
    matchedFields: string[];
    path: unknown;
  }> = [];

  for (const entity of expanded) {
    const subject = await readSubjectFacts(context, entity.entityId);
    if (subject === null) continue;
    const matches = await matchParty(context, subject, scope.strictness);
    for (const match of matches) {
      // An entity never conflicts with itself, so the current search subject is dropped. But a match
      // landing on a DIFFERENT subject party is a genuine co-party surfacing — a positional conflict
      // (a related entity that is also a named party, e.g. the opposing party turns out to be the
      // client's parent company) or a co-party name/identifier collision — so it is recorded, flagged
      // co-party so a reviewer triages it apart from a conflict with a prior client, never dropped.
      if (match.entityId === entity.entityId) continue;
      hits.push({
        entityId: match.entityId,
        sourceClass: entity.path.length === 0 ? "party" : "graph",
        coParty: seedIds.has(match.entityId),
        tier: assignTier(match.evidence),
        matchedFields: describeEvidence(match.evidence),
        path: entity.path,
      });
    }
  }

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

  const checkId = newIdentifier("conflictsCheck", options.randomSource);
  const now = options.clock.now();
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
  const inputs = {
    subjectEntityIds: [...seedIds].sort(),
    expandedEntityIds: expanded.map((entity) => entity.entityId).sort(),
    identifierRefs: await readIdentifierReferences(context, [...seedIds]),
    skippedIdentifierTypes: ["dob", "ssn_last_four"],
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
