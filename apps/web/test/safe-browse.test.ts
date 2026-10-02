/*
 * Safe website viewer seam — the branching that decides which page state a capture resolves to,
 * pinned. The tricky cases: a pasted bare domain must become an https URL while a non-web scheme
 * is refused before any round trip, a shortened link that lands on another host must read as
 * such, and a 502 (the remote renderer being away) must not read as the member's fault — or as a
 * fault worth quoting to support.
 */
import { describe, expect, it } from "vitest";
import {
  landedOnDifferentHost,
  normalizeTarget,
  problemGuidance,
  screenshotSource,
  sortedHeaders,
  viewSafely,
  viewSafelyStaged,
  type SafeWebsiteView,
} from "../src/lib/tools/safe-browse/safe-browse.ts";

const capturedView: SafeWebsiteView = {
  requestedUrl: "https://short.example/a",
  finalUrl: "https://landing.example/page",
  redirectChain: [
    { url: "https://short.example/a", status: 301, location: "https://landing.example/page" },
    { url: "https://landing.example/page", status: 200 },
  ],
  responseHeaders: { server: "nginx", "content-type": "text/html" },
  screenshotBase64: "aGVsbG8=",
  title: "Landing",
  markdown: "# Landing",
  links: ["https://landing.example/next"],
};

// A stub fetch that answers with one prepared Response, so the branching runs without the network.
function respondWith(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
    })) as unknown as typeof fetch;
}

describe("normalizeTarget", () => {
  it("passes a full https URL through", () => {
    expect(normalizeTarget("https://example.com/page")).toBe("https://example.com/page");
  });

  it("gives a bare domain an https scheme", () => {
    expect(normalizeTarget("example.com")).toBe("https://example.com/");
  });

  it("keeps an explicit http scheme rather than upgrading it", () => {
    // The whole point is seeing what the link actually does — including that it is plain http.
    expect(normalizeTarget("http://example.com/")).toBe("http://example.com/");
  });

  it("trims surrounding whitespace from a pasted link", () => {
    expect(normalizeTarget("  example.com  ")).toBe("https://example.com/");
  });

  it("keeps a port on a bare host:port input", () => {
    expect(normalizeTarget("example.com:8443/admin")).toBe("https://example.com:8443/admin");
  });

  it("refuses a non-web scheme rather than sending it", () => {
    expect(normalizeTarget("file:///etc/passwd")).toBeNull();
    expect(normalizeTarget("ftp://example.com/")).toBeNull();
  });

  it("refuses input that cannot be a URL at all", () => {
    expect(normalizeTarget("not a url")).toBeNull();
    expect(normalizeTarget("")).toBeNull();
  });

  it("refuses a bare single label — it parses as a URL but names no public host", () => {
    expect(normalizeTarget("google")).toBeNull();
    expect(normalizeTarget("localhost")).toBeNull();
  });

  it("refuses input longer than the route accepts", () => {
    expect(normalizeTarget(`https://example.com/${"a".repeat(2048)}`)).toBeNull();
  });
});

describe("screenshotSource", () => {
  it("wraps raw base64 as a PNG data URL", () => {
    expect(screenshotSource("aGVsbG8=")).toBe("data:image/png;base64,aGVsbG8=");
  });

  it("passes a value already carrying a data: prefix through", () => {
    expect(screenshotSource("data:image/webp;base64,aGVsbG8=")).toBe(
      "data:image/webp;base64,aGVsbG8=",
    );
  });

  it("reports an absent screenshot as null rather than a broken image", () => {
    expect(screenshotSource("")).toBeNull();
  });
});

describe("landedOnDifferentHost", () => {
  it("is true when the capture ended on another host", () => {
    expect(landedOnDifferentHost(capturedView)).toBe(true);
  });

  it("is false when only the path or scheme moved", () => {
    expect(
      landedOnDifferentHost({
        ...capturedView,
        requestedUrl: "http://landing.example/a",
        finalUrl: "https://landing.example/page",
      }),
    ).toBe(false);
  });

  it("reads an unparseable URL as false rather than alarming without facts", () => {
    expect(landedOnDifferentHost({ ...capturedView, finalUrl: "" })).toBe(false);
  });
});

describe("sortedHeaders", () => {
  it("returns [name, value] pairs in a stable name order", () => {
    expect(sortedHeaders(capturedView.responseHeaders)).toEqual([
      ["content-type", "text/html"],
      ["server", "nginx"],
    ]);
  });
});

describe("viewSafely", () => {
  it("returns the view kind for a 200 body", async () => {
    const outcome = await viewSafely("https://short.example/a", respondWith(capturedView));
    expect(outcome).toEqual({ kind: "view", view: capturedView });
  });

  it("surfaces a problem with its Error ID on a 500", async () => {
    const outcome = await viewSafely(
      "https://example.com/",
      respondWith({ title: "boom", status: 500, errorId: "error_abc123" }, 500),
    );
    expect(outcome).toMatchObject({
      kind: "problem",
      problem: { status: 500, errorId: "error_abc123" },
    });
  });

  it("returns a problem carrying the status when a 400 body has no Error ID field", async () => {
    const outcome = await viewSafely("https://bad.example/", respondWith("not a json body", 400));
    expect(outcome).toMatchObject({ kind: "problem", problem: { status: 400 } });
  });

  it("reports a 502 renderer outage as a problem so the page can say try again", async () => {
    const outcome = await viewSafely("https://example.com/", respondWith({}, 502));
    expect(outcome).toMatchObject({ kind: "problem", problem: { status: 502 } });
  });

  it("reports transport when nothing answers at all", async () => {
    const throwing = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    expect(await viewSafely("https://example.com/", throwing)).toMatchObject({ kind: "transport" });
  });

  it("reports transport when a 200 body is not valid JSON", async () => {
    const outcome = await viewSafely("https://example.com/", respondWith("<html>no</html>", 200));
    expect(outcome).toMatchObject({ kind: "transport" });
  });
});

describe("problemGuidance", () => {
  it("treats a 502 as a transient renderer outage, not a fault worth quoting", () => {
    const guidance = problemGuidance({ status: 502, errorId: "error_example" });
    expect(guidance.tone).toBe("warning");
    expect(guidance.message).not.toContain("support");
  });

  it("marks any other server fault danger and points at the Error ID", () => {
    expect(problemGuidance({ status: 500 }).tone).toBe("danger");
  });

  it("explains a 401 politely as a missing session", () => {
    expect(problemGuidance({ status: 401 }).tone).toBe("info");
  });

  it("treats 403 as a permission warning", () => {
    expect(problemGuidance({ status: 403 }).tone).toBe("warning");
  });

  it("treats 429 as a rate-limit warning", () => {
    expect(problemGuidance({ status: 429 }).tone).toBe("warning");
  });

  it("treats a 400 blocked target as an input warning", () => {
    expect(problemGuidance({ status: 400 }).tone).toBe("warning");
  });

  it("never blames the input for a 404 — that is deploy skew, not an address fault", () => {
    // A 404 with no problem document behind it was answered by no route at all: the page and the
    // service are on different releases. Reading it as an input fault blamed the member for a
    // deploy, which is what this pins.
    const guidance = problemGuidance({ status: 404 });
    expect(guidance.tone).toBe("warning");
    expect(guidance.message).not.toContain("address");
    expect(guidance.message).toContain("Reload");
  });

  it("does not call a genuinely missing record a deploy either", () => {
    // The other way round is worse: a 404 the API composed carries a registered type and a handle,
    // and telling somebody the platform was updating when their record is simply gone sends them
    // to wait for a release that will not bring it back.
    const guidance = problemGuidance({
      status: 404,
      type: "https://api.magnacarta.esq/problems/not-found",
      errorId: "error_gone",
      detail: "That capture is no longer held.",
    });
    expect(guidance.message).not.toContain("Reload");
    expect(guidance.message).toContain("no longer held");
  });

  it("cannot echo the target back — guidance is a constant of the status alone", () => {
    // The function takes no URL, so a distinctive user input can never reach a message. This
    // guards that the SSRF-generic 400 stays generic rather than being "improved" to reflect input.
    const sentinel = "victim-domain.test";
    for (const status of [400, 401, 403, 429, 500, 502]) {
      expect(problemGuidance({ status }).message).not.toContain(sentinel);
    }
  });
});

describe("viewSafelyStaged", () => {
  function respondWithStream(lines: unknown[], status = 200): typeof fetch {
    const body = lines.map((line) => `${JSON.stringify(line)}\n`).join("");
    return (async () => new Response(body, { status })) as unknown as typeof fetch;
  }

  it("reports each stage and resolves with the terminal view", async () => {
    const stages: string[] = [];
    const outcome = await viewSafelyStaged(
      "https://short.example/a",
      (progress) => stages.push(progress.stage),
      respondWithStream([
        { stage: "probing" },
        { stage: "probed", redirectCount: 1, finalUrl: "https://landing.example/page" },
        { stage: "complete", view: capturedView },
      ]),
    );
    expect(stages).toEqual(["probing", "probed"]);
    expect(outcome).toEqual({ kind: "view", view: capturedView });
  });

  it("resolves a failed terminal line as a problem", async () => {
    const outcome = await viewSafelyStaged(
      "https://example.com/",
      () => {},
      respondWithStream([{ stage: "probing" }, { stage: "failed", problem: { status: 502 } }]),
    );
    expect(outcome).toMatchObject({ kind: "problem", problem: { status: 502 } });
  });

  it("reads a pre-stream refusal as an ordinary problem document", async () => {
    const refusing = (async () =>
      new Response(JSON.stringify({ errorId: "error_x" }), {
        status: 403,
      })) as unknown as typeof fetch;
    const outcome = await viewSafelyStaged("https://example.com/", () => {}, refusing);
    expect(outcome).toMatchObject({
      kind: "problem",
      problem: { status: 403, errorId: "error_x" },
    });
  });

  it("falls back to the non-streaming capture when the stream route is not deployed", async () => {
    // The page and the API deploy as separate Workers, so a fresh page can meet an older API
    // whose build predates the streaming route. The member loses the narration, not the capture.
    const skewedApi = (async (input: RequestInfo | URL) =>
      String(input).includes("/stream")
        ? new Response("not found", { status: 404 })
        : new Response(JSON.stringify(capturedView), { status: 200 })) as unknown as typeof fetch;
    const outcome = await viewSafelyStaged("https://short.example/a", () => {}, skewedApi);
    expect(outcome).toEqual({ kind: "view", view: capturedView });
  });

  it("reports transport when the stream ends without a terminal line", async () => {
    const outcome = await viewSafelyStaged(
      "https://example.com/",
      () => {},
      respondWithStream([{ stage: "probing" }]),
    );
    expect(outcome).toMatchObject({ kind: "transport" });
  });

  it("reports transport when a line is not valid JSON", async () => {
    const garbled = (async () =>
      new Response("not json\n", { status: 200 })) as unknown as typeof fetch;
    expect(await viewSafelyStaged("https://example.com/", () => {}, garbled)).toMatchObject({
      kind: "transport",
    });
  });

  it("reports transport when nothing answers at all", async () => {
    const throwing = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    expect(await viewSafelyStaged("https://example.com/", () => {}, throwing)).toMatchObject({
      kind: "transport",
    });
  });
});
