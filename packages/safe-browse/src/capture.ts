import { assertPublicTarget } from "@magna-carta/integrations/safe-target";
import type { SafeBrowseDeps, SafeView } from "./types.ts";

// Progress a capture can report while it runs. The probe and the renderer run in parallel, so the
// stages are not a pipeline: "probing" fires when both are dispatched, and "probed" fires when the
// redirect probe settles — usually well before the renderer, which is exactly why it is worth
// reporting: the caller can show where the link really leads while the page is still rendering.
export type CaptureStage =
  | { stage: "probing" }
  | { stage: "probed"; redirectCount: number; finalUrl: string };

// The SSRF guard runs first — before the redirect probe or the renderer — so a private target
// never triggers an outbound connection. `assertPublicTarget` throws `SsrfRejection` on any
// non-public host and we let it propagate unchanged. `onStage` is best-effort progress; a
// listener that throws must not fail the capture, so calls are guarded.
export async function captureSafeView(
  url: string,
  deps: SafeBrowseDeps,
  onStage?: (stage: CaptureStage) => void,
): Promise<SafeView> {
  const parsed = await assertPublicTarget(url, deps.resolve);

  const report = (stage: CaptureStage): void => {
    try {
      onStage?.(stage);
    } catch {
      // Progress reporting must never fail the capture.
    }
  };

  report({ stage: "probing" });

  const probePromise = deps.probe.follow(parsed.url.href).then((probeResult) => {
    report({
      stage: "probed",
      // Hops that actually redirected — the chain's last entry is the final response.
      redirectCount: probeResult.chain.filter(
        (hop) => hop.status >= 300 && hop.status < 400 && hop.location !== undefined,
      ).length,
      finalUrl: probeResult.finalUrl,
    });
    return probeResult;
  });

  const [probeResult, renderResult] = await Promise.all([
    probePromise,
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
