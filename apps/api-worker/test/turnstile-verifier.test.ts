// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { createTurnstileVerifier } from "../src/http/human-verification/turnstile-verifier.ts";
import { verifierNotConfigured } from "../src/http/human-verification/human-verification-port.ts";

// The siteverify adapter against the documented response shapes. A fake fetch stands in for
// Cloudflare so every branch — including the ones a live endpoint would never produce on demand — is
// exercised, and so the assertions can read the REQUEST the adapter made, which is where the
// single-use and idempotency rules actually live.

interface RecordedCall {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

/** A fake fetch that answers each call from a queue of scripted replies, recording what it was sent. */
function scriptedFetch(replies: Array<() => Response | Promise<Response>>): {
  fetch: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetchImplementation = (async (target: string | URL | Request, init?: RequestInit) => {
    // Narrowed rather than stringified: `fetch` accepts three target shapes and two of them
    // stringify to nothing useful, so a bare String() would quietly assert against "[object Object]".
    const url =
      typeof target === "string" ? target : target instanceof URL ? target.href : target.url;
    const sentBody = init?.body;
    calls.push({
      url,
      body: typeof sentBody === "string" ? (JSON.parse(sentBody) as Record<string, unknown>) : {},
    });
    const reply = replies[index];
    index += 1;
    if (reply === undefined) throw new Error("the adapter made more calls than the test scripted");
    return reply();
  }) as unknown as typeof fetch;
  return { fetch: fetchImplementation, calls };
}

function siteverifyJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("the Turnstile siteverify adapter", () => {
  it("passes a valid token, and sends the secret, the token and the caller's address", async () => {
    const { fetch: fetchImplementation, calls } = scriptedFetch([
      () =>
        siteverifyJson({
          success: true,
          challenge_ts: "2026-08-15T10:00:00.000Z",
          hostname: "magnacarta.esq",
          "error-codes": [],
        }),
    ]);
    const verifier = createTurnstileVerifier("the-secret", fetchImplementation);

    const outcome = await verifier.verify({
      token: "a-solved-challenge",
      callerAddress: "192.0.2.7",
    });

    expect(outcome).toEqual({ decision: "verified" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(calls[0]?.body["secret"]).toBe("the-secret");
    expect(calls[0]?.body["response"]).toBe("a-solved-challenge");
    expect(calls[0]?.body["remoteip"]).toBe("192.0.2.7");
    // The retry key is what makes the retry below safe against the single-use rule, so its presence
    // is part of the contract rather than an implementation detail.
    expect(typeof calls[0]?.body["idempotency_key"]).toBe("string");
  });

  it("omits the caller address entirely when the runtime supplied none", async () => {
    const { fetch: fetchImplementation, calls } = scriptedFetch([
      () => siteverifyJson({ success: true, "error-codes": [] }),
    ]);
    const verifier = createTurnstileVerifier("the-secret", fetchImplementation);

    await verifier.verify({ token: "a-solved-challenge", callerAddress: null });

    expect(calls[0]?.body).not.toHaveProperty("remoteip");
  });

  it("refuses an invalid or expired token", async () => {
    const { fetch: fetchImplementation } = scriptedFetch([
      () => siteverifyJson({ success: false, "error-codes": ["invalid-input-response"] }),
    ]);
    const verifier = createTurnstileVerifier("the-secret", fetchImplementation);

    expect(await verifier.verify({ token: "not-a-real-token", callerAddress: null })).toEqual({
      decision: "refused",
      reason: "token-rejected",
    });
  });

  it("refuses a replayed token as already spent", async () => {
    // A token validates exactly once; the second validation of the same one comes back under this
    // code. It is a refusal of the CALLER, and never retried — retrying it would only be told the
    // same thing again.
    const { fetch: fetchImplementation, calls } = scriptedFetch([
      () => siteverifyJson({ success: false, "error-codes": ["timeout-or-duplicate"] }),
    ]);
    const verifier = createTurnstileVerifier("the-secret", fetchImplementation);

    expect(await verifier.verify({ token: "already-spent", callerAddress: null })).toEqual({
      decision: "refused",
      reason: "token-already-spent",
    });
    expect(calls).toHaveLength(1);
  });

  it("never calls out at all when the caller presented no token", async () => {
    const { fetch: fetchImplementation, calls } = scriptedFetch([]);
    const verifier = createTurnstileVerifier("the-secret", fetchImplementation);

    expect(await verifier.verify({ token: null, callerAddress: null })).toEqual({
      decision: "refused",
      reason: "token-missing",
    });
    expect(await verifier.verify({ token: "", callerAddress: null })).toEqual({
      decision: "refused",
      reason: "token-missing",
    });
    // The point of the assertion: an unauthenticated flood of tokenless requests costs this
    // deployment nothing outbound.
    expect(calls).toHaveLength(0);
  });

  it("reports OUR bad secret as an absence, not as the caller's fault, and does not retry it", async () => {
    const { fetch: fetchImplementation, calls } = scriptedFetch([
      () => siteverifyJson({ success: false, "error-codes": ["invalid-input-secret"] }),
    ]);
    const verifier = createTurnstileVerifier("wrong-secret", fetchImplementation);

    expect(await verifier.verify({ token: "a-solved-challenge", callerAddress: null })).toEqual({
      decision: "unavailable",
      reason: "verifier-credential-rejected",
    });
    expect(calls).toHaveLength(1);
  });

  it("retries a transport failure under the SAME idempotency key, so the token is not burned", async () => {
    const { fetch: fetchImplementation, calls } = scriptedFetch([
      () => {
        throw new TypeError("network down");
      },
      () => siteverifyJson({ success: true, "error-codes": [] }),
    ]);
    const verifier = createTurnstileVerifier("the-secret", fetchImplementation);

    expect(await verifier.verify({ token: "a-solved-challenge", callerAddress: null })).toEqual({
      decision: "verified",
    });
    expect(calls).toHaveLength(2);
    // One key across both attempts is the whole reason the retry is legitimate: without it the
    // second call would be a SECOND validation of a single-use token and would come back duplicate.
    expect(calls[0]?.body["idempotency_key"]).toBe(calls[1]?.body["idempotency_key"]);
  });

  it("gives up as unavailable — never as a refusal — when the verifier never answers", async () => {
    const { fetch: fetchImplementation, calls } = scriptedFetch([
      () => siteverifyJson({ error: "bad gateway" }, 502),
      () => {
        throw new TypeError("network down");
      },
    ]);
    const verifier = createTurnstileVerifier("the-secret", fetchImplementation);

    expect(await verifier.verify({ token: "a-solved-challenge", callerAddress: null })).toEqual({
      decision: "unavailable",
      reason: "verifier-unreachable",
    });
    expect(calls).toHaveLength(2);
  });

  it("treats an unrecognized error code as an absence rather than evidence against the caller", async () => {
    const { fetch: fetchImplementation } = scriptedFetch([
      () => siteverifyJson({ success: false, "error-codes": ["internal-error"] }),
      () => siteverifyJson({ success: false, "error-codes": ["some-future-code"] }),
    ]);
    const verifier = createTurnstileVerifier("the-secret", fetchImplementation);

    expect(await verifier.verify({ token: "a-solved-challenge", callerAddress: null })).toEqual({
      decision: "unavailable",
      reason: "verifier-unreachable",
    });
  });
});

describe("the not-configured verifier", () => {
  it("answers the absence without inventing a verdict, for any input", async () => {
    expect(await verifierNotConfigured.verify({ token: null, callerAddress: null })).toEqual({
      decision: "unavailable",
      reason: "verifier-not-configured",
    });
    expect(
      await verifierNotConfigured.verify({ token: "anything", callerAddress: "192.0.2.7" }),
    ).toEqual({ decision: "unavailable", reason: "verifier-not-configured" });
  });
});
