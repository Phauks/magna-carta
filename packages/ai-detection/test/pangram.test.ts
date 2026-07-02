import { describe, expect, it } from "vitest";
import type { HttpClient, HttpRequest, HttpResponse } from "@magna-carta/integrations/http";
import type { FirmId } from "@magna-carta/identifiers/types";
import { createPangramAdapter } from "../src/adapters/pangram.ts";

const FIRM = "firm_test000000000000000" as FirmId;
const AT = "2026-07-02T00:00:00.000Z";
// 300 characters — above MIN_RELIABLE_CHARACTERS so a clean result is not forced inconclusive.
const LONG_TEXT = "a".repeat(300);

function stubClient(response: HttpResponse, capture?: (req: HttpRequest) => void): HttpClient {
  return {
    async request(req) {
      capture?.(req);
      return response;
    },
  };
}
function jsonResponse(status: number, body: unknown): HttpResponse {
  return { status, json: async () => body };
}

function adapter(client: HttpClient) {
  return createPangramAdapter({
    http: client,
    apiKey: "test-key",
    baseUrl: "https://pangram.example",
    now: () => AT,
  });
}

describe("createPangramAdapter.detect", () => {
  it("maps a clean-AI response to band 'likely' with pangram provenance", async () => {
    let seen: HttpRequest | undefined;
    const port = adapter(
      stubClient(
        jsonResponse(200, { fraction_ai: 0.95, version: "v3", stage: "production" }),
        (req) => (seen = req),
      ),
    );
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.band).toBe("likely");
    expect(result.value.provenance.egressedTo).toBe("pangram");
    expect(result.value.provenance.adapterId).toBe("pangram");
    expect(result.value.provenance.detectedAt).toBe(AT);
    // The request carries the key and never sets a public dashboard link for privileged content.
    expect(seen?.method).toBe("POST");
    expect(JSON.stringify(seen?.headers)).toContain("test-key");
    expect(seen?.body).toContain('"public_dashboard_link":false');
  });

  it("forces 'inconclusive' when Pangram reports AI-assisted (paraphrase caveat)", async () => {
    const port = adapter(
      stubClient(jsonResponse(200, { fraction_ai: 0.9, fraction_ai_assisted: 0.4 })),
    );
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.band).toBe("inconclusive");
    expect(result.value.caveats).toContain("possible-paraphrase-or-humanization");
  });

  it("maps window offsets to character segments", async () => {
    const port = adapter(
      stubClient(
        jsonResponse(200, {
          fraction_ai: 0.9,
          windows: [{ start_index: 0, end_index: 50, ai_assistance_score: 0.9, confidence: 0.9 }],
        }),
      ),
    );
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.segments?.[0]?.startCharacter).toBe(0);
    expect(result.value.segments?.[0]?.endCharacter).toBe(50);
  });

  it("returns adapter-error (upstream) with no text leak on a 5xx", async () => {
    const port = adapter(stubClient(jsonResponse(503, { error: "upstream" })));
    const result = await port.detect({ text: "secret privileged content", firmId: FIRM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("adapter-error");
    expect(result.problem?.category).toBe("upstream");
    expect(result.problem?.status).toBe(502);
    expect(JSON.stringify(result)).not.toContain("secret privileged content");
  });

  it("returns adapter-error (upstream) on a malformed 200 body, not a throw", async () => {
    const port = adapter(stubClient(jsonResponse(200, { not_a_prediction: true })));
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("adapter-error");
    expect(result.problem?.category).toBe("upstream");
    expect(result.problem?.status).toBe(502);
  });

  it("returns adapter-error (network), no text leak, when the transport throws", async () => {
    const throwingClient: HttpClient = {
      async request() {
        throw new Error("connection refused");
      },
    };
    const port = adapter(throwingClient);
    const result = await port.detect({ text: "secret privileged content", firmId: FIRM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("adapter-error");
    expect(result.problem?.category).toBe("network");
    expect(result.problem?.status).toBe(502);
    expect(JSON.stringify(result)).not.toContain("secret privileged content");
  });

  it("returns adapter-error (upstream) when response.json() throws, not network", async () => {
    const badBodyClient: HttpClient = {
      async request() {
        return {
          status: 200,
          json: async () => {
            throw new SyntaxError("bad json");
          },
        };
      },
    };
    const port = adapter(badBodyClient);
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("adapter-error");
    expect(result.problem?.category).toBe("upstream");
    expect(result.problem?.status).toBe(502);
  });
});
