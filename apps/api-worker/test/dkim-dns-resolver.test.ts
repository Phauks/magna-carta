// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDkimKeyLookup, joinTextStrings } from "../src/emails/dkim-dns-resolver.ts";

// The resolver joins a split TXT record back into one string, refuses to put anything that is not a
// plain domain name into a query, and — the property the verdict depends on — keeps "no such record"
// distinct from "the lookup broke".

describe("joinTextStrings", () => {
  // DKIM keys routinely exceed the 255-octet limit on a single TXT string, so a real key arrives as
  // adjacent quoted segments. Joining them with anything between — or not joining them — leaves a
  // base64 key that decodes to garbage.
  it("joins a record split across several strings with nothing between them", () => {
    expect(joinTextStrings('"v=DKIM1; k=rsa; p=AAAA" "BBBB" "CCCC"')).toBe(
      "v=DKIM1; k=rsa; p=AAAABBBBCCCC",
    );
  });

  it("unwraps a single quoted string", () => {
    expect(joinTextStrings('"v=DKIM1; p=AAAA"')).toBe("v=DKIM1; p=AAAA");
  });

  it("passes through a record a resolver returned unquoted", () => {
    expect(joinTextStrings("v=DKIM1; p=AAAA")).toBe("v=DKIM1; p=AAAA");
  });

  it("unescapes an escaped quote inside a segment", () => {
    expect(joinTextStrings('"a\\"b"')).toBe('a"b');
  });
});

const RESOLVER = "https://resolver.test/dns-query";

// The resolver is stubbed rather than reached: these tests are about how a DNS answer is classified,
// and a real lookup would make them depend on the network being up and on a third party's zone.
function stubResolver(handler: (url: URL) => Response | Promise<Response>): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
    Promise.resolve(handler(new URL(String(input)))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createDkimKeyLookup", () => {
  // The name is built from the message's own d= and s= tags, so it is untrusted input. Anything that
  // is not a plain domain name is refused before it can shape a request URL.
  it("refuses a name that is not a plain domain, without making a request", async () => {
    let called = false;
    stubResolver(() => {
      called = true;
      return new Response("{}");
    });
    const lookup = createDkimKeyLookup(RESOLVER);
    for (const name of ["sel._domainkey.example.test/../evil", "a b", "sel@example.test", ""]) {
      expect(await lookup(name)).toEqual({ kind: "notFound" });
    }
    expect(called).toBe(false);
  });

  it("returns the TXT records a resolver answered with", async () => {
    stubResolver((url) => {
      expect(url.searchParams.get("name")).toBe("sel._domainkey.example.test");
      expect(url.searchParams.get("type")).toBe("TXT");
      return new Response(
        JSON.stringify({ Status: 0, Answer: [{ type: 16, data: '"v=DKIM1; p=AAAA"' }] }),
      );
    });
    expect(await createDkimKeyLookup(RESOLVER)("sel._domainkey.example.test")).toEqual({
      kind: "records",
      records: ["v=DKIM1; p=AAAA"],
    });
  });

  // A selector that has rotated away is a fact about the message and stays distinct from a broken
  // lookup — the verifier reports the first as `keyUnavailable` and never as a signer's failure.
  it("reports NXDOMAIN as not found", async () => {
    stubResolver(() => new Response(JSON.stringify({ Status: 3 })));
    expect(await createDkimKeyLookup(RESOLVER)("sel._domainkey.example.test")).toEqual({
      kind: "notFound",
    });
  });

  it("reports an answer with no TXT record as not found", async () => {
    stubResolver(
      () => new Response(JSON.stringify({ Status: 0, Answer: [{ type: 5, data: "cname.test" }] })),
    );
    expect(await createDkimKeyLookup(RESOLVER)("sel._domainkey.example.test")).toEqual({
      kind: "notFound",
    });
  });

  // A resolver that cannot be reached, or that answers with a server-side condition, is OUR failure —
  // reporting it as the signer's would defame a sender for our outage.
  it("reports an unreachable resolver as a temporary failure", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("network down")));
    expect(await createDkimKeyLookup(RESOLVER)("sel._domainkey.example.test")).toEqual({
      kind: "temporaryFailure",
    });
  });

  it("reports SERVFAIL and a non-ok response as temporary failures", async () => {
    stubResolver(() => new Response(JSON.stringify({ Status: 2 })));
    expect(await createDkimKeyLookup(RESOLVER)("sel._domainkey.example.test")).toEqual({
      kind: "temporaryFailure",
    });
    stubResolver(() => new Response("upstream unavailable", { status: 503 }));
    expect(await createDkimKeyLookup(RESOLVER)("sel._domainkey.example.test")).toEqual({
      kind: "temporaryFailure",
    });
  });
});
