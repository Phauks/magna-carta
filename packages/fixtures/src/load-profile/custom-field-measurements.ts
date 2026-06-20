import { directoryIdentifierValue } from "@magna-carta/data-access/protected-field-registry";
import type { ProtectedReadContext } from "@magna-carta/data-access/protected-fields";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import { readCurrentValues } from "@magna-carta/custom-fields/reads";
import { previewConvert } from "@magna-carta/custom-fields/convert";
import { setCustomFieldValue } from "@magna-carta/custom-fields/custom-field-value-service";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CustomFieldId, UserId } from "@magna-carta/identifiers/types";
import { createPerson } from "@magna-carta/directory/person";
import { mergeEntities, type MergeEntitiesInput } from "@magna-carta/directory/merge";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import type { FirmId } from "@magna-carta/identifiers/types";
import { fixtureContext, type FixtureContext } from "../context.ts";
import { createProfileFirmKeyProvider } from "./protected-generate.ts";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The custom-field volume-shaped measured set: the per-record current-value read (the matter/entity
// detail panel's field fan), the contact-reference back-reference lookup (which records point at an
// entity — the merge repoint's and the entity-detail's read), the convert preview scan (a field's
// whole current-value set classified for a kind change), and a non-destructive merge whose repoint
// folds an entity's custom-field references onto the master at scale. Each rides the REAL domain path
// (readCurrentValues / the reference-lookup SQL / previewConvert / mergeEntities), so the index walks,
// the LEFT JOIN to picklist_option, the coercion classifier, and the repoint UPDATEs are all on the
// clock. The cost of these depends on the data SHAPE the custom-field generator laid down — a record
// with a full field set, a field with a value per record of its type, and a back-reference corpus.

// The read context the merge measurement runs its repoint under: the seed-derived firm key (unused by
// the custom-field repoint itself, but the merge's identifier-context type requires it) and the
// per-firm database for the merge's atomic batch + audit row.
export interface CustomFieldMeasurementHandle {
  readonly snapshot: LoadedSnapshot;
  readonly context: FixtureContext;
  readonly identifierContext: DirectoryIdentifierContext;
  // The acting user the merge records as merged_by (entity_merge.merged_by is NOT NULL) — minted on
  // the disjoint measurement stream, never a seeded id.
  readonly actorUserId: UserId;
  // The matter carrying the most current values — the per-record read's hot case.
  readonly busiestRecordId: string;
  // A contact-reference field and the entity its values point at — the back-reference lookup target.
  readonly referenceFieldId: string;
  readonly referencedEntityId: string;
  // A field with a value on every record of its type — the convert preview scan's hot case.
  readonly convertScanFieldId: CustomFieldId;
}

// The read side derives its audit-row ids + clock from its OWN `${seed}:custom-field-measure` stream —
// disjoint from the seeded data and from the other measurement streams, since the merge's audit + merge
// rows share the audit_log / entity_merge tables. The firm KEY still comes from the base seed.
export async function customFieldMeasurementHandle(
  snapshot: LoadedSnapshot,
  seed: string,
): Promise<CustomFieldMeasurementHandle> {
  const context = fixtureContext(`${seed}:custom-field-measure`);
  const { directoryProbes, customFieldProbes } = snapshot.manifest;
  const firmKeyProvider = await createProfileFirmKeyProvider(snapshot.manifest.seed);
  const actorUserId = newIdentifier("user", context.randomSource);
  const readContext: ProtectedReadContext = {
    firmId: directoryProbes.firmId as FirmId,
    firmKeyVersion: directoryProbes.firmKeyVersion,
    firmKeyProvider,
    database: snapshot.database,
    effectivePermissions: new Set([directoryIdentifierValue.permission]),
    actorUserId,
    clock: context.clock,
    randomSource: context.randomSource,
  };
  return {
    snapshot,
    context,
    identifierContext: readContext,
    actorUserId,
    busiestRecordId: customFieldProbes.busiestRecordId,
    referenceFieldId: customFieldProbes.referenceFieldId,
    referencedEntityId: customFieldProbes.referencedEntityId,
    convertScanFieldId: customFieldProbes.convertScanFieldId as CustomFieldId,
  };
}

// One merge's freshly minted endpoints + the custom-field references that hang off the subordinate, so
// the timed mergeEntities has real repoint work and never collides on the partial unique value index.
interface MergePair {
  readonly masterId: string;
  readonly subordinateId: string;
}

// Untimed per-iteration setup for the merge measurement: mint a fresh master + subordinate person, give
// the subordinate an OWNED entity value (target_row_id = subordinate) and a back-reference value
// (value_reference_id = subordinate) on another record, so the timed merge repoints both. A merge
// archives the subordinate, so a fresh pair is needed each iteration (a second merge of the same pair
// fails). The writes ride the REAL person + value write paths on the disjoint measurement stream.
async function freshMergePair(handle: CustomFieldMeasurementHandle): Promise<MergePair> {
  const { snapshot, context, referenceFieldId } = handle;
  const writeOptions = {
    clock: context.clock,
    actorUserId: handle.actorUserId,
    randomSource: context.randomSource,
  };
  const masterId = await createPerson(
    snapshot.database,
    { given: context.faker.person.firstName(), family: context.faker.person.lastName() },
    writeOptions,
  );
  const subordinateId = await createPerson(
    snapshot.database,
    { given: context.faker.person.firstName(), family: context.faker.person.lastName() },
    writeOptions,
  );
  // A back-reference value on the busiest record pointing AT the subordinate (repointed to master).
  await setCustomFieldValue(
    snapshot.database,
    {
      fieldId: referenceFieldId as CustomFieldId,
      targetRowId: handle.busiestRecordId,
      value: {
        kind: "reference",
        referenceId: subordinateId,
        referenceKind: "contact-reference",
      },
    },
    writeOptions,
  );
  // An OWNED value on the subordinate (target_row_id = subordinate) — moved onto the master by the
  // repoint. Uses the reference field with a self-reference so exactly one value column is populated.
  await setCustomFieldValue(
    snapshot.database,
    {
      fieldId: referenceFieldId as CustomFieldId,
      targetRowId: subordinateId,
      value: {
        kind: "reference",
        referenceId: masterId,
        referenceKind: "contact-reference",
      },
    },
    writeOptions,
  );
  return { masterId, subordinateId };
}

export const customFieldMeasurements: readonly Measurement<
  CustomFieldMeasurementHandle,
  MergePair | undefined
>[] = [
  {
    name: "custom-field.read-current-values",
    operation: async (handle) => {
      // The matter/entity detail panel's field fan: every current value on one record, one index walk.
      await readCurrentValues(handle.snapshot.database, handle.busiestRecordId);
    },
  },
  {
    name: "custom-field.reference-lookup",
    operation: async (handle) => {
      // The contact-reference back-reference channel: which custom-field values point at an entity —
      // the value_reference_id equality the merge repoint reads and the entity-detail back-references.
      await referenceLookupStatement(handle.snapshot, handle.referencedEntityId).all();
    },
  },
  {
    name: "custom-field.preview-convert-scan",
    operation: async (handle) => {
      // A field's whole current-value set classified for a kind change — the convert preview scan walks
      // the field index and LEFT JOINs picklist_option, classifying each value with the coercion rules.
      await previewConvert(handle.snapshot.database, {
        fieldId: handle.convertScanFieldId,
        toKind: "single-line",
      });
    },
  },
  {
    name: "custom-field.merge-repoint",
    prepare: (handle) => freshMergePair(handle),
    operation: async (handle, pair) => {
      // The non-destructive merge's repoint at scale: the custom-field value pointing at the
      // subordinate (value_reference_id) and the value owned by the subordinate (target_row_id) are
      // both folded onto the master in the one atomic batch — both reads walk an index.
      const input: MergeEntitiesInput = {
        masterId: pair!.masterId,
        subordinateId: pair!.subordinateId,
        survivorship: {},
      };
      await mergeEntities(handle.identifierContext, input);
    },
  },
];

// Nothing is allowlisted: every EXPLAIN'd custom-field hot path must walk an index. The per-record read
// walks (target_row_id, is_current); the reference lookup walks (value_reference_id); the convert scan
// walks (field_id); the merge repoint's reads walk those same indexes.
export const CUSTOM_FIELD_PLAN_SCAN_ALLOWLIST: readonly string[] = [];

// The snapshot database is the node:sqlite adapter, so every statement it prepares carries the SQL text
// + bindings the EXPLAIN probe needs (the D1-shaped return type omits them). Recovering the runtime
// shape here keeps the probes on the REAL SQL — no literal copy to drift.
function captured(statement: { bind(...values: unknown[]): unknown }): NodeSqlStatement {
  return statement as unknown as NodeSqlStatement;
}

// The per-record current-value read SQL readCurrentValues runs — the (target_row_id, is_current) index
// walk the matter/entity detail panel resolves against. Literal here: reads.ts does not export the
// statement builder, and the plan shape is what the EXPLAIN holds scan-free.
function readCurrentValuesStatement(
  snapshot: LoadedSnapshot,
  targetRowId: string,
): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        "SELECT id, field_id, value_text, value_number, value_date, value_option_id, value_reference_id, valid_from, valid_to FROM custom_field_value WHERE target_row_id = ?1 AND is_current = 1",
      )
      .bind(targetRowId),
  );
}

// The contact-reference back-reference lookup: every current value pointing at an entity — the
// value_reference_id equality the merge repoint reads and the entity-detail back-reference panel shows.
// Walks the custom_field_value_reference_index.
function referenceLookupStatement(
  snapshot: LoadedSnapshot,
  referencedEntityId: string,
): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        "SELECT id, field_id, target_row_id FROM custom_field_value WHERE value_reference_id = ?1 AND is_current = 1",
      )
      .bind(referencedEntityId),
  );
}

// The convert preview scan's load: a field's whole current-value set, LEFT JOINed to picklist_option so
// a picklist value's label rides along. The SQL mirrors convert.ts loadCurrentValues (literal here: it
// does not export the statement). Walks the custom_field_value_field_index on field_id.
function convertScanStatement(snapshot: LoadedSnapshot, fieldId: string): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        `SELECT value.target_row_id, value.value_text, value.value_number, value.value_date, value.value_option_id, value.value_reference_id, option.name AS option_label
         FROM custom_field_value AS value
         LEFT JOIN picklist_option AS option ON option.id = value.value_option_id
         WHERE value.field_id = ?1 AND value.is_current = 1`,
      )
      .bind(fieldId),
  );
}

// The merge repoint's two custom_field_value reads: the rows pointing at the subordinate
// (value_reference_id) and the rows owned by the subordinate (target_row_id). Both must walk an index —
// the repoint runs them per merge, so a scan here would make every merge O(table).
function mergeRepointReferenceReadStatement(
  snapshot: LoadedSnapshot,
  entityId: string,
): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare("SELECT id AS row FROM custom_field_value WHERE value_reference_id = ?1")
      .bind(entityId),
  );
}

function mergeRepointOwnedReadStatement(
  snapshot: LoadedSnapshot,
  entityId: string,
): NodeSqlStatement {
  return captured(
    snapshot.database
      .prepare(
        "SELECT id AS row, field_id, is_current FROM custom_field_value WHERE target_row_id = ?1",
      )
      .bind(entityId),
  );
}

export function customFieldHotPathPlans(snapshot: LoadedSnapshot): LabeledPlan[] {
  const { customFieldProbes } = snapshot.manifest;
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "custom-field.read-current-values",
      statement: readCurrentValuesStatement(snapshot, customFieldProbes.busiestRecordId),
    },
    {
      label: "custom-field.reference-lookup",
      statement: referenceLookupStatement(snapshot, customFieldProbes.referencedEntityId),
    },
    {
      label: "custom-field.preview-convert-scan",
      statement: convertScanStatement(snapshot, customFieldProbes.convertScanFieldId),
    },
    {
      label: "custom-field.merge-repoint.reference-read",
      statement: mergeRepointReferenceReadStatement(snapshot, customFieldProbes.referencedEntityId),
    },
    {
      label: "custom-field.merge-repoint.owned-read",
      statement: mergeRepointOwnedReadStatement(snapshot, customFieldProbes.referencedEntityId),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(snapshot.raw, statement.sql, statement.bindings),
  }));
}
