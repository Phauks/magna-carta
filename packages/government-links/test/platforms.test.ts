import { describe, expect, it } from "vitest";
import { ASSESSOR_PLATFORMS } from "../src/platforms.ts";

// Adapters receive an already-normalized `key` (the resolver normalizes first) and assemble the
// URL from the jurisdiction's host and any per-jurisdiction params.
describe("assessor platform link builders", () => {
  it("DevNet Wedge builds /parcel/view/{key}/{year} and requires a year", () => {
    expect(
      ASSESSOR_PLATFORMS.devnetWedge.build({
        host: "nyenv-assessor.devnetwedge.com",
        key: "00123456",
        year: 2026,
      }),
    ).toBe("https://nyenv-assessor.devnetwedge.com/parcel/view/00123456/2026");
    expect(ASSESSOR_PLATFORMS.devnetWedge.requiresYear).toBe(true);
  });

  it("GSA Corp builds /parcel/{key} and needs no year", () => {
    expect(
      ASSESSOR_PLATFORMS.gsaCorp.build({ host: "douglasnv-search.gsacorp.io", key: "132012" }),
    ).toBe("https://douglasnv-search.gsacorp.io/parcel/132012");
    expect(ASSESSOR_PLATFORMS.gsaCorp.requiresYear).toBe(false);
  });

  it("Beacon/qPublic builds an Application.aspx KeyValue link from per-county params", () => {
    expect(
      ASSESSOR_PLATFORMS.beaconQpublic.build({
        host: "qpublic.schneidercorp.com",
        params: { appId: "1045", layerId: "23342", pageTypeId: "4" },
        key: "940440780000",
      }),
    ).toBe(
      "https://qpublic.schneidercorp.com/Application.aspx?AppID=1045&LayerID=23342&PageTypeID=4&KeyValue=940440780000",
    );
  });

  it("TerraScan TaxSifter builds a Search/Results q-param link, with an optional basePath", () => {
    expect(
      ASSESSOR_PLATFORMS.terraScanTaxSifter.build({
        host: "lincolnwa-taxsifter.publicaccessnow.com",
        key: "0801032002000",
      }),
    ).toBe("https://lincolnwa-taxsifter.publicaccessnow.com/Search/Results.aspx?q=0801032002000");
    expect(
      ASSESSOR_PLATFORMS.terraScanTaxSifter.build({
        host: "terra.co.franklin.wa.us",
        params: { basePath: "/taxsifter" },
        key: "12345",
      }),
    ).toBe("https://terra.co.franklin.wa.us/taxsifter/Search/Results.aspx?q=12345");
  });

  it("Megabyte MBAP builds /mbap/{slug}/asr/AsrMain/{key} from host + slug", () => {
    expect(
      ASSESSOR_PLATFORMS.megabyteMbap.build({
        host: "common1.mptsweb.com",
        params: { slug: "sonoma" },
        key: "004011001000",
      }),
    ).toBe("https://common1.mptsweb.com/mbap/sonoma/asr/AsrMain/004011001000");
  });
});
