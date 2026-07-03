// The recovery Container's HTTP surface, narrowed to the one call the proxy makes. The container from
// getContainer(env.RECOVERY_ENGINE, ...) satisfies it; tests pass a fake so the proxy is exercised
// without a real container (or Docker).
export interface RecoveryContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

// Forward an incoming recovery request to the engine Container and return its response verbatim. The
// app worker calls POST /diagnose | /repair | /carve with the file bytes as the body; this proxy
// re-targets the same operation path at the container (http://recovery<path>) and streams the body
// through. The service binding from the app worker is the trust boundary — this worker has no public
// routes. A network failure throws (surfaced via telemetry), never a silent empty result.
export async function forwardRecovery(
  request: Request,
  path: string,
  container: RecoveryContainerFetcher,
): Promise<Response> {
  const containerResponse = await container.fetch(
    new Request(`http://recovery${path}`, {
      method: "POST",
      body: request.body,
      headers: request.headers,
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
