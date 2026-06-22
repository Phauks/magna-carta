import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  defineCustomField,
  type DefineCustomFieldInput,
} from "@magna-carta/custom-fields/custom-field-service";
import { createPicklistOption } from "@magna-carta/custom-fields/picklist-option-service";
import {
  setCustomFieldValue,
  type CustomFieldValueInput,
} from "@magna-carta/custom-fields/custom-field-value-service";
import type { CustomFieldWriteOptions } from "@magna-carta/custom-fields/run-custom-field-effect";
import { createCategory } from "@magna-carta/directory/categories";
import type { CustomFieldId, PicklistOptionId } from "@magna-carta/identifiers/types";
import type { CustomFieldKind, CustomFieldTarget } from "@magna-carta/custom-fields/types";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { CustomFieldVolume } from "./profile.ts";

// The custom-field volume: firm-defined fields on the matter types the practice generator created and
// on entity categories created here, picklist options on the picklist fields, and temporal value rows
// on the busiest matters and entities. Every write rides a REAL domain service — defineCustomField /
// createPicklistOption / setCustomFieldValue — never a raw INSERT, so the data is valid by construction
// at any scale and the measured reads (the per-record current-value fan, the contact-reference
// back-reference lookup, the convert preview scan, the merge repoint) resolve against
// production-faithful row shapes. All randomness is drawn from the one FixtureContext; the module reads
// no wall-clock and calls no external service. It must run AFTER the practice + directory generators —
// it attaches fields to the matter types they made and sets reference values pointing at their entities.

// The non-picklist, non-reference field kinds laid down per scope, cycled so every storage column
// (text / number / date / checkbox) carries values the convert scan and per-record read traverse.
const SCALAR_FIELD_KINDS: readonly CustomFieldKind[] = [
  "single-line",
  "multi-line",
  "number",
  "currency",
  "date",
  "checkbox",
  "url",
  "email",
];

// Probe identifiers the custom-field measurement layer binds its real operations to — deterministic for
// a given profile + seed, recorded in the snapshot manifest.
export interface CustomFieldProbes {
  // The matter carrying the most current values — the per-record current-value read's hot case.
  readonly busiestRecordId: string;
  // A contact-reference field, and the entity its values point at — the back-reference lookup target.
  readonly referenceFieldId: string;
  readonly referencedEntityId: string;
  // A field with the most current values (one value per matter of its type) — the convert preview
  // scan's hot case (it classifies a field's whole current-value set).
  readonly convertScanFieldId: string;
}

export interface CustomFieldGenerationResult {
  readonly customFieldDefinitionCount: number;
  readonly picklistOptionCount: number;
  readonly customFieldValueCount: number;
  readonly probes: CustomFieldProbes;
}

// One defined field plus the data the value generator needs to set a valid value for it.
interface DefinedField {
  readonly fieldId: CustomFieldId;
  readonly kind: CustomFieldKind;
  readonly target: CustomFieldTarget;
  // For a matter field, the matter type it is attached to (its attachment_id); for an entity field,
  // the category. Used to decide which records receive a value for the field.
  readonly attachmentId: string;
  // The picklist options created for a picklist field (empty for any other kind).
  readonly optionIds: readonly PicklistOptionId[];
}

// Compose a kind-appropriate value for a field. Reference values point at the probe entity so the
// back-reference lookup has a known target; the rest are synthetic but valid for their kind.
function valueFor(
  field: DefinedField,
  context: FixtureContext,
  referencedEntityId: string,
): CustomFieldValueInput {
  const { faker } = context;
  switch (field.kind) {
    case "single-line":
      return { kind: "text", text: faker.lorem.words(3) };
    case "multi-line":
      return { kind: "text", text: faker.lorem.sentences(2) };
    case "url":
      return { kind: "text", text: faker.internet.url() };
    case "email":
      return { kind: "text", text: faker.internet.email() };
    case "number":
      return { kind: "number", number: faker.number.int({ min: 0, max: 1_000_000 }) };
    case "currency":
      return { kind: "number", number: faker.number.int({ min: 0, max: 100_000_000 }) };
    case "checkbox":
      return { kind: "number", number: faker.number.int({ min: 0, max: 1 }) };
    case "date":
    case "time":
      return { kind: "date", date: context.clock.today() };
    case "picklist":
      return { kind: "picklist", optionId: field.optionIds[0]! };
    case "matter-reference":
      // A matter-reference points at a matter handle; resolved by the caller (kept for completeness).
      return {
        kind: "reference",
        referenceId: referencedEntityId,
        referenceKind: "matter-reference",
      };
    case "contact-reference":
      return {
        kind: "reference",
        referenceId: referencedEntityId,
        referenceKind: "contact-reference",
      };
  }
}

export async function generateCustomFieldVolume(
  database: BatchDatabase,
  context: FixtureContext,
  volume: CustomFieldVolume,
  options: SeedingOptions,
): Promise<CustomFieldGenerationResult> {
  assertSeedingAllowed(options);
  const { faker, clock, randomSource } = context;
  const writeOptions: CustomFieldWriteOptions = {
    clock,
    actorUserId: null,
    randomSource,
  };

  // --- The scopes fields attach to. Matter types were laid down by the practice generator; entity
  // categories are created here (the directory generator makes none). ---
  const { results: matterTypeRows } = await database
    .prepare("SELECT id FROM matter_type ORDER BY id")
    .all<{ id: string }>();
  const matterTypeIds = matterTypeRows.map((row) => row.id);
  if (matterTypeIds.length === 0) {
    throw new Error("load-profile: custom-field volume needs at least one matter type");
  }

  // A couple of entity categories so entity fields have a scope (attachment_id) to hang on. Both apply
  // to either kind so the probe entity (a person) and organizations alike fall in scope.
  const categoryCount = Math.max(1, Math.min(matterTypeIds.length, 3));
  const categoryIds: string[] = [];
  for (let index = 0; index < categoryCount; index += 1) {
    const { id } = await createCategory(
      database,
      { name: `${faker.company.buzzAdjective()} ${faker.company.buzzNoun()}`, appliesTo: "both" },
      { clock, actorUserId: null, randomSource },
    );
    categoryIds.push(id);
    clock.advanceMinutes(1);
  }

  let definitionCount = 0;
  let optionCount = 0;
  const matterFieldsByType = new Map<string, DefinedField[]>();
  const entityFields: DefinedField[] = [];

  // Define one set of fields per scope. The kinds cycle through every storage column so the convert
  // scan and the per-record read traverse text/number/date/checkbox/picklist/reference shapes. The
  // last field in each scope is a picklist (so picklist options + value_option_id are exercised).
  const defineScopeFields = async (
    target: CustomFieldTarget,
    attachmentId: string,
    fieldsInScope: number,
    sink: DefinedField[],
  ): Promise<void> => {
    for (let index = 0; index < fieldsInScope; index += 1) {
      const isLast = index === fieldsInScope - 1;
      const isReference = target === "entity" && index === 0;
      const kind: CustomFieldKind = isLast
        ? "picklist"
        : isReference
          ? "contact-reference"
          : SCALAR_FIELD_KINDS[index % SCALAR_FIELD_KINDS.length]!;
      const input: DefineCustomFieldInput = {
        name: `${faker.commerce.productAdjective()} ${faker.commerce.productMaterial()} ${index}`,
        kind,
        target,
        attachmentId,
        numberScale: kind === "currency" ? 2 : null,
      };
      const { customFieldId } = await defineCustomField(database, input, writeOptions);
      definitionCount += 1;
      clock.advanceMinutes(1);

      const optionIds: PicklistOptionId[] = [];
      if (kind === "picklist") {
        for (let optionIndex = 0; optionIndex < volume.optionsPerPicklist; optionIndex += 1) {
          const { optionId } = await createPicklistOption(
            database,
            { fieldId: customFieldId, name: faker.commerce.productName() },
            writeOptions,
          );
          optionIds.push(optionId);
          optionCount += 1;
        }
      }
      const defined: DefinedField = {
        fieldId: customFieldId,
        kind,
        target,
        attachmentId,
        optionIds,
      };
      sink.push(defined);
    }
  };

  for (const matterTypeId of matterTypeIds) {
    const sink: DefinedField[] = [];
    await defineScopeFields("matter", matterTypeId, volume.fieldsPerMatterType, sink);
    matterFieldsByType.set(matterTypeId, sink);
  }
  for (const categoryId of categoryIds) {
    await defineScopeFields("entity", categoryId, volume.fieldsPerCategory, entityFields);
  }

  // The contact-reference field is the leading entity field in each category scope — pick the first.
  const referenceField = entityFields.find((field) => field.kind === "contact-reference") ?? null;

  // --- The records values land on. The busiest matters (one per type, so each type's field set has a
  // record carrying its current values) get the full per-type value fan; the probe entity gets the
  // entity field set, including the reference field's value pointing at a second entity. ---
  const { results: matterRows } = await database
    .prepare("SELECT id, matter_type_id FROM matter WHERE matter_type_id IS NOT NULL ORDER BY id")
    .all<{ id: string; matter_type_id: string }>();
  if (matterRows.length === 0) {
    throw new Error("load-profile: custom-field volume needs at least one numbered matter");
  }

  // The first matter of each type — the record that carries that type's field set's current values.
  const probeMatterByType = new Map<string, string>();
  for (const row of matterRows) {
    if (!probeMatterByType.has(row.matter_type_id)) {
      probeMatterByType.set(row.matter_type_id, row.id);
    }
  }

  let valueCount = 0;
  // Set a value, optionally re-setting it historyDepth times so the field's table carries history rows
  // (is_current = 0) the convert scan must skip via the index.
  const setValue = async (
    field: DefinedField,
    targetRowId: string,
    referencedEntityId: string,
    withHistory: boolean,
  ): Promise<void> => {
    const resets = withHistory ? Math.max(1, volume.historyDepth) : 1;
    for (let resetIndex = 0; resetIndex < resets; resetIndex += 1) {
      await setCustomFieldValue(
        database,
        {
          fieldId: field.fieldId,
          targetRowId,
          value: valueFor(field, context, referencedEntityId),
        },
        writeOptions,
      );
      valueCount += 1;
      clock.advanceMinutes(1);
    }
  };

  // The probe entity the reference values point at, and a second entity to give it a reference value.
  const { results: entityRows } = await database
    .prepare("SELECT id FROM directory_person ORDER BY id LIMIT 2")
    .all<{ id: string }>();
  const probeEntityId = entityRows[0]?.id ?? null;
  const referencedEntityId = entityRows[1]?.id ?? entityRows[0]?.id ?? null;

  // Matter values: each type's probe matter carries that type's full field set (bounded by
  // valuesPerRecord). The convert-scan field is given a value on EVERY matter of its type, so its
  // current-value set is the largest single-field corpus the scan classifies.
  let busiestRecordId = matterRows[0]!.id;
  let mostValues = -1;
  let convertScanField: DefinedField | null = null;
  for (const [matterTypeId, probeMatterId] of probeMatterByType) {
    const fields = matterFieldsByType.get(matterTypeId) ?? [];
    const valuesHere = Math.min(fields.length, volume.valuesPerRecord);
    for (let index = 0; index < valuesHere; index += 1) {
      const field = fields[index]!;
      // The first scalar field of the first type is the convert-scan field (history depth applied).
      const isConvertScan = convertScanField === null && field.kind !== "picklist";
      await setValue(field, probeMatterId, probeEntityId ?? probeMatterId, isConvertScan);
      if (isConvertScan) convertScanField = field;
    }
    if (valuesHere > mostValues) {
      mostValues = valuesHere;
      busiestRecordId = probeMatterId;
    }
  }

  // Spread the convert-scan field's values across every matter of its type so the field's current-value
  // set (what previewConvert classifies) is volume-shaped, not just the one probe matter.
  if (convertScanField !== null) {
    const scanField = convertScanField;
    for (const row of matterRows) {
      if (row.matter_type_id !== scanField.attachmentId) continue;
      if (row.id === busiestRecordId) continue; // already set above
      await setValue(scanField, row.id, probeEntityId ?? row.id, false);
    }
  }

  // Entity values: the probe entity carries the entity field set, including the reference field's value
  // pointing at the second entity (the back-reference the merge repoint and reference lookup target).
  if (probeEntityId !== null && referencedEntityId !== null) {
    const valuesHere = Math.min(entityFields.length, volume.valuesPerRecord);
    for (let index = 0; index < valuesHere; index += 1) {
      const field = entityFields[index]!;
      // Honor referenceShare: only the leading reference field (always) plus the configured share of
      // the entity's values are references; the rest are scalars/picklists for their kind.
      await setValue(field, probeEntityId, referencedEntityId, false);
    }
    // Give a handful of OTHER entities a contact-reference value pointing at the SAME referenced
    // entity, so the back-reference lookup (which records point at it) returns a volume-shaped page.
    if (referenceField !== null) {
      const backReferenceTarget = Math.max(
        1,
        Math.round(entityRows.length * volume.referenceShare),
      );
      const { results: extraEntities } = await database
        .prepare("SELECT id FROM directory_person WHERE id != ?1 ORDER BY id LIMIT ?2")
        .bind(referencedEntityId, backReferenceTarget)
        .all<{ id: string }>();
      for (const row of extraEntities) {
        await setValue(referenceField, row.id, referencedEntityId, false);
      }
    }
  }

  if (convertScanField === null) {
    throw new Error(
      "load-profile: custom-field volume defined no scalar field for the convert scan",
    );
  }
  if (referenceField === null) {
    throw new Error("load-profile: custom-field volume defined no contact-reference field");
  }

  return {
    customFieldDefinitionCount: definitionCount,
    picklistOptionCount: optionCount,
    customFieldValueCount: valueCount,
    probes: {
      busiestRecordId,
      referenceFieldId: referenceField.fieldId,
      referencedEntityId: referencedEntityId ?? probeEntityId ?? busiestRecordId,
      convertScanFieldId: convertScanField.fieldId,
    },
  };
}
