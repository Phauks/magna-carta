// Seeds the local development firm by calling the Worker's dev-only seed route, then prints the
// credentials to sign in with. One command for "stand up real data locally":
//
//   vp run worker-dev          # in one terminal — the local app (Miniflare D1/R2/Queues)
//   pnpm run seed-dev-firm     # in another — provisions firm + owner + matter + files
//
// The seed route (apps/api-worker/src/http/routes/developer/dev-seed.ts) is development-only: it serves ONLY when the
// real R2 S3 credential set is absent, so it is a bare 404 in production. Re-running is idempotent —
// it resumes the same tenant rather than duplicating it.
//
// Override the base URL when the Worker is not on the wrangler default:  WORKER_URL=http://127.0.0.1:8788

const baseUrl = (process.env.WORKER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const seedUrl = `${baseUrl}/api/__dev/seed`;

// Bring the control-plane schema up first. In production a Cron trigger applies the control-plane
// migrations (apps/api-worker/src/background/scheduled.ts); wrangler dev does NOT auto-run Cron, so a fresh Miniflare
// D1 has no `firm` table and the seed would 500 with "no such table: firm". Hitting the scheduled
// handler runs the same migration pass, and it is idempotent — a warm database applies nothing new.
try {
  const migrate = await fetch(`${baseUrl}/cdn-cgi/handler/scheduled`);
  if (!migrate.ok) {
    console.error(
      `Could not apply the control-plane migrations: ${migrate.status} from /cdn-cgi/handler/scheduled.`,
    );
    process.exit(1);
  }
} catch (cause) {
  console.error(`Could not reach the Worker at ${baseUrl}.`);
  console.error("Start it first with:  vp run worker-dev");
  console.error(String(cause));
  process.exit(1);
}

let response;
try {
  response = await fetch(seedUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: "{}",
  });
} catch (cause) {
  console.error(`Could not reach the Worker at ${baseUrl}.`);
  console.error("Start it first with:  vp run worker-dev");
  console.error(String(cause));
  process.exit(1);
}

if (response.status === 404) {
  console.error(
    `The seed route is not active at ${seedUrl} (404). It runs only in local development ` +
      "(when the real R2 S3 credentials are absent). Confirm you are running `vp run worker-dev`.",
  );
  process.exit(1);
}
if (!response.ok) {
  console.error(`Seed failed: ${response.status} ${response.statusText}`);
  console.error(await response.text());
  process.exit(1);
}

const result = await response.json();
console.log("Local development firm is seeded.\n");
console.log(`  Firm:      ${result.firmName} (${result.firmId})`);
console.log(`  Matter:    ${result.matterId}`);
console.log(`  Files:     ${result.fileCount}`);
console.log("\nSign in at /login with:");
console.log(`  Email:     ${result.credentials.email}`);
console.log(`  Password:  ${result.credentials.password}`);
