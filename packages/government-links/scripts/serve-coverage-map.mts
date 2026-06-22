import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeCoverageData } from "./build-coverage-data.mts";

// Local dev server for the coverage map. Serves the mockups/ folder and exposes POST /rebuild, which
// regenerates coverage-data.js from the live registry — that endpoint backs the map's "Rebuild data"
// button. Regenerates once on start and opens the map in the browser. Ctrl+C to stop.
const root = fileURLToPath(new URL("../mockups", import.meta.url));
const PORT = 8799;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

writeCoverageData();

const server = createServer(async (req, res) => {
  // Framing proxy: many official portals (the IIS/GSA-Corp ones) send `X-Frame-Options: SAMEORIGIN`,
  // which the browser enforces so they can't be embedded for preview. Fetch the page server-side and
  // re-serve it without the framing headers, injecting <base> so its relative assets still resolve.
  // Dev-only, localhost — purely to eyeball the right page loads during verification.
  if (req.method === "GET" && req.url?.startsWith("/proxy?")) {
    const target = new URL(req.url, `http://localhost:${PORT}`).searchParams.get("url");
    if (!target || !/^https?:\/\//i.test(target)) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad url");
      return;
    }
    try {
      const upstream = await fetch(target, {
        redirect: "follow",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      const ctype = upstream.headers.get("content-type") ?? "text/html; charset=utf-8";
      if (!ctype.includes("text/html")) {
        res.writeHead(302, { location: target });
        res.end();
        return;
      }
      let html = await upstream.text();
      const base = `<base href="${upstream.url}">`;
      html = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (m) => m + base)
        : base + html;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (err) {
      res.writeHead(502, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<p style="font:14px/1.5 sans-serif;padding:24px;color:#b4471f">Proxy could not load this page (${String(
          err,
        )}). Use <b>Open</b> to view it directly.</p>`,
      );
    }
    return;
  }

  if (req.method === "POST" && req.url === "/rebuild") {
    try {
      const summary = writeCoverageData();
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(summary);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(err));
    }
    return;
  }

  const rel = (req.url === "/" ? "/coverage-map.html" : (req.url ?? "/")).split("?")[0];
  const file = join(root, rel);
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const buf = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      // never cache — so a Rebuild + reload always serves the freshly generated coverage-data.js
      "cache-control": "no-store",
    });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

const url = `http://localhost:${PORT}/coverage-map.html`;
function openBrowser() {
  const open =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(open);
}

// If the port is already taken it's almost always a server from a previous launch — don't crash with
// EADDRINUSE, just open the map that's already running.
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Coverage map already running at ${url} — opening it.`);
    openBrowser();
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`Coverage map running at ${url}  —  Ctrl+C to stop`);
  openBrowser();
});
