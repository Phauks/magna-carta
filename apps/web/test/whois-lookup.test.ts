/*
 * WHOIS lookup seam — the branching that decides which page state a lookup resolves to, pinned.
 * The tricky cases: an RDAP "not found" is a 200 with empty fields (must read as "nothing found",
 * not a broken card), a port-43 result is raw text, and a failure must surface its Error ID.
 */
import { describe, expect, it } from "vitest";
import {
  classifyResult,
  formatTimestamp,
  hasRegistrationDetail,
  lookupWhois,
  problemGuidance,
  type WhoisResult,
} from "../src/lib/tools/whois/whois-lookup.ts";

const rdapFound: WhoisResult = {
  source: "rdap",
  target: "example.com",
  registrar: "IANA",
  registeredAt: "1995-08-14T04:00:00Z",
  nameservers: ["a.iana-servers.net"],
  statuses: ["client delete prohibited"],
};

const rdapEmpty: WhoisResult = { source: "rdap", target: "does-not-exist-8h2f.com" };

const port43: WhoisResult = {
  source: "whois-43",
  target: "example.de",
  raw: "Domain: example.de\nStatus: connect\n",
};

// A stub fetch that answers with one prepared Response, so the branching runs without the network.
function respondWith(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
    })) as unknown as typeof fetch;
}

describe("hasRegistrationDetail", () => {
  it("is true when any structured field is present", () => {
    expect(hasRegistrationDetail(rdapFound)).toBe(true);
  });

  it("is false for an RDAP result with no fields", () => {
    expect(hasRegistrationDetail(rdapEmpty)).toBe(false);
  });

  it("treats empty arrays as absent", () => {
    expect(hasRegistrationDetail({ source: "rdap", target: "x", nameservers: [], statuses: [] })).toBe(
      false,
    );
  });
});

describe("classifyResult", () => {
  it("classifies a populated RDAP result as rdap", () => {
    expect(classifyResult(rdapFound)).toBe("rdap");
  });

  it("classifies an empty RDAP result as empty — the not-found case", () => {
    expect(classifyResult(rdapEmpty)).toBe("empty");
  });

  it("classifies a port-43 result as raw", () => {
    expect(classifyResult(port43)).toBe("raw");
  });
});

describe("lookupWhois", () => {
  it("returns the rdap kind for a populated RDAP body", async () => {
    const outcome = await lookupWhois("example.com", respondWith(rdapFound));
    expect(outcome).toEqual({ kind: "rdap", result: rdapFound });
  });

  it("returns the empty kind when RDAP answers with nothing", async () => {
    const outcome = await lookupWhois("nope.com", respondWith(rdapEmpty));
    expect(outcome.kind).toBe("empty");
  });

  it("returns the raw kind for a port-43 body", async () => {
    const outcome = await lookupWhois("example.de", respondWith(port43));
    expect(outcome.kind).toBe("raw");
  });

  it("surfaces a problem with its Error ID on a 500", async () => {
    const outcome = await lookupWhois(
      "example.com",
      respondWith({ title: "boom", status: 500, errorId: "error_abc123" }, 500),
    );
    expect(outcome).toEqual({ kind: "problem", problem: { status: 500, errorId: "error_abc123" } });
  });

  it("returns a problem carrying the status when a 400 body has no Error ID field", async () => {
    const outcome = await lookupWhois("bad", respondWith("not a json body", 400));
    expect(outcome).toEqual({ kind: "problem", problem: { status: 400, errorId: undefined } });
  });

  it("reports a 401 as a problem so the page can explain the missing session", async () => {
    const outcome = await lookupWhois("example.com", respondWith({ errorId: "error_z" }, 401));
    expect(outcome).toEqual({ kind: "problem", problem: { status: 401, errorId: "error_z" } });
  });

  it("reports transport when nothing answers at all", async () => {
    const throwing = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    expect(await lookupWhois("example.com", throwing)).toEqual({ kind: "transport" });
  });

  it("reports transport when a 200 body is not valid JSON", async () => {
    const outcome = await lookupWhois("example.com", respondWith("<html>not json</html>", 200));
    expect(outcome).toEqual({ kind: "transport" });
  });
});

describe("problemGuidance", () => {
  it("marks a server fault danger and points at the Error ID", () => {
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

  it("treats a 400 invalid target as an input warning", () => {
    expect(problemGuidance({ status: 400 }).tone).toBe("warning");
  });

  it("cannot echo the query back — guidance is a constant of the status alone", () => {
    // The function takes no query, so a distinctive user input can never reach a message. This
    // guards that the SSRF-generic 400 stays generic rather than being "improved" to reflect input.
    const sentinel = "victim-domain.test";
    for (const status of [400, 401, 403, 429, 500]) {
      expect(problemGuidance({ status }).message).not.toContain(sentinel);
    }
  });
});

describe("formatTimestamp", () => {
  it("renders a parseable ISO date to a readable string containing the year", () => {
    expect(formatTimestamp("1995-08-14T04:00:00Z")).toContain("1995");
  });

  it("returns an unparseable value unchanged rather than hiding the field", () => {
    expect(formatTimestamp("whenever the registry felt like it")).toBe(
      "whenever the registry felt like it",
    );
  });
});
