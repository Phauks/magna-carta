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

// The kind of assessment jurisdiction. Today every entry is a county-equivalent, but town- and
// municipality-assessed states (all of New England) have no county assessor — this tag lets them
// join later without reshaping the model.
export type JurisdictionType = "county" | "municipality" | "district";

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

// One assessment jurisdiction's web presence, keyed by a stable `jurisdictionId`. Today every
// jurisdiction is a county-equivalent and the id is its 5-digit county FIPS code; the id is kept
// generic (and paired with `jurisdictionType`) so town/municipality-assessed states can join later
// under a place code without reshaping the model. `searchUrl` always works (the universal
// fallback); `deepLink` is the most specific link the jurisdiction offers.
export interface AssessorSite {
  readonly jurisdictionId: string;
  readonly jurisdictionType: JurisdictionType;
  readonly state: string;
  readonly name: string;
  readonly searchUrl: string;
  readonly deepLink: AssessorDeepLink;
}

// What the caller knows about the property. `year` is the tax year some platforms require in the
// URL path; the caller supplies the current tax year. With no APN — or no year where one is
// required — the resolver returns the search page rather than a broken link.
export interface AssessorLookup {
  readonly apn?: string;
  readonly year?: number;
}
