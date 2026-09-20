// Fitness function: nothing in the API worker reaches the bound R2 binding directly, except the few
// modules whose bytes genuinely belong to the platform rather than to a firm.
//
// WHY THIS EXISTS. A firm's objects live in that firm's own bucket — the storage half of the tenancy
// boundary the per-firm database draws for rows. `src/files/firm-bucket.ts` is the one place that
// answers "which bucket holds this firm's bytes", and it answers as a PAIR: the name a presigned URL
// addresses, and the handle this Worker reads and writes through. Resolving the two together is the
// point. A path that signs a URL against a firm's bucket while reading through the bound binding is
// silent data loss — the bytes land somewhere no read path here can reach, ingest finds no object,
// and a read that does succeed succeeded in some other namespace.
//
// `env.R2` is the bound binding. Reaching for it in a firm-scoped path is exactly how that divergence
// gets reintroduced, and it is invisible in review: the line looks like every other R2 call. Five such
// call sites existed when this check was written, three of them inside modules that also called the
// resolver — which is why the unit here is the CALL SITE and the allow-list is per module rather than
// per directory.
//
// THE FIX IS ALWAYS THE SAME: resolve through the seam. `resolveFirmBucket(env, firmBucketName)` when
// the caller already has the firm's bucket name (off a route's firm context, a queue message, a signed
// token, or a Durable Object's own state); `resolveFirmBucketForFirmId(env, firmId)` when it has only
// the firm. Then read through the returned `bucket` and sign against the returned `bucketName` — never
// one from the resolver and the other from the binding.
//
// ADDING TO THE ALLOW-LIST is a claim that the bytes belong to the platform or to local development,
// not to any firm, and it needs the reason written beside it here. If a firm could ever ask for those
// bytes back, or be billed for them, they are not platform bytes.
//
// Run: `pnpm run lint:firm-bucket-seam`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const SCANNED_ROOT = "apps/api-worker/src";

// Each entry is a module whose `env.R2` use is genuinely NOT a firm's bytes, with why.
const PLATFORM_SCOPED = new Map([
  [
    "apps/api-worker/src/files/firm-bucket.ts",
    "the seam itself — the one module that turns a firm's bucket name into a handle",
  ],
  [
    "apps/api-worker/src/status/derived-snapshot.ts",
    "a reachability probe on the bound bucket; it asks whether object storage answers, not what any " +
      "firm stores",
  ],
  [
    "apps/api-worker/src/files/presign.ts",
    "the DEVELOPMENT presigner's own staging objects under __dev-multipart, which stand in for R2's " +
      "multipart service and never carry a firm's bytes; the production presigner signs against the " +
      "bucket name it is given",
  ],
  [
    "apps/api-worker/src/routes/developer/dev-r2-upload.ts",
    "the development upload leg's staged parts, same staging prefix, never reachable in production",
  ],
  [
    "apps/api-worker/src/routes/developer/dev-seed.ts",
    "the development seeder, which writes into the bound bucket a local environment resolves every " +
      "firm to anyway",
  ],
]);

const SKIP_DIRECTORIES = new Set(["node_modules", ".tsbuild", "dist", "build", ".wrangler"]);

// `env.R2`, `c.env.R2`, `this.env.R2` — but not `env.R2_BUCKET_NAME` / `env.R2_S3_*`, which are
// configuration strings rather than the binding.
const BINDING_REFERENCE = /(?:^|[^\w.])(?:[\w.]+\.)?env\.R2(?![\w])/;

function walk(directory, out) {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
}

function offendingLinesIn(source) {
  const findings = [];
  source.split("\n").forEach((line, index) => {
    const code = line.trim();
    // A comment naming the binding is describing it, not reaching for it.
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
    if (BINDING_REFERENCE.test(line)) findings.push({ line: index + 1, source: code });
  });
  return findings;
}

function main() {
  const files = [];
  walk(join(ROOT, SCANNED_ROOT), files);

  const offenders = [];
  const allowedSeen = new Set();
  for (const file of files) {
    const relativePath = relative(ROOT, file).split(sep).join("/");
    const findings = offendingLinesIn(readFileSync(file, "utf8"));
    if (findings.length === 0) continue;
    if (PLATFORM_SCOPED.has(relativePath)) {
      allowedSeen.add(relativePath);
      continue;
    }
    for (const finding of findings) {
      offenders.push(`  ${relativePath}:${finding.line}  ${finding.source}`);
    }
  }

  // An allow-list entry nothing reaches any more is a claim with nothing behind it: the module was
  // routed through the seam or deleted, and leaving the exemption standing would silently re-permit a
  // direct read the next time that file grows one.
  const stale = [...PLATFORM_SCOPED.keys()].filter((path) => !allowedSeen.has(path));

  if (offenders.length > 0) {
    console.error(
      "\nThese lines reach the bound R2 binding directly, past the resolver that decides which bucket" +
        "\nholds a firm's bytes.\n",
    );
    console.error(
      "A firm's objects live in that firm's own bucket. Signing a URL against one bucket while reading" +
        "\nthrough another is silent data loss, which is what src/files/firm-bucket.ts exists to prevent." +
        "\n\nResolve through the seam instead: resolveFirmBucket(env, firmBucketName) when you already have" +
        "\nthe name, resolveFirmBucketForFirmId(env, firmId) when you have only the firm. Read through the" +
        "\nreturned `bucket` and sign against the returned `bucketName` — never one of each.\n" +
        "\nIf these bytes genuinely belong to the platform rather than to any firm, add the module to" +
        "\nPLATFORM_SCOPED in tooling/lint-firm-bucket-seam.mjs with the reason.\n",
    );
    console.error(offenders.join("\n"));
    console.error(`\n${offenders.length} direct R2 binding use(s) outside the seam.`);
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error("\nThese modules are allow-listed but no longer reach the binding at all:\n");
    console.error(stale.map((path) => `  ${path}`).join("\n"));
    console.error("\nRemove them from PLATFORM_SCOPED in tooling/lint-firm-bucket-seam.mjs.");
    process.exit(1);
  }

  console.log(
    `Every firm-scoped R2 access resolves through files/firm-bucket.ts ` +
      `(${files.length} file(s) scanned, ${PLATFORM_SCOPED.size} platform-scoped module(s) allowed).`,
  );
}

if (process.argv[1] === SELF) main();
