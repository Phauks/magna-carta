import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../../bindings.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";

// THROWAWAY dev-only demo. A barebones page to eyeball the WHOIS Lookup and Safe Website Viewer
// output before the real Tools UI lands with the design-system shell. It is NOT the product UI and
// NOT part of any contract: a bare app.get (never in the OpenAPI document), gated on DEV_DEMO_TOOLS so
// it answers 404 unless explicitly switched on locally. Delete this file (and its registration in
// app.ts) once the real widgets exist.
//
// How it works: the page is served same-origin by the Worker, so its fetch() calls to the real
// /api/v1/whois and /api/v1/safe-browse endpoints carry your session cookie and a matching Origin —
// sign in through the normal app first. The Safe Website Viewer needs the real Browser Rendering
// binding, so run the Worker with `wrangler dev --remote` (local Miniflare has no browser); the WHOIS
// lookup works against a plain local dev Worker.

const DEMO_PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Web tools demo (throwaway)</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 1.5rem; max-width: 70rem; }
  h1 { font-size: 1.2rem; }
  section { border: 1px solid #ccc; border-radius: 6px; padding: 1rem; margin: 1rem 0; }
  input[type=text] { width: 28rem; max-width: 100%; padding: 0.4rem; }
  button { padding: 0.4rem 0.9rem; cursor: pointer; }
  pre { background: #f5f5f5; padding: 0.75rem; overflow: auto; white-space: pre-wrap; word-break: break-word; }
  img { max-width: 100%; border: 1px solid #ccc; }
  .note { color: #555; font-size: 0.85rem; }
  .err { color: #b00; }
  table { border-collapse: collapse; }
  td { border: 1px solid #ddd; padding: 2px 6px; vertical-align: top; }
</style>
</head>
<body>
<h1>Web tools demo <span class="note">(throwaway dev page — sign in to the app first)</span></h1>

<section>
  <h2>WHOIS Lookup</h2>
  <p><input id="whois-q" type="text" placeholder="example.com or 8.8.8.8" value="example.com" />
     <button id="whois-go">Look up</button></p>
  <pre id="whois-out">(results appear here)</pre>
</section>

<section>
  <h2>Safe Website Viewer <span class="note">(needs <code>wrangler dev --remote</code> for Browser Rendering)</span></h2>
  <p><input id="sb-url" type="text" placeholder="http://example.com" value="https://example.com" />
     <button id="sb-go">Render safely</button></p>
  <div id="sb-status" class="note"></div>
  <div id="sb-shot"></div>
  <pre id="sb-meta"></pre>
</section>

<section>
  <h2>Metadata Inspector &amp; Scrubber <span class="note">(.docx, .jpg, .png)</span></h2>
  <p>
    <input id="md-file" type="file" />
    <button id="md-inspect">Inspect</button>
    <button id="md-scrub">Scrub &amp; download</button>
  </p>
  <pre id="md-out">(results appear here)</pre>
  <div id="md-dl"></div>
</section>

<script>
const $ = (id) => document.getElementById(id);

async function whois() {
  const q = $("whois-q").value.trim();
  $("whois-out").textContent = "Loading...";
  $("whois-out").className = "";
  try {
    const r = await fetch("/api/v1/whois?query=" + encodeURIComponent(q), { credentials: "same-origin" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { $("whois-out").className = "err"; $("whois-out").textContent = "HTTP " + r.status + "\\n" + JSON.stringify(body, null, 2); return; }
    $("whois-out").textContent = JSON.stringify(body, null, 2);
  } catch (e) { $("whois-out").className = "err"; $("whois-out").textContent = String(e); }
}

async function safeBrowse() {
  const url = $("sb-url").value.trim();
  $("sb-status").textContent = "Rendering in an isolated remote browser...";
  $("sb-shot").innerHTML = ""; $("sb-meta").textContent = ""; $("sb-meta").className = "";
  try {
    const r = await fetch("/api/v1/safe-browse", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { $("sb-status").textContent = ""; $("sb-meta").className = "err"; $("sb-meta").textContent = "HTTP " + r.status + "\\n" + JSON.stringify(body, null, 2); return; }
    $("sb-status").textContent = "Final URL: " + (body.finalUrl || "");
    if (body.screenshotBase64) {
      const img = document.createElement("img");
      img.src = "data:image/png;base64," + body.screenshotBase64;
      img.alt = "Rendered screenshot (static image — the live site never reached your browser)";
      $("sb-shot").appendChild(img);
    }
    const meta = {
      finalUrl: body.finalUrl,
      redirectChain: body.redirectChain,
      responseHeaders: body.responseHeaders,
      links: body.links,
      title: body.title,
      markdown: body.markdown,
    };
    $("sb-meta").textContent = JSON.stringify(meta, null, 2);
  } catch (e) { $("sb-status").textContent = ""; $("sb-meta").className = "err"; $("sb-meta").textContent = String(e); }
}

async function fileToBase64(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk)
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(binary);
}

async function mdInspect() {
  const file = $("md-file").files[0];
  if (!file) {
    $("md-out").textContent = "Pick a file first.";
    return;
  }
  $("md-out").textContent = "Inspecting...";
  const r = await fetch("/api/v1/metadata/inspect", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentBase64: await fileToBase64(file) }),
  });
  $("md-out").textContent = JSON.stringify(await r.json().catch(() => ({})), null, 2);
}

async function mdScrub() {
  const file = $("md-file").files[0];
  if (!file) {
    $("md-out").textContent = "Pick a file first.";
    return;
  }
  $("md-out").textContent = "Scrubbing...";
  const r = await fetch("/api/v1/metadata/scrub", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentBase64: await fileToBase64(file) }),
  });
  const body = await r.json().catch(() => ({}));
  $("md-out").textContent = JSON.stringify(body.report ?? body, null, 2);
  $("md-dl").innerHTML = "";
  if (body.cleanedBase64) {
    const a = document.createElement("a");
    a.href = "data:" + body.mediaType + ";base64," + body.cleanedBase64;
    a.download = "cleaned-" + file.name;
    a.textContent = "Download cleaned file";
    $("md-dl").appendChild(a);
  }
}

$("whois-go").addEventListener("click", whois);
$("sb-go").addEventListener("click", safeBrowse);
$("md-inspect").addEventListener("click", mdInspect);
$("md-scrub").addEventListener("click", mdScrub);
</script>
</body>
</html>`;

// Registers the throwaway demo page on a bare GET (NOT an OpenAPI operation, so it never enters the
// contract or the conformance sweep). Mount it BEFORE the static-asset catch-all. It answers 404
// unless DEV_DEMO_TOOLS is switched on, so production is unaffected even though it is always wired.
export function registerDevWebToolsDemoRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
): void {
  app.get("/__dev/web-tools", (c) => {
    if (c.env.DEV_DEMO_TOOLS !== "1") return c.notFound();
    return c.html(DEMO_PAGE);
  });
}
