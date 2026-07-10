// Tiny static file server for the visual-regression harness: serves ../storybook-static (the
// built catalog) over http on 127.0.0.1 so iframe.html can fetch its module scripts, index.json
// and fonts (file:// navigation breaks those same-origin fetches). Launched and torn down by
// Playwright's webServer (./playwright.config.ts). Zero new dependencies by design — same
// node:http pattern as test/csp-spike/run-csp-spike.mjs (the strict-CSP probe server).
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const harnessDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticBuildDirectory = path.join(harnessDirectory, "..", "storybook-static");
const port = Number(process.env.PORT ?? 6007);

if (!existsSync(path.join(staticBuildDirectory, "iframe.html"))) {
  console.error(
    "storybook-static/iframe.html missing — build the static catalog first:\n" +
      "  pnpm --filter @magna-carta/design-system run storybook-build",
  );
  process.exit(1);
}

const contentTypeByExtension = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

http
  .createServer(async (request, response) => {
    const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
    const relativePath =
      requestPath === "/" ? "index.html" : decodeURIComponent(requestPath.slice(1));
    const filePath = path.resolve(staticBuildDirectory, relativePath);
    // Constraint: never serve outside the static build (trivial traversal guard; the server
    // binds to loopback only, but the guard keeps the contract explicit).
    if (
      !filePath.startsWith(staticBuildDirectory) ||
      !existsSync(filePath) ||
      !statSync(filePath).isFile()
    ) {
      response.writeHead(404).end("not found");
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypeByExtension[path.extname(filePath)] ?? "application/octet-stream",
    });
    response.end(body);
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`visual-regression static server: http://127.0.0.1:${port}/ (storybook-static)`);
  });
