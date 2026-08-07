import type { CustomFieldDefinitionRow } from "../custom-field-bindings.ts";

// The version of the platform catalogue an assembly ran against, recorded on every provenance row.
//
// It is what makes a document assembled in March and one assembled in September explainably different
// rather than mysteriously so, and it moves whenever the SHIPPED LIST OR THE GENERATION THAT PRODUCES
// IT moves — a facet added, a subject added, a value type widened. It does not move for a firm's own
// fields, which are per firm and carried by the digest below instead.
export const DICTIONARY_VERSION = 3;

// The revision a caching client compares.
//
// The catalogue is tens of kilobytes of labels, descriptions, synonyms, and example renderings, and it
// is THE SAME BYTES for every member of a firm until that firm's own field definitions change. So the
// revision is the platform version plus a digest of exactly the definition facts the entries are derived
// from — a handle, a kind, a name, a scale, and whether it is archived. Nothing about any matter's data
// is in it, which is what keeps a catalogue response cacheable in a browser.
//
// The digest is a plain 32-bit FNV-1a rather than a cryptographic hash: it is a cache-validity token, not
// a security boundary, and it has to be computable synchronously on the response path. A collision costs
// one stale catalogue until the next definition change, which is the same cost as no revision at all.
export function mergeFieldCatalogRevision(
  customFields: readonly CustomFieldDefinitionRow[],
): string {
  // Sorted by handle so two reads that returned the same definitions in a different order produce the
  // same revision — otherwise every reorder of the firm's field list would invalidate every cache.
  const definitions = [...customFields]
    .sort((left, right) => (left.handle < right.handle ? -1 : left.handle > right.handle ? 1 : 0))
    .map(
      (row) =>
        `${row.handle}:${row.kind}:${row.numberScale ?? ""}:${row.archived ? 1 : 0}:${row.name}`,
    )
    .join("\n");
  return `${DICTIONARY_VERSION}-${fnv1a32(definitions)}`;
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a32(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // `Math.imul` keeps the multiply in 32-bit space; `*` would go through a double and lose the low
    // bits the hash depends on once the value exceeds the safe integer range.
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
