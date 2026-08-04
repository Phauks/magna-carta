import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// Fitness probes for the conflicts log: the append-only conflicts_check / conflicts_hit /
// conflicts_disposition tables. Mirrors the aggregate-then-throw shape of
// packages/directory/src/fitness.ts — every probe runs, every offending row across every probe is
// collected, and assertConflictsFitness throws once with the full damage rather than stopping at the
// first violation.

// The nine append-only guard triggers the per-firm migration installs — three per table: BEFORE UPDATE
// and BEFORE DELETE reject the obvious mutations, and a BEFORE INSERT ... WHEN EXISTS guard rejects the
// REPLACE / INSERT OR REPLACE that would otherwise delete-then-reinsert past the other two. Each is a
// RAISE(ABORT). A dropped trigger silently reopens the log to mutation, so this probe checks presence
// directly against sqlite_master rather than trusting the migration ran intact.
const REQUIRED_APPEND_ONLY_TRIGGERS = [
  "conflicts_check_no_update",
  "conflicts_check_no_delete",
  "conflicts_check_no_replace",
  "conflicts_hit_no_update",
  "conflicts_hit_no_delete",
  "conflicts_hit_no_replace",
  "conflicts_disposition_no_update",
  "conflicts_disposition_no_delete",
  "conflicts_disposition_no_replace",
] as const;

// A hit referencing a check that no longer resolves. The two ids make the failure actionable.
export interface OrphanHit {
  readonly hitId: string;
  readonly checkId: string;
}

// A disposition referencing a hit that no longer resolves.
export interface OrphanDisposition {
  readonly dispositionId: string;
  readonly hitId: string;
}

// A conflicts_check row whose inputs_json carries a plaintext-identifier-shaped digit run — the
// structural guard on "identifiers by reference": the log records what was searched, never the
// plaintext identifier value that drove the search (e.g. a Social Security Number).
export interface PlaintextIdentifierInCheck {
  readonly checkId: string;
}

// A conflicts_hit row whose evidence JSON (matched_fields_json or graph_path_json) carries a
// plaintext-identifier-shaped digit run — the same guard, extended to the hit table, whose evidence
// strings are assembled from free text (describeEvidence, the imputation branch) and so are a second
// place a future edit could leak a value.
export interface PlaintextIdentifierInHit {
  readonly hitId: string;
}

// A conflicts_hit row whose evidence is malformed: its tier falls outside 1-4, or its
// graph_path_json fails to parse as a JSON array (an empty array is valid — a direct hit still
// records its empty connecting path, never omits the column).
export interface InvalidHitEvidence {
  readonly hitId: string;
  readonly reason: string;
}

// The aggregate fitness failure: the log-wide audit found at least one broken invariant. Carries
// every offending row across every probe so one run surfaces the full damage, not just the first hit.
export class ConflictsFitnessError extends Error {
  readonly code = "conflicts-fitness";
  readonly missingTriggers: readonly string[];
  readonly orphanHits: readonly OrphanHit[];
  readonly orphanDispositions: readonly OrphanDisposition[];
  readonly plaintextIdentifierChecks: readonly PlaintextIdentifierInCheck[];
  readonly plaintextIdentifierHits: readonly PlaintextIdentifierInHit[];
  readonly invalidHitEvidence: readonly InvalidHitEvidence[];
  constructor(
    missingTriggers: readonly string[],
    orphanHits: readonly OrphanHit[],
    orphanDispositions: readonly OrphanDisposition[],
    plaintextIdentifierChecks: readonly PlaintextIdentifierInCheck[],
    plaintextIdentifierHits: readonly PlaintextIdentifierInHit[],
    invalidHitEvidence: readonly InvalidHitEvidence[],
  ) {
    const parts: string[] = [];
    if (missingTriggers.length > 0) {
      parts.push(
        `${missingTriggers.length} append-only trigger(s) missing: ${missingTriggers.join(", ")}`,
      );
    }
    if (orphanHits.length > 0) {
      parts.push(
        `${orphanHits.length} hit(s) reference an unresolved check: ${orphanHits
          .map((hit) => `${hit.hitId}->${hit.checkId}`)
          .join(", ")}`,
      );
    }
    if (orphanDispositions.length > 0) {
      parts.push(
        `${orphanDispositions.length} disposition(s) reference an unresolved hit: ${orphanDispositions
          .map((disposition) => `${disposition.dispositionId}->${disposition.hitId}`)
          .join(", ")}`,
      );
    }
    if (plaintextIdentifierChecks.length > 0) {
      parts.push(
        `${plaintextIdentifierChecks.length} check(s) carry a plaintext identifier in inputs_json: ${plaintextIdentifierChecks
          .map((check) => check.checkId)
          .join(", ")}`,
      );
    }
    if (plaintextIdentifierHits.length > 0) {
      parts.push(
        `${plaintextIdentifierHits.length} hit(s) carry a plaintext identifier in evidence JSON: ${plaintextIdentifierHits
          .map((hit) => hit.hitId)
          .join(", ")}`,
      );
    }
    if (invalidHitEvidence.length > 0) {
      parts.push(
        `${invalidHitEvidence.length} hit(s) carry invalid evidence: ${invalidHitEvidence
          .map((hit) => `${hit.hitId}(${hit.reason})`)
          .join(", ")}`,
      );
    }
    super(`conflicts: fitness violations — ${parts.join("; ")} (conflicts-fitness)`);
    this.name = "ConflictsFitnessError";
    this.missingTriggers = missingTriggers;
    this.orphanHits = orphanHits;
    this.orphanDispositions = orphanDispositions;
    this.plaintextIdentifierChecks = plaintextIdentifierChecks;
    this.plaintextIdentifierHits = plaintextIdentifierHits;
    this.invalidHitEvidence = invalidHitEvidence;
  }
}

// findMissingAppendOnlyTriggers reports which of the six required append-only guard triggers are
// absent from sqlite_master. A complete migration leaves this empty.
export async function findMissingAppendOnlyTriggers(database: SqlDatabase): Promise<string[]> {
  const placeholders = REQUIRED_APPEND_ONLY_TRIGGERS.map((_, index) => `?${index + 1}`).join(", ");
  const { results } = await database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (${placeholders})`)
    .bind(...REQUIRED_APPEND_ONLY_TRIGGERS)
    .all<{ name: string }>();
  const present = new Set(results.map((result) => result.name));
  return REQUIRED_APPEND_ONLY_TRIGGERS.filter((trigger) => !present.has(trigger));
}

// findOrphanHits scans every conflicts_hit row for a check_id that resolves to no conflicts_check
// row. The table declares the foreign key, but SQLite does not enforce it without an explicit
// PRAGMA, so this probe proves the reference actually holds.
export async function findOrphanHits(database: SqlDatabase): Promise<OrphanHit[]> {
  const { results } = await database
    .prepare(
      `SELECT h.id AS hit_id, h.check_id AS check_id FROM conflicts_hit h
       WHERE NOT EXISTS (SELECT 1 FROM conflicts_check c WHERE c.id = h.check_id)`,
    )
    .all<{ hit_id: string; check_id: string }>();
  return results.map((result) => ({ hitId: result.hit_id, checkId: result.check_id }));
}

// findOrphanDispositions scans every conflicts_disposition row for a hit_id that resolves to no
// conflicts_hit row.
export async function findOrphanDispositions(database: SqlDatabase): Promise<OrphanDisposition[]> {
  const { results } = await database
    .prepare(
      `SELECT d.id AS disposition_id, d.hit_id AS hit_id FROM conflicts_disposition d
       WHERE NOT EXISTS (SELECT 1 FROM conflicts_hit h WHERE h.id = d.hit_id)`,
    )
    .all<{ disposition_id: string; hit_id: string }>();
  return results.map((result) => ({
    dispositionId: result.disposition_id,
    hitId: result.hit_id,
  }));
}

// Nine or more digits, allowing a single space or dash between adjacent digits — long enough, and
// separator-tolerant enough, to be a Social Security Number (`123-45-6789`), an EIN (`12-3456789`), an
// account, or a driver's-licence number, in either raw or formatted form. A bare `\d{9}` missed every
// formatted value (the longest consecutive run in `123-45-6789` is four); this catches the shapes the
// firm actually stores. Letters break the run, so type-prefixed entity handles never trip it. (DOB and
// SSN-last-four are lower-entropy 8-/4-digit values that are never standalone-indexed and are out of
// this heuristic's scope; the log carries them by reference like every other identifier.)
const IDENTIFIER_DIGIT_RUN = /\d(?:[\s-]?\d){8,}/;

// findPlaintextIdentifiersInChecks scans every conflicts_check row's inputs_json for an
// identifier-shaped digit run. The identifiers-by-reference rule means inputs_json should carry entity
// and identifier-type references, never the raw identifier value itself.
export async function findPlaintextIdentifiersInChecks(
  database: SqlDatabase,
): Promise<PlaintextIdentifierInCheck[]> {
  const { results } = await database
    .prepare(`SELECT id, inputs_json FROM conflicts_check`)
    .all<{ id: string; inputs_json: string }>();
  return results
    .filter((result) => IDENTIFIER_DIGIT_RUN.test(result.inputs_json))
    .map((result) => ({ checkId: result.id }));
}

// findPlaintextIdentifiersInHits scans every conflicts_hit row's evidence JSON (matched_fields_json +
// graph_path_json) for the same identifier-shaped digit run — the hit table is the second place the log
// records search output, and its evidence strings are free text, so it needs the same guard.
export async function findPlaintextIdentifiersInHits(
  database: SqlDatabase,
): Promise<PlaintextIdentifierInHit[]> {
  const { results } = await database
    .prepare(`SELECT id, matched_fields_json, graph_path_json FROM conflicts_hit`)
    .all<{ id: string; matched_fields_json: string; graph_path_json: string }>();
  return results
    .filter(
      (result) =>
        IDENTIFIER_DIGIT_RUN.test(result.matched_fields_json) ||
        IDENTIFIER_DIGIT_RUN.test(result.graph_path_json),
    )
    .map((result) => ({ hitId: result.id }));
}

// findInvalidHitEvidence scans every conflicts_hit row and reports one whose evidence_tier falls
// outside 1-4, or whose graph_path_json fails to parse as a JSON array. The CHECK constraint on
// evidence_tier already blocks an out-of-range write through the schema; this probe is the
// defense-in-depth sweep that also catches a graph_path_json shape the schema cannot constrain.
export async function findInvalidHitEvidence(database: SqlDatabase): Promise<InvalidHitEvidence[]> {
  const { results } = await database
    .prepare(`SELECT id, evidence_tier, graph_path_json FROM conflicts_hit`)
    .all<{ id: string; evidence_tier: number; graph_path_json: string }>();

  const found: InvalidHitEvidence[] = [];
  for (const result of results) {
    if (!(result.evidence_tier >= 1 && result.evidence_tier <= 4)) {
      found.push({
        hitId: result.id,
        reason: `evidence_tier ${result.evidence_tier} is outside 1-4`,
      });
      continue;
    }
    let parsedGraphPath: unknown;
    try {
      parsedGraphPath = JSON.parse(result.graph_path_json);
    } catch {
      found.push({ hitId: result.id, reason: "graph_path_json is not valid JSON" });
      continue;
    }
    if (!Array.isArray(parsedGraphPath)) {
      found.push({ hitId: result.id, reason: "graph_path_json does not parse to a JSON array" });
    }
  }
  return found;
}

// assertConflictsFitness runs the log-wide conflicts invariant audit and throws ConflictsFitnessError
// if ANY invariant is broken, aggregating every offending row across all six probes:
//   1. All nine append-only guard triggers exist — the log cannot be mutated, deleted, or replaced.
//   2. Every hit resolves to a real check — no orphan hit.
//   3. Every disposition resolves to a real hit — no orphan disposition.
//   4. No check's inputs_json carries a plaintext identifier value — identifiers are logged by
//      reference only.
//   5. No hit's evidence JSON carries a plaintext identifier value — the same reference-only rule.
//   6. Every hit's evidence_tier is 1-4 and its graph_path_json parses as a JSON array.
// Resolves silently when the log is sound. Wire it as a fitness function (a test, or a periodic
// integrity sweep) to prove the corpus invariants hold.
export async function assertConflictsFitness(database: SqlDatabase): Promise<void> {
  const [
    missingTriggers,
    orphanHits,
    orphanDispositions,
    plaintextIdentifierChecks,
    plaintextIdentifierHits,
    invalidHitEvidence,
  ] = await Promise.all([
    findMissingAppendOnlyTriggers(database),
    findOrphanHits(database),
    findOrphanDispositions(database),
    findPlaintextIdentifiersInChecks(database),
    findPlaintextIdentifiersInHits(database),
    findInvalidHitEvidence(database),
  ]);

  if (
    missingTriggers.length > 0 ||
    orphanHits.length > 0 ||
    orphanDispositions.length > 0 ||
    plaintextIdentifierChecks.length > 0 ||
    plaintextIdentifierHits.length > 0 ||
    invalidHitEvidence.length > 0
  ) {
    throw new ConflictsFitnessError(
      missingTriggers,
      orphanHits,
      orphanDispositions,
      plaintextIdentifierChecks,
      plaintextIdentifierHits,
      invalidHitEvidence,
    );
  }
}
