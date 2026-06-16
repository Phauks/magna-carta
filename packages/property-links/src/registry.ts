import { redfinProvider } from "./providers/redfin.ts";
import { zillowProvider } from "./providers/zillow.ts";
import type { LinkProvider, PropertyLink, PropertyReference } from "./types.ts";

// Every external-link provider composes into one ordered registry. Adding a provider (Google Maps,
// Realtor.com, a county-assessor link wrapping @magna-carta/parcels) is one import + one row here —
// nothing else changes.
const PROVIDERS: readonly LinkProvider[] = [zillowProvider, redfinProvider];

// The external lookups usable for what the caller knows about a property. Providers lacking the
// information they need are omitted. Total: never throws, never yields an empty or broken URL — a
// consumer can always render whatever comes back.
export function resolvePropertyLinks(reference: PropertyReference): PropertyLink[] {
  const links: PropertyLink[] = [];
  for (const provider of PROVIDERS) {
    const url = provider.build(reference);
    if (url !== null) {
      links.push({ providerId: provider.id, label: provider.label, url });
    }
  }
  return links;
}
