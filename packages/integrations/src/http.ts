// The transport seam every credentialed adapter's outbound surface is built on — a platform-neutral
// home (not any one vendor's). The worker backs it with global fetch; tests pass a fake. Kept tiny
// (no Request/Response objects) so adapter tests are trivial and the pure package stays dependency-free.
export interface HttpRequest {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

export interface HttpClient {
  request(input: HttpRequest): Promise<HttpResponse>;
}

// A fetch-backed client for the worker to inject. Lives here so every consumer builds it the same way.
export function fetchHttpClient(fetchImpl: typeof fetch = fetch): HttpClient {
  return {
    async request(input) {
      const response = await fetchImpl(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
      });
      return { status: response.status, json: () => response.json() };
    },
  };
}
