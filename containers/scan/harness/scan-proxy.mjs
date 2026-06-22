// A zero-dependency local proxy + static server for the scan harness.
//
// Why a proxy at all: the scan container's /scan endpoint sets no CORS headers (it is an internal
// service the Worker calls server-to-server, never a browser), so a browser page cannot POST to it
// cross-origin. This server is same-origin to the page and forwards to the container — so the engine
// container stays exactly as it ships in production, untouched by anything test-only.
//
// It also hosts /api/bench, which streams an arbitrary number of bytes straight to the container
// without the browser (or the disk) ever holding the whole payload — the way to time a 1 GiB scan.
//
// Run: node scan-proxy.mjs            then open http://127.0.0.1:8787
// Env: PORT (default 8787), SCAN_URL (default http://127.0.0.1:8080 — the docker-run container).

import { Buffer } from "node:buffer";
import { randomFillSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const samplesDirectory = join(here, "samples");
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const scanBase = (process.env.SCAN_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");

const MEGABYTE = 1024 * 1024;

function throughputMegabytesPerSecond(bytes, milliseconds) {
  if (milliseconds <= 0) return 0;
  return bytes / MEGABYTE / (milliseconds / 1000);
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

// Reads the engine's reply tolerantly: a 200 is the JSON verdict; anything else (e.g. the 503 a clamd
// fault returns) becomes a surfaced error rather than a thrown json-parse.
async function readEngineReply(upstream) {
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return { error: `engine HTTP ${upstream.status}${text ? `: ${text.trim()}` : ""}` };
  }
  return { result: await upstream.json() };
}

// Reads a request body fully into a Buffer, with a guard so a stray huge browser upload cannot exhaust
// memory — anything large should go through /api/bench, which streams instead.
function readBody(request, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(
          new Error(
            `request body exceeded ${limitBytes} bytes — use the benchmark for large payloads`,
          ),
        );
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

// Forwards a buffered body to the container's /scan and times the round trip.
async function scanBuffer(bytes, contentType) {
  const query = new URLSearchParams({ size: String(bytes.length), contentType: contentType ?? "" });
  const start = performance.now();
  const upstream = await fetch(`${scanBase}/scan?${query.toString()}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: bytes,
  });
  const reply = await readEngineReply(upstream);
  const milliseconds = performance.now() - start;
  return { status: upstream.status, ...reply, milliseconds, bytes: bytes.length };
}

// Streams `totalBytes` to the container's /scan without buffering — a reused random chunk is enqueued
// until the target is met. This is how a multi-GB scan is timed from a laptop.
async function scanStream(totalBytes, contentType) {
  // Build the payload in memory and send it with a known Content-Length (via scanBuffer). Streaming the
  // body (chunked, duplex:half) over the local loopback measured far slower than the engine's real scan
  // rate — an artifact of the Node->container transport on this host, not the scan itself. A buffered
  // send reflects true throughput. A 4 MiB random block is tiled to fill the payload (fast memcpy; the
  // content is immaterial to clamd's byte-matcher).
  const block = Buffer.allocUnsafe(4 * MEGABYTE);
  randomFillSync(block);
  const payload = Buffer.allocUnsafe(totalBytes);
  for (let offset = 0; offset < totalBytes; offset += block.length) {
    block.copy(payload, offset, 0, Math.min(block.length, totalBytes - offset));
  }
  return scanBuffer(payload, contentType ?? "application/octet-stream");
}

async function handle(request, response) {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);

  try {
    if (request.method === "GET" && url.pathname === "/") {
      const html = await readFile(join(here, "harness.html"));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }

    // Engine reachability — the page polls this to show connected / start-Docker.
    if (request.method === "GET" && url.pathname === "/api/ready") {
      try {
        const upstream = await fetch(`${scanBase}/ready`, { signal: AbortSignal.timeout(1500) });
        sendJson(response, 200, {
          reachable: upstream.ok,
          scanUrl: scanBase,
          status: upstream.status,
        });
      } catch (error) {
        sendJson(response, 200, {
          reachable: false,
          scanUrl: scanBase,
          error: String(error?.message ?? error),
        });
      }
      return;
    }

    // The manifest of generated samples (name, size, expected verdict).
    if (request.method === "GET" && url.pathname === "/api/samples") {
      try {
        const manifest = await readFile(join(samplesDirectory, "manifest.json"), "utf8");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(manifest);
      } catch {
        sendJson(response, 200, []);
      }
      return;
    }

    // Scan a generated sample by name (read server-side, never through the browser).
    if (request.method === "POST" && url.pathname === "/api/scan-sample") {
      const body = await readBody(request, 4 * MEGABYTE);
      const { name, contentType } = JSON.parse(body.toString("utf8"));
      const safe = normalize(name).replace(/^([/\\]|\.\.)+/, "");
      const bytes = await readFile(join(samplesDirectory, safe));
      sendJson(response, 200, await scanBuffer(bytes, contentType));
      return;
    }

    // Scan an arbitrary file dragged into the page (buffered, capped at 512 MiB).
    if (request.method === "POST" && url.pathname === "/api/scan") {
      const bytes = await readBody(request, 512 * MEGABYTE);
      sendJson(response, 200, await scanBuffer(bytes, url.searchParams.get("contentType")));
      return;
    }

    // Stream N MiB of random bytes to the engine and time it.
    if (request.method === "GET" && url.pathname === "/api/bench") {
      const megabytes = Number.parseInt(url.searchParams.get("mib") ?? "1024", 10);
      if (!Number.isFinite(megabytes) || megabytes <= 0 || megabytes > 2048) {
        sendJson(response, 400, {
          error: "mib must be between 1 and 2048 (the inspectable-size cap)",
        });
        return;
      }
      const outcome = await scanStream(megabytes * MEGABYTE, "application/octet-stream");
      sendJson(response, 200, outcome);
      return;
    }

    sendJson(response, 404, { error: "not found" });
  } catch (error) {
    sendJson(response, 502, { error: String(error?.message ?? error), scanUrl: scanBase });
  }
}

createServer((request, response) => {
  handle(request, response).catch((error) => {
    sendJson(response, 500, { error: String(error?.message ?? error) });
  });
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`scan harness on http://127.0.0.1:${port}  (engine: ${scanBase})\n`);
});
