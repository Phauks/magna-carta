/*
 * Where a row in the Build Information panel goes when somebody clicks it.
 *
 * THE PROPERTY UNDER TEST IS THAT NOTHING IS LINKED THAT CANNOT BE VERIFIED. A link built from the
 * "dev" or "unknown" placeholder is a 404 that reads as a broken deployment, and a link built with
 * no repository at all is worse — so both cases return null and the panel renders plain text. The
 * dashboard link is the opposite case: it names no account on purpose, so it works for every member
 * of the account and embeds nothing that can go stale.
 *
 * The build identity here is the vitest define (vitest.config.ts), which fixes the repository so a
 * link is assertable rather than dependent on whose checkout ran the suite.
 */
import { describe, expect, it } from "vitest";
import { BUILD_IDENTITY } from "../src/lib/build-identity.ts";
import {
  commitComparisonUrl,
  commitUrl,
  workerDashboardUrl,
} from "../src/lib/versions/deployment-links.ts";

describe("the Cloudflare dashboard link", () => {
  it("names no account, so it resolves against whoever is signed in", () => {
    const url = workerDashboardUrl("magna-carta-scan");
    expect(url).toContain("dash.cloudflare.com/?to=/:account/");
    expect(url).toContain("magna-carta-scan");
  });

  it("escapes the Worker name rather than pasting it into the path", () => {
    expect(workerDashboardUrl("a b")).toContain("a%20b");
  });
});

describe("the commit link", () => {
  it("points at the commit in this build's own repository", () => {
    expect(commitUrl("a1b2c3d")).toBe(`${BUILD_IDENTITY.sourceRepository ?? ""}/commit/a1b2c3d`);
  });

  it("refuses a placeholder, because a link to 'dev' is a 404 that reads as a broken deployment", () => {
    expect(commitUrl("dev")).toBeNull();
    expect(commitUrl("unknown")).toBeNull();
    expect(commitUrl(null)).toBeNull();
  });
});

describe("the comparison link", () => {
  it("answers what changed between this tab's build and the one being served", () => {
    expect(commitComparisonUrl("a1b2c3d", "9f9f9f9")).toContain("/compare/a1b2c3d...9f9f9f9");
  });

  it("is absent when there is nothing to compare — one end missing, or both the same commit", () => {
    expect(commitComparisonUrl("a1b2c3d", "a1b2c3d")).toBeNull();
    expect(commitComparisonUrl("a1b2c3d", null)).toBeNull();
    expect(commitComparisonUrl("dev", "9f9f9f9")).toBeNull();
  });
});
