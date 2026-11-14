import { describe, expect, it } from "vitest";
import { readGoogleNotices } from "../src/change-notices.ts";

function headers(values: Record<string, string>): { get(name: string): string | null } {
  return new Headers(values);
}

describe("reading what Google posts to a watch's address", () => {
  it("takes the secret from a notice that something changed, and nothing about the change", () => {
    expect(
      readGoogleNotices(
        headers({
          "X-Goog-Channel-ID": "channel-1",
          "X-Goog-Channel-Token": "secret-1",
          "X-Goog-Resource-ID": "resource-1",
          "X-Goog-Resource-State": "exists",
          "X-Goog-Message-Number": "7",
        }),
      ),
    ).toEqual([{ secret: "secret-1" }]);
  });

  it("holds no notice in the greeting Google sends when a watch begins", () => {
    expect(
      readGoogleNotices(
        headers({ "X-Goog-Channel-Token": "secret-1", "X-Goog-Resource-State": "sync" }),
      ),
    ).toEqual([]);
  });

  it("holds no notice in a request with no token, or with one longer than Google allows", () => {
    expect(readGoogleNotices(headers({ "X-Goog-Resource-State": "exists" }))).toEqual([]);
    expect(
      readGoogleNotices(
        headers({ "X-Goog-Channel-Token": "x".repeat(257), "X-Goog-Resource-State": "exists" }),
      ),
    ).toEqual([]);
  });
});
