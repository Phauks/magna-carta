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

function adapter(client: HttpClient, overrides: Partial<Parameters<typeof createPangramAdapter>[0]> = {}) {
  return createPangramAdapter({
    http: client,
    apiKey: "test-key",
    baseUrl: "https://pangram.example",
    mode: "sync",
    now: () => AT,
    sleep: async () => {},
    ...overrides,
  });
}

// A queue-backed HttpClient: each call returns the next scripted response; POST vs GET is asserted by
// the caller. Records the requests so we can assert the submit URL and the poll URL.
function scriptedClient(responses: HttpResponse[]): { client: HttpClient; requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  let i = 0;
  return {
    requests,
    client: {
      async request(req) {
        requests.push(req);
        const response = responses[i];
        i += 1;
        if (response === undefined) throw new Error("no scripted response");
        return response;
      },
    },
  };
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
    expect(result.value.provenance.vendorVersion).toBe("v3");
    expect(result.value.provenance.vendorModel).toBeUndefined();
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

describe("createPangramAdapter.detect — async task flow", () => {
  it("submits, polls past a pending status, and maps the terminal prediction", async () => {
    const { client, requests } = scriptedClient([
      jsonResponse(200, { task_id: "task-1" }),
      jsonResponse(200, { stage: "STAGE_PROCESSING" }),
      jsonResponse(200, { stage: "STAGE_SUCCESS", fraction_ai: 0.95, version: "3.3" }),
    ]);
    let slept = 0;
    const port = adapter(client, { mode: "async-task", sleep: async () => { slept += 1; } });
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.band).toBe("likely");
    expect(result.value.provenance.vendorVersion).toBe("3.3"); // version, not stage
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("https://pangram.example/task");
    expect(requests[1]?.method).toBe("GET");
    expect(requests[1]?.url).toBe("https://pangram.example/task/task-1");
    expect(slept).toBe(1); // waited once between the pending poll and the success poll
  });

  it("returns adapter-error when the task reports STAGE_FAILED", async () => {
    const { client } = scriptedClient([
      jsonResponse(200, { task_id: "task-2" }),
      jsonResponse(200, { stage: "STAGE_FAILED" }),
    ]);
    const port = adapter(client, { mode: "async-task" });
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("adapter-error");
    expect(result.problem?.status).toBe(502);
  });

  it("returns adapter-error when the submit response has no task_id", async () => {
    const { client } = scriptedClient([jsonResponse(200, { not_a_task: true })]);
    const port = adapter(client, { mode: "async-task" });
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("adapter-error");
  });

  it("times out (adapter-error) when the task never reaches a terminal stage", async () => {
    const pending = () => jsonResponse(200, { stage: "STAGE_PROCESSING" });
    const { client } = scriptedClient([
      jsonResponse(200, { task_id: "task-3" }),
      pending(),
      pending(),
    ]);
    const port = adapter(client, {
      mode: "async-task",
      sleep: async () => {},
      maxPollAttempts: 2,
    });
    const result = await port.detect({ text: "secret privileged content", firmId: FIRM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("adapter-error");
    expect(result.problem?.status).toBe(502);
    expect(JSON.stringify(result)).not.toContain("secret privileged content");
  });
});
