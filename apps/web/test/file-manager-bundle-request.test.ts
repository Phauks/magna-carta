import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUNDLE_CHOICES,
  bundleRefusal,
  bundleRequestBody,
  bundleStem,
  isPlainZip,
  linksOf,
  requestBundle,
  type BundleChoices,
} from "../src/lib/file-manager/bundle-request.ts";

const selection = { matterId: "mat_1", fileIds: ["fil_1"], folderIds: ["fld_1"] };
const plain: BundleChoices = { ...DEFAULT_BUNDLE_CHOICES, compression: "store", manifest: false };

describe("bundleRequestBody", () => {
  it("leaves the options out of a plain zip so it rides the fast lane", () => {
    expect(isPlainZip(plain)).toBe(true);
    expect(bundleRequestBody(selection, plain, "Reyes")).toEqual({
      matterId: "mat_1",
      fileIds: ["fil_1"],
      folderIds: ["fld_1"],
    });
  });

  it("sends the options, and the password beside them, for anything else", () => {
    const body = bundleRequestBody(
      selection,
      { ...DEFAULT_BUNDLE_CHOICES, format: "sevenZip", password: "s3cret" },
      "Reyes",
    );
    expect(body["password"]).toBe("s3cret");
    expect(body["options"]).toMatchObject({
      format: "sevenZip",
      compression: "normal",
      encryption: { algorithm: "aes-256", encryptFileNames: true },
      split: null,
      outputName: "Reyes.7z",
      manifest: true,
    });
  });

  it("never asks a zip to hide its file names", () => {
    const body = bundleRequestBody(selection, { ...DEFAULT_BUNDLE_CHOICES, password: "x" }, "R");
    expect(body["options"]).toMatchObject({ encryption: { encryptFileNames: false } });
  });

  it("leaves the password out when there is none", () => {
    expect(bundleRequestBody(selection, DEFAULT_BUNDLE_CHOICES, "R")).not.toHaveProperty(
      "password",
    );
  });
});

describe("bundleRefusal", () => {
  it("refuses what the route refuses", () => {
    expect(bundleRefusal({ ...DEFAULT_BUNDLE_CHOICES, partBytes: 100 })).toMatch(/7z/);
    expect(
      bundleRefusal({
        ...DEFAULT_BUNDLE_CHOICES,
        format: "sevenZip",
        partBytes: 100,
        password: "x",
      }),
    ).toMatch(/one file/);
    expect(
      bundleRefusal({ ...DEFAULT_BUNDLE_CHOICES, format: "sevenZip", partBytes: 100 }),
    ).toBeUndefined();
  });
});

describe("bundleStem", () => {
  it("makes a matter name safe to save", () => {
    expect(bundleStem("Reyes v. Harbor: 2026/04")).toBe("Reyes v. Harbor- 2026-04");
    expect(bundleStem("   ")).toBe("Bundle");
  });
});

describe("requestBundle", () => {
  const fetchReturning = (response: Response): typeof fetch =>
    (() => Promise.resolve(response)) as typeof fetch;

  it("reads a streamed archive with its name", async () => {
    const outcome = await requestBundle(
      fetchReturning(
        new Response(new Uint8Array([1, 2]), {
          headers: {
            "content-type": "application/zip",
            "content-disposition": 'attachment; filename="Reyes.zip"',
          },
        }),
      ),
      {},
      "fallback.zip",
    );
    expect(outcome.kind === "ok" && outcome.value.kind === "archive" && outcome.value.name).toBe(
      "Reyes.zip",
    );
  });

  it("reads a background build", async () => {
    const outcome = await requestBundle(
      fetchReturning(Response.json({ jobId: "abc", status: "building" }, { status: 202 })),
      {},
      "x.zip",
    );
    expect(outcome).toEqual({ kind: "ok", value: { kind: "building", jobId: "abc" } });
  });

  it("reads links to a build that already exists", async () => {
    const outcome = await requestBundle(
      fetchReturning(Response.json({ url: "https://r2/x" })),
      {},
      "x.zip",
    );
    expect(outcome).toEqual({ kind: "ok", value: { kind: "links", urls: ["https://r2/x"] } });
  });

  it("passes a refusal through as the route's problem", async () => {
    const outcome = await requestBundle(
      fetchReturning(
        Response.json({ title: "Bundle service not configured", status: 503 }, { status: 503 }),
      ),
      {},
      "x.zip",
    );
    expect(outcome.kind === "problem" && outcome.problem.status).toBe(503);
  });

  it("names a server that did not answer", async () => {
    const outcome = await requestBundle(
      (() => Promise.reject(new Error("offline"))) as typeof fetch,
      {},
      "x.zip",
    );
    expect(outcome.kind).toBe("transport");
  });
});

describe("linksOf", () => {
  it("gives the parts in order, or the one link", () => {
    expect(linksOf({ status: "ready", urls: ["a", "b"] })).toEqual(["a", "b"]);
    expect(linksOf({ status: "ready", url: "a" })).toEqual(["a"]);
    expect(linksOf({ status: "building" })).toEqual([]);
  });
});
