// The committed snapshot must equal a fresh emission — the local mirror of the CI
// code-as-contract drift gate (`emit-openapi && git diff --exit-code`), catching a route change that
// landed without re-emitting before it ever reaches push. Byte-for-byte against the `?raw` text, the
// same comparison CI's `git diff` makes.
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import committedSnapshot from "../../openapi/openapi.json?raw";
import { serializeOpenAPIDocument } from "../../src/http/app.ts";

describe("OpenAPI snapshot — committed artifact equals a fresh emission", () => {
  it("matches scripts/emit-openapi byte-for-byte (run `pnpm --filter @magna-carta/api-worker run emit-openapi` if this fails)", () => {
    expect(committedSnapshot).toBe(serializeOpenAPIDocument());
  });
});

// Full-stack proof: the running Worker serves the SAME document the snapshot commits, so the
// committed contract is never stale against what the deployment actually serves. The live endpoint and
// the snapshot share one emit path (emitOpenAPIDocument in app.ts) — this locks them together end to
// end. Parsed equality, not byte: the live endpoint replies with compact JSON, the snapshot is
// pretty-printed; the document is what must match.
describe("OpenAPI contract — the running Worker serves the committed snapshot", () => {
  it("serves /api/openapi.json equal to the committed document", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(JSON.parse(committedSnapshot));
  });
});
