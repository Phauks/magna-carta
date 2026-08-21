/*
 * THE COMPOSITION ROOT for the merge-field catalog.
 *
 * This module is the ONE place the app decides which provider it is talking to. Every surface takes
 * a `MergeFieldCatalogProvider` and holds only the interface, so switching from the in-repo mock to
 * the live endpoints is an edit to this file and nothing else.
 *
 * The live half is `mergeFieldCatalogFromResponse` below: the projection from what
 * `GET /api/v1/merge-fields` returns to what the surfaces consume. It is a pure function taking the
 * payload rather than a provider that fetches, because the app has no HTTP client wired yet — and the
 * mapping is the part with rules in it, so it is the part worth having under test now. When the app
 * gains a typed client, `mergeFieldCatalogProvider()` composes that client with this function and no
 * consumer changes.
 */
import { createMockMergeFieldCatalogProvider } from "@magna-carta/merge-field-catalog-contract/mock-catalog-provider";
import type {
  MergeFieldAvailability,
  MergeFieldCatalog,
  MergeFieldEntry,
  MergeFieldProminence,
  MergeFieldSensitivity,
  MergeFieldStatus,
  MergeFieldValueType,
  MergeFieldCatalogProvider,
} from "@magna-carta/merge-field-catalog-contract/types";
import { MERGE_FIELD_VALUE_TYPE_LABELS } from "@magna-carta/merge-field-catalog-contract/types";

// A small delay so the loading path the network will really have is exercised in development
// rather than discovered when the live provider lands.
const MOCK_LATENCY_MILLISECONDS = 120;

let provider: MergeFieldCatalogProvider | null = null;

export function mergeFieldCatalogProvider(): MergeFieldCatalogProvider {
  provider ??= createMockMergeFieldCatalogProvider({
    latencyMilliseconds: MOCK_LATENCY_MILLISECONDS,
  });
  return provider;
}

/** Whether the surfaces are reading invented fixture data rather than the firm's own catalog. */
export const MERGE_FIELD_CATALOG_IS_FIXTURE = true;

/** One entry as `GET /api/v1/merge-fields` returns it — every field a string or a plain collection. */
export interface MergeFieldsResponseEntry {
  readonly key: string;
  readonly label: string;
  readonly group: string;
  readonly subject: string;
  readonly subjectLabel: string;
  readonly prominence: string;
  readonly valueType: string;
  readonly defaultFormat: string;
  readonly formats: readonly string[];
  readonly description: string;
  readonly synonyms: readonly string[];
  readonly exampleRenderings: Readonly<Record<string, string>>;
  readonly availability: string;
  readonly availabilityNote: string;
  readonly sensitivity: string;
  readonly absence: string;
  readonly status: string;
  readonly supersededBy: string | null;
}

export interface MergeFieldsResponse {
  readonly revision: string;
  readonly fields: readonly MergeFieldsResponseEntry[];
}

// The response's unions arrive as plain strings, because a server that gained a value the client has
// not been rebuilt for must not make the whole catalog unreadable. Each one is narrowed against what
// this build knows, with a SAFE fallback rather than a throw: an unrecognized value type still renders
// as text, an unrecognized availability still asks a person to fill it in. A field nobody can read is
// worse than a field read conservatively — the alternative to seeing it here is retyping it by hand.
function valueTypeOf(value: string): MergeFieldValueType {
  return value in MERGE_FIELD_VALUE_TYPE_LABELS ? (value as MergeFieldValueType) : "text";
}

function availabilityOf(value: string): MergeFieldAvailability {
  return value === "automatic" || value === "conditional" || value === "unavailable"
    ? value
    : "manual";
}

function prominenceOf(value: string): MergeFieldProminence {
  return value === "secondary" ? "secondary" : "primary";
}

function sensitivityOf(value: string): MergeFieldSensitivity {
  return value === "protected" ? "protected" : "ordinary";
}

function statusOf(value: string): MergeFieldStatus {
  return value === "deprecated" ? "deprecated" : "current";
}

function entryOf(entry: MergeFieldsResponseEntry): MergeFieldEntry {
  return {
    key: entry.key,
    label: entry.label,
    group: entry.group,
    subject: entry.subject,
    subjectLabel: entry.subjectLabel,
    prominence: prominenceOf(entry.prominence),
    valueType: valueTypeOf(entry.valueType),
    description: entry.description,
    // The sample shown beside a field with no format chosen is the one for its DEFAULT rendering — the
    // rendering a placeholder that names no format actually produces. Falling back to the first
    // rendering, or to the empty string, would show a person a sample of something else.
    exampleRendering: entry.exampleRenderings[entry.defaultFormat] ?? "",
    exampleRenderings: { ...entry.exampleRenderings },
    synonyms: [...entry.synonyms],
    availability: availabilityOf(entry.availability),
    availabilityNote: entry.availabilityNote,
    sensitivity: sensitivityOf(entry.sensitivity),
    formats: [...entry.formats],
    status: statusOf(entry.status),
    supersededBy: entry.supersededBy,
  };
}

/** The catalog as the surfaces consume it, from the endpoint's payload. */
export function mergeFieldCatalogFromResponse(response: MergeFieldsResponse): MergeFieldCatalog {
  return { revision: response.revision, entries: response.fields.map(entryOf) };
}
