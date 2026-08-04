/*
 * THE COMPOSITION ROOT for the merge-field catalog.
 *
 * This module is the ONE place the app decides which provider it is talking to. Every surface takes
 * a `MergeFieldCatalogProvider` and holds only the interface, so switching from the in-repo mock to
 * the live endpoints is an edit to this file and nothing else.
 *
 * It answers from the mock catalog today. When the merge-field dictionary and template-fields
 * endpoints exist, replace the body of `mergeFieldCatalogProvider()` with a provider that calls
 * them — same signature, same return type, no consumer edit.
 */
import { createMockMergeFieldCatalogProvider } from "@magna-carta/merge-field-catalog-contract/mock-catalog-provider";
import type { MergeFieldCatalogProvider } from "@magna-carta/merge-field-catalog-contract/types";

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
