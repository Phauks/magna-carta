// Trigger a Cloudflare Workers deploy hook to rebuild the scan container image and refresh ClamAV
// signatures. The deploy hook URL is an optional secret (SCAN_BUILD_DEPLOY_HOOK_URL) — when unset
// (e.g. before production wiring), this is a no-op. A failed POST is surfaced as a thrown error so
// the cron failure is reported through the standard telemetry pipeline rather than silently dropped.
export async function triggerSignatureRefresh(deployHookUrl: string | undefined): Promise<void> {
  if (!deployHookUrl) return;
  const response = await fetch(deployHookUrl, { method: "POST" });
  if (!response.ok) {
    throw new Error(`signature-refresh deploy hook returned status ${response.status}`);
  }
}
