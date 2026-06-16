import { describe, expect, it } from "vitest";
import { assessorUrl } from "../src/resolve.ts";
import type { AssessorSite } from "../src/types.ts";

const gsaSite: AssessorSite = {
  jurisdictionId: "32005",
  jurisdictionType: "county",
  state: "NV",
  name: "Douglas",
  searchUrl: "https://douglasnv-search.gsacorp.io/",
  deepLink: { kind: "platform", platform: "gsaCorp", host: "douglasnv-search.gsacorp.io" },
};

const devnetSite: AssessorSite = {
  jurisdictionId: "32023",
  jurisdictionType: "county",
  state: "NV",
  name: "Nye",
  searchUrl: "https://nyenv-assessor.devnetwedge.com/",
  deepLink: { kind: "platform", platform: "devnetWedge", host: "nyenv-assessor.devnetwedge.com" },
};

const beaconSite: AssessorSite = {
  jurisdictionId: "15003",
  jurisdictionType: "county",
  state: "HI",
  name: "Honolulu",
  searchUrl:
    "https://qpublic.schneidercorp.com/Application.aspx?App=HonoluluCountyHI&PageType=Search",
  deepLink: {
    kind: "platform",
    platform: "beaconQpublic",
    host: "qpublic.schneidercorp.com",
    params: { appId: "1045", layerId: "23342", pageTypeId: "4" },
  },
};

const templateSite: AssessorSite = {
  jurisdictionId: "32003",
  jurisdictionType: "county",
  state: "NV",
  name: "Clark",
  searchUrl: "https://www.clarkcountynv.gov/government/assessor/property_search/",
  deepLink: {
    kind: "template",
    template:
      "https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/ParcelDetail.aspx?hdnParcel={apn}",
  },
};

const keepSeparatorsSite: AssessorSite = {
  jurisdictionId: "10005",
  jurisdictionType: "county",
  state: "DE",
  name: "Sussex",
  searchUrl: "https://property.sussexcountyde.gov/PT/search/commonsearch.aspx?mode=parid",
  deepLink: {
    kind: "template",
    template:
      "https://property.sussexcountyde.gov/PT/search/commonsearch.aspx?mode=parid&parid={apn}",
    keyFormat: "keepSeparators",
  },
};

describe("assessorUrl", () => {
  it("builds a platform deep-link, normalizing the APN", () => {
    expect(assessorUrl(gsaSite, { apn: "1320-12" })).toBe(
      "https://douglasnv-search.gsacorp.io/parcel/132012",
    );
  });

  it("supplies the tax year to a platform that requires it", () => {
    expect(assessorUrl(devnetSite, { apn: "00123456", year: 2026 })).toBe(
      "https://nyenv-assessor.devnetwedge.com/parcel/view/00123456/2026",
    );
  });

  it("falls back to the search page when a year-requiring platform has no year", () => {
    expect(assessorUrl(devnetSite, { apn: "00123456" })).toBe(
      "https://nyenv-assessor.devnetwedge.com/",
    );
  });

  it("builds a Beacon/qPublic deep-link from per-county params", () => {
    expect(assessorUrl(beaconSite, { apn: "9-4-044-078" })).toBe(
      "https://qpublic.schneidercorp.com/Application.aspx?AppID=1045&LayerID=23342&PageTypeID=4&KeyValue=94044078",
    );
  });

  it("fills a custom template, normalizing the APN to its dashless form", () => {
    expect(assessorUrl(templateSite, { apn: "162-35-113-001" })).toBe(
      "https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/ParcelDetail.aspx?hdnParcel=16235113001",
    );
  });

  it("keeps separators when the site's keyFormat says so", () => {
    expect(assessorUrl(keepSeparatorsSite, { apn: "234-100.00-01" })).toBe(
      "https://property.sussexcountyde.gov/PT/search/commonsearch.aspx?mode=parid&parid=234-100.00-01",
    );
  });

  it("falls back to the search page when no APN is known", () => {
    expect(assessorUrl(gsaSite)).toBe("https://douglasnv-search.gsacorp.io/");
  });

  it("ignores a blank APN and falls back to the search page", () => {
    expect(assessorUrl(gsaSite, { apn: "   " })).toBe("https://douglasnv-search.gsacorp.io/");
  });
});
