# Scan-policy `_SUSP_` score-histogram seam — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or
> superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expose the malware scanner's `_SUSP_` score histogram through a runtime API so the future
firm scan-policy custom-floor slider (Slice B2 UI) has a data source.

**Architecture:** Compute the histogram from the side-map already loaded in the scan container's
`AppState`; serve it at `GET /rules/score-histogram`; forward it through the scan-worker service binding;
expose a firm-gated `GET /api/v1/firm/scan-policy/score-histogram` on the app worker that returns a
no-engine empty shape wherever the scan engine is not deployed (every local/test env).

**Tech Stack:** Rust (axum 0.8, yara-x, serde) for the container; TypeScript (Hono, zod-openapi, Vitest,
Miniflare) for the workers.

## Global Constraints

- Tests run via `vp test` (NOT `pnpm exec vitest`); the full Miniflare worker suite OOMs — run one file
  at a time (`cd apps/worker && vp test run <name>`). Do NOT `cargo clean` (rustc cannot rebuild a fresh
  `memchr` on this box).
- `git add` explicit paths only (never `-A` — pre-existing formatter drift in unrelated files).
- Full-name discipline (golden rule 12); no process-artifact refs in code (golden rule 13,
  `node tooling/lint-process-references.mjs`).
- The live-engine path is CI/deploy-gated (no container locally); local tests cover the no-engine + authz
  paths only, consistent with all scan-engine work.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Shared `_SUSP_` score-histogram function (Rust)

**Files:**

- Modify: `containers/scan/src/yara.rs` (add the function + unit test)
- Modify: `containers/scan/src/bin/build-yara-rules.rs:211-225` (reuse it in the summary log)

**Produces:** `pub fn susp_score_histogram(scores: impl IntoIterator<Item = i32>) -> Vec<(i32, usize)>`
— returns `(bucket_floor, count)` pairs, ascending by floor, bucket = `(score / 5) * 5`, only for the
scores passed in (caller pre-filters to suspicious rules).

- [ ] **Step 1: Write the failing test** in `containers/scan/src/yara.rs` (tests module):

```rust
#[test]
fn susp_score_histogram_buckets_ascending_by_five() {
    // scores 40,41 -> [40], 47 -> [45], 75 -> [75]; empty input -> empty.
    let h = susp_score_histogram([41, 40, 75, 47]);
    assert_eq!(h, vec![(40, 2), (45, 1), (75, 1)]);
    assert!(susp_score_histogram(std::iter::empty::<i32>()).is_empty());
}
```

- [ ] **Step 2: Run it, expect failure** — `cargo test -p magna-carta-scan susp_score_histogram` → FAIL (function missing).

- [ ] **Step 3: Implement** in `containers/scan/src/yara.rs`:

```rust
/// Counts scores into 5-point buckets, ascending by inclusive floor (`(score / 5) * 5`). The caller
/// pre-filters to the suspicious (`_SUSP_`) rules whose score the firm's floor actually gates, so this
/// is the distribution the scan-policy custom-floor slider plots. Shared with build-yara-rules' summary
/// so the build log and the runtime endpoint never drift.
pub fn susp_score_histogram(scores: impl IntoIterator<Item = i32>) -> Vec<(i32, usize)> {
    let mut buckets: std::collections::BTreeMap<i32, usize> = std::collections::BTreeMap::new();
    for score in scores {
        *buckets.entry((score / 5) * 5).or_insert(0) += 1;
    }
    buckets.into_iter().collect()
}
```

- [ ] **Step 4: Reuse it in the summary** — replace the inline bucket loop at
      `containers/scan/src/bin/build-yara-rules.rs:211-225` so it calls
      `yara::susp_score_histogram(tagged.iter().filter(|r| r.is_suspicious).map(|r| r.score))` and prints each
      `(floor, count)` (the `suspicious_total` is the sum of counts). Keep the existing log wording.

- [ ] **Step 5: Run** — `cargo test -p magna-carta-scan susp_score_histogram` → PASS; `cargo build -p magna-carta-scan --bin build-yara-rules` compiles.

- [ ] **Step 6: Commit** — `git add containers/scan/src/yara.rs containers/scan/src/bin/build-yara-rules.rs` then commit `feat(scan): shared _SUSP_ score-histogram fn (build log + runtime reuse)`.

---

### Task 2: Container endpoint `GET /rules/score-histogram` (Rust)

**Files:**

- Modify: `containers/scan/src/lib.rs` (route + handler + response structs)
- Test: `containers/scan/src/lib.rs` tests module (a router test)

**Consumes:** `susp_score_histogram` (Task 1); `AppState { side_map, engine_version, .. }`.
**Produces:** route `GET /rules/score-histogram` returning JSON
`{ engineVersion: string, minScoreGate: number, total: number, buckets: [{ floor, count }] }`.

- [ ] **Step 1: Write the failing test** in `containers/scan/src/lib.rs`:

```rust
#[tokio::test]
async fn rules_score_histogram_returns_the_suspicious_distribution() {
    use axum::body::to_bytes;
    let mut side_map = yara::SideMap::new();
    side_map.insert("A".into(), yara::RuleMeta { tier: forge::Tier::Extended, score: 40, is_suspicious: true });
    side_map.insert("B".into(), yara::RuleMeta { tier: forge::Tier::Extended, score: 42, is_suspicious: true });
    side_map.insert("C".into(), yara::RuleMeta { tier: forge::Tier::Core, score: 90, is_suspicious: false });
    let state = test_state(side_map); // helper below builds AppState with empty rules + this side_map
    let response = score_histogram(axum::extract::State(state)).await.into_response();
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["total"], 2);                       // only the two suspicious rules
    assert_eq!(json["buckets"], serde_json::json!([{ "floor": 40, "count": 2 }]));
    assert_eq!(json["minScoreGate"], 75);
    assert!(json["engineVersion"].is_string());
}
```

(If a `test_state` helper does not already exist, add a minimal one that builds `AppState` with
`rules: Arc::new(<empty compiled rules>)`, the given `side_map`, a dummy `clamd_address`, default `caps`,
and `engine_version: Arc::from("engine/1+yara-rules/none+clamav-db/0")`. Reuse any existing test
constructor if present.)

- [ ] **Step 2: Run it, expect failure** — `cargo test -p magna-carta-scan rules_score_histogram` → FAIL.

- [ ] **Step 3: Implement** in `containers/scan/src/lib.rs` — add the structs, the handler, and the route:

```rust
#[derive(serde::Serialize)]
struct HistogramBucket {
    floor: i32,
    count: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ScoreHistogram {
    engine_version: String,
    min_score_gate: i32,
    total: usize,
    buckets: Vec<HistogramBucket>,
}

// The default suspicious-score floor, surfaced as a reference line for the firm slider (the same default
// the app's DEFAULT_SCAN_POLICY uses). Informational only — no rules are gated here.
const DEFAULT_SUSP_SCORE_GATE: i32 = 75;

// The `_SUSP_` score distribution of the baked corpus — static for this instance's lifetime. Computed
// from the side-map already in AppState (a single pass over ~10k entries, called only on a settings load).
async fn score_histogram(State(state): State<AppState>) -> Response {
    let buckets: Vec<HistogramBucket> = yara::susp_score_histogram(
        state.side_map.values().filter(|m| m.is_suspicious).map(|m| m.score),
    )
    .into_iter()
    .map(|(floor, count)| HistogramBucket { floor, count })
    .collect();
    let total = buckets.iter().map(|b| b.count).sum();
    Json(ScoreHistogram {
        engine_version: state.engine_version.to_string(),
        min_score_gate: DEFAULT_SUSP_SCORE_GATE,
        total,
        buckets,
    })
    .into_response()
}
```

Add to `router()`: `.route("/rules/score-histogram", get(score_histogram))`.

- [ ] **Step 4: Run** — `cargo test -p magna-carta-scan rules_score_histogram` → PASS; `cargo clippy -p magna-carta-scan -- -D warnings` clean.

- [ ] **Step 5: Commit** — `git add containers/scan/src/lib.rs` then commit `feat(scan): GET /rules/score-histogram serves the _SUSP_ distribution`.

---

### Task 3: scan-worker forward (TypeScript)

**Files:**

- Create: `apps/scan-worker/src/forward-histogram.ts`
- Modify: `apps/scan-worker/src/index.ts` (route the GET)
- Test: `apps/scan-worker/test/forward-histogram.test.ts`

**Consumes:** the container route (Task 2); `ScanContainerFetcher` from `./forward-scan.ts`.
**Produces:** `forwardHistogram(container: ScanContainerFetcher): Promise<Response>`.

- [ ] **Step 1: Write the failing test** `apps/scan-worker/test/forward-histogram.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { forwardHistogram } from "../src/forward-histogram.ts";

describe("forwardHistogram", () => {
  it("forwards GET /rules/score-histogram to the container and returns its response verbatim", async () => {
    let seen: string | undefined;
    const container = {
      fetch: async (request: Request) => {
        seen = new URL(request.url).pathname;
        return new Response(
          JSON.stringify({ engineVersion: "e", minScoreGate: 75, total: 0, buckets: [] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    };
    const response = await forwardHistogram(container);
    expect(seen).toBe("/rules/score-histogram");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ engineVersion: "e", total: 0 });
  });
});
```

- [ ] **Step 2: Run it, expect failure** — `cd apps/scan-worker && vp test run forward-histogram` → FAIL.

- [ ] **Step 3: Implement** `apps/scan-worker/src/forward-histogram.ts`:

```ts
import type { ScanContainerFetcher } from "./forward-scan.ts";

// Forward the histogram read to the scan Container and return its response verbatim. GET, no body.
// The service binding from the app worker is the trust boundary — this worker has no public routes.
export async function forwardHistogram(container: ScanContainerFetcher): Promise<Response> {
  const containerResponse = await container.fetch(
    new Request("http://scan/rules/score-histogram", { method: "GET" }),
  );
  return new Response(containerResponse.body, {
    status: containerResponse.status,
    statusText: containerResponse.statusText,
    headers: containerResponse.headers,
  });
}
```

Wire it in `apps/scan-worker/src/index.ts` — import it and, before the 404, add:

```ts
if (request.method === "GET" && url.pathname === "/rules/score-histogram") {
  return forwardHistogram(getContainer(env.SCAN_CONTAINER, "scan"));
}
```

- [ ] **Step 4: Run** — `cd apps/scan-worker && vp test run forward-histogram` → PASS.

- [ ] **Step 5: Commit** — `git add apps/scan-worker/src/forward-histogram.ts apps/scan-worker/src/index.ts apps/scan-worker/test/forward-histogram.test.ts` then commit `feat(scan-worker): forward GET /rules/score-histogram`.

---

### Task 4: App-worker firm route + contract (TypeScript)

**Files:**

- Modify: `apps/worker/src/routes/firm/scan-policy.ts` (add the GET sub-route)
- Test: `apps/worker/test/scan-policy.test.ts` (no-engine + authz)
- Regenerate: `apps/worker/openapi/openapi.json`, `packages/api-client/src/*`

**Consumes:** `env.SCAN_SERVICE` (the scan-worker service binding; `undefined` in every test env);
the route-meta + chokepoint pattern already used in `scan-policy.ts` / `scan-diagnose.ts`.
**Produces:** `GET /api/v1/firm/scan-policy/score-histogram` → `ScoreHistogramResponse`
`{ engineVersion: string | null, minScoreGate: number | null, total: number, buckets: {floor,count}[] }`.

- [ ] **Step 1: Write the failing tests** in `apps/worker/test/scan-policy.test.ts`:

```ts
it("score-histogram returns the no-engine empty shape (200) when no engine is deployed", async () => {
  const { userId } = await seedCredentialedUser("hist-owner@example.com", {
    userName: "Hist Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(userId, "Hist Owner", poolFirmId);
  const cookie = await signInForSessionCookie("hist-owner@example.com");
  const response = await SELF.fetch("https://example.com/api/v1/firm/scan-policy/score-histogram", {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    engineVersion: null,
    minScoreGate: null,
    total: 0,
    buckets: [],
  });
});

it("score-histogram returns 403 for a member without firm:manageScanPolicy", async () => {
  await seedCredentialedUser("hist-noperm@example.com", {
    userName: "No Perm",
    firmId: poolFirmId,
  });
  const cookie = await signInForSessionCookie("hist-noperm@example.com");
  const response = await SELF.fetch("https://example.com/api/v1/firm/scan-policy/score-histogram", {
    headers: { cookie },
  });
  expect(response.status).toBe(403);
});
```

- [ ] **Step 2: Run them, expect failure** — `cd apps/worker && vp test run scan-policy` → the two new tests FAIL (404/route missing).

- [ ] **Step 3: Implement** the route in `apps/worker/src/routes/firm/scan-policy.ts`. Define the response zod
      schema (camelCase, `engineVersion`/`minScoreGate` nullable), a `RouteMeta`
      (`operationId: "firm.scanPolicy.scoreHistogram"`, `surface: "app"`, `authenticated: true`,
      `permission: "firm:manageScanPolicy"`, `resource: "firm"`, `audited: false`, `idempotency: "optional"`,
      `rateLimit: "default"`), and the handler:

```ts
const EMPTY_HISTOGRAM = { engineVersion: null, minScoreGate: null, total: 0, buckets: [] } as const;

// handler body:
const scanService = c.env.SCAN_SERVICE;
if (scanService === undefined) {
  // No engine deployed (every local/test env, and before the scan worker is wired in prod): the slider
  // renders unbounded/disabled rather than erroring. Never fabricate buckets.
  return c.json(EMPTY_HISTOGRAM, 200);
}
const upstream = await scanService.fetch("http://scan/rules/score-histogram");
if (!upstream.ok) {
  // A deployed-but-unreachable engine is a real fault — surface it through the standard error path,
  // not a fabricated empty (mirrors the never-silently-clean posture).
  throw new Error(`scan service returned status ${upstream.status}`);
}
return c.json(await upstream.json(), 200);
```

Register the route with `defineOpenAPIRoute` exactly as the existing GET `/scan-policy` route in this file
does (mirror its chokepoint middleware + response wiring). Confirm `SCAN_SERVICE` is in `Bindings`
(`apps/worker/src/app.ts`) — it is (used by `resolveScanPort`).

- [ ] **Step 4: Run** — `cd apps/worker && vp test run scan-policy` → all PASS.

- [ ] **Step 5: Regenerate the contract** — from repo root:
      `pnpm --filter @magna-carta/worker run emit-openapi && pnpm run generate-client`.
      Then `cd apps/worker && vp test run conformance` → PASS (snapshot in sync).

- [ ] **Step 6: Commit** — `git add apps/worker/src/routes/firm/scan-policy.ts apps/worker/test/scan-policy.test.ts apps/worker/openapi/openapi.json packages/api-client/src` then commit `feat(scan-policy): GET firm/scan-policy/score-histogram (no-engine-graceful)`.

---

### Task 5: Docs + final gate

**Files:**

- Create: `changelog.d/scan-policy-histogram-seam.md`
- Modify: `STATUS.md` (the 2·1 scan row only — note the seam built, B2 UI deferred)

- [ ] **Step 1: Changelog fragment** `changelog.d/scan-policy-histogram-seam.md`:

```markdown
- **Scan policy:** the malware scanner's `_SUSP_` score distribution is now retrievable at runtime
  (`GET /api/v1/firm/scan-policy/score-histogram`, scan engine permission), surfacing the build-time
  histogram so the firm scan-policy custom score-floor control has a data source.
```

- [ ] **Step 2: STATUS.md** — append a sentence to the 2·1 row noting the histogram seam is built and the
      B2 settings UI remains deferred to the design system. Edit only that row.

- [ ] **Step 3: Gate** — run, confirming only our files:
  - `node tooling/lint-process-references.mjs` → clean.
  - `vp check --fix` on the touched TS files; `cargo fmt -p magna-carta-scan` + `cargo clippy -p magna-carta-scan -- -D warnings`.
  - Re-run `vp test run scan-policy`, `vp test run forward-histogram`, `cargo test -p magna-carta-scan` (histogram tests).

- [ ] **Step 4: Commit** — `git add changelog.d/scan-policy-histogram-seam.md STATUS.md` then commit `docs(scan-policy): changelog + status for the histogram seam`.

---

## Self-review

- **Spec coverage:** container fn (T1) + endpoint (T2) + scan-worker forward (T3) + firm route & contract
  (T4) + docs (T5) cover every section of the design. The deferred B2 UI is explicitly out of scope.
- **No-engine path:** T4 returns the design's `{engineVersion:null, minScoreGate:null, total:0, buckets:[]}`
  at 200; the container always returns a non-null `engineVersion` + `minScoreGate:75`, so only the worker's
  no-engine branch nulls them — consistent with the TS contract.
- **Type consistency:** `floor`/`count`/`total`/`engineVersion`/`minScoreGate`/`buckets` identical across
  the Rust serde struct (camelCase), the zod schema, and the tests.
- **Pre-push (CI) gates:** the linux `cfg(unix)` container build + the live-engine path (container deployed)
  remain CI/deploy-gated; local covers the fn, the route over a synthetic side-map, the forward, and the
  worker no-engine + authz paths.
