import type { HttpClient } from "@magna-carta/integrations/http";
import { z } from "zod";
import type { CatalogEntry } from "./catalog.ts";

// What the provider says it serves TODAY, set beside the curated catalog.
//
// The catalog (./catalog.ts) is the only roster a firm may choose from, because every entry on it carries
// a human's recorded finding that the model is zero-data-retention eligible and not trained on, and a
// live list carries no such finding. What a live list CAN answer is the question the catalog cannot ask
// of itself between verification passes: is each curated model still published, and has the provider
// released something the catalog has not caught up with? ./model-pin-freshness.ts names that second
// question as the gap it cannot close from in-repo data; this module closes it at request time, for an
// administrator to read, without letting it decide anything.
//
// So the reconciliation is strictly additive information. It never adds a model to the selectable
// roster, never removes one (a curated model the list omits is shown as "not in the provider's list",
// not hidden, because a transient listing gap must not strand a firm that pinned it), and never moves a
// tier. A model the provider publishes that is not curated is reported as awaiting verification, which
// is also the honest description of a model the provider designates retention-requiring: the curation
// pass is where that finding is made, not a string comparison here.
//
// Pure: the HTTP client, the credential and the clock are parameters. The composition root owns the
// secret, the cache and the logging.

// The provider's model-listing endpoint and the API version header it is read under.
export const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
export const ANTHROPIC_API_VERSION = "2026-10-21";

// A page is the provider's maximum; the cap on pages is a backstop against a paginator that never
// reports the end, not an expected bound (the provider publishes a few dozen models).
const PAGE_LIMIT = 1000;
const MAX_PAGES = 5;

export interface ProviderModel {
  // The provider's own id, without the gateway prefix the catalog's modelId carries.
  readonly id: string;
  readonly displayName: string;
  readonly createdAt: string | null;
}

export type ProviderRosterStatus = "live" | "not-configured" | "unreachable";

export interface ProviderRosterSnapshot {
  readonly status: ProviderRosterStatus;
  // When the provider was last asked. Null when it never was (no credential configured).
  readonly checkedAt: string | null;
  readonly models: readonly ProviderModel[];
}

export const providerRosterSnapshotSchema: z.ZodType<ProviderRosterSnapshot> = z.object({
  status: z.enum(["live", "not-configured", "unreachable"]),
  checkedAt: z.string().nullable(),
  models: z.array(
    z.object({ id: z.string(), displayName: z.string(), createdAt: z.string().nullable() }),
  ),
});

const modelPageSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      display_name: z.string().optional(),
      created_at: z.string().optional(),
    }),
  ),
  has_more: z.boolean().optional(),
  last_id: z.string().nullable().optional(),
});

export type ProviderListOutcome =
  | { readonly kind: "ok"; readonly models: readonly ProviderModel[] }
  | { readonly kind: "failed"; readonly reason: string };

// Read every page of the provider's model list. Never throws: a transport failure, a non-200 status or
// a body that does not parse is a `failed` outcome carrying a short, content-free reason (a status code
// or a parse verdict, never a response body), so the caller can log it and fall back.
export async function listAnthropicModels(input: {
  readonly http: HttpClient;
  readonly apiKey: string;
  readonly baseUrl?: string;
}): Promise<ProviderListOutcome> {
  const baseUrl = input.baseUrl ?? ANTHROPIC_MODELS_URL;
  const models: ProviderModel[] = [];
  let afterId: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (afterId !== null) query.set("after_id", afterId);
    let status: number;
    let body: unknown;
    try {
      const response = await input.http.request({
        method: "GET",
        url: `${baseUrl}?${query.toString()}`,
        headers: { "x-api-key": input.apiKey, "anthropic-version": ANTHROPIC_API_VERSION },
      });
      status = response.status;
      body = status === 200 ? await response.json() : undefined;
    } catch (caught) {
      return {
        kind: "failed",
        reason: `transport: ${caught instanceof Error ? caught.name : "unknown"}`,
      };
    }
    if (status !== 200) return { kind: "failed", reason: `status ${String(status)}` };
    const parsed = modelPageSchema.safeParse(body);
    if (!parsed.success) return { kind: "failed", reason: "unexpected response shape" };
    for (const model of parsed.data.data) {
      models.push({
        id: model.id,
        displayName: model.display_name ?? model.id,
        createdAt: model.created_at ?? null,
      });
    }
    const lastId = parsed.data.last_id ?? parsed.data.data.at(-1)?.id ?? null;
    if (parsed.data.has_more !== true || lastId === null) return { kind: "ok", models };
    afterId = lastId;
  }
  return { kind: "ok", models };
}

export interface ProviderRosterReconciliation {
  // Per curated entry (by catalog modelId): true when the provider lists it, false when a live list
  // omits it, null when there is no live list to ask.
  readonly published: ReadonlyMap<string, boolean | null>;
  // Models the provider publishes that the catalog does not carry, newest first. These are shown, never
  // offered: none has a recorded retention finding.
  readonly awaitingVerification: readonly ProviderModel[];
}

// Set a snapshot beside the curated entries. Only Anthropic entries are compared — the catalog's
// referenceId is the provider's bare id for those, and a first-party Workers AI entry has no counterpart
// in this provider's list to be absent from.
export function reconcileProviderRoster(
  entries: readonly CatalogEntry[],
  snapshot: ProviderRosterSnapshot,
): ProviderRosterReconciliation {
  const anthropicEntries = entries.filter((entry) => entry.modelId.startsWith("anthropic/"));
  const live = snapshot.status === "live";
  const providerIds = new Set(snapshot.models.map((model) => model.id));
  const published = new Map<string, boolean | null>(
    anthropicEntries.map((entry) => [
      entry.modelId,
      live ? providerIds.has(entry.referenceId) : null,
    ]),
  );
  const curatedIds = new Set(anthropicEntries.map((entry) => entry.referenceId));
  const awaitingVerification = live
    ? snapshot.models
        .filter((model) => !curatedIds.has(model.id))
        .toSorted((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))
    : [];
  return { published, awaitingVerification };
}
