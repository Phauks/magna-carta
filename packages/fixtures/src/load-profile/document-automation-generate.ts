import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  defineCustomField,
  type DefineCustomFieldInput,
} from "@magna-carta/custom-fields/custom-field-service";
import {
  setCustomFieldValue,
  type CustomFieldValueInput,
} from "@magna-carta/custom-fields/custom-field-value-service";
import type { CustomFieldWriteOptions } from "@magna-carta/custom-fields/run-custom-field-effect";
import type { CustomFieldKind } from "@magna-carta/custom-fields/types";
import { linkMatterParty } from "@magna-carta/directory/party";
import { composeCreateMatterAssignment } from "@magna-carta/matters/matter-assignment";
import { composeSetMatterCourtCase } from "@magna-carta/matters/matter-court-case";
import { composeSetMatterEstate } from "@magna-carta/matters/matter-estate";
import { upsertMemberProfessionalProfileStatement } from "@magna-carta/matters/member-professional-profile";
import { customMergeKeyFor } from "@magna-carta/document-assembly/custom-field-bindings";
import { DICTIONARY } from "@magna-carta/document-assembly/dictionary";
import { confirmFieldMappingStatements } from "@magna-carta/document-assembly/field-mapping-statements";
import {
  completeDocumentAssemblyStatement,
  insertDocumentAssemblyStatement,
} from "@magna-carta/document-assembly/assembly-statements";
import {
  markTemplateVersionCleanStatement,
  setCurrentTemplateVersionStatement,
} from "@magna-carta/document-assembly/template-statements";
import {
  composeTemplateArchive,
  composeTemplateVersionRegistration,
  composeTemplateRegistration,
  type RegisterTemplateInput,
  type TemplateServiceOptions,
} from "@magna-carta/document-assembly/template-service";
import type { TemplatePreparation } from "@magna-carta/document-assembly/register";
import type {
  FieldManifest,
  ManifestBlock,
  ManifestComputedField,
  ManifestField,
} from "@magna-carta/document-assembly/types";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DocumentTemplateId,
  DocumentTemplateVersionId,
  FileId,
  FileVersionId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { DocumentAutomationVolume } from "./profile.ts";

// The document-automation volume: the firm's template catalogue and its immutable version history
// through composeTemplateRegistration / composeTemplateVersionRegistration, the confirmed
// Word-name-to-merge-key mapping library through confirmFieldMappingStatements, the assembly provenance
// rows through the same insert/complete statements the queue consumer commits, and — on ONE probe matter
// — the merge-context hot case: its own matter-axis custom fields carrying current values, plus a full
// party list. Every write rides a REAL composed effect, never a raw INSERT, so the measured reads (the
// catalogue list, the one-read current-version resolve, the batched merge context, the custom-field
// manifest read) resolve against production-faithful row shapes.
//
// It must run AFTER the practice, directory, and custom-field generators: it binds templates to the
// matter types the practice generator made, links parties from the entities the directory generator
// made, and defines its own fields alongside the ones the custom-field generator already attached.
//
// THE PROBE MATTER IS DELIBERATELY NOT THE CUSTOM-FIELD PROBE. The custom-field measurement layer times
// a per-record current-value read against its own busiest record; laying forty more values on that same
// matter would silently change what that measurement measures. So the automation probe is chosen as a
// different matter, and the forty fields' values land only on it.

// The platform merge keys an ordinary template's manifest draws from. A manifest field is keyed by its
// merge key, so this list is the ceiling on distinct platform fields a template can declare.
const PLATFORM_MERGE_KEYS: readonly string[] = DICTIONARY.map((entry) => entry.key);

// The roles the probe matter's party links are spread across.
//
// The first three are laid down EXACTLY ONCE. A matter has one client, one opposing party, and one
// opposing counsel, and the Directory role merge sources resolve a single party per role — a probe
// matter carrying three of each would measure only the ambiguous path, where the resolution stops at a
// count. The remaining links alternate between the two roles a matter genuinely carries several of,
// which is what a role collection walks and what keeps the party read's row count realistic.
const SINGULAR_PARTY_ROLES = ["client", "opposing_party", "opposing_counsel"] as const;
const REPEATED_PARTY_ROLES = ["guardian", "witness"] as const;

function partyRoleAt(index: number): string {
  return (
    SINGULAR_PARTY_ROLES[index] ??
    REPEATED_PARTY_ROLES[(index - SINGULAR_PARTY_ROLES.length) % REPEATED_PARTY_ROLES.length]!
  );
}

// The firm-field shapes the probe matter's bindings cycle through, each with the value it stores. All
// four storage columns are covered on purpose: the merge read joins and the scale rules that decide
// whether a stored `500` prints as five hundred or as five dollars are only exercised if the batched
// statement actually returns a number, a currency amount, and a date — not forty text values.
const MERGE_FIELD_SHAPES: readonly {
  readonly kind: CustomFieldKind;
  readonly numberScale: number | null;
  readonly value: (context: FixtureContext) => CustomFieldValueInput;
}[] = [
  {
    kind: "number",
    numberScale: null,
    value: (context) => ({
      kind: "number",
      number: context.faker.number.int({ min: 0, max: 1_000_000 }),
    }),
  },
  {
    kind: "currency",
    numberScale: 2,
    value: (context) => ({
      kind: "number",
      number: context.faker.number.int({ min: 0, max: 100_000_000 }),
    }),
  },
  {
    kind: "date",
    numberScale: null,
    value: (context) => ({ kind: "date", date: context.clock.today() }),
  },
  {
    kind: "single-line",
    numberScale: null,
    value: (context) => ({ kind: "text", text: context.faker.lorem.words(3) }),
  },
];

// Probe identifiers the document-automation measurement layer binds its real operations to —
// deterministic for a given profile + seed, recorded in the snapshot manifest.
export interface DocumentAutomationProbes {
  // The matter the merge-context measurement resolves against: forty of the firm's own fields with
  // current values, and a full party list.
  readonly probeMatterId: MatterId;
  // The template whose manifest declares the whole probe key set — the merge context's hot case.
  readonly probeTemplateId: DocumentTemplateId;
  // Its current (clean) version — what readTemplateVersionForAssembly resolves at the head of a job.
  readonly probeTemplateVersionId: DocumentTemplateVersionId;
  // The probe manifest, as stored, so the measurement resolves the SAME manifest the version carries
  // rather than rebuilding one that might drift from it.
  readonly probeFieldManifestJson: string;
  // The SECOND probe manifest: a repeating block over a role collection, an aggregate over its items,
  // and every protected key the dictionary offers. The plain manifest above leaves blocks and computed
  // fields empty, which is right for an ordinary template — but it means the two things that make the
  // batching claim non-trivial go unmeasured. Expression keys join the read plan precisely so an
  // expression can never be the reason a read happens late, and protected keys are read one at a time
  // by design (one permission check, one audit row, one decrypt each). Neither shows up in a profile
  // unless a manifest actually carries them.
  readonly expressionProbeFieldManifestJson: string;
  // The name of the first catalogue page's last row, and its id — the keyset cursor a second page
  // starts from, so the list measurement can be taken at a real page boundary rather than only at the
  // head of the table.
  readonly catalogueCursorName: string;
  readonly catalogueCursorId: string;
}

export interface DocumentAutomationGenerationResult {
  readonly templateCount: number;
  readonly archivedTemplateCount: number;
  readonly templateVersionCount: number;
  readonly assemblyCount: number;
  readonly fieldMappingCount: number;
  readonly probes: DocumentAutomationProbes;
}

// A manifest over a chosen key set. Occurrences are drawn per field so `totalOccurrences` is the real
// denominator rather than the field count restated, and the block/computed lists stay empty for an
// ordinary template — the expression constructs are exercised by the package's own tests, and what this
// volume is for is the SHAPE the resolution reads plan from.
function manifestFor(
  keys: readonly string[],
  context: FixtureContext,
  occurrences: { readonly min: number; readonly max: number },
): FieldManifest {
  const fields: ManifestField[] = [];
  let totalOccurrences = 0;
  for (const key of keys) {
    const count = context.faker.number.int(occurrences);
    totalOccurrences += count;
    fields.push({
      key,
      format: null,
      occurrences: count,
      parts: ["word/document.xml"],
      forms: ["brace"],
    });
  }
  return {
    fields,
    totalOccurrences,
    unconvertedMergeFields: [],
    blocks: [],
    computedFields: [],
  };
}

// A manifest that carries the constructs the plain one deliberately leaves out: a repeating block over
// a collection, an aggregate computed over that collection's items, and every protected key.
//
// The point is not the microsecond number. It is that the READ PLAN and the DECRYPT COUNT appear in the
// harness at the size a real firm produces: expression keys are supposed to join the plan so a
// resolution still issues one read per source, and the protected read loop is supposed to be serial —
// both are claims about shape that only a manifest carrying these constructs can exercise.
function expressionManifestFor(
  context: FixtureContext,
  occurrences: { readonly min: number; readonly max: number },
): FieldManifest {
  const collection = DICTIONARY.find(
    (entry) => entry.valueType === "list" && (entry.itemFields?.length ?? 0) > 0,
  );
  const protectedKeys = DICTIONARY.filter((entry) => entry.sensitivity === "protected").map(
    (entry) => entry.key,
  );

  const fields: ManifestField[] = [];
  let totalOccurrences = 0;
  // The protected keys as ordinary placeholders: each one costs its own permission check, audit row,
  // and decrypt, which is the serial cost this manifest exists to make visible.
  for (const key of protectedKeys) {
    const count = context.faker.number.int(occurrences);
    totalOccurrences += count;
    fields.push({
      key,
      format: null,
      occurrences: count,
      parts: ["word/document.xml"],
      forms: ["brace"],
    });
  }

  const blocks: ManifestBlock[] = [];
  const computedFields: ManifestComputedField[] = [];
  if (collection !== undefined) {
    const itemField = collection.itemFields?.[0]?.name;
    blocks.push({
      kind: "each",
      source: collection.key,
      resultType: "list",
      part: "word/document.xml",
      keys: [collection.key],
      depth: 0,
    });
    // An aggregate over the same collection: one computed field whose key set joins the read plan.
    computedFields.push({
      source: `count(${collection.key})`,
      format: null,
      resultType: "number",
      part: "word/document.xml",
      keys: [collection.key],
      occurrences: 1,
    });
    totalOccurrences += 1;
    if (itemField !== undefined) {
      // A placeholder scoped INSIDE the repeat, which is the case that must not add a read: the
      // collection was already read whole.
      blocks.push({
        kind: "if",
        source: `has(${collection.key})`,
        resultType: "boolean",
        part: "word/document.xml",
        keys: [collection.key],
        depth: 1,
      });
    }
  }

  return {
    fields,
    totalOccurrences,
    unconvertedMergeFields: [],
    blocks,
    computedFields,
  };
}

// The registration input a version is composed from. The stored bytes are modeled by a VIEW onto one
// shared pool buffer rather than a fresh array per version: the only thing that reaches the row is
// `bytes.byteLength` (node:sqlite has no R2), and allocating a real quarter-megabyte package per version
// would spend a hundred megabytes to record a number.
function preparationFor(manifest: FieldManifest, bytes: Uint8Array): TemplatePreparation {
  return {
    bytes,
    manifest,
    warnings: [],
    normalizerVersion: 1,
    removedMacroParts: [],
    macrosStripped: false,
    mergeFieldDetections: [],
    mergeFieldsConverted: false,
    confirmedMergeFieldMappings: [],
  };
}

export async function generateDocumentAutomationVolume(
  database: BatchDatabase,
  context: FixtureContext,
  volume: DocumentAutomationVolume,
  // The custom-field volume's probe record, so this generator can pick a DIFFERENT matter and leave
  // that measurement's shape untouched.
  customFieldProbeRecordId: string,
  options: SeedingOptions,
): Promise<DocumentAutomationGenerationResult> {
  assertSeedingAllowed(options);
  const { faker, clock, randomSource } = context;
  const serviceOptions: TemplateServiceOptions = { clock, actorUserId: null, randomSource };
  const customFieldOptions: CustomFieldWriteOptions = { clock, actorUserId: null, randomSource };
  const commit = async (statements: readonly SqlStatement[]): Promise<void> => {
    await commitEffectBatch(
      database,
      { statements: [...statements], outboxMessages: [] },
      { now: () => clock.now() },
    );
  };

  // --- The probe matter. A numbered matter that is NOT the custom-field probe, so the forty fields
  // this generator defines land somewhere that measurement does not read. ---
  const { results: matterRows } = await database
    .prepare("SELECT id, matter_type_id FROM matter WHERE matter_type_id IS NOT NULL ORDER BY id")
    .all<{ id: string; matter_type_id: string }>();
  if (matterRows.length === 0) {
    throw new Error("load-profile: document-automation volume needs at least one numbered matter");
  }
  const probeRow = matterRows.find((row) => row.id !== customFieldProbeRecordId) ?? matterRows[0]!;
  const probeMatterId = probeRow.id as MatterId;
  const probeMatterTypeId = probeRow.matter_type_id;

  // --- The firm's own fields on the probe matter's type, each with a current value on the probe
  // matter. These become the `custom.<handle>` bindings the probe template declares, and the width of
  // the ONE batched statement the merge context resolves them with. ---
  const customKeys: string[] = [];
  for (let index = 0; index < volume.customFieldBindings; index += 1) {
    const shape = MERGE_FIELD_SHAPES[index % MERGE_FIELD_SHAPES.length]!;
    const input: DefineCustomFieldInput = {
      name: `${faker.commerce.productAdjective()} ${faker.commerce.department()} ${index}`,
      kind: shape.kind,
      target: "matter",
      attachmentId: probeMatterTypeId,
      numberScale: shape.numberScale,
    };
    const { customFieldId } = await defineCustomField(database, input, customFieldOptions);
    clock.advanceMinutes(1);
    await setCustomFieldValue(
      database,
      {
        fieldId: customFieldId,
        targetRowId: probeMatterId,
        value: shape.value(context),
      },
      customFieldOptions,
    );
    clock.advanceMinutes(1);
    customKeys.push(customMergeKeyFor(customFieldId));
  }

  // --- The probe matter's party links: the whole collection a repeat walks in one read. Persons come
  // from the directory generator's corpus; a matter with no available entity simply gets fewer links. ---
  const { results: personRows } = await database
    .prepare("SELECT id FROM directory_person ORDER BY id LIMIT ?1")
    .bind(volume.partyLinksOnProbeMatter)
    .all<{ id: string }>();
  for (const [index, person] of personRows.entries()) {
    await linkMatterParty(
      database,
      {
        matterId: probeMatterId,
        entityId: person.id,
        role: partyRoleAt(index),
        // The client acts in a recorded fiduciary capacity, so the composed capacity line resolves
        // over real data — the phrase the probate measurements read.
        capacity: index === 0 ? "Administrator" : null,
      },
      { clock, actorUserId: null, randomSource },
    );
    clock.advanceMinutes(1);
  }

  // --- The probe matter's staffing beyond the responsible attorney, each member with a professional
  // profile so the staffing read's joins return real facts. Distinct roles by construction: the
  // measured context is the RESOLVED one, and a duplicated role would honestly resolve its subject
  // to an absence — a correct answer that would leave the joins unmeasured. ---
  const STAFFING_ROLES = [
    "supervising_attorney",
    "originating_attorney",
    "assigned_paralegal",
    "billing_attorney",
  ] as const;
  const { results: staffMemberRows } = await database
    .prepare("SELECT user_id FROM member ORDER BY user_id LIMIT ?1")
    .bind(Math.min(volume.staffingAssignmentsOnProbeMatter, STAFFING_ROLES.length))
    .all<{ user_id: string }>();
  for (const [index, member] of staffMemberRows.entries()) {
    const memberUserId = member.user_id as UserId;
    const assignment = await composeCreateMatterAssignment(
      database,
      {
        matterId: probeMatterId,
        memberUserId,
        assignmentRole: STAFFING_ROLES[index]!,
      },
      { clock, actorUserId: null, randomSource },
    );
    await commit(assignment.statements);
    clock.advanceMinutes(1);
    await commit([
      upsertMemberProfessionalProfileStatement(
        database,
        memberUserId,
        {
          title: index === 0 ? "Partner" : "Associate",
          admissions: "Nevada, 2014",
          directDial: faker.phone.number({ style: "national" }),
          professionalEmail: faker.internet.email().toLowerCase(),
          signatureBlock: null,
        },
        clock.now(),
      ),
    ]);
    clock.advanceMinutes(1);
  }

  // --- The probe matter's court-case and estate records: one of each, so the court and estate
  // sources resolve real rows and the merge-context measurement covers every statement-issuing
  // source the catalogue declares. The court is a Directory organisation and the judge and decedent
  // Directory persons, exactly as production records them. ---
  const { results: courtOrganisationRows } = await database
    .prepare("SELECT id FROM directory_organization ORDER BY id LIMIT 1")
    .all<{ id: string }>();
  const { results: judgeRows } = await database
    .prepare("SELECT id FROM directory_person ORDER BY id DESC LIMIT 2")
    .all<{ id: string }>();
  const courtCase = await composeSetMatterCourtCase(
    database,
    probeMatterId,
    {
      courtEntityId: courtOrganisationRows[0]?.id ?? null,
      judgeEntityId: judgeRows[0]?.id ?? null,
      caseNumber: "PR26-00381",
      division: "Probate Division",
      department: "Department 6",
      filedOn: "2025-11-04",
      clientDesignation: "Petitioner",
      opposingDesignation: "Respondent",
    },
    { clock, actorUserId: null, randomSource },
  );
  await commit(courtCase.statements);
  clock.advanceMinutes(1);
  const estate = await composeSetMatterEstate(
    database,
    probeMatterId,
    {
      decedentEntityId: judgeRows[1]?.id ?? null,
      estateEntityId: null,
      dateOfDeath: "2025-09-17",
      estateStyle: "the Estate of Rowan Ashcroft, Deceased",
      shortStyle: "the Ashcroft Estate",
      proceedingType: "intestate",
      lettersIssuedOn: "2025-12-02",
    },
    { clock, actorUserId: null, randomSource },
  );
  await commit(estate.statements);
  clock.advanceMinutes(1);

  // --- The mapping library: confirmed Word-name-to-merge-key entries, read WHOLE once per
  // registration. Names are unique by construction (the table's unique index is on field_name). ---
  const mappings = Array.from({ length: volume.fieldMappingCount }, (_, index) => ({
    fieldName: `${faker.commerce.productAdjective()}${faker.commerce.productMaterial()}${index}`,
    mergeKey: PLATFORM_MERGE_KEYS[index % PLATFORM_MERGE_KEYS.length]!,
  }));
  if (mappings.length > 0) {
    await commit(confirmFieldMappingStatements(database, mappings, serviceOptions));
    clock.advanceMinutes(1);
  }

  // --- The catalogue. Each template registers with a first version, gains its version history, has its
  // current pointer moved to the last clean version, and a slice is archived. ---
  const archiveTarget = Math.round(volume.templateCount * volume.archivedTemplateFraction);
  const matterTypeIds = [...new Set(matterRows.map((row) => row.matter_type_id))];
  let templateVersionCount = 0;
  let archivedTemplateCount = 0;
  const activeTemplates: {
    name: string;
    id: DocumentTemplateId;
    versionId: DocumentTemplateVersionId;
  }[] = [];
  // The pool the modeled template packages are cut from as views (see preparationFor).
  const bytePool = new Uint8Array(volume.templateSizeBytes.max);
  const modeledBytes = (): Uint8Array =>
    bytePool.subarray(0, faker.number.int(volume.templateSizeBytes));

  const registerVersions = async (
    templateId: DocumentTemplateId,
    firstVersionId: DocumentTemplateVersionId,
    extraVersions: number,
    manifest: FieldManifest,
  ): Promise<DocumentTemplateVersionId> => {
    let currentVersionId = firstVersionId;
    templateVersionCount += 1;
    for (let index = 0; index < extraVersions; index += 1) {
      // A new version of an existing template writes no catalogue row, so the catalogue-shaped fields
      // below are unread on this path — a template is never edited in place, only versioned, and the
      // name and scoping stay on the row the first registration wrote.
      const input: RegisterTemplateInput = {
        name: "",
        description: null,
        matterTypeId: null,
        locationId: null,
        preparation: preparationFor(manifest, modeledBytes()),
        contentSha256: faker.string.hexadecimal({ length: 64, prefix: "", casing: "lower" }),
      };
      const registered = await composeTemplateVersionRegistration(
        database,
        templateId,
        input,
        serviceOptions,
      );
      await commit(registered.effect.statements);
      currentVersionId = registered.versionId;
      templateVersionCount += 1;
      clock.advanceMinutes(1);
    }
    // Every version clears the gate; the catalogue pointer follows the last one. A version whose scan
    // never cleared would leave the template unassemblable, which is a state the routes' own tests
    // cover — what this volume needs is a catalogue whose rows are readable.
    await commit([
      markTemplateVersionCleanStatement(
        database,
        currentVersionId,
        "clean",
        "fixture",
        null,
        clock.now(),
      ),
      setCurrentTemplateVersionStatement(database, templateId, currentVersionId, clock.now()),
    ]);
    clock.advanceMinutes(1);
    return currentVersionId;
  };

  for (let index = 0; index < volume.templateCount; index += 1) {
    const fieldCount = faker.number.int(volume.fieldsPerTemplate);
    const manifest = manifestFor(
      PLATFORM_MERGE_KEYS.slice(0, Math.min(fieldCount, PLATFORM_MERGE_KEYS.length)),
      context,
      volume.occurrencesPerField,
    );
    const name = `${faker.company.buzzAdjective()} ${faker.commerce.department()} ${index}`;
    const input: RegisterTemplateInput = {
      name,
      description: faker.lorem.sentence(),
      // Most templates are scoped to a matter type (the catalogue list's second filter); a few are
      // firm-wide.
      matterTypeId:
        index % 5 === 0
          ? null
          : (matterTypeIds[index % matterTypeIds.length] as RegisterTemplateInput["matterTypeId"]),
      locationId: null,
      preparation: preparationFor(manifest, modeledBytes()),
      contentSha256: faker.string.hexadecimal({ length: 64, prefix: "", casing: "lower" }),
    };
    const registered = composeTemplateRegistration(database, input, serviceOptions);
    await commit(registered.effect.statements);
    clock.advanceMinutes(1);
    const currentVersionId = await registerVersions(
      registered.templateId,
      registered.versionId,
      faker.number.int(volume.versionsPerTemplate) - 1,
      manifest,
    );

    if (archivedTemplateCount < archiveTarget) {
      await commit(
        composeTemplateArchive(database, registered.templateId, serviceOptions).statements,
      );
      archivedTemplateCount += 1;
      clock.advanceMinutes(1);
    } else {
      activeTemplates.push({ name, id: registered.templateId, versionId: currentVersionId });
    }
  }

  // --- The probe template: the whole key set the firm's dictionary offers for this matter type — every
  // platform key plus every one of the probe matter's custom bindings — so the merge-context
  // measurement resolves the widest context a template can ask for. ---
  const probeManifest = manifestFor(
    [...PLATFORM_MERGE_KEYS, ...customKeys],
    context,
    volume.occurrencesPerField,
  );
  // Registered on the same probe template's version history, so it is stored rather than rebuilt at
  // measurement time and cannot drift from what the measurement resolves.
  const expressionProbeManifest = expressionManifestFor(context, volume.occurrencesPerField);
  const probeInput: RegisterTemplateInput = {
    name: "Zzz Probe Assembly Template",
    description: "The widest merge context this firm's dictionary can offer.",
    matterTypeId: probeMatterTypeId as RegisterTemplateInput["matterTypeId"],
    locationId: null,
    preparation: preparationFor(probeManifest, bytePool),
    contentSha256: faker.string.hexadecimal({ length: 64, prefix: "", casing: "lower" }),
  };
  const probeTemplate = composeTemplateRegistration(database, probeInput, serviceOptions);
  await commit(probeTemplate.effect.statements);
  clock.advanceMinutes(1);
  const probeVersionId = await registerVersions(
    probeTemplate.templateId,
    probeTemplate.versionId,
    volume.versionsPerTemplate.max - 1,
    probeManifest,
  );
  activeTemplates.push({
    name: probeInput.name,
    id: probeTemplate.templateId,
    versionId: probeVersionId,
  });

  // --- Assembly provenance. Each matter records a few filed documents, pointing at real file/version
  // rows the practice generator committed, through the SAME insert + complete statements the queue
  // consumer commits. ---
  const { results: filedRows } = await database
    .prepare(
      "SELECT file.matter_id AS matter_id, file.id AS file_id, file_version.id AS version_id FROM file JOIN file_version ON file_version.file_id = file.id ORDER BY file.id, file_version.id",
    )
    .all<{ matter_id: string; file_id: string; version_id: string }>();
  const filedByMatter = new Map<string, { fileId: string; versionId: string }[]>();
  for (const row of filedRows) {
    const list = filedByMatter.get(row.matter_id) ?? [];
    list.push({ fileId: row.file_id, versionId: row.version_id });
    filedByMatter.set(row.matter_id, list);
  }

  let assemblyCount = 0;
  for (const row of matterRows) {
    const target = faker.number.int(volume.assembliesPerMatter);
    const filed = filedByMatter.get(row.id) ?? [];
    for (let index = 0; index < target; index += 1) {
      // The probe matter's assemblies all name the probe template's version, so the by-version index
      // has a hot key; every other matter draws across the catalogue. Template and version always
      // travel together — a provenance row naming a version of another template is a row no reader of
      // the table could explain.
      const source =
        row.id === probeMatterId
          ? { id: probeTemplate.templateId, versionId: probeVersionId }
          : activeTemplates[faker.number.int({ min: 0, max: activeTemplates.length - 1 })]!;
      const assemblyId = newIdentifier("documentAssembly", randomSource);
      const statements: SqlStatement[] = [
        insertDocumentAssemblyStatement(database, {
          id: assemblyId,
          matterId: row.id as MatterId,
          templateId: source.id,
          templateVersionId: source.versionId,
          folderId: null,
          engineVersion: 1,
          dictionaryVersion: 1,
          requestedBy: null,
          createdAt: clock.now(),
        }),
      ];
      // Most assemblies finished and filed a document; a tail is left queued, which is what the
      // matter-scoped list read has to page over as well.
      const output = filed[index % Math.max(1, filed.length)];
      if (output !== undefined) {
        statements.push(
          completeDocumentAssemblyStatement(database, {
            assemblyId,
            fileId: output.fileId as FileId,
            fileVersionId: output.versionId as FileVersionId,
            outcome: index % 7 === 0 ? "succeeded_with_absences" : "succeeded",
            absentFieldKeys: index % 7 === 0 ? ["location.footer"] : [],
            frozenFieldNames: [],
            completedAt: clock.now(),
          }),
        );
      }
      await commit(statements);
      assemblyCount += 1;
      clock.advanceMinutes(1);
    }
  }

  // The keyset cursor the catalogue list's second page starts from: the sorted-by-name row at the page
  // boundary, so the measured list is taken mid-catalogue rather than only at the head.
  const sortedActive = [...activeTemplates].sort((left, right) =>
    left.name === right.name
      ? left.id.localeCompare(right.id)
      : left.name.localeCompare(right.name),
  );
  const cursor = sortedActive[Math.floor(sortedActive.length / 2)] ?? sortedActive[0]!;

  return {
    templateCount: volume.templateCount + 1,
    archivedTemplateCount,
    templateVersionCount,
    assemblyCount,
    fieldMappingCount: mappings.length,
    probes: {
      probeMatterId,
      probeTemplateId: probeTemplate.templateId,
      probeTemplateVersionId: probeVersionId,
      probeFieldManifestJson: JSON.stringify(probeManifest),
      expressionProbeFieldManifestJson: JSON.stringify(expressionProbeManifest),
      catalogueCursorName: cursor.name,
      catalogueCursorId: cursor.id,
    },
  };
}
