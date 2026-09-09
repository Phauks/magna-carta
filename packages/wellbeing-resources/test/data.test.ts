import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { describe, expect, it } from "vitest";
import { JURISDICTIONS, NATIONAL_RESOURCES } from "../src/registry.ts";
import type { WellbeingResource } from "../src/types.ts";

const OPERATOR_TYPES = new Set(["stateBar", "nonprofit", "court", "vendor", "national"]);
const SCOPES = new Set(["statewide", "metro", "national"]);
const AVAILABILITY = new Set(["aroundTheClock", "businessHours", "unspecified"]);
const SERVICES = new Set([
  "counseling",
  "substanceUse",
  "mentalHealth",
  "peerSupport",
  "crisisLine",
  "teletherapy",
  "financialAid",
  "familySupport",
  "monitoring",
]);
const ISO_DATE = CIVIL_DATE_PATTERN;

function checkResource(where: string, r: WellbeingResource): void {
  expect(r.name, `${where}: name`).toBeTruthy();
  expect(r.operator, `${where}: operator`).toBeTruthy();
  expect(OPERATOR_TYPES.has(r.operatorType), `${where}: operatorType ${r.operatorType}`).toBe(true);
  expect(SCOPES.has(r.scope), `${where}: scope ${r.scope}`).toBe(true);
  // Every resource must be contactable: a url or at least one phone.
  expect(Boolean(r.url) || r.phones.length > 0, `${where}: has a contact`).toBe(true);
  for (const p of r.phones) {
    expect(p.number, `${where}: phone number`).toBeTruthy();
    expect(AVAILABILITY.has(p.availability), `${where}: availability ${p.availability}`).toBe(true);
  }
  for (const s of r.services) {
    expect(SERVICES.has(s), `${where}: service ${s}`).toBe(true);
  }
  expect(r.confidential, `${where}: confidential`).toBeTruthy();
  expect(r.cost, `${where}: cost`).toBeTruthy();
  expect(r.description, `${where}: description`).toBeTruthy();
  expect(ISO_DATE.test(r.verifiedOn), `${where}: verifiedOn ${r.verifiedOn}`).toBe(true);
}

describe("national safety net", () => {
  it("is non-empty, all operatorType national, and includes 988", () => {
    expect(NATIONAL_RESOURCES.length).toBeGreaterThan(0);
    for (const [i, r] of NATIONAL_RESOURCES.entries()) {
      expect(r.operatorType, `national[${i}]`).toBe("national");
      checkResource(`national[${i}]`, r);
    }
    expect(NATIONAL_RESOURCES.some((r) => r.phones.some((p) => p.number === "988"))).toBe(true);
  });
});

describe("jurisdictions", () => {
  it("has unique, well-formed FIPS and codes and covers all 50 states + DC", () => {
    const fips = new Set<string>();
    const codes = new Set<string>();
    for (const j of JURISDICTIONS) {
      expect(/^\d{2}$/.test(j.fips), `${j.code}: fips ${j.fips}`).toBe(true);
      expect(/^[A-Z]{2}$/.test(j.code), `${j.code}: code`).toBe(true);
      expect(fips.has(j.fips), `duplicate fips ${j.fips}`).toBe(false);
      expect(codes.has(j.code), `duplicate code ${j.code}`).toBe(false);
      expect(j.name, `${j.code}: name`).toBeTruthy();
      fips.add(j.fips);
      codes.add(j.code);
    }
    const STATES_AND_DC = [
      "AL",
      "AK",
      "AZ",
      "AR",
      "CA",
      "CO",
      "CT",
      "DE",
      "DC",
      "FL",
      "GA",
      "HI",
      "ID",
      "IL",
      "IN",
      "IA",
      "KS",
      "KY",
      "LA",
      "ME",
      "MD",
      "MA",
      "MI",
      "MN",
      "MS",
      "MO",
      "MT",
      "NE",
      "NV",
      "NH",
      "NJ",
      "NM",
      "NY",
      "NC",
      "ND",
      "OH",
      "OK",
      "OR",
      "PA",
      "RI",
      "SC",
      "SD",
      "TN",
      "TX",
      "UT",
      "VT",
      "VA",
      "WA",
      "WV",
      "WI",
      "WY",
    ];
    for (const code of STATES_AND_DC) {
      expect(codes.has(code), `missing ${code}`).toBe(true);
    }
  });

  it("nationalFallbackOnly iff resources are empty; every real resource is valid", () => {
    for (const j of JURISDICTIONS) {
      expect(j.nationalFallbackOnly, `${j.code}: fallback flag matches emptiness`).toBe(
        j.resources.length === 0,
      );
      for (const [i, r] of j.resources.entries()) {
        checkResource(`${j.code}.resources[${i}]`, r);
      }
    }
  });
});
