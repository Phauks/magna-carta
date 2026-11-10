// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
// The trace reader is the one piece of the location probe that runs without a browser, and the one
// whose mistake would be silent: a misread `loc=` would report a country the browser was never in.
import { describe, expect, it } from "vitest";
import { readTrace } from "../src/http/routes/tools/safe-browse-location-probe.ts";

const TRACE = [
  "fl=123abc",
  "h=www.cloudflare.com",
  "ip=203.0.113.9",
  "ts=1790270000.000",
  "visit_scheme=https",
  "colo=AKL",
  "loc=NZ",
  "tls=TLSv1.3",
].join("\n");

describe("readTrace", () => {
  it("reads the country and the data centre", () => {
    expect(readTrace(TRACE)).toEqual({ country: "NZ", dataCenter: "AKL" });
  });

  it("matches whole keys, not a key that merely ends in one", () => {
    // `xloc=` must not be read as `loc=`.
    expect(readTrace("xloc=US\ncolo=SJC\nloc=GB").country).toBe("GB");
  });

  it("answers null rather than guessing when the trace carries no country", () => {
    expect(readTrace("fl=1\nh=example")).toEqual({ country: null, dataCenter: null });
  });
});
