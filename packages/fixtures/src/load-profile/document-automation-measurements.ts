import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import {
  customFieldDictionaryEntries,
  customFieldHandleOf,
} from "@magna-carta/document-assembly/custom-field-bindings";
import {
  selectCustomFieldCatalogStatement,
  selectCustomFieldValuesStatement,
} from "@magna-carta/document-assembly/custom-field-statements";
import { dictionaryForFirm } from "@magna-carta/document-assembly/dictionary";
import {
  selectMatterForMergeStatement,
  selectMatterPartiesForMergeStatement,
} from "@magna-carta/document-assembly/merge-statements";
import {
  readCustomFieldCatalog,
  resolveMergeContext,
} from "@magna-carta/document-assembly/resolve";
import {
  listDocumentTemplates,
  listDocumentTemplatesStatement,
  readTemplateVersionForAssembly,
  readTemplateVersionForAssemblyStatement,
} from "@magna-carta/document-assembly/template-statements";
import { manifestKeys, type FieldManifest } from "@magna-carta/document-assembly/types";
import type { MatterId } from "@magna-carta/identifiers/types";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The document-automation (slice 2·6) volume-shaped measured set — the four operations the subsystem's
// design names, each riding the REAL query the production path issues:
//
//   1. the CATALOGUE LIST at the top of the expected range, taken at a mid-catalogue keyset boundary
//      rather than only at the head, so the (status, name) index is doing the work a real second page
//      asks of it;
//   2. the CURRENT-VERSION RESOLVE — the one read every assembly job starts with, joining the version
//      to its catalogue row so the job never pays two round trips for facts that always travel together;
//   3. the FULL MERGE-CONTEXT BATCH for the widest template this firm's dictionary can offer, against a
//      matter carrying a full party list and forty of the firm's own fields. This is THE measurement of
//      the batching rule: its cost must track the number of SOURCES, never the number of fields, so a
//      per-field resolver reintroduced later shows up here as a curve rather than as a code review;
//   4. the CUSTOM-FIELD MANIFEST READ the firm's dictionary is derived from — one read shared by
//      registration, the field-list surface, and assembly.
//
// Everything heavier than these is off the request path by design (reading template bytes, parsing or
// rebuilding OOXML, normalization, the DOCX-to-PDF hop, committing the output version), so it is not
// measured here — a measurement of it would imply it belonged on the hot path.

export interface DocumentAutomationMeasurementHandle {
  readonly database: SqlDatabase;
  readonly snapshot: LoadedSnapshot;
  // The probe manifest as the version stores it, parsed once: the measurement resolves the SAME
  // manifest the row carries rather than a rebuilt one that could drift from it.
  readonly probeManifest: FieldManifest;
  // The firm's dictionary — the shipped entries plus its own `custom.<handle>` bindings, derived from
  // the catalogue read exactly as the production path derives it.
  readonly firmDictionary: Awaited<ReturnType<typeof dictionaryForFirm>>;
  // The handles the probe manifest binds, in the order the batched value statement binds them.
  readonly probeCustomHandles: readonly string[];
}

// The catalogue list's page size — the templates route's default page, so the measured cost matches one
// real page rather than an arbitrary slice.
const CATALOGUE_PAGE_SIZE = 50;

export async function documentAutomationMeasurementHandle(
  snapshot: LoadedSnapshot,
): Promise<DocumentAutomationMeasurementHandle> {
  const { documentAutomationProbes } = snapshot.manifest;
  const probeManifest = JSON.parse(
    documentAutomationProbes.probeFieldManifestJson,
  ) as FieldManifest;
  const catalog = await readCustomFieldCatalog(snapshot.database);
  const firmDictionary = dictionaryForFirm(customFieldDictionaryEntries(catalog));
  const probeCustomHandles = [
    ...new Set(
      manifestKeys(probeManifest)
        .map((key) => customFieldHandleOf(key))
        .filter((handle): handle is string => handle !== undefined),
    ),
  ].sort();
  return {
    database: snapshot.database,
    snapshot,
    probeManifest,
    firmDictionary,
    probeCustomHandles,
  };
}

export const documentAutomationMeasurements: readonly Measurement<
  DocumentAutomationMeasurementHandle,
  unknown
>[] = [
  {
    name: "templates.list-catalogue",
    operation: async (handle) => {
      const { documentAutomationProbes } = handle.snapshot.manifest;
      // A page taken at a real keyset boundary: status filter plus the (name, id) cursor, which is
      // exactly what the catalogue surface issues once the user has scrolled past the first page.
      await listDocumentTemplates(handle.database, {
        status: "active",
        limit: CATALOGUE_PAGE_SIZE,
        afterName: documentAutomationProbes.catalogueCursorName,
        afterId: documentAutomationProbes.catalogueCursorId,
      });
    },
  },
  {
    name: "templates.version-for-assembly",
    operation: async (handle) => {
      // The head of every assembly job: the stored bytes' location and gate status, the field manifest,
      // and the catalogue name the produced document is named from — in one read.
      await readTemplateVersionForAssembly(
        handle.database,
        handle.snapshot.manifest.documentAutomationProbes.probeTemplateVersionId,
      );
    },
  },
  {
    name: "assembly.merge-context",
    operation: async (handle) => {
      // The whole context for the widest template the firm's dictionary offers. No object store is
      // supplied, so the letterhead image resolves as an absence rather than an error — which is the
      // production behaviour for an office with no logo, and keeps this a pure database measurement.
      const result = await resolveMergeContext(handle.database, {
        matterId: handle.snapshot.manifest.documentAutomationProbes.probeMatterId,
        manifest: handle.probeManifest,
        firmName: "Load Profile LLP",
        assembledAt: "2026-01-01T00:00:00.000Z",
        currencyCode: "USD",
        dictionary: handle.firmDictionary,
      });
      if (!result.ok) {
        throw new Error(`load-profile: merge context did not resolve: ${result.detail}`);
      }
    },
  },
  {
    name: "templates.custom-field-catalog",
    operation: async (handle) => {
      // The one read the firm's dictionary is derived from, shared by registration, the field list, and
      // assembly. It touches no matter's data, so it is the same read whichever is asking.
      await readCustomFieldCatalog(handle.database);
    },
  },
];

// Nothing here is table-wide by nature, so the allowlist is empty and kept as the explicit seam a
// future table-wide rollup would have to register through. The firm's field catalogue looked like the
// one candidate — the dictionary IS every active matter field, so the read has no narrowing predicate
// beyond the scope — but `target = 'matter'` is the leading column of custom_field_scope_index, so it
// walks the index too. Both ordered reads finish with a temporary B-tree, and both are deliberate: the
// catalogue's `position, name, id` order has no covering index (the set is bounded by the per-firm field
// cap, not by the firm's data), and the catalogue list's is only the LAST term of its order — the
// (status, name) index serves the page, and the `id` tiebreaker sorts within one shared name.
export const DOCUMENT_AUTOMATION_PLAN_SCAN_ALLOWLIST: readonly string[] = [];

function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

export function documentAutomationHotPathPlans(
  handle: DocumentAutomationMeasurementHandle,
): LabeledPlan[] {
  const { snapshot } = handle;
  const { documentAutomationProbes } = snapshot.manifest;
  const matterId = documentAutomationProbes.probeMatterId;
  // Every probe below runs the REAL statement its read composes — nothing here reproduces SQL, so a
  // query that changes shape changes its own plan probe with it.
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "templates.list-catalogue",
      statement: capturedStatement(
        listDocumentTemplatesStatement(handle.database, {
          status: "active",
          limit: CATALOGUE_PAGE_SIZE,
          afterName: documentAutomationProbes.catalogueCursorName,
          afterId: documentAutomationProbes.catalogueCursorId,
        }),
      ),
    },
    {
      label: "templates.version-for-assembly",
      statement: capturedStatement(
        readTemplateVersionForAssemblyStatement(
          handle.database,
          documentAutomationProbes.probeTemplateVersionId,
        ),
      ),
    },
    // The three reads the merge context actually issues, probed individually: the matter row, the whole
    // party collection in one read, and every bound custom-field handle in one statement.
    //
    // There is no fourth probe for the Directory role sources on purpose: `opposingParty.displayName`
    // and the rest are derived from the party rows THIS statement already returned, so a role costs a
    // pass over an array rather than a query. If a role ever grows a read of its own, this list is where
    // it has to appear — and the merge-context measurement above is where the cost would show.
    {
      label: "assembly.merge-context.matter",
      statement: capturedStatement(selectMatterForMergeStatement(handle.database, matterId)),
    },
    {
      label: "assembly.merge-context.parties",
      statement: capturedStatement(selectMatterPartiesForMergeStatement(handle.database, matterId)),
    },
    {
      label: "assembly.merge-context.custom-field-values",
      statement: capturedStatement(
        selectCustomFieldValuesStatement(handle.database, matterId, handle.probeCustomHandles),
      ),
    },
    {
      label: "templates.custom-field-catalog",
      statement: capturedStatement(selectCustomFieldCatalogStatement(handle.database)),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(snapshot.raw, statement.sql, statement.bindings),
  }));
}
