import { describe, expect, it } from "vitest";
import { BUILD_IDENTITY, isDevelopmentBuildIdentity } from "../src/build-identity.ts";
import { VERSION_ROUTE_PATH, isVersionRequest, versionResponse } from "../src/version-route.ts";

describe("the checked-in identity is the honest dev placeholder", () => {
  // The generated file is committed with "dev" and no timestamps; only a deploy build's throwaway
  // checkout ever holds real values. A test tree carrying anything else means a stamped file was
  // committed — a stale claim every deployed Worker would then repeat.
  it("reports dev with no timestamps", () => {
    expect(BUILD_IDENTITY.commit).toBe("dev");
    expect(BUILD_IDENTITY.commitTime).toBeNull();
    expect(BUILD_IDENTITY.buildTime).toBeNull();
    expect(isDevelopmentBuildIdentity(BUILD_IDENTITY)).toBe(true);
  });

  it("a stamped identity is not the development placeholder", () => {
    expect(
      isDevelopmentBuildIdentity({
        commit: "a1b2c3d",
        commitTime: "2026-08-29T00:00:00Z",
        buildTime: "2026-08-29T00:05:00Z",
      }),
    ).toBe(false);
  });
});

describe("the version read", () => {
  it("matches only GET on the version path", () => {
    expect(isVersionRequest(new Request(`https://scan${VERSION_ROUTE_PATH}`))).toBe(true);
    expect(
      isVersionRequest(new Request(`https://scan${VERSION_ROUTE_PATH}`, { method: "POST" })),
    ).toBe(false);
    expect(isVersionRequest(new Request("https://scan/scan"))).toBe(false);
  });

  it("answers the identity it was handed as JSON", async () => {
    const response = versionResponse({
      commit: "a1b2c3d",
      commitTime: "2026-08-29T00:00:00Z",
      buildTime: "2026-08-29T00:05:00Z",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      commit: "a1b2c3d",
      commitTime: "2026-08-29T00:00:00Z",
      buildTime: "2026-08-29T00:05:00Z",
    });
  });

  it("defaults to this build's own identity", async () => {
    const body = (await versionResponse().json()) as { commit: string };
    expect(body.commit).toBe(BUILD_IDENTITY.commit);
  });
});
