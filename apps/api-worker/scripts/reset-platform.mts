// Destroy every firm's resources and empty the control plane — the pre-launch clean slate.
//
// WHY THE ORDER IS NOT NEGOTIABLE. There is no Cloudflare API that lists Durable Object instances,
// and no API that maps a bucket back to the firm that owns it. The control-plane `firm` table is the
// ONLY index of what exists: it holds each firm's id (which addresses its database Durable Object by
// name) and its bucket_name. Empty that table first and every bucket becomes unreachable — still
// stored, still billed, with nothing left that can name it. So the control plane is destroyed LAST,
// after everything it points at is already gone.
//
// WHAT THIS DOES NOT DO. It does not wipe the firm databases themselves. A Durable Object's storage
// can only be cleared from inside a Worker (`ctx.storage.deleteAll()`), and standing up a route that
// does that would leave a permanent "destroy this firm" endpoint in production long after this one
// use. Instead each firm's key is crypto-shredded first, which is the project's own unit of
// offboarding: the wrapped key is destroyed, every derived purpose key with it, and the firm's
// protected corpus is permanently unreadable. What remains is an unaddressed SQLite database holding
// non-protected test rows, encrypted at rest, that nothing can reach — see the note printed at the
// end for the two ways to reclaim it if that is not good enough.
//
// Dry run unless --destroy is passed AND the account id is typed out in full, because a flag alone is
// too easy to leave in a shell history and re-run.
//
// Usage:
//   node apps/api-worker/scripts/reset-platform.mts                          # inventory only
//   node apps/api-worker/scripts/reset-platform.mts --destroy --account <id> # do it
//
// Environment:
//   CLOUDFLARE_API_TOKEN      account-scoped, with R2 edit and D1 edit
//   CLOUDFLARE_ACCOUNT_ID     the account the resources live in
//   R2_S3_ACCESS_KEY_ID       the S3 credential pair, for emptying buckets
//   R2_S3_SECRET_ACCESS_KEY
//   D1_CONTROL_DATABASE       the control-plane database name
import { execFileSync } from "node:child_process";
import { AwsClient } from "aws4fetch";

const API = "https://api.cloudflare.com/client/v4";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";
const accessKeyId = process.env.R2_S3_ACCESS_KEY_ID ?? "";
const secretAccessKey = process.env.R2_S3_SECRET_ACCESS_KEY ?? "";
const controlDatabase =
  process.env.D1_CONTROL_DATABASE ?? "magna-carta-production-platform-control";

const argv = process.argv.slice(2);
const confirmedAccount = argv.includes("--account") ? argv[argv.indexOf("--account") + 1] : "";
const destroy = argv.includes("--destroy") && confirmedAccount === accountId && accountId !== "";

if (accountId === "" || apiToken === "") {
  console.error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must both be set.");
  process.exit(1);
}

/** One firm as the control plane records it — the only place these three facts exist together. */
interface FirmRow {
  readonly id: string;
  readonly name: string | null;
  readonly bucket_name: string | null;
  readonly data_region: string | null;
  readonly status: string | null;
}

/** A Cloudflare REST call, with the envelope's own success flag treated as the real status. */
async function callApi(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ ok: boolean; detail: string }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const envelope = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    errors?: { message?: string }[];
  };
  const detail = (envelope.errors ?? []).map((error) => error.message ?? "").join("; ");
  return {
    ok: response.ok && envelope.success !== false,
    detail: detail || String(response.status),
  };
}

/** Read the control plane through wrangler, so this script needs no D1 binding of its own. */
function readFirms(): FirmRow[] {
  const raw = execFileSync(
    "pnpm",
    [
      "--filter",
      "@magna-carta/api-worker",
      "exec",
      "wrangler",
      "d1",
      "execute",
      controlDatabase,
      "--remote",
      "--json",
      "--command",
      "SELECT id, name, bucket_name, data_region, status FROM firm ORDER BY id",
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  // wrangler prints a banner before the JSON; take from the first bracket.
  const start = raw.indexOf("[");
  if (start === -1) throw new Error(`no JSON in wrangler output:\n${raw}`);
  const parsed = JSON.parse(raw.slice(start)) as { results?: FirmRow[] }[];
  return parsed[0]?.results ?? [];
}

/** Run one statement against the control plane. */
function writeControlPlane(sql: string): void {
  execFileSync(
    "pnpm",
    [
      "--filter",
      "@magna-carta/api-worker",
      "exec",
      "wrangler",
      "d1",
      "execute",
      controlDatabase,
      "--remote",
      "--command",
      sql,
    ],
    { stdio: "inherit" },
  );
}

/** The S3 endpoint a bucket answers on; a jurisdiction bucket exists only at its own host. */
function endpointFor(region: string | null): string {
  return region === "eu"
    ? `https://${accountId}.eu.r2.cloudflarestorage.com`
    : `https://${accountId}.r2.cloudflarestorage.com`;
}

/**
 * Empty a bucket, then delete it. R2 refuses to delete a bucket that still holds objects, and a
 * listing answers at most 1000 keys, so this pages until the bucket reports empty. Versions are not
 * a concern: R2 buckets here are unversioned.
 */
async function destroyBucket(bucketName: string, region: string | null): Promise<number> {
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  const base = `${endpointFor(region)}/${bucketName}`;
  let deleted = 0;
  for (;;) {
    const listed = await client.fetch(`${base}?list-type=2&max-keys=1000`, { method: "GET" });
    // A bucket that was never created answers 404 here. That is not a failure to delete — it is a
    // firm whose bucket step ran under the dev adapter, which records a name and creates nothing.
    // Treating it as an error would block the whole reset behind every such firm, so it counts as
    // already gone: zero objects, no bucket to remove, and the control plane may still be emptied.
    if (listed.status === 404) return 0;
    if (!listed.ok) throw new Error(`list ${bucketName}: HTTP ${String(listed.status)}`);
    const xml = await listed.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1] ?? "");
    if (keys.length === 0) break;
    // DeleteObjects takes up to 1000 keys and needs a Content-MD5 R2 does not require, so the
    // per-object DELETE is used instead — slower, but it needs no digest and reports each failure.
    for (const key of keys) {
      const removed = await client.fetch(`${base}/${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      if (!removed.ok && removed.status !== 404) {
        throw new Error(`delete ${bucketName}/${key}: HTTP ${String(removed.status)}`);
      }
      deleted += 1;
    }
  }
  const jurisdiction = region === "eu" ? { "cf-r2-jurisdiction": "eu" } : {};
  const dropped = await callApi(
    "DELETE",
    `/accounts/${accountId}/r2/buckets/${bucketName}`,
    undefined,
    jurisdiction,
  );
  // Gone between the listing and the delete, or never there in the API's eyes: either way there is
  // nothing left to remove, and only a refusal of a bucket that exists is a failure.
  if (!dropped.ok && !/not found|does not exist|10006/i.test(dropped.detail)) {
    throw new Error(`delete bucket ${bucketName}: ${dropped.detail}`);
  }
  return deleted;
}

/**
 * Destroy a firm's data key before its resources go. Nulling the wrapped key is irreversible and
 * makes every protected column unreadable, so it is the one step that still means something even if
 * a later step fails and leaves storage behind.
 */
function shredKey(firmId: string): void {
  writeControlPlane(
    `UPDATE firm SET wrapped_firm_key = NULL WHERE id = '${firmId.replaceAll("'", "''")}'`,
  );
}

/**
 * Every table the control plane actually has, read from the database itself rather than listed here.
 *
 * A hardcoded list in a destructive script is a landmine: a table added next month survives the
 * wipe silently, and the failure is invisible until something reads a row that should not exist.
 * Asking sqlite_master cannot go stale. Drizzle's own ledger is kept, so the database stays migrated
 * rather than becoming an empty file the runner would try to re-migrate from scratch.
 */
function controlPlaneTables(): string[] {
  const raw = execFileSync(
    "pnpm",
    [
      "--filter",
      "@magna-carta/api-worker",
      "exec",
      "wrangler",
      "d1",
      "execute",
      controlDatabase,
      "--remote",
      "--json",
      "--command",
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' " +
        "AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name NOT LIKE 'd1_%' ORDER BY name",
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const start = raw.indexOf("[");
  if (start === -1) throw new Error(`no JSON in wrangler output:\n${raw}`);
  const parsed = JSON.parse(raw.slice(start)) as { results?: { name: string }[] }[];
  return (parsed[0]?.results ?? []).map((row) => row.name);
}

/**
 * The firms holding a live managed natural-language search instance.
 *
 * These are resources in the platform's ACCOUNT, not rows — and this table is deliberately their only
 * index (control-plane-schema.ts: "Nothing ever calls the service's list operation to learn which
 * firms have instances"). So emptying the control plane while one is live orphans a running instance
 * that nothing can afterwards name, against an account ceiling of 5,000. The same trap as the
 * buckets, with no way to sweep up afterwards.
 */
function liveSearchInstances(): { firm_id: string; instance_name: string; state: string }[] {
  const raw = execFileSync(
    "pnpm",
    [
      "--filter",
      "@magna-carta/api-worker",
      "exec",
      "wrangler",
      "d1",
      "execute",
      controlDatabase,
      "--remote",
      "--json",
      "--command",
      "SELECT firm_id, instance_name, state FROM ai_search_instance " +
        "WHERE state IN ('provisioning', 'ready', 'tearing-down')",
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const start = raw.indexOf("[");
  if (start === -1) return [];
  const parsed = JSON.parse(raw.slice(start)) as {
    results?: { firm_id: string; instance_name: string; state: string }[];
  }[];
  return parsed[0]?.results ?? [];
}

async function main(): Promise<void> {
  const firms = readFirms();
  const searchInstances = liveSearchInstances();

  console.log(`\ncontrol plane : ${controlDatabase}`);
  console.log(`account       : ${accountId}`);
  console.log(`firms         : ${String(firms.length)}\n`);
  for (const firm of firms) {
    console.log(
      `  ${firm.id}  ${(firm.status ?? "?").padEnd(12)} ${(firm.data_region ?? "us").padEnd(4)} ${firm.bucket_name ?? "(no bucket)"}`,
    );
  }

  if (searchInstances.length > 0) {
    console.log(`\nlive natural-language search instances: ${String(searchInstances.length)}`);
    for (const instance of searchInstances) {
      console.log(`  ${instance.firm_id}  ${instance.state.padEnd(13)} ${instance.instance_name}`);
    }
  }

  if (!destroy) {
    console.log(
      "\nDRY RUN — nothing was touched.\n" +
        "To destroy all of the above, re-run with:\n" +
        `  node apps/api-worker/scripts/reset-platform.mts --destroy --account ${accountId}\n`,
    );
    return;
  }

  // A live search instance is an account resource whose only index is the table about to be emptied,
  // and it cannot be torn down from here — tearDownNaturalLanguageInstance runs inside the Worker,
  // over the firm's own database. So this refuses rather than orphaning something unnameable.
  if (searchInstances.length > 0) {
    console.error(
      `\nREFUSING: ${String(searchInstances.length)} natural-language search instance(s) are still live.\n` +
        "They are resources in the account, and ai_search_instance is deliberately their only index —\n" +
        "emptying the control plane would leave them running with nothing able to name them, against\n" +
        "an account ceiling of 5,000. Tear them down first (the opt-out path on each firm, which calls\n" +
        "tearDownNaturalLanguageInstance and records the service's response), then re-run:\n" +
        searchInstances.map((one) => `  ${one.firm_id}  ${one.instance_name}`).join("\n"),
    );
    process.exit(1);
  }

  console.log(
    "\nDESTROYING. Buckets first; the control plane last, because it is the only index.\n",
  );

  let bucketsDropped = 0;
  let objectsDeleted = 0;
  const failures: string[] = [];

  for (const firm of firms) {
    // The key first: irreversible, cheap, and the one step whose value survives a later failure.
    shredKey(firm.id);
    if (firm.bucket_name === null || firm.bucket_name === "") {
      console.log(`  ${firm.id}  no bucket recorded — key shredded, nothing to delete`);
      continue;
    }
    try {
      const objects = await destroyBucket(firm.bucket_name, firm.data_region);
      objectsDeleted += objects;
      bucketsDropped += 1;
      console.log(`  ${firm.id}  ${firm.bucket_name}: ${String(objects)} objects, bucket deleted`);
    } catch (caught) {
      // Keep going. One firm's stuck bucket must not strand every firm behind it — and the control
      // plane is not emptied below if anything failed, so the index of what is left survives.
      const message = caught instanceof Error ? caught.message : String(caught);
      failures.push(`${firm.id}: ${message}`);
      console.error(`  ${firm.id}  FAILED — ${message}`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n${String(failures.length)} firm(s) failed. The control plane has NOT been emptied, because ` +
        "it is the only record of which buckets are left. Fix these and re-run:\n" +
        failures.map((failure) => `  ${failure}`).join("\n"),
    );
    process.exit(1);
  }

  // Foreign keys are off for this pass rather than ordering the deletes: the order that satisfies
  // every constraint changes whenever a table is added, and getting it wrong here fails halfway
  // through with the control plane in a state no one designed.
  const tables = controlPlaneTables();
  console.log(`\n  emptying ${String(tables.length)} control-plane table(s): ${tables.join(", ")}`);
  writeControlPlane(
    `PRAGMA defer_foreign_keys = ON; ${tables.map((table) => `DELETE FROM "${table}";`).join(" ")}`,
  );

  console.log(
    `\nDone. ${String(bucketsDropped)} bucket(s) and ${String(objectsDeleted)} object(s) destroyed; ` +
      "control plane emptied.\n\n" +
      "WHAT SURVIVES: each firm's database Durable Object still holds its SQLite data. Its key is\n" +
      "shredded, so every protected column is permanently unreadable, and nothing can address the\n" +
      "object any more — the id that named it is gone. To reclaim the storage itself, either:\n" +
      "  (a) deploy a tombstone for the FirmDatabase class (exports state: deleted), which destroys\n" +
      "      every instance, then deploy again to recreate the class; or\n" +
      "  (b) leave it — SQLite storage bills $0.20/GB-month and test firms hold very little.\n\n" +
      "Registering again with the same email now provisions a firm from scratch, which means it also\n" +
      "runs the bucket-CORS step that firms created before 2026-09-03 never ran.\n",
  );
}

await main();
