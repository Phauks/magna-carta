# Spike — Collabora-on-Containers topology measurement

**Purpose:** measure the three numbers that parameterize the slice 2·2 build (warm-standby instance sizing, cold-start budget, and whether the keep-alive mitigation is real). Throwaway harness — deploy, measure, record the results below, then tear down. The production image + `DocumentSession` DO are built separately during the slice.

**Status: harness BUILT, deploying (2026-06-21).** Implemented as a standalone Worker in this directory: `worker.ts` (the `DocumentSession` DO that owns the container + the alarm keep-alive toggle + lifecycle logging), `wrangler.jsonc` (container + DO + vars), and `Dockerfile` + `start-spike.sh` (collabora/code with the local-filesystem backend + baked text docs). **Two simplifications vs. the research notes below:** (1) documents open via Collabora's **local-filesystem backend** (`cool.html?file_path=…`), so no WOPI-host stub is needed to measure coolwsd; (2) memory is read from **Cloudflare's per-container memory metric** (the number that actually sizes the instance) rather than an in-container `/proc` sidecar — the Debian base ships neither busybox nor pgrep, and container memory is the right sizing number anyway. The `wrangler` snippet + DO sketch below are **superseded by the committed files**; the protocol, prerequisites, risks, and results template still apply. The deploy-and-measure step is billable.

## The three numbers

1. **coolwsd RSS curve** — idle baseline / +1 document / +Nth document (the per-kit slope) / a heavy document. → sets the warm-standby `instance_type`.
2. **Cold-start** — request → coolwsd `/hosting/discovery` 200 → first document open. → sets the warm-standby pool depth + the open-latency budget.
3. **Keep-alive defeats sleep** — a control run (no keep-alive, expect the container to sleep mid-edit) vs a mitigation run (alarm-driven `renewActivityTimeout`, expect survival). → confirms or refutes the reliability design.

## Re-verified platform facts (2026-06-19)

- `@cloudflare/containers` confirms `renewActivityTimeout(): void`, `alarm(alarmProps?)`, `schedule(when, callback, payload?)`, `getState()`, `startAndWaitForPorts()`.
- **`cloudflare/containers#147` (WebSocket frames do not renew the activity timer) is STILL OPEN, no fix/PR.** The alarm-driven keep-alive is a community-inferred mitigation, not a published snippet — it MUST be proven empirically (steps 8–9), and the DO sketch re-validated against the exact installed package version (it may have quietly changed).
- SSH config is the **`ssh`** key (`wrangler_ssh` is a deprecated alias); SSH is enabled-by-default since 2026-05-12, but you still must add an `ssh-ed25519` key to `authorized_keys` to connect for the `/proc` probe.
- Custom instance types enforce **min 3 GiB memory per vCPU** and **max 2 GB disk per 1 GiB memory** (so a 1-vCPU custom box is floored at 3 GiB).
- There is **no `min_instances`/pre-warm config key** in public config — warm standbys are emulated by holding instances open with a long `sleepAfter`, not a knob.

## Prerequisites (billable / outward-facing — needs go-ahead)

- **Workers Paid plan** — Containers is Paid-only.
- Containers enabled on the account (confirm the `containers` config deploys).
- Account headroom under the per-account caps (6 TiB memory / 1,500 vCPU / 30 TB disk — trivially clear for ≤5 instances).
- Image storage ≤ 50 GB/account — `collabora/code` is ~537 MB; `wrangler containers delete` it after.
- An `ssh-ed25519` keypair; the public key in `authorized_keys`.
- **Container egress to the WOPI-host Worker origin must be permitted** (`Container.enableInternet`) — coolwsd makes an outbound HTTPS call for every CheckFileInfo/GetFile/PutFile; a no-egress posture fails 100% of opens.
- GraphQL Analytics access for `containersMetricsAdaptiveGroups` (confirm via introspection; may be plan-gated) — the `/proc` probe is primary regardless.
- A throwaway WOPI-host stub Worker + one fixed test `.docx` and one heavy `.docx` in R2 to drive real opens — **bytes never logged**.
- **Estimated cost: single-digit to low-tens of dollars** — a few `standard-1`/`standard-2` instances for a few hours; the ≥10 cold-start cycles + a 30–60 min keep-alive soak are the largest (still minor) line items. Confirm against the live containers/pricing page before quoting a firm figure.

## wrangler config

```jsonc
{
  // ... existing worker config ...
  "containers": [
    {
      "class_name": "DocumentSession",          // the per-document DO that owns the container
      "image": "./spikes/collabora-topology/Dockerfile",
      "max_instances": 5,                        // spike cap: idle / +1 / +Nth / heavy without burning budget
      // SPIKE sizing GUESS — coolwsd is ~537MB and spawns a jailed kit per document. standard-1
      // (1/2 vCPU, 4 GiB) is the start point; the RSS curve REPLACES this. If a heavy doc + N kits
      // exceeds 4 GiB, step up to standard-2 (6 GiB) / standard-3 (8 GiB). Custom boxes are floored
      // at 3 GiB/vCPU and max 2 GB disk per 1 GiB memory, e.g. {vcpu:1, memory_mib:4096, disk_mb:8000}.
      "instance_type": "standard-1",
      "ssh": { "enabled": true },
      "authorized_keys": [
        { "name": "spike-operator", "public_key": "ssh-ed25519 AAAA... <your-key>" }
      ]
    }
  ],
  "durable_objects": {
    "bindings": [{ "name": "DOCUMENT_SESSION", "class_name": "DocumentSession" }]
  },
  "migrations": [
    { "tag": "v-spike-1", "new_sqlite_classes": ["DocumentSession"] }  // container-backed DOs must be SQLite
  ],
  "observability": { "enabled": true }           // container stdout/stderr + DO logs → Workers Logs
}
```

## coolwsd config (Container `envVars` consumed by `--use-env-vars`, plus `extra_params` `--o:` flags)

- **`aliasgroup1`** = `https://<worker-wopi-host>:443` — the WOPI host allowlist (the Worker origin serving CheckFileInfo/GetFile/PutFile). Escape literal dots (`https://magna-carta-worker\.<acct>\.workers\.dev:443`); bad escaping is the #1 "Unauthorized WOPI host" cause.
- **`server_name`** = `<worker-wopi-host>` — the public hostname coolwsd advertises behind the TLS-terminating edge.
- **`extra_params`** = `--o:ssl.enable=false --o:ssl.termination=true` — Cloudflare terminates TLS at the edge; coolwsd must not do in-container TLS but must still emit `https://` URLs (`termination=true`).
- **`DONT_GEN_SSL_CERT`** = `1` — skip self-signed cert generation.
- **`username` / `password`** — admin console creds (spike-only — view live documents/memory at `/browser/dist/admin/admin.html`; remove after).
- **`dictionaries`** = `en_US en_GB` — trim the 11-locale spellcheck default to lower idle-RSS noise.
- **`extra_params` perf knobs:** `--o:per_document.num_prespawn_children=1` (one warm child); `--o:per_document.idle_timeout_secs=3600` (don't let coolwsd unload a doc mid-measurement — sleep is driven by Cloudflare's `sleepAfter`, not this); `--o:logging.color=false`.
- **Avoided:** `storage.filesystem allow` (WOPI only); `--privileged` (image uses file caps; a no-op here).
- **No-egress caveat:** coolwsd must reach `<worker-wopi-host>` over HTTPS or every open fails — and it verifies the host's TLS cert by default, so the stub needs a Cloudflare-issued cert (do not disable verification).

## `DocumentSession` keep-alive sketch — VERIFY before trusting

This is the community-inferred `#147` mitigation, not a Cloudflare-published snippet, and `#147` is still open. Re-validate against the installed `@cloudflare/containers` version (it may have changed `alarm`/`schedule`/`renew` behaviour, or quietly fixed WS renewal — in which case the keep-alive is moot). Logs carry timestamps/pids/integers only — never document bytes or tokens.

```typescript
import { Container } from "@cloudflare/containers";

export class DocumentSession extends Container<Env> {
  defaultPort = 9980;            // coolwsd port (TLS terminated at edge; container speaks http on 9980)
  sleepAfter = "60s";           // SPIKE: force the #147 window fast; production value is what the spike sets

  private static readonly KEEP_ALIVE_SECONDS = 30;  // < sleepAfter so a renew always lands first

  override async onStart() {
    console.log(JSON.stringify({ evt: "container.onStart", ts: Date.now() }));
    await this.armKeepAlive();   // real slice: arm only while a session has >=1 live participant
  }

  override async onStop(params: { exitCode: number; reason: string }) {
    console.log(JSON.stringify({ evt: "container.onStop", ts: Date.now(), ...params }));
  }

  override async onActivityExpired() {
    console.log(JSON.stringify({ evt: "container.onActivityExpired", ts: Date.now() }));
    return super.onActivityExpired();
  }

  private async armKeepAlive() {
    await this.schedule(DocumentSession.KEEP_ALIVE_SECONDS, "keepAlive");
  }

  async keepAlive() {
    this.renewActivityTimeout();   // no args; resets the deadline to now + sleepAfter
    console.log(JSON.stringify({ evt: "keepAlive.renew", ts: Date.now() }));
    await this.schedule(DocumentSession.KEEP_ALIVE_SECONDS, "keepAlive");  // re-arm
  }

  override fetch(request: Request): Promise<Response> {
    return super.fetch(request);   // WebSocket upgrade MUST go through fetch(), not containerFetch (HTTP-only)
  }
}
// #162 companion (a long single op killed mid-flight): before a known-long op, pre-extend then renew —
// `this.sleepAfter = estimatedSeconds + 30; this.renewActivityTimeout();`. The heavy-doc GetFile / version
// cut is the candidate long op to guard in the real slice.
```

## Measurement protocol

Prereqs done: image built/pushed (`wrangler deploy`), the DO + container deployed, an `ssh-ed25519` key in `authorized_keys`, observability on, and a throwaway WOPI-host stub reachable from the container.

1. **Enumerate the instance.** `wrangler containers instances <APPLICATION_ID> --json` → capture `id` (INSTANCE_ID), `state`, `location`, `version`. All SSH/GraphQL queries key off `id`.
2. **Idle RSS baseline (1A).** Zero documents open. Read coolwsd-tree RSS two ways: (a) `wrangler containers ssh <INSTANCE_ID> -- sh -c 'for p in $(pgrep coolwsd coolforkit coolkit); do awk "/VmRSS/{print \$2}" /proc/$p/status; done'` summed; (b) `containerFetch(<url>/__rss, 9981)` summing `vmrss_kib`. Agree within jitter; trust `/proc` if they diverge.
3. **+1 document (1B).** Open exactly one `.docx` session (real WOPI open → WebSocket → editor ready). Wait ~10 s, re-sample. Delta vs idle = per-first-document cost.
4. **+Nth document (1C — the curve).** Open documents 2,3,…,N (distinct fileIds → distinct kits). Sample after each. Stop at RSS plateau, the memory ceiling, OR CODE's built-in connection/document cap (**record which limit you hit**). Slope = per-additional-document cost.
5. **Heavy document (1D).** Close the others; open one large/complex `.docx` (many pages, images, tracked changes). Sample peak RSS at load and during editing.
6. **Cross-check the host aggregate.** `containersMetricsAdaptiveGroups` filtered by `instanceId`, bucketed `datetimeMinute`, `max.memory` + `quantiles.memoryP95`. Confirm it tracks the `/proc` peaks (it validates, not replaces).
7. **Cold-start (2).** From stopped: T0 = request arrives; T1 = `onStart()`; T2 = `startAndWaitForPorts()` returns; T3 = first 200 from `containerFetch('/hosting/discovery')`; T4 = first document fully open. Report startup (T2−T0), app-ready (T3−T0), full-first-doc (T4−T0). **Repeat ≥10 cold starts** (stop between) → median + p95 (image-pull variance dominates).
8. **Keep-alive CONTROL (3, baseline).** `sleepAfter='60s'`, keep-alive **disarmed**. Open a doc, drive continuous WebSocket editing >180 s. EXPECT failure: `onActivityExpired`/`onStop` logs, dropped WebSocket, `getState()` → `stopped` ~at `sleepAfter`. (This reproduces #147. If it does NOT fail, #147 is fixed in your version and the keep-alive is unnecessary.)
9. **Keep-alive MITIGATION (3, the proof).** Same `sleepAfter='60s'`, keep-alive **armed** (every 30 s). Same >180 s of editing. EXPECT survival: no `onActivityExpired`/`onStop`, WebSocket up, `getState()` `healthy` throughout, `keepAlive.renew` logs every ~30 s. Run once long (30–60 min) to catch a slow leak. Overhead = one in-DO call + one alarm write per interval (sub-ms, no container round-trip).
10. **Read out + record.** Write the three numbers into `docs/operating-costs.md` (replacing the "verify"-marked container rate) and the implementation plan; fill the results table below.
11. **Teardown.** Stop instances, `wrangler containers delete` the image, remove admin creds + the WOPI stub.

## Open risks (the spike must resolve)

- `#147` open with no fix — the README's "auto-renews on WebSocket" claim is contradicted by the shipped code; prove the mitigation empirically and re-validate the sketch against the installed version.
- Whether `schedule('keepAlive')` co-exists with the `Container` class's own default `alarm()`, or needs an `alarm()` override + `super` — confirm against the installed dist.
- CODE's built-in connection/document cap bounds the +Nth curve before memory does — record which limit; the RSS **slope** transfers to the licensed build, the absolute **N** does not.
- coolwsd verifies the WOPI host TLS cert — a self-signed stub cert fails opens silently; use a Cloudflare-issued cert.
- `busybox`/`pgrep`/`awk` presence in the CODE base is unverified — `which` on first boot; if absent, use the SSH `/proc` path (no sidecar).
- Cold-start spread is image-pull-dominated; the median+p95 over ≥10 runs may come in well above the "~1–3s" figure for a ~537 MB image on a cold edge.

## Results (fill after measuring) — and GO / NO-GO

| Number | Value |
| --- | --- |
| Idle RSS | _____ |
| +1 document delta | _____ |
| Per-additional-document slope | _____ |
| +N plateau / cap hit (which limit) | _____ |
| Heavy-document peak RSS | _____ |
| Chosen `instance_type` | _____ |
| Cold-start median / p95 (full-first-doc) | _____ |
| Warm-standby pool depth | _____ |
| Keep-alive CONTROL (expect sleep ~`sleepAfter`) | _____ |
| Keep-alive MITIGATION (expect survival) | _____ |
| **GO / NO-GO** | _____ |
