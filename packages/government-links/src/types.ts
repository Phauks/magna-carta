// A US assessor platform — the vendor software a jurisdiction's online property search runs on.
// Most jurisdictions run one of a small number of these, so a single adapter (see platforms.ts)
// serves every jurisdiction on the same platform nationwide. Extend this union as new platforms
// are encountered; a one-off site uses a `template` deep-link instead.
export type AssessorPlatform =
  | "devnetWedge"
  | "gsaCorp"
  | "beaconQpublic"
  | "terraScanTaxSifter"
  | "megabyteMbap";

// How an assessor site expects the parcel key (APN/TMK) formatted in its URL. Jurisdictions vary:
// most want separators stripped to the bare identifier; some (e.g. Tyler iasWorld) match on the
// dashed form exactly as displayed; Hawaii's qPublic wants the TMK reduced to its 12-digit KeyValue.
export type ParcelKeyFormat = "stripSeparators" | "keepSeparators" | "hawaiiTmk";

// The kind of jurisdiction a portal belongs to. Property records are county-equivalent (or, in the
// town-assessed New England states, a municipality/MCD); a Secretary-of-State business register is a
// state office, so `state` keys its portals by the 2-digit state FIPS.
export type JurisdictionType = "county" | "municipality" | "district" | "state";

// The category of public-record link, which also fixes the granularity of its jurisdiction key:
// `property` is keyed by county (5-digit FIPS) or county-subdivision (10-digit GEOID); `business` and
// `licensing` by state (2-digit FIPS). One engine serves all — the same jurisdiction-keyed registry,
// platform adapters, and URL builder.
export type LinkCategory = "property" | "business" | "licensing";

// The specific government portal within a category. A jurisdiction can carry several: a county has an
// assessor and (later) a recorder and GIS; a state has a business-entity register, a UCC index, and an
// attorney-licensing directory. The registry keys on `system` + `jurisdictionId`, so these never
// collide.
export type PortalSystem =
  | "assessor"
  | "recorder"
  | "gis"
  | "businessEntity"
  | "ucc"
  | "attorneyLicense";

// How to build a direct link to a parcel on an assessor site:
//  - `platform`: the jurisdiction runs a known platform — name it plus the host (and any
//    per-jurisdiction `params`, e.g. Beacon/qPublic's AppID/LayerID), and the shared adapter
//    builds the URL, so adding such a jurisdiction is one registry row, no new code.
//  - `template`: a bespoke site; an explicit URL template carrying an `{apn}` placeholder.
//  - `searchPage`: no parameterized entry point exists, so the resolver opens the search page.
// `keyFormat` overrides the default parcel-key normalization where a jurisdiction differs.
export type AssessorDeepLink =
  | {
      readonly kind: "platform";
      readonly platform: AssessorPlatform;
      readonly host: string;
      readonly params?: Readonly<Record<string, string>>;
      readonly keyFormat?: ParcelKeyFormat;
    }
  | { readonly kind: "template"; readonly template: string; readonly keyFormat?: ParcelKeyFormat }
  | { readonly kind: "searchPage" };

// Generic spellings of the deep-link vocabulary, for portals beyond the assessor (recorder, GIS,
// Secretary-of-State, UCC). The shapes are identical — the engine is category-agnostic; only the
// property domain keeps the `Assessor`/`Parcel` names.
export type PortalDeepLink = AssessorDeepLink;
export type PortalPlatform = AssessorPlatform;
export type KeyFormat = ParcelKeyFormat;

// One government portal for a jurisdiction, keyed by a stable `jurisdictionId` together with its
// `system` (a county can carry both an assessor and a recorder; a state both a business register and
// a UCC index). The id granularity follows `category`: a 5-digit county FIPS or 10-digit
// county-subdivision GEOID for property, a 2-digit state FIPS for business. `searchUrl` always works
// (the universal fallback); `deepLink` is the most specific link the portal offers.
export interface PortalSite {
  readonly jurisdictionId: string;
  readonly jurisdictionType: JurisdictionType;
  readonly category: LinkCategory;
  readonly system: PortalSystem;
  readonly state: string;
  readonly name: string;
  readonly searchUrl: string;
  readonly deepLink: PortalDeepLink;
}

// What the caller knows. `key` is the public identifier to deep-link by — an APN/TMK for a property
// assessor, an entity or file number for a business register. `year` is the tax year some property
// platforms require in the URL path. With no key — or no year where one is required — the resolver
// returns the search page rather than a broken link.
export interface PortalLookup {
  readonly key?: string;
  readonly year?: number;
}

// Property-domain spellings. `AssessorSite` is a `PortalSite` (every property row is one); the
// assessor resolver takes an `apn` rather than the generic `key`. These keep the property surface
// reading in its own vocabulary while the engine underneath is category-agnostic.
export type AssessorSite = PortalSite;

export interface AssessorLookup {
  readonly apn?: string;
  readonly year?: number;
}
