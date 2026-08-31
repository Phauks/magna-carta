/*
 * A fetch that records what was asked of it.
 *
 * The time surface's tests assert the REQUEST, not the resolution. A call that resolves proves the
 * stub answered; it proves nothing about what went out, and the whole class of defect this exists
 * to catch is a write that leaves out a header the contract requires. So nothing here is a spy on a
 * return value: it captures the method, the path, the headers and the body of every call, and the
 * assertions read those.
 *
 * Not a test file itself — the suite collects `*.test.ts` only.
 */

/** One call as it went out. Headers are lower-cased, because HTTP header names are not case-bearing. */
export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The parsed JSON body, or null where the call carried none. */
  readonly body: unknown;
}

export interface RequestRecorder {
  readonly fetch: typeof fetch;
  readonly calls: readonly RecordedRequest[];
  /** Every call that changes something: the reads are not what any of this is about. */
  readonly writes: readonly RecordedRequest[];
  /** The one call made, when exactly one was. Fails loudly rather than answering the first of many. */
  onlyCall(): RecordedRequest;
}

function lowerCasedHeaders(init: HeadersInit | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  new Headers(init).forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  return headers;
}

/**
 * A recorder answering every call with `answer`.
 *
 * The answer is deliberately the same for every route: a test that asserts what went out must not
 * be able to pass or fail on what came back.
 */
export function recordRequests(answer: unknown = {}): RequestRecorder {
  const calls: RecordedRequest[] = [];
  const recorded: typeof fetch = (input, init) => {
    const request = init ?? {};
    const rawBody = request.body;
    calls.push({
      method: (request.method ?? "GET").toUpperCase(),
      path: String(input),
      headers: lowerCasedHeaders(request.headers),
      body: typeof rawBody === "string" ? (JSON.parse(rawBody) as unknown) : null,
    });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };

  return {
    fetch: recorded,
    get calls() {
      return calls;
    },
    get writes() {
      return calls.filter((call) => call.method !== "GET");
    },
    onlyCall() {
      if (calls.length !== 1) {
        throw new Error(
          `Expected exactly one call, saw ${String(calls.length)}: ${calls
            .map((call) => `${call.method} ${call.path}`)
            .join(", ")}`,
        );
      }
      // Checked immediately above; the index is safe.
      return calls[0] as RecordedRequest;
    },
  };
}

/** The header every time write must carry, spelled once so no test can assert a near-miss. */
export const IDEMPOTENCY_HEADER = "idempotency-key";
