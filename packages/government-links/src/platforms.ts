import type { AssessorPlatform, ParcelKeyFormat } from "./types.ts";

// Builds the parcel URL for one assessor platform from the jurisdiction's host, any extra
// per-jurisdiction params, and an already-normalized parcel key (the resolver normalizes before
// calling). `requiresYear` marks platforms that put the tax year in the path; `defaultKeyFormat`
// is the platform's usual key normalization, overridable per jurisdiction.
export interface AssessorPlatformAdapter {
  readonly requiresYear: boolean;
  readonly defaultKeyFormat: ParcelKeyFormat;
  build(input: {
    host: string;
    params?: Readonly<Record<string, string>>;
    key: string;
    year?: number;
  }): string;
}

// The shared platform adapters. Each is written once and reused by every jurisdiction on that
// platform nationwide — the unit that turns national coverage into a data problem (one host, plus
// any params, per jurisdiction) rather than a code problem. Add a platform here, then point
// jurisdictions at it from the registry.
export const ASSESSOR_PLATFORMS: Record<AssessorPlatform, AssessorPlatformAdapter> = {
  // DevNet Wedge (now Catalis): /parcel/view/{key}/{year}.
  devnetWedge: {
    requiresYear: true,
    defaultKeyFormat: "stripSeparators",
    build: ({ host, key, year }) => `https://${host}/parcel/view/${key}/${year}`,
  },
  // GSA Corp / GovStack: /parcel/{key}, no year segment.
  gsaCorp: {
    requiresYear: false,
    defaultKeyFormat: "stripSeparators",
    build: ({ host, key }) => `https://${host}/parcel/${key}`,
  },
  // Schneider Geospatial Beacon / qPublic: an Application.aspx report keyed by per-county
  // AppID/LayerID/PageTypeID (PageTypeID 4 is the parcel report) with the key as KeyValue. Used by
  // a large share of US counties, so the per-county ids live in the site's `params`.
  beaconQpublic: {
    requiresYear: false,
    defaultKeyFormat: "stripSeparators",
    build: ({ host, params, key }) =>
      `https://${host}/Application.aspx?AppID=${params?.appId ?? ""}&LayerID=${
        params?.layerId ?? ""
      }&PageTypeID=${params?.pageTypeId ?? "4"}&KeyValue=${key}`,
  },
  // TerraScan TaxSifter (hosted on publicaccessnow.com or self-hosted): a search-results page that
  // lands on the parcel when given the parcel number as `q`. Self-hosted instances sit under a base
  // path (e.g. /taxsifter), supplied via params.basePath. A one-time per-session disclaimer redirect
  // carries `q` through to the result.
  terraScanTaxSifter: {
    requiresYear: false,
    defaultKeyFormat: "stripSeparators",
    build: ({ host, params, key }) =>
      `https://${host}${params?.basePath ?? ""}/Search/Results.aspx?q=${key}`,
  },
  // Megabyte MBAP (California assessor module on *.mptsweb.com): /mbap/{slug}/asr/AsrMain/{key},
  // with the host (common1/2/3) and the county slug per jurisdiction. The public APN goes straight
  // into the path with separators stripped (a dashed APN 404s).
  megabyteMbap: {
    requiresYear: false,
    defaultKeyFormat: "stripSeparators",
    build: ({ host, params, key }) =>
      `https://${host}/mbap/${params?.slug ?? ""}/asr/AsrMain/${key}`,
  },
};
