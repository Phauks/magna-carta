// The upstream providers this platform depends on. "statuspage" providers publish an Atlassian
// Statuspage summary.json we poll and normalize; "manual" providers have no consumable feed and
// are omitted until an operator-set path exists (a v1 boundary — see pollProviders).
export interface ProviderDefinition {
  id: string;
  name: string;
  kind: "statuspage" | "manual";
  /** The machine feed polled on the cron — an Atlassian Statuspage `summary.json`. */
  feedUrl?: string;
  /**
   * The human status page a reader is sent to. Held separately from `feedUrl` because the two can
   * legitimately differ: a provider may serve its API from the long-lived host while publishing the
   * page readers should actually visit somewhere else. When absent, the feed's origin stands in.
   */
  statusPageUrl?: string;
  /**
   * The names of the provider's TOP-LEVEL Statuspage component groups whose health this platform
   * actually depends on. When set, the provider's severity is computed from those groups (plus any
   * unresolved incident touching them) instead of the whole-page `status.indicator`.
   *
   * This exists because a page-wide indicator can be permanently pessimistic. Cloudflare's page
   * carries ~470 components, and the great majority are individual edge locations; a handful of
   * points of presence is re-routed at any given moment, which drags the page indicator to "minor"
   * while every service is healthy and Cloudflare's own page headline reads "All systems
   * operational". Scoping to the service group is what makes our row agree with theirs.
   *
   * A scope that matches nothing falls back to the page indicator rather than reporting health:
   * a renamed group must degrade to the pessimistic answer, never to a green one.
   */
  serviceComponentGroups?: readonly string[];
}

export const PROVIDER_REGISTRY: readonly ProviderDefinition[] = [
  {
    id: "cloudflare",
    name: "Cloudflare",
    kind: "statuspage",
    // The API is served identically from both www.cloudflarestatus.com and
    // new.cloudflarestatus.com (same Statuspage page id, byte-equivalent payloads). We poll the
    // long-standing host and send readers to the new page, which is the one Cloudflare now points
    // at. When the new page takes over the www hostname, statusPageUrl can simply be dropped.
    feedUrl: "https://www.cloudflarestatus.com/api/v2/summary.json",
    statusPageUrl: "https://new.cloudflarestatus.com/",
    // Everything this platform runs on — Workers, D1, R2, Queues, Durable Objects, Vectorize,
    // Workers KV, Containers — is a child of this one group. The sibling groups are the continental
    // buckets of edge locations, which is exactly the noise the scope exists to exclude.
    serviceComponentGroups: ["Cloudflare Sites and Services"],
  },
  {
    id: "github",
    name: "GitHub",
    kind: "statuspage",
    // A dozen service components and no location components, so the page indicator is already the
    // service verdict and needs no scoping.
    feedUrl: "https://www.githubstatus.com/api/v2/summary.json",
  },
  // No consumable public feed today; carried as a placeholder, not emitted until an operator-set
  // provider-status path is built.
  { id: "helcim", name: "Helcim (payments)", kind: "manual" },
  { id: "pangram", name: "Pangram (AI-text detection)", kind: "manual" },
];
