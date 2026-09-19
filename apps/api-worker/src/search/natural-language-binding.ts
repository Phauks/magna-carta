import {
  naturalLanguageInstanceCreated,
  naturalLanguageInstanceTornDown,
  naturalLanguageKeptAlive,
  naturalLanguageProvisioningAdapterError,
  naturalLanguageSyncStatusRead,
  notConfiguredNaturalLanguageProvisioningPort,
  type NaturalLanguageInstanceCreateResult,
  type NaturalLanguageInstanceTeardownResult,
  type NaturalLanguageKeepAliveResult,
  type NaturalLanguageProvisioningPort,
  type NaturalLanguageSyncStatusResult,
} from "@magna-carta/search/natural-language-provisioning";
import {
  naturalLanguageInstanceNotProvisioned,
  notProvisionedNaturalLanguageSearchPort,
  type NaturalLanguageSearchPort,
} from "@magna-carta/search/natural-language-port";
import { NATURAL_LANGUAGE_KEEP_ALIVE_QUERY } from "@magna-carta/search/natural-language-instance";
import type { Bindings } from "../bindings.ts";

// Where this deployment's natural-language search bindings resolve — and, when they are absent,
// where the honest "there is nothing here" answer comes from.
//
// TWO BINDINGS, TWO PORTS, and they are separate because they have different lifetimes. The
// management binding creates and destroys instances from queue-dispatched work; the query binding
// resolves an instance handle and makes one call from a request. Neither resolver throws when its
// binding is missing: a deployment carrying neither serves every other surface normally and reports
// this one unavailable.
//
// THE MISSING-BINDING ANSWER IS A TYPED OUTCOME, NOT AN EMPTY SUCCESS. An adapter that resolved
// cleanly and returned no results would be indistinguishable from a corpus in which nothing matched,
// which is the failure where a lawyer finds nothing and concludes there is nothing. So an
// unconfigured deployment gives exactly the answer a firm mid-provisioning gets: the instance is not
// there.

// The management binding's shape, as this Worker uses it. Declared here rather than imported from a
// vendor type because these three operations are the entire surface this platform touches — there is
// no list operation and there must not be one (the control-plane row is the catalog), and there is
// no operation that configures a text-generation model or enables a public endpoint.
export interface NaturalLanguageNamespaceBinding {
  create(input: Record<string, unknown>): Promise<{ id?: string; name?: string }>;
  delete(name: string): Promise<unknown>;
  get(name: string): NaturalLanguageInstanceBinding;
}

// One instance's own binding. `search()` only — retrieval, never generation.
export interface NaturalLanguageInstanceBinding {
  search(input: Record<string, unknown>): Promise<unknown>;
  syncStatus?(): Promise<{ lastCompletedAt?: string | null }>;
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : "managed search service error";
}

// The adapter over the management binding. Every operation catches and maps to a typed failure, the
// discipline every other port in this codebase shares: a caller pattern-matches rather than catches,
// and a transport fault becomes a recordable outcome rather than an escaped exception in a queue
// consumer.
function namespaceBindingPort(
  namespaces: NaturalLanguageNamespaceBinding,
): NaturalLanguageProvisioningPort {
  return {
    async createInstance(input): Promise<NaturalLanguageInstanceCreateResult> {
      try {
        const configuration = input.configuration;
        const created = await namespaces.create({
          name: input.instanceName,
          source: { type: "r2", bucket: input.bucketName, prefix: input.keyPrefix },
          embedding_model: configuration.embeddingModelId,
          indexing_mode: configuration.indexingMode,
          sync_interval_minutes: configuration.syncIntervalMinutes,
          metadata_fields: [...configuration.metadataFields],
          query_rewriting: configuration.queryRewriting,
          reranking: configuration.reranking,
          reranking_model: configuration.rerankingModelId,
          // Absent rather than false: there is no generation model, no public endpoint, and no
          // similarity cache on any instance this platform creates. Spelling the negatives out is
          // what makes a later diff that adds one visible.
          similarity_cache: configuration.similarityCache,
          public_endpoints: configuration.publicEndpoints,
        });
        const identifier = created.id ?? created.name;
        if (identifier === undefined || identifier === "") {
          return naturalLanguageProvisioningAdapterError(
            "managed search service returned no instance identifier",
          );
        }
        return naturalLanguageInstanceCreated({
          instanceIdentifier: identifier,
          instanceName: input.instanceName,
        });
      } catch (error) {
        return naturalLanguageProvisioningAdapterError(describeFailure(error));
      }
    },
    async destroyInstance(instanceName): Promise<NaturalLanguageInstanceTeardownResult> {
      try {
        const response = await namespaces.delete(instanceName);
        // Recorded verbatim, and nothing is concluded from it. `acknowledged` means the service
        // accepted the request; what the service then does to the vectors, the keyword index, and
        // the converted text is not something this platform can observe or promise.
        return naturalLanguageInstanceTornDown({
          acknowledged: true,
          response: JSON.stringify(response ?? null),
        });
      } catch (error) {
        return naturalLanguageProvisioningAdapterError(describeFailure(error));
      }
    },
    async syncStatus(instanceName): Promise<NaturalLanguageSyncStatusResult> {
      try {
        const instance = namespaces.get(instanceName);
        const status = await instance.syncStatus?.();
        return naturalLanguageSyncStatusRead({ lastCompletedAt: status?.lastCompletedAt ?? null });
      } catch (error) {
        return naturalLanguageProvisioningAdapterError(describeFailure(error));
      }
    },
    async keepAlive(instanceName): Promise<NaturalLanguageKeepAliveResult> {
      try {
        const instance = namespaces.get(instanceName);
        // A full-text query with a constant, content-free phrase. Its only purpose is to be a
        // request, so the instance's scheduled syncs are not paused for inactivity — a firm that
        // searches rarely would otherwise meet a month-stale index with no warning.
        await instance.search({ query: NATURAL_LANGUAGE_KEEP_ALIVE_QUERY, max_num_results: 1 });
        return naturalLanguageKeptAlive();
      } catch (error) {
        return naturalLanguageProvisioningAdapterError(describeFailure(error));
      }
    },
  };
}

// Resolve the management port: the binding when this deployment carries one, else the
// not-configured port whose every operation reports `binding-not-configured`.
export function resolveNaturalLanguageProvisioningPort(
  env: Bindings,
): NaturalLanguageProvisioningPort {
  return env.AI_SEARCH_NAMESPACES === undefined
    ? notConfiguredNaturalLanguageProvisioningPort
    : namespaceBindingPort(env.AI_SEARCH_NAMESPACES);
}

// The port a deployment that HAS the query binding resolves to while the retrieval adapter is
// unwritten. Same outcome, different detail, and the difference matters to whoever is reading a log
// asking why the feature is unavailable: "no binding" is a deployment to configure, and this one is
// a build that has not happened yet.
//
// The adapter is deliberately unwritten until the managed index's metadata-filter semantics have
// been verified against the live service — a filter that silently fails open, or that is accepted
// and ignored, cannot bear even the recall-optimization weight this design puts on it, and a
// client's confidences do not go behind a guess about what a filter does. The construction protocol
// and its sensitivity proof are already runnable in
// packages/search/test/natural-language-filter-wall/; what is missing is the run against a real
// instance.
const adapterNotBuiltNaturalLanguageSearchPort: NaturalLanguageSearchPort = {
  naturalLanguageSearch: () =>
    Promise.resolve(
      naturalLanguageInstanceNotProvisioned(
        "managed search retrieval is not reachable in this build",
      ),
    ),
};

// Resolve the QUERY port. An ABSENT binding resolves to the default port, whose every call reports
// `instance-not-provisioned` — so a misconfigured environment produces an obviously-unavailable
// feature and never a silent empty result. This is the branch production takes today, on the
// ordinary path, and nothing injects around it.
export function resolveNaturalLanguageSearchPort(env: Bindings): NaturalLanguageSearchPort {
  return env.AI_SEARCH === undefined
    ? notProvisionedNaturalLanguageSearchPort
    : adapterNotBuiltNaturalLanguageSearchPort;
}
