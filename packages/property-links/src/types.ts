// What the caller knows about a property. Field names match the codebase AddressInput
// (street/city/region/postal) so a Location maps in directly. `apn`/`jurisdictionId` are unused by
// Zillow/Redfin — reserved for the future county-assessor provider (wraps @magna-carta/parcels).
export interface PropertyReference {
  readonly street?: string;
  readonly city?: string;
  readonly region?: string;
  readonly postal?: string;
  readonly formattedAddress?: string;
  readonly apn?: string;
  readonly jurisdictionId?: string;
}

// One ready-to-use external link for a property.
export interface PropertyLink {
  readonly providerId: string;
  readonly label: string;
  readonly url: string;
}

// An external-link provider for one site. `build` returns null when it lacks the information it
// needs, so the registry can omit it.
export interface LinkProvider {
  readonly id: string;
  readonly label: string;
  build(reference: PropertyReference): string | null;
}
