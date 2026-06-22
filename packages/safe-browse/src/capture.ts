import { assertPublicTarget } from "@magna-carta/integrations/safe-target";
import type { SafeBrowseDeps, SafeView } from "./types.ts";

// The SSRF guard runs first — before the redirect probe or the renderer — so a private target
// never triggers an outbound connection. `assertPublicTarget` throws `SsrfRejection` on any
// non-public host and we let it propagate unchanged.
export async function captureSafeView(url: string, deps: SafeBrowseDeps): Promise<SafeView> {
  const parsed = await assertPublicTarget(url, deps.resolve);

  const [probeResult, renderResult] = await Promise.all([
    deps.probe.follow(parsed.url.href),
    deps.renderer.snapshot(parsed.url.href),
  ]);

  return {
    requestedUrl: url,
    finalUrl: probeResult.finalUrl,
    redirectChain: probeResult.chain,
    responseHeaders: probeResult.headers,
    screenshotBase64: renderResult.screenshotBase64,
    title: renderResult.title,
    markdown: renderResult.markdown,
    links: renderResult.links ?? [],
  };
}
