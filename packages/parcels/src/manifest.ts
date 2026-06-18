import type { IntegrationManifest } from "@magna-carta/integrations/manifest";

// Credential-less county-assessor deep-link resolver: always available, no account. Catalog-only —
// no routes, no adapter registration; surfaced inside features, toggleable per firm by the marketplace.
export const parcelsManifest: IntegrationManifest = {
  id: "parcels",
  category: "parcels",
  displayName: "County parcel lookup",
  summary: "Deep-links to the official county assessor record for a parcel/APN.",
  credential: { kind: "none" },
  capability: {
    adapterId: "parcels",
    category: "parcels",
    credential: { kind: "none" },
    operations: { assessorLink: { supported: true } },
    passthroughAvailable: false,
  },
  permission: null,
  defaultEnablement: "on",
};
