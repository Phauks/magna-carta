/*
 * A list endpoint may not quietly answer with an unbounded array.
 *
 * The contract module in apps/api-worker/src/http/contracts/pagination.ts states the rule outright — "every
 * list endpoint returns the uniform { data, nextCursor } envelope" — and forty-seven endpoints did
 * not follow it. A rule written down and enforced by nothing is a rule that decays, and this one had:
 * two of the forty-seven read a matter's whole record with no LIMIT at any layer, which is a response
 * whose size is bounded only by how long the firm has been in business.
 *
 * The gate reads the EMITTED contract, not the source, because the emitted contract is what a caller
 * actually gets. It compares the set of array-returning GETs that carry no `nextCursor` against a
 * checked-in baseline, and refuses either direction of drift:
 *
 *   - an endpoint missing from the baseline is NEW unpaged work, and is refused
 *   - an endpoint in the baseline that no longer appears has been fixed, and the entry must go, so
 *     the list can only ever shrink and cannot rot into a list of names nobody has re-read
 *
 * Usage: node tooling/lint-list-pagination/index.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listOperations } from "./list-operations.mjs";
import { BOUNDED_BY_CONSTRUCTION, UNPAGED_LIST_OPERATIONS } from "./unpaged-baseline.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT = path.join(ROOT, "apps", "api-worker", "openapi", "openapi.json");

const document = JSON.parse(readFileSync(CONTRACT, "utf8"));
const operations = listOperations(document);
const unpaged = new Set(operations.filter((entry) => !entry.paged).map((e) => e.operationId));
const baseline = new Set(UNPAGED_LIST_OPERATIONS);
const bounded = new Set(Object.keys(BOUNDED_BY_CONSTRUCTION));

const added = [...unpaged].filter((id) => !baseline.has(id) && !bounded.has(id)).sort();
const fixed = [...baseline].filter((id) => !unpaged.has(id)).sort();

if (added.length === 0 && fixed.length === 0) {
  const total = operations.length;
  console.log(
    `lint:list-pagination: ${String(total - unpaged.size)} of ${String(total)} list endpoints are ` +
      `cursor-paged; ${String(unpaged.size)} carried over, none added.`,
  );
  process.exit(0);
}

if (added.length > 0) {
  console.error(
    "lint:list-pagination: a list endpoint answers with an array and no cursor.\n\n" +
      "  A list endpoint returns the uniform { data, nextCursor } envelope — see\n" +
      "  apps/api-worker/src/http/contracts/pagination.ts, and packages/data-access/src/cursor-pagination.ts\n" +
      "  for the keyset helpers. An unbounded array is a response whose size the caller does not\n" +
      "  control and the firm's own history does.\n",
  );
  for (const id of added) {
    const entry = operations.find((candidate) => candidate.operationId === id);
    console.error(`    ${id}  (GET ${entry?.route ?? "?"})`);
  }
  console.error(
    "\n  If the answer is genuinely bounded by something other than a page size, record it in\n" +
      "  tooling/lint-list-pagination/unpaged-baseline.mjs under BOUNDED_BY_CONSTRUCTION with what\n" +
      "  bounds it — a claim that can be checked at a named place, never 'it is probably small'.",
  );
}

if (fixed.length > 0) {
  console.error(
    "\nlint:list-pagination: the baseline names endpoints that are no longer unpaged.\n" +
      "  Delete them from UNPAGED_LIST_OPERATIONS — the list only shrinks, and a stale entry turns\n" +
      "  it into a list of names nobody has re-read.\n",
  );
  for (const id of fixed) console.error(`    ${id}`);
}

process.exit(1);
