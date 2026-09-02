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
  lookupWhoisWithRetries,
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
    expect(
      hasRegistrationDetail({ source: "rdap", target: "x", nameservers: [], statuses: [] }),
    ).toBe(false);
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
    expect(outcome).toMatchObject({
      kind: "problem",
      problem: { status: 500, errorId: "error_abc123" },
    });
  });

  it("returns a problem carrying the status when a 400 body has no Error ID field", async () => {
    const outcome = await lookupWhois("bad", respondWith("not a json body", 400));
    expect(outcome).toMatchObject({ kind: "problem", problem: { status: 400 } });
  });

  it("reports a 401 as a problem so the page can explain the missing session", async () => {
    const outcome = await lookupWhois("example.com", respondWith({ errorId: "error_z" }, 401));
    expect(outcome).toMatchObject({
      kind: "problem",
      problem: { status: 401, errorId: "error_z" },
    });
  });

  it("reports transport when nothing answers at all", async () => {
    const throwing = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    expect(await lookupWhois("example.com", throwing)).toMatchObject({ kind: "transport" });
  });

  it("reports transport when a 200 body is not valid JSON", async () => {
    const outcome = await lookupWhois("example.com", respondWith("<html>not json</html>", 200));
    expect(outcome).toMatchObject({ kind: "transport" });
  });
});

describe("lookupWhoisWithRetries", () => {
  const noDelay = async () => {};

  // A fetch that serves the given responses in order, repeating the last one.
  function respondInSequence(bodies: Array<{ body: unknown; status: number }>): typeof fetch {
    let call = 0;
    return (async () => {
      const next = bodies[Math.min(call, bodies.length - 1)]!;
      call += 1;
      return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body), {
        status: next.status,
      });
    }) as unknown as typeof fetch;
  }

  it("returns a first-attempt success after exactly one attempt", async () => {
    const attempts: number[] = [];
    const outcome = await lookupWhoisWithRetries(
      "example.com",
      (progress) => attempts.push(progress.attempt),
      respondInSequence([{ body: rdapFound, status: 200 }]),
      noDelay,
    );
    expect(outcome.kind).toBe("rdap");
    expect(attempts).toEqual([1]);
  });

  it("retries through registry faults and returns the record a later attempt finds", async () => {
    // The reported bug: a registry's transient fault read as "no record", and the member had to be
    // the retry loop. The page now retries visibly and lands on the real record.
    const attempts: number[] = [];
    const outcome = await lookupWhoisWithRetries(
      "example.com",
      (progress) => attempts.push(progress.attempt),
      respondInSequence([
        { body: {}, status: 502 },
        { body: {}, status: 502 },
        { body: rdapFound, status: 200 },
      ]),
      noDelay,
    );
    expect(outcome.kind).toBe("rdap");
    expect(attempts).toEqual([1, 2, 3]);
  });

  it("retries a transport fault where nothing answered at all", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("network down");
      return new Response(JSON.stringify(rdapFound), { status: 200 });
    }) as unknown as typeof fetch;
    const outcome = await lookupWhoisWithRetries("example.com", () => {}, flaky, noDelay);
    expect(outcome.kind).toBe("rdap");
    expect(calls).toBe(2);
  });

  it("stops after the attempt budget and surfaces the last fault", async () => {
    const attempts: number[] = [];
    const outcome = await lookupWhoisWithRetries(
      "example.com",
      (progress) => attempts.push(progress.attempt),
      respondInSequence([{ body: {}, status: 502 }]),
      noDelay,
    );
    expect(outcome).toMatchObject({ kind: "problem", problem: { status: 502 } });
    expect(attempts).toEqual([1, 2, 3]);
  });

  it("does not retry an answer — a 400 input fault comes back after one attempt", async () => {
    const attempts: number[] = [];
    const outcome = await lookupWhoisWithRetries(
      "bad",
      (progress) => attempts.push(progress.attempt),
      respondInSequence([{ body: {}, status: 400 }]),
      noDelay,
    );
    expect(outcome.kind).toBe("problem");
    expect(attempts).toEqual([1]);
  });

  it("does not retry the platform's own rate limit — that would dig the hole deeper", async () => {
    const attempts: number[] = [];
    const outcome = await lookupWhoisWithRetries(
      "example.com",
      (progress) => attempts.push(progress.attempt),
      respondInSequence([{ body: {}, status: 429 }]),
      noDelay,
    );
    expect(outcome).toMatchObject({ kind: "problem", problem: { status: 429 } });
    expect(attempts).toEqual([1]);
  });
});

describe("problemGuidance", () => {
  it("marks a server fault danger and points at the Error ID", () => {
    expect(problemGuidance({ status: 500 }).tone).toBe("danger");
  });

  // The page shows the Error ID only on a `danger` tone, so classifying 501 as info is also what
  // keeps a registry that publishes no lookup service from reading as our own fault.
  it("treats a 501 unsupported registry as information, not a server fault", () => {
    const guidance = problemGuidance({ status: 501, errorId: "error_example" });
    expect(guidance.tone).toBe("info");
    expect(guidance.message).not.toContain("support");
  });

  // The registry rate-limiting or being away is transient — retry guidance, not an Error ID. The
  // worker maps RdapUpstreamFailure to this 502; before it existed the fault parsed as an empty
  // record and read as "no registration record found".
  it("treats a 502 registry outage as a retryable warning, not a fault worth quoting", () => {
    const guidance = problemGuidance({ status: 502, errorId: "error_example" });
    expect(guidance.tone).toBe("warning");
    expect(guidance.message).not.toContain("support");
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
