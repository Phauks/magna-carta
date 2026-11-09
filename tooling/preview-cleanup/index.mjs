// Deletes every Worker Preview of the repository's Workers except the staging branch's (`beta`).
//
// Each Preview gets its own fresh namespace for every Durable Object class the Worker declares
// (developers.cloudflare.com/workers/previews/: Cloudflare "automatically provisions a new Durable
// Object namespace ... for each Preview"), and nothing deletes a Preview when its branch goes. The
// account's Durable Object namespace allowance is finite, and the api-worker alone declares thirteen
// classes, so Previews left behind by merged branches would exhaust it and the next deploy would fail
// (the Grim-Games repository hit this as error 10067). Deleting a Preview deletes its namespaces and
// their storage; production and the kept Preview are never touched.
//
// Dormant until a `beta` Preview exists: select.mjs deletes nothing for a Worker whose Previews do not
// include the kept one, because then the names are not what this expects.
//
// Usage: node tooling/preview-cleanup/index.mjs [--dry-run]
// With CLOUDFLARE_API_TOKEN (Workers Scripts: Edit) and CLOUDFLARE_ACCOUNT_ID set. The Preview cleanup
// workflow runs it; without either it reports that and does nothing.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KEEP, previewsToDelete, workerName } from "./select.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every Worker the repository deploys, read from each app's wrangler.jsonc. */
function repositoryWorkers() {
  const apps = path.join(ROOT, "apps");
  const names = [];
  for (const entry of readdirSync(apps, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let source;
    try {
      source = readFileSync(path.join(apps, entry.name, "wrangler.jsonc"), "utf8");
    } catch {
      continue; // not a Worker
    }
    const name = workerName(source);
    if (name !== null) names.push(name);
  }
  return names.toSorted();
}

async function call(token, url, method = "GET") {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const why =
      body.errors?.map((error) => `${error.code}: ${error.message}`).join("; ") ||
      response.statusText;
    const failure = new Error(`${method} ${response.status} ${why}`);
    failure.status = response.status;
    throw failure;
  }
  return body;
}

async function listPreviews(token, api) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const body = await call(token, `${api}?per_page=100&page=${page}`);
    const batch = body.result ?? [];
    all.push(...batch);
    const pages = body.result_info?.total_pages;
    if (batch.length < 100 || (pages && page >= pages)) break;
  }
  return all;
}

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const dryRun = process.argv.includes("--dry-run");

if (!token || !account) {
  console.log(
    "::notice title=Preview cleanup::CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set, so nothing ran.",
  );
} else {
  let failed = 0;
  for (const worker of repositoryWorkers()) {
    // The path Wrangler's own `wrangler preview delete` uses.
    const api = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/workers/${worker}/previews`;
    let previews;
    try {
      previews = await listPreviews(token, api);
    } catch (error) {
      if (error.status === 404) {
        console.log(`${worker}: no Previews (or no such Worker)`);
        continue;
      }
      failed++;
      console.log(`::warning title=Preview cleanup::${worker}: ${error.message}`);
      continue;
    }
    const doomed = previewsToDelete(previews);
    console.log(
      `${worker}: ${previews.length} Previews; ${doomed.length} to delete, keeping "${KEEP}".`,
    );
    if (previews.length > 0 && doomed.length === 0 && !previews.some((p) => p.name === KEEP)) {
      console.log(`${worker}: no Preview named "${KEEP}", so none deleted.`);
    }
    for (const preview of doomed) {
      if (dryRun) {
        console.log(`  would delete ${preview.name}`);
        continue;
      }
      try {
        await call(token, `${api}/${encodeURIComponent(preview.id ?? preview.name)}`, "DELETE");
        console.log(`  deleted ${preview.name}`);
      } catch (error) {
        failed++;
        console.log(`::warning title=Preview cleanup::${worker}/${preview.name}: ${error.message}`);
      }
    }
  }
  if (failed > 0) process.exitCode = 1;
}
