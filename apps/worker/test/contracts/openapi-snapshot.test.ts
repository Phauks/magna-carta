// Slice 0·5b Task 9: the committed snapshot must equal a fresh emission — the local mirror of the CI
// code-as-contract drift gate (`emit-openapi && git diff --exit-code`), catching a route change that
// landed without re-emitting before it ever reaches push. Byte-for-byte against the `?raw` text, the
// same comparison CI's `git diff` makes.
import { describe, expect, it } from "vitest";
import committedSnapshot from "../../openapi/openapi.json?raw";
import { serializeOpenAPIDocument } from "../../src/app.ts";

describe("OpenAPI snapshot — committed artifact equals a fresh emission", () => {
  it("matches scripts/emit-openapi byte-for-byte (run `pnpm --filter @magna-carta/worker run emit-openapi` if this fails)", () => {
    expect(committedSnapshot).toBe(serializeOpenAPIDocument());
  });
});
