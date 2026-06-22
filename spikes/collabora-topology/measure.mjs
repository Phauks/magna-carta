// Throwaway measurement driver for the Collabora-on-Containers topology spike. Discarded after the
// spike. Run against the deployed Worker URL from datacenter bandwidth (the ~2 GB collabora/code image
// cannot be pushed from a home connection, so this is wired into CI).
//
// It scripts the two timing numbers that are observable from outside the container:
//   1. Cold-start: request -> coolwsd /hosting/discovery 200 -> first document open. Repeated so the
//      caller gets median + p95 (image-pull variance dominates a cold edge).
//   2. Keep-alive defeats sleep: the cloudflare/containers issue where WebSocket frames do NOT renew
//      the activity timer is still open, so the alarm-driven renewActivityTimeout mitigation must be
//      PROVEN, not assumed. With the keep-alive armed (KEEP_ALIVE=on, deployed by the caller), this
//      holds a session open and asserts the container is still running well past sleepAfter. The
//      control direction (keep-alive off -> the container sleeps) is the caller's separate deploy.
//
// The third number, coolwsd RSS, is NOT scriptable from here: the harness reads memory from
// Cloudflare's per-container metric (the number that actually sizes the instance), not an in-container
// probe. This script prints where to read it; the operator records the curve from Workers observability.
//
// No document bytes are ever logged — only URLs, HTTP status, and timings.
//
// Usage:
//   node measure.mjs --url https://collabora-topology-spike.<account>.workers.dev \
//                    [--cold-starts 10] [--keepalive-window-seconds 240] [--sleep-after-seconds 60] \
//                    [--mode keepalive|coldstart|both] [--out results.json]

import { writeFileSync } from "node:fs";

function parseArgs(argv) {
  const args = {
    url: process.env.SPIKE_WORKER_URL || "",
    coldStarts: 10,
    keepaliveWindowSeconds: 240,
    sleepAfterSeconds: 60,
    mode: "both",
    out: "",
  };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--url": args.url = value; i++; break;
      case "--cold-starts": args.coldStarts = Number(value); i++; break;
      case "--keepalive-window-seconds": args.keepaliveWindowSeconds = Number(value); i++; break;
      case "--sleep-after-seconds": args.sleepAfterSeconds = Number(value); i++; break;
      case "--mode": args.mode = value; i++; break;
      case "--out": args.out = value; i++; break;
      default: break;
    }
  }
  if (!args.url) {
    console.error("error: --url (or SPIKE_WORKER_URL) is required");
    process.exit(2);
  }
  args.url = args.url.replace(/\/+$/, "");
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Poll a URL until it returns 200 (or the deadline passes), returning the elapsed milliseconds from
// the first attempt to the first success. A cold edge serves 5xx/connection errors while the image
// pulls and coolwsd boots, so transient failures are expected and retried.
async function timeUntil200(targetUrl, deadlineMs, label) {
  const start = Date.now();
  let lastStatus = "none";
  while (Date.now() - start < deadlineMs) {
    try {
      const response = await fetch(targetUrl, { redirect: "manual" });
      lastStatus = response.status;
      // 2xx and 3xx both mean coolwsd answered (cool.html issues a redirect on open).
      if (response.status >= 200 && response.status < 400) {
        return { ok: true, ms: Date.now() - start };
      }
    } catch (error) {
      lastStatus = `err:${error?.cause?.code || error?.name || "fetch"}`;
    }
    await sleep(1000);
  }
  return { ok: false, ms: Date.now() - start, lastStatus, label };
}

function quantile(sortedValues, q) {
  if (sortedValues.length === 0) return null;
  const position = (sortedValues.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  const next = sortedValues[base + 1];
  return next === undefined
    ? sortedValues[base]
    : Math.round(sortedValues[base] + rest * (next - sortedValues[base]));
}

// Discovery readiness, then first document open via Collabora's local-filesystem backend (no WOPI host
// is needed to measure coolwsd). The baked small document is opened read/edit; the redirect/HTML
// response is the "open issued" marker. Wall-clock from request to discovery and to first open.
async function oneColdStart(baseUrl, deadlineMs) {
  const discoveryUrl = `${baseUrl}/hosting/discovery`;
  const openUrl = `${baseUrl}/browser/dist/cool.html?file_path=file:///opt/spike-docs/small.txt&permission=edit`;

  const t0 = Date.now();
  const discovery = await timeUntil200(discoveryUrl, deadlineMs, "discovery");
  if (!discovery.ok) {
    return { ok: false, stage: "discovery", discoveryMs: null, openMs: null, lastStatus: discovery.lastStatus };
  }
  const open = await timeUntil200(openUrl, deadlineMs, "first-open");
  const openMs = Date.now() - t0;
  return {
    ok: open.ok,
    stage: open.ok ? "open" : "open-timeout",
    discoveryMs: discovery.ms,
    openMs: open.ok ? openMs : null,
    lastStatus: open.ok ? open.status : open.lastStatus,
  };
}

async function measureColdStart(args) {
  console.log(`\n=== Cold-start: ${args.coldStarts} run(s) ===`);
  console.log(
    "NOTE: each run reuses the same instance unless the operator stops it between runs " +
      "(wrangler containers instances ... then stop). Without a stop, only the FIRST run is a true " +
      "cold start (image pull + boot); the rest measure warm discovery + open. The CI job logs the " +
      "first run separately for that reason.",
  );
  const perRunDeadlineMs = 5 * 60 * 1000; // generous: a cold edge pulls ~2 GB before coolwsd answers
  const discoveryTimes = [];
  const openTimes = [];
  const runs = [];
  for (let i = 0; i < args.coldStarts; i++) {
    const result = await oneColdStart(args.url, perRunDeadlineMs);
    runs.push(result);
    if (result.discoveryMs != null) discoveryTimes.push(result.discoveryMs);
    if (result.openMs != null) openTimes.push(result.openMs);
    console.log(
      `  run ${i + 1}/${args.coldStarts}: ` +
        `discovery=${result.discoveryMs ?? "FAIL"}ms open=${result.openMs ?? "FAIL"}ms ` +
        `(${result.stage}, last=${result.lastStatus})`,
    );
  }
  discoveryTimes.sort((a, b) => a - b);
  openTimes.sort((a, b) => a - b);
  const summary = {
    runs,
    firstRunDiscoveryMs: runs[0]?.discoveryMs ?? null,
    firstRunOpenMs: runs[0]?.openMs ?? null,
    discoveryMedianMs: quantile(discoveryTimes, 0.5),
    discoveryP95Ms: quantile(discoveryTimes, 0.95),
    openMedianMs: quantile(openTimes, 0.5),
    openP95Ms: quantile(openTimes, 0.95),
  };
  console.log(
    `  FIRST run (true cold start): discovery=${summary.firstRunDiscoveryMs}ms ` +
      `full-first-doc=${summary.firstRunOpenMs}ms`,
  );
  console.log(
    `  full-first-doc across runs: median=${summary.openMedianMs}ms p95=${summary.openP95Ms}ms`,
  );
  return summary;
}

// Keep-alive proof. The caller deploys with KEEP_ALIVE=on and a short sleepAfter, then this opens a
// session and asserts the container stays running for a window comfortably longer than sleepAfter.
// State is read from the Worker's /__spike/state probe (getState()), polled every ~10 s. PASS = it is
// still "running"/"healthy" after > 2x sleepAfter; FAIL = it reports "stopped" near sleepAfter (which
// would mean the alarm renewal is NOT holding the session — the issue is unmitigated in this version).
async function measureKeepAlive(args) {
  console.log(`\n=== Keep-alive proof: hold a session ${args.keepaliveWindowSeconds}s (sleepAfter=${args.sleepAfterSeconds}s) ===`);
  // Boot + open one document so the activity timer is genuinely armed.
  const boot = await oneColdStart(args.url, 5 * 60 * 1000);
  if (!boot.ok) {
    console.log(`  could not open a session to test keep-alive (stage=${boot.stage}, last=${boot.lastStatus})`);
    return { ok: false, reason: "session-open-failed", samples: [] };
  }
  console.log(`  session open (discovery=${boot.discoveryMs}ms, first-doc=${boot.openMs}ms); now observing state...`);

  const stateUrl = `${args.url}/__spike/state`;
  const start = Date.now();
  const samples = [];
  let stoppedAt = null;
  while ((Date.now() - start) / 1000 < args.keepaliveWindowSeconds) {
    let state = "unknown";
    try {
      const response = await fetch(stateUrl);
      if (response.ok) {
        const body = await response.json();
        state = String(body.status ?? "unknown");
      } else {
        state = `http:${response.status}`;
      }
    } catch (error) {
      state = `err:${error?.cause?.code || error?.name || "fetch"}`;
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    samples.push({ elapsedSeconds: elapsed, state });
    console.log(`  t+${elapsed}s state=${state}`);
    // "stopped"/"stopping" past sleepAfter is the failure signal (the session was reaped mid-edit).
    if (/stop/i.test(state) && elapsed > args.sleepAfterSeconds) {
      stoppedAt = elapsed;
      break;
    }
    await sleep(10000);
  }

  const survivedSeconds = samples.length ? samples[samples.length - 1].elapsedSeconds : 0;
  const pass = stoppedAt === null && survivedSeconds > args.sleepAfterSeconds * 2;
  console.log(
    pass
      ? `  PASS: session stayed alive ${survivedSeconds}s (> 2x sleepAfter=${args.sleepAfterSeconds}s) — alarm keep-alive holds.`
      : `  RESULT: stoppedAt=${stoppedAt ?? "n/a"}s survived=${survivedSeconds}s — inspect wrangler tail for keepAlive.renew / onActivityExpired.`,
  );
  return { ok: pass, stoppedAtSeconds: stoppedAt, survivedSeconds, sleepAfterSeconds: args.sleepAfterSeconds, samples };
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`Spike measurement against ${args.url} (mode=${args.mode})`);
  const results = { url: args.url, startedAt: new Date().toISOString(), mode: args.mode };

  if (args.mode === "coldstart" || args.mode === "both") {
    results.coldStart = await measureColdStart(args);
  }
  if (args.mode === "keepalive" || args.mode === "both") {
    results.keepAlive = await measureKeepAlive(args);
  }

  console.log(
    "\n=== coolwsd RSS curve (read OUT OF BAND) ===\n" +
      "  Not scripted here. Read the per-container memory metric from Workers observability while you\n" +
      "  open idle / +1 / +Nth / a heavy document, and record idle baseline, the per-document slope,\n" +
      "  and the heavy-document peak into README.md. That curve sets the instance_type.",
  );

  results.finishedAt = new Date().toISOString();
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(results, null, 2));
    console.log(`\nWrote ${args.out}`);
  }
  console.log("\n=== JSON ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
