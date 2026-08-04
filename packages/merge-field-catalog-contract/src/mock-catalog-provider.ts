/*
 * THE SEAM. This mock is the stand-in implementation of MergeFieldCatalogProvider, answering from
 * the in-repo fixture catalog. It exists so the field-input user interface can be built, storied,
 * and tested end to end before the merge-field dictionary and template-fields endpoints exist.
 *
 * WHEN THE REAL API LANDS: write a provider that calls those endpoints, construct it instead of
 * this one at the composition root, and delete nothing else. No consuming component imports this
 * module — they take a MergeFieldCatalogProvider and hold the interface, never the implementation.
 * That is the whole reason the interface is a parameter rather than a module-level import.
 *
 * The mock is deliberately asynchronous and optionally latent: a surface built against an instant,
 * synchronous answer grows loading states that do not work. `latencyMilliseconds` lets a story or a
 * page exercise the loading path the network will really have.
 */
import {
  FIXTURE_MERGE_FIELD_CATALOG,
  FIXTURE_TEMPLATE_FIELD_MANIFESTS,
  FIXTURE_TEMPLATE_VERSIONS,
} from "./fixture-catalog.ts";
import type {
  MergeFieldCatalog,
  MergeFieldCatalogProvider,
  TemplateFieldManifest,
  TemplateVersionSummary,
} from "./types.ts";

export interface MockMergeFieldCatalogProviderOptions {
  /** Artificial delay before each answer, so loading states are exercised. Defaults to none. */
  readonly latencyMilliseconds?: number;
  /** Override the catalog — a test narrowing the entries, or a story showing an empty firm. */
  readonly catalog?: MergeFieldCatalog;
  /** Override the template manifests the provider can answer for. */
  readonly manifests?: readonly TemplateFieldManifest[];
  /** Override the template version list. Defaults to the summaries of `manifests`. */
  readonly templateVersions?: readonly TemplateVersionSummary[];
}

/** Thrown when a caller asks for a template version the provider does not hold. */
export class UnknownTemplateVersionError extends Error {
  constructor(readonly templateVersionId: string) {
    super(`No template version named ${templateVersionId}`);
    this.name = "UnknownTemplateVersionError";
  }
}

function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function createMockMergeFieldCatalogProvider(
  options: MockMergeFieldCatalogProviderOptions = {},
): MergeFieldCatalogProvider {
  const latencyMilliseconds = options.latencyMilliseconds ?? 0;
  const catalog = options.catalog ?? FIXTURE_MERGE_FIELD_CATALOG;
  const manifests = options.manifests ?? FIXTURE_TEMPLATE_FIELD_MANIFESTS;
  const templateVersions =
    options.templateVersions ??
    (options.manifests
      ? options.manifests.map((manifest) => ({
          templateVersionId: manifest.templateVersionId,
          templateName: manifest.templateName,
          description: "",
        }))
      : FIXTURE_TEMPLATE_VERSIONS);

  return {
    async listMergeFields(): Promise<MergeFieldCatalog> {
      await delay(latencyMilliseconds);
      return catalog;
    },

    async getTemplateFieldManifest(templateVersionId: string): Promise<TemplateFieldManifest> {
      await delay(latencyMilliseconds);
      const manifest = manifests.find(
        (candidate) => candidate.templateVersionId === templateVersionId,
      );
      if (!manifest) throw new UnknownTemplateVersionError(templateVersionId);
      return manifest;
    },

    async listTemplateVersions(): Promise<readonly TemplateVersionSummary[]> {
      await delay(latencyMilliseconds);
      return templateVersions;
    },
  };
}
