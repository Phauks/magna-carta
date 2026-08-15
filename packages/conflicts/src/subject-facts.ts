import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { readPerson } from "@magna-carta/directory/person";
import { readOrganization } from "@magna-carta/directory/organization";
import {
  DIRECTORY_ORGANIZATION_TABLE,
  DIRECTORY_PERSON_TABLE,
} from "@magna-carta/directory/statements";
import type { MatchPartyInput } from "./matching.ts";

// The entity's current name parts and kind, shaped for the matcher. One home for the "which node
// table, which columns, what does an absent row mean" question, so the per-entity read and the
// set-valued read can never answer it differently.

// The entity id prefixes are self-describing (see packages/directory/src/entity-kind.ts, which this
// package does not depend on directly): "directoryPerson_..." or "directoryOrganization_...". Used
// only to pick which node table to read — never to skip validating that the row actually exists.
export function subjectKindOf(entityId: string): "person" | "organization" | null {
  if (entityId.startsWith("directoryPerson_")) return "person";
  if (entityId.startsWith("directoryOrganization_")) return "organization";
  return null;
}

// Returns null for an entity id that does not resolve to a live person or organization row (an
// unknown prefix, or a row that has been hard-deleted, which the directory otherwise never does) so
// the caller can skip it rather than crash a whole check over one bad reference.
export async function readSubjectFacts(
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
        // Carries the subject's id so the matcher can fire the exact-identifier (tier 1) channel over
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

// D1 caps bound parameters at 100 per query. Mirrors MAX_BOUND_PARAMETERS in
// packages/ledger/src/statements.ts.
const MAX_SUBJECT_BOUND_PARAMETERS = 100;

// The same facts for a whole expanded set, in ONE query per node table (per hundred ids) rather than
// one per entity. A five-hundred-entity closure is five hundred single-row reads on the per-entity
// path, before any matching happens at all.
//
// An entity id with an unknown prefix, or one whose row is absent, is simply missing from the result
// map — the same "skip it, do not crash the check" outcome readSubjectFacts returns null for. The
// only behaviour that cannot be reproduced here is the loud rethrow on a transient database error,
// and it does not need to be: a failing set-valued read throws on its own.
export async function readSubjectFactsBatch(
  context: DirectoryIdentifierContext,
  entityIds: readonly string[],
): Promise<Map<string, MatchPartyInput>> {
  const facts = new Map<string, MatchPartyInput>();
  const personIds: string[] = [];
  const organizationIds: string[] = [];
  for (const entityId of new Set(entityIds)) {
    const kind = subjectKindOf(entityId);
    if (kind === "person") personIds.push(entityId);
    else if (kind === "organization") organizationIds.push(entityId);
  }

  for (let start = 0; start < personIds.length; start += MAX_SUBJECT_BOUND_PARAMETERS) {
    const chunk = personIds.slice(start, start + MAX_SUBJECT_BOUND_PARAMETERS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await context.database
      .prepare(
        `SELECT id, name_given, name_family, display_name
           FROM ${DIRECTORY_PERSON_TABLE} WHERE id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<{
        id: string;
        name_given: string | null;
        name_family: string | null;
        display_name: string | null;
      }>();
    for (const row of results) {
      facts.set(row.id, {
        kind: "person",
        given: row.name_given ?? undefined,
        family: row.name_family ?? undefined,
        displayName: row.display_name ?? undefined,
        entityId: row.id,
      });
    }
  }

  for (let start = 0; start < organizationIds.length; start += MAX_SUBJECT_BOUND_PARAMETERS) {
    const chunk = organizationIds.slice(start, start + MAX_SUBJECT_BOUND_PARAMETERS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await context.database
      .prepare(
        `SELECT id, legal_name, display_name
           FROM ${DIRECTORY_ORGANIZATION_TABLE} WHERE id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<{ id: string; legal_name: string | null; display_name: string | null }>();
    for (const row of results) {
      facts.set(row.id, {
        kind: "organization",
        legalName: row.legal_name ?? undefined,
        displayName: row.display_name ?? undefined,
        entityId: row.id,
      });
    }
  }

  return facts;
}
