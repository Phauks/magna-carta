// The upstream providers this platform depends on. "statuspage" providers publish an Atlassian
// Statuspage summary.json we poll and normalize; "manual" providers have no consumable feed and
// are omitted until an operator-set path exists (a v1 boundary — see pollProviders).
export interface ProviderDefinition {
  id: string;
  name: string;
  kind: "statuspage" | "manual";
  url?: string;
}

export const PROVIDER_REGISTRY: readonly ProviderDefinition[] = [
  {
    id: "cloudflare",
    name: "Cloudflare",
    kind: "statuspage",
    url: "https://www.cloudflarestatus.com/api/v2/summary.json",
  },
  {
    id: "github",
    name: "GitHub",
    kind: "statuspage",
    url: "https://www.githubstatus.com/api/v2/summary.json",
  },
  // No consumable public feed today; carried as a placeholder, not emitted until an operator-set
  // provider-status path is built.
  { id: "helcim", name: "Helcim (payments)", kind: "manual" },
  { id: "pangram", name: "Pangram (AI-text detection)", kind: "manual" },
];
