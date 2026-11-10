import { describe, expect, it } from "vitest";
import {
  QUERY_OPERATIONS,
  forwardQueryOperation,
  pokeContainer,
  queryOperationOf,
  type AddressContainerFetcher,
} from "../src/forward-query.ts";

function recordingContainer(response: Response): {
  container: AddressContainerFetcher;
  seen: Request[];
} {
  const seen: Request[] = [];
  return {
    seen,
    container: {
      fetch: (request) => {
        seen.push(request);
        return Promise.resolve(response.clone());
      },
    },
  };
}

describe("the proxy forwards only the two lookup operations", () => {
  it("recognises exactly suggestions and units", () => {
    expect([...QUERY_OPERATIONS]).toEqual(["suggestions", "units"]);
    expect(queryOperationOf("/suggestions")).toBe("suggestions");
    expect(queryOperationOf("/units")).toBe("units");
  });

  it("refuses anything else, the build surface included", () => {
    for (const path of ["/", "/builds", "/ready", "/Suggestions", "/units/", "/suggestions/x"]) {
      expect(queryOperationOf(path), path).toBeNull();
    }
  });

  it("passes the body through and the answer back verbatim", async () => {
    const answer = { outcome: "unavailable" };
    const { container, seen } = recordingContainer(Response.json(answer, { status: 200 }));
    const body = '{"country":"US","query":"1402 lawson cr","limit":8,"near":"NC"}';
    const response = await forwardQueryOperation(
      new Request("https://address/suggestions", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
      }),
      "suggestions",
      container,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(answer);
    expect(seen[0]?.url).toBe("http://address/suggestions");
    expect(seen[0]?.method).toBe("POST");
    expect(await seen[0]?.text()).toBe(body);
  });

  it("passes an engine error status back unchanged", async () => {
    const { container } = recordingContainer(
      Response.json({ error: "bad-request" }, { status: 400 }),
    );
    const response = await forwardQueryOperation(
      new Request("https://address/units", { method: "POST", body: "{}" }),
      "units",
      container,
    );
    expect(response.status).toBe(400);
  });

  it("pokes the readiness endpoint and reports whether it answered", async () => {
    const ready = recordingContainer(new Response(null, { status: 204 }));
    expect(await pokeContainer(ready.container)).toBe(true);
    expect(ready.seen[0]?.url).toBe("http://address/ready");
    const down = recordingContainer(new Response(null, { status: 503 }));
    expect(await pokeContainer(down.container)).toBe(false);
  });
});
