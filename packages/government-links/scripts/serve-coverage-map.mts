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
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/coverage-map.html`;
  console.log(`Coverage map running at ${url}  —  Ctrl+C to stop`);
  const open =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(open);
});
