import type { ScanContainerFetcher } from "./forward-scan.ts";

// Forward an incoming identify request to the scan Container's /identify endpoint and return its
// response verbatim. Mirrors forward-scan.ts: the service binding from the app worker is the trust
// boundary, the body is streamed (duplex: half), and any network failure throws rather than fabricating
// a result.
export async function forwardIdentify(
  request: Request,
  container: ScanContainerFetcher,
): Promise<Response> {
  const containerResponse = await container.fetch(
    new Request(`http://scan/identify${new URL(request.url).search}`, {
      method: "POST",
      body: request.body,
      duplex: "half",
      signal: request.signal,
    } as RequestInit & { duplex: "half" }),
  );
  return new Response(containerResponse.body, {
    status: containerResponse.status,
    statusText: containerResponse.statusText,
    headers: containerResponse.headers,
  });
}
