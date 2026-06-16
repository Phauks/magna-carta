import { countyAssessorProvider } from "./providers/county-assessor.ts";
import { googleMapsProvider } from "./providers/google-maps.ts";
import { realtorProvider } from "./providers/realtor.ts";
import { redfinProvider } from "./providers/redfin.ts";
import { zillowProvider } from "./providers/zillow.ts";
import type { LinkProvider, PropertyLink, PropertyReference } from "./types.ts";

// Every external-link provider composes into one ordered registry. Adding a provider (Trulia, a
// FEMA flood-map link) is one import + one row here — nothing else changes. The commercial sites come
// first (address-keyed); the county-assessor link (jurisdiction-keyed, wrapping @magna-carta/parcels)
// rounds out the list — present only when the caller has resolved a covered county.
const PROVIDERS: readonly LinkProvider[] = [
  zillowProvider,
  redfinProvider,
  googleMapsProvider,
  realtorProvider,
  countyAssessorProvider,
];

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
