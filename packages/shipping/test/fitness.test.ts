import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEasyPostAdapter } from "../src/easypost/adapter.ts";
import type { HttpClient } from "../src/easypost/http.ts";

const http: HttpClient = {
  async request() {
    return { status: 200, json: async () => ({}) };
  },
};

function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function importLines(source: string): string {
  return source
    .split("\n")
    .filter((line) => line.trimStart().startsWith("import"))
    .join("\n");
}

describe("shipping fitness", () => {
  it("the adapter ships a descriptor with a category and a credential requirement", () => {
    const { descriptor } = createEasyPostAdapter({ http });
    expect(descriptor.category).toBe("shipping");
    expect(descriptor.credential.kind).toBe("apiKey");
  });

  it("the port module does not import any easypost adapter (dependency-inversion guard)", () => {
    // A comment naming the vendor is fine; the guard is that no IMPORT pulls in the adapter.
    expect(importLines(sourceOf("../src/port.ts"))).not.toMatch(/easypost/i);
  });

  it("the adapter never writes the credential to a console/log surface", () => {
    const adapterSource = sourceOf("../src/easypost/adapter.ts");
    expect(adapterSource).not.toMatch(/console\./);
    expect(adapterSource).not.toMatch(/JSON\.stringify\([^)]*credential/);
  });
});
