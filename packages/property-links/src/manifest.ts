import type { IntegrationManifest } from "@magna-carta/integrations/manifest";

// Credential-less property-link resolver: always available, no account. Catalog-only —
// no routes, no adapter registration; surfaced inside features, toggleable per firm by the marketplace.
export const propertyLinksManifest: IntegrationManifest = {
  id: "property-links",
  category: "property-links",
  displayName: "Property links",
  summary: "One-click links to view a property on Zillow, Redfin, Google Maps, and Realtor.com.",
  credential: { kind: "none" },
  capability: {
    adapterId: "property-links",
    category: "property-links",
    credential: { kind: "none" },
    operations: { resolveLinks: { supported: true } },
    passthroughAvailable: false,
  },
  permission: null,
  defaultEnablement: "on",
};
