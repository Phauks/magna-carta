/*
 * The measurement server, as Cloudflare's own page reports it. A malformed body must yield null
 * rather than a half-filled panel of undefineds.
 */
import { describe, expect, it } from "vitest";
import {
  fetchMeasurementServer,
  ipVersion,
  parseMeasurementServer,
} from "../src/lib/tools/speed-test/speed-test-meta.ts";

const RAW = {
  clientIp: "203.0.113.10",
  asn: 22773,
  asOrganization: "Cox Communications Inc.",
  country: "US",
  city: "Las Vegas",
  region: "Nevada",
  httpProtocol: "HTTP/1.1",
  colo: { iata: "LAS", city: "Las Vegas" },
};

describe("ipVersion", () => {
  it("reads a dotted address as IPv4", () => {
    expect(ipVersion("203.0.113.10")).toBe("IPv4");
  });

  it("reads a colonned address as IPv6", () => {
    expect(ipVersion("2606:4700:4700::1111")).toBe("IPv6");
  });
});

describe("parseMeasurementServer", () => {
  it("reads the fields Cloudflare's meta endpoint returns", () => {
    expect(parseMeasurementServer(RAW)).toEqual({
      clientIp: "203.0.113.10",
      asn: 22773,
      asOrganization: "Cox Communications Inc.",
      city: "Las Vegas",
      region: "Nevada",
      country: "US",
      coloIata: "LAS",
      coloCity: "Las Vegas",
    });
  });

  it("returns null for a body that is not the shape we expect", () => {
    expect(parseMeasurementServer({ clientIp: 42 })).toBeNull();
    expect(parseMeasurementServer(null)).toBeNull();
    expect(parseMeasurementServer("nope")).toBeNull();
  });
});

describe("fetchMeasurementServer", () => {
  it("returns null rather than throwing when the endpoint is unreachable", async () => {
    const server = await fetchMeasurementServer(async () => {
      throw new Error("offline");
    });
    expect(server).toBeNull();
  });

  it("parses a good response", async () => {
    const server = await fetchMeasurementServer(async () => RAW);
    expect(server?.coloIata).toBe("LAS");
  });
});
