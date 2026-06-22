import { describe, expect, it } from "vitest";
import {
  nullSafeRenditionAdapter,
  SafeRenditionNotAvailableError,
} from "../src/safe-rendition-port.ts";

const req = {
  versionId: "fileVersion_x" as never,
  r2Key: "files/f/v",
  sniffedContentType: "text/html",
  target: "rasterized-image" as const,
};

describe("nullSafeRenditionAdapter", () => {
  it("returns null from lookup (no rendition exists at launch)", async () => {
    expect(await nullSafeRenditionAdapter.lookup(req)).toBeNull();
  });
  it("throws SafeRenditionNotAvailableError from request (engine deferred)", async () => {
    await expect(nullSafeRenditionAdapter.request(req)).rejects.toBeInstanceOf(
      SafeRenditionNotAvailableError,
    );
  });
});
