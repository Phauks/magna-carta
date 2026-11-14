import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { DisarmError, disarmDocument, ensureReady, identifyDisarmable } from "../src/index.ts";

const wasmBytes = readFileSync(
  fileURLToPath(new URL("../src/pkg/disarm_core_bg.wasm", import.meta.url)),
);

const encoder = new TextEncoder();

describe("@magna-carta/disarm wasm wrapper", () => {
  beforeAll(async () => {
    await ensureReady(wasmBytes);
  });

  it("identifies an RTF document from its bytes", async () => {
    expect(await identifyDisarmable(encoder.encode("{\\rtf1 hello}"))).toBe("rtf");
    expect(await identifyDisarmable(encoder.encode("plain text"))).toBeNull();
  });

  it("returns the copy and a count of what it removed", async () => {
    const input = encoder.encode(
      "{\\rtf1 Before {\\object{\\*\\objdata 0105}{\\result shown}} after}",
    );
    const disarmed = await disarmDocument(input);

    expect(disarmed.kind).toBe("rtf");
    expect(disarmed.outputExtension).toBeNull();
    expect(disarmed.removals).toEqual([{ kind: "embeddedObject", count: 1 }]);
    const text = new TextDecoder().decode(disarmed.bytes);
    expect(text).not.toContain("objdata");
    expect(text).toContain("shown");
  });

  it("rejects with a stable code when there is nothing it can disarm", async () => {
    await expect(disarmDocument(encoder.encode("plain text"))).rejects.toEqual(
      new DisarmError("unsupported"),
    );
  });
});
