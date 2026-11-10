// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
// The trust refusal-code → problem mapping, exercised directly. The route tests reach this through
// live routes for the common refusals; this suite pins the full jurisdiction family, because the
// failure mode it guards against is quiet — a code missing from the mapping does not error, it just
// falls through to the generic movement-refused catch-all and tells the caller the movement itself
// was improper when the truth is that no reviewed rule stands behind an answer.
import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import { problemResponseForTrustRefusal } from "../src/http/trust-refusal-problems";

function fakeContext(path: string): Context {
  return {
    req: { path },
    get: () => undefined,
    json: (body: unknown, status?: number, headers?: Record<string, string>) =>
      new Response(JSON.stringify(body), { status: status ?? 200, headers }),
  } as unknown as Context;
}

async function problemTypeFor(code: ConstructorParameters<typeof TrustValidationError>[0]) {
  const response = problemResponseForTrustRefusal(
    fakeContext("/api/v1/trust/accounts/tacct_x/movements"),
    new TrustValidationError(code, `refused with ${code}`),
  );
  const body = (await response.json()) as { type: string; status: number };
  return { type: body.type, status: response.status };
}

describe("the four jurisdiction refusals map to trust-jurisdiction-unavailable", () => {
  // Four distinct codes upstream, one problem type here: each means "nobody has stood behind an
  // answer for this jurisdiction", fixed by a person doing something other than retrying. The two
  // newer codes — not-verified and requirement-not-encoded — must not regress to the catch-all.
  it.each([
    "jurisdiction-not-recorded",
    "jurisdiction-not-encoded",
    "jurisdiction-not-verified",
    "jurisdiction-requirement-not-encoded",
  ] as const)("%s → trust-jurisdiction-unavailable, 422", async (code) => {
    const { type, status } = await problemTypeFor(code);
    expect(type).toBe("https://api.magnacarta.esq/problems/trust-jurisdiction-unavailable");
    expect(status).toBe(422);
  });
});

describe("the surrounding mappings hold their shapes", () => {
  it("an unknown handle is a 404", async () => {
    const { type, status } = await problemTypeFor("unknown-trust-account");
    expect(type).toBe("https://api.magnacarta.esq/problems/not-found");
    expect(status).toBe(404);
  });

  it("an available-balance refusal is a retryable 409", async () => {
    const { type, status } = await problemTypeFor("movement-exceeds-available");
    expect(type).toBe("https://api.magnacarta.esq/problems/trust-insufficient-available");
    expect(status).toBe(409);
  });

  it("a structural refusal falls to the movement-refused 422 catch-all", async () => {
    const { type, status } = await problemTypeFor("commingled-entry");
    expect(type).toBe("https://api.magnacarta.esq/problems/trust-movement-refused");
    expect(status).toBe(422);
  });
});
