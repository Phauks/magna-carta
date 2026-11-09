# Pangram Endpoint Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the platform-managed Pangram adapter to the real v3 API — support BOTH the async external-api task-poll flow and the synchronous flow behind one config switch, fix the base URL and the `stage`→provenance bug — so the correct surface is a one-setting selection once the test key confirms which it is provisioned for.

**Architecture:** The pure `@magna-carta/ai-detection` package stays network-free and timer-free: the adapter takes a `mode` (`"async-task" | "sync"`) plus an injected `sleep` seam (the worker supplies a real `setTimeout`-based sleep; tests supply an instant one). Async mode submits to `POST {baseUrl}/task`, reads a `task_id`, then polls `GET {baseUrl}/task/{task_id}` until the `stage` field reaches a terminal state. Sync mode `POST`s to `{baseUrl}` and reads the prediction directly. Both map the SAME terminal prediction body (`fraction_ai`, `windows[]`, `version`) through the existing `normalize()`.

**Tech Stack:** TypeScript, the pure `@magna-carta/ai-detection` package (hand-rolled validation, no zod in the parser), Cloudflare Workers + Hono route wiring, Vitest.

## Global Constraints

Every task's requirements implicitly include this section.

- **Purity (pure package):** `@magna-carta/ai-detection/src` imports only relative paths or the existing allowlist (`packages/ai-detection/test/purity.test.ts`): `@magna-carta/integrations/{dispatch,problem,port,manifest,http}`, `@magna-carta/data-access/setting-statements`, `@magna-carta/identifiers/types`, `zod` (settings only). **Do NOT add new imports.** No network, no `Date.now()`, no `setTimeout` in the pure package — the network is the injected `HttpClient`, the clock is the injected `now`, and the delay is the injected `sleep`.
- **Never leak the analyzed text or any raw upstream response body** into an error `detail`. Every failure is an `adapterError(integrationProblem(category, status, title, { detail }))` with a generic detail (the existing pattern).
- **Signal, not proof stays intact:** the adapter only maps vendor→`RawDetection` and calls `normalize()`. Do not add a boolean verdict, do not use Pangram's own `headline`/`prediction_short` label as the verdict.
- **`public_dashboard_link: false`** on every submit (never create a public link for privileged content).
- **Provenance fix:** map the vendor model `version` (e.g. `"3.3"`) to `vendorVersion`. The `stage` field is the task lifecycle state (`STAGE_SUCCESS`/`STAGE_FAILED`/pending), NOT a model version — it must NOT appear in provenance.
- **Verified API facts (from the Pangram v3 docs):**
  - Auth header `x-api-key: <key>`; `Content-Type: application/json`.
  - Request body `{ "text": string, "public_dashboard_link": false }`.
  - **Async external-api** (`https://text.external-api.pangram.com`): `POST /task` → `{ "task_id": "..." }`; poll `GET /task/{task_id}` → body carries `stage` (`"STAGE_SUCCESS"` | `"STAGE_FAILED"` | a non-terminal/absent value while processing) plus, on success, the terminal prediction fields.
  - **Sync** (`https://text.api.pangram.com/v3`): `POST` returns the terminal prediction body directly; no batch endpoint.
  - Terminal prediction fields we consume: `fraction_ai` (0..1), `fraction_ai_assisted` (0..1), `version` (string), `windows[]` each `{ start_index, end_index, ai_assistance_score (0..1), confidence? (0..1) }`. **Window indices are character-based.** (The response also carries `headline`/`prediction`/`prediction_short`/`fraction_human`/`num_*_segments`/per-window `text`/`label`/`word_count`/`token_length` — we deliberately ignore these; the parser ignores unknown fields.)
- **Full names, no shorthand; no process-doc refs** (ADR-N / spec §N / slice N) in source or tests.
- **Working directory:** the worktree `C:/dev/magna-carta-worktrees/pangram-endpoint` (branch `pangram-endpoint`, off `main`).
- **Test commands:** package — `pnpm --filter @magna-carta/ai-detection test` (NOT `test run` — that mis-filters vitest in this repo); worker focused — `pnpm --filter @magna-carta/worker exec vp test run <pattern>`.

---

## File Structure

- `packages/ai-detection/src/adapters/pangram-response.ts` (extend) — add the async submit parse (`parsePangramSubmit`) and a discriminated task-status parse (`parsePangramTaskStatus`) driven by `stage`. Keep `parsePangramResponse` (the terminal/sync prediction parse) unchanged.
- `packages/ai-detection/src/adapters/pangram.ts` (rewrite) — add `mode` + `sleep` + poll config to `PangramAdapterConfig`; extract shared HTTP + mapping helpers; implement the sync and async flows; fix provenance.
- `packages/ai-detection/test/pangram-response.test.ts` (extend) — submit + task-status parse tests.
- `packages/ai-detection/test/pangram.test.ts` (extend/adjust) — sync flow (adapt existing), async submit/poll flow, provenance, timeout.
- `apps/worker/src/routes/files/ai-detection.ts` (modify) — construct the adapter with `mode`, per-mode default base URL, and an injected real `sleep`.
- `apps/worker/src/app.ts` (modify) — add `PANGRAM_MODE?` binding.
- `apps/worker/wrangler.jsonc` (modify) — default `PANGRAM_BASE_URL` to the async external-api host; document the sync alternative.
- Docs: `changelog.d/pangram-endpoint.md`, `docs/decisions/pending/pangram-endpoint-dual-mode.md`.

---

## Task 1: Async submit + task-status parsing (pure)

**Files:**

- Modify: `packages/ai-detection/src/adapters/pangram-response.ts`
- Test: `packages/ai-detection/test/pangram-response.test.ts`

**Interfaces:**

- Consumes: existing `parsePangramResponse(json): PangramPrediction | null`, `PangramPrediction`.
- Produces:
  - `parsePangramSubmit(json: unknown): { readonly taskId: string } | null` — reads the async submit response's `task_id`.
  - `type PangramTaskStatus = { kind: "success"; prediction: PangramPrediction } | { kind: "failed" } | { kind: "pending" } | { kind: "malformed" }`.
  - `parsePangramTaskStatus(json: unknown): PangramTaskStatus` — branches on the `stage` field.

- [ ] **Step 1: Write the failing tests**

Append to `packages/ai-detection/test/pangram-response.test.ts`:

```typescript
import { parsePangramSubmit, parsePangramTaskStatus } from "../src/adapters/pangram-response.ts";

describe("parsePangramSubmit", () => {
  it("reads task_id from the async submit response", () => {
    expect(parsePangramSubmit({ task_id: "abc123" })).toEqual({ taskId: "abc123" });
  });
  it("returns null when task_id is missing or non-string", () => {
    expect(parsePangramSubmit({})).toBeNull();
    expect(parsePangramSubmit({ task_id: 5 })).toBeNull();
    expect(parsePangramSubmit(null)).toBeNull();
  });
});

describe("parsePangramTaskStatus", () => {
  it("returns success with the prediction when stage is STAGE_SUCCESS and the body is valid", () => {
    const status = parsePangramTaskStatus({
      stage: "STAGE_SUCCESS",
      fraction_ai: 0.9,
      version: "3.3",
    });
    expect(status.kind).toBe("success");
    if (status.kind !== "success") return;
    expect(status.prediction.fraction_ai).toBe(0.9);
    expect(status.prediction.version).toBe("3.3");
  });
  it("returns failed when stage is STAGE_FAILED", () => {
    expect(parsePangramTaskStatus({ stage: "STAGE_FAILED" }).kind).toBe("failed");
  });
  it("returns pending for a non-terminal or absent stage", () => {
    expect(parsePangramTaskStatus({ stage: "STAGE_PROCESSING" }).kind).toBe("pending");
    expect(parsePangramTaskStatus({}).kind).toBe("pending");
  });
  it("returns malformed for a non-object, or STAGE_SUCCESS with an invalid prediction", () => {
    expect(parsePangramTaskStatus(null).kind).toBe("malformed");
    expect(parsePangramTaskStatus("nope").kind).toBe("malformed");
    expect(parsePangramTaskStatus({ stage: "STAGE_SUCCESS", fraction_ai: 5 }).kind).toBe(
      "malformed",
    );
    expect(parsePangramTaskStatus({ stage: "STAGE_SUCCESS" }).kind).toBe("malformed");
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @magna-carta/ai-detection exec vitest run pangram-response`
Expected: FAIL — `parsePangramSubmit` / `parsePangramTaskStatus` not exported.

- [ ] **Step 3: Implement the parsers**

Append to `packages/ai-detection/src/adapters/pangram-response.ts` (after `parsePangramResponse`):

```typescript
// The async external-api submit response — a task handle to poll. `task_id` is the only field we need.
export function parsePangramSubmit(json: unknown): { readonly taskId: string } | null {
  if (!isRecord(json)) return null;
  if (typeof json.task_id !== "string") return null;
  return { taskId: json.task_id };
}

// A poll response's meaning, driven by the task lifecycle `stage` field. STAGE_SUCCESS carries the
// terminal prediction (validated the same way as the sync body); STAGE_FAILED is a terminal failure;
// any other/absent stage means the task is still running (keep polling). A non-object — or a claimed
// success whose prediction does not validate — is malformed.
export type PangramTaskStatus =
  | { readonly kind: "success"; readonly prediction: PangramPrediction }
  | { readonly kind: "failed" }
  | { readonly kind: "pending" }
  | { readonly kind: "malformed" };

export function parsePangramTaskStatus(json: unknown): PangramTaskStatus {
  if (!isRecord(json)) return { kind: "malformed" };
  const stage = typeof json.stage === "string" ? json.stage : undefined;
  if (stage === "STAGE_FAILED") return { kind: "failed" };
  if (stage === "STAGE_SUCCESS") {
    const prediction = parsePangramResponse(json);
    return prediction === null ? { kind: "malformed" } : { kind: "success", prediction };
  }
  return { kind: "pending" };
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm --filter @magna-carta/ai-detection exec vitest run pangram-response`
Expected: PASS (all existing + the new submit/task-status tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ai-detection/src/adapters/pangram-response.ts packages/ai-detection/test/pangram-response.test.ts
git commit -m "feat(ai-detection): parse Pangram async submit + task-status responses"
```

---

## Task 2: Dual-mode adapter + provenance fix (pure)

**Files:**

- Modify: `packages/ai-detection/src/adapters/pangram.ts`
- Test: `packages/ai-detection/test/pangram.test.ts`

**Interfaces:**

- Consumes: `parsePangramResponse`, `parsePangramSubmit`, `parsePangramTaskStatus`, `PangramPrediction` (Task 1); `normalize`, `AiTextDetectionPort`, `RawDetection`, `RawSegment`, `HttpClient`, `HttpResponse`, `ok`, `adapterError`, `integrationProblem`.
- Produces:
  - `type PangramMode = "async-task" | "sync"`.
  - `PangramAdapterConfig` gains: `readonly mode: PangramMode`, `readonly sleep: (milliseconds: number) => Promise<void>`, `readonly pollIntervalMs?: number` (default 750), `readonly maxPollAttempts?: number` (default 16).
  - `createPangramAdapter(config): AiTextDetectionPort` (unchanged signature name).

- [ ] **Step 1: Rewrite the adapter**

Replace the entire body of `packages/ai-detection/src/adapters/pangram.ts` with:

```typescript
import { adapterError, ok, type Dispatch } from "@magna-carta/integrations/dispatch";
import type { HttpClient, HttpResponse } from "@magna-carta/integrations/http";
import { integrationProblem } from "@magna-carta/integrations/problem";
import type { AiTextDetectionPort, DetectionInput, RawDetection, RawSegment } from "../port.ts";
import type { DetectionReport } from "../report.ts";
import { normalize } from "../normalize.ts";
import {
  parsePangramResponse,
  parsePangramSubmit,
  parsePangramTaskStatus,
  type PangramPrediction,
} from "./pangram-response.ts";

// The platform-managed Pangram adapter. It calls Pangram over the injected HttpClient (the pure
// package never touches the network itself), validates the response at the boundary, maps it to the
// vendor-neutral RawDetection, and hands that to normalize() — the framing (band/reliability/caveats)
// is ours. The API key is injected at construction (a platform secret, not a per-firm credential).
// Pangram exposes two surfaces with the SAME request/response fields: an async external-api that
// returns a task to poll, and a synchronous endpoint. `mode` selects which; the poll delay is an
// injected `sleep` so the pure package stays timer-free. Errors surface as an adapter-error dispatch
// whose detail never echoes the analyzed text or any raw upstream response body.
export type PangramMode = "async-task" | "sync";

export interface PangramAdapterConfig {
  readonly http: HttpClient;
  readonly apiKey: string;
  readonly baseUrl: string; // async: the external-api host; sync: the full endpoint (a binding, not a code constant)
  readonly mode: PangramMode;
  readonly now: () => string; // ISO-8601 instant; the pure core never calls Date.now()
  readonly sleep: (milliseconds: number) => Promise<void>; // the pure core never calls setTimeout
  readonly pollIntervalMs?: number;
  readonly maxPollAttempts?: number;
}

const ADAPTER_ID = "pangram";
const EGRESSED_TO = "pangram";
const DEFAULT_POLL_INTERVAL_MS = 750;
const DEFAULT_MAX_POLL_ATTEMPTS = 16;

function jsonHeaders(apiKey: string): Readonly<Record<string, string>> {
  return { "content-type": "application/json", "x-api-key": apiKey };
}

function requestBody(text: string): string {
  return JSON.stringify({ text, public_dashboard_link: false });
}

// The three generic failure problems, built once. Detail is always generic — never the text or an
// upstream body.
function networkProblem() {
  return integrationProblem("network", 502, "Detection provider unreachable", {
    detail: "The detection provider could not be reached.",
  });
}
function upstreamStatusProblem(status: number) {
  return integrationProblem("upstream", 502, "Detection provider error", {
    detail: `The detection provider returned status ${status}.`,
  });
}
function unexpectedResponseProblem() {
  return integrationProblem("upstream", 502, "Unexpected detection response", {
    detail: "The detection provider returned an unexpected response shape.",
  });
}

// A single HTTP round-trip that returns either the decoded JSON body or a typed failure. Centralizes
// the transport-throw / non-2xx / undecodable-body handling shared by submit, poll, and sync.
type FetchResult =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly dispatch: Dispatch<never> };

async function fetchJson(
  http: HttpClient,
  request: {
    method: "GET" | "POST";
    url: string;
    headers: Readonly<Record<string, string>>;
    body?: string;
  },
): Promise<FetchResult> {
  let response: HttpResponse;
  try {
    response = await http.request(request);
  } catch {
    return { ok: false, dispatch: adapterError(networkProblem()) };
  }
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, dispatch: adapterError(upstreamStatusProblem(response.status)) };
  }
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, dispatch: adapterError(unexpectedResponseProblem()) };
  }
}

function toSegments(prediction: PangramPrediction): readonly RawSegment[] | undefined {
  if (prediction.windows === undefined) return undefined;
  return prediction.windows.map((window) => ({
    startCharacter: window.start_index,
    endCharacter: window.end_index,
    score: window.ai_assistance_score,
  }));
}

// The lowest per-window confidence is the adapter's vendorConfidence: one weak window undercuts the
// whole result, which is the conservative reading the caveat layer wants.
function minWindowConfidence(prediction: PangramPrediction): number | undefined {
  const confidences = (prediction.windows ?? [])
    .map((window) => window.confidence)
    .filter((value): value is number => value !== undefined);
  return confidences.length > 0 ? Math.min(...confidences) : undefined;
}

function toRawDetection(prediction: PangramPrediction): RawDetection {
  const vendorConfidence = minWindowConfidence(prediction);
  const segments = toSegments(prediction);
  const paraphraseSuspected =
    prediction.fraction_ai_assisted !== undefined && prediction.fraction_ai_assisted > 0;
  return {
    score: prediction.fraction_ai,
    ...(vendorConfidence !== undefined ? { vendorConfidence } : {}),
    // `version` is the vendor model version (e.g. "3.3"). `stage` is the task lifecycle state, NOT a
    // model version, so it never enters provenance.
    ...(prediction.version !== undefined ? { vendorVersion: prediction.version } : {}),
    ...(segments !== undefined ? { segments } : {}),
    ...(paraphraseSuspected ? { signals: { paraphraseSuspected: true } } : {}),
  };
}

function mapPrediction(input: DetectionInput, prediction: PangramPrediction, now: () => string) {
  return ok(
    normalize(input, toRawDetection(prediction), {
      adapterId: ADAPTER_ID,
      detectedAt: now(),
      egressedTo: EGRESSED_TO,
    }),
  );
}

// Sync: one POST returns the terminal prediction body directly.
async function detectSync(
  config: PangramAdapterConfig,
  input: DetectionInput,
): Promise<Dispatch<DetectionReport>> {
  const result = await fetchJson(config.http, {
    method: "POST",
    url: config.baseUrl,
    headers: jsonHeaders(config.apiKey),
    body: requestBody(input.text),
  });
  if (!result.ok) return result.dispatch;
  const prediction = parsePangramResponse(result.body);
  if (prediction === null) return adapterError(unexpectedResponseProblem());
  return mapPrediction(input, prediction, config.now);
}

// Async: POST /task returns a task_id; poll GET /task/{id} until the stage is terminal (or attempts
// run out). A pending status waits `sleep(pollIntervalMs)` and retries; failed/malformed/exhausted
// all surface as adapter-error with no text leak.
async function detectAsync(
  config: PangramAdapterConfig,
  input: DetectionInput,
): Promise<Dispatch<DetectionReport>> {
  const submitResult = await fetchJson(config.http, {
    method: "POST",
    url: `${config.baseUrl}/task`,
    headers: jsonHeaders(config.apiKey),
    body: requestBody(input.text),
  });
  if (!submitResult.ok) return submitResult.dispatch;
  const submitted = parsePangramSubmit(submitResult.body);
  if (submitted === null) return adapterError(unexpectedResponseProblem());

  const interval = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = config.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  const pollUrl = `${config.baseUrl}/task/${submitted.taskId}`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pollResult = await fetchJson(config.http, {
      method: "GET",
      url: pollUrl,
      headers: jsonHeaders(config.apiKey),
    });
    if (!pollResult.ok) return pollResult.dispatch;
    const status = parsePangramTaskStatus(pollResult.body);
    if (status.kind === "success") return mapPrediction(input, status.prediction, config.now);
    if (status.kind === "failed" || status.kind === "malformed") {
      return adapterError(unexpectedResponseProblem());
    }
    // pending — wait and poll again, unless this was the last attempt.
    if (attempt < maxAttempts - 1) await config.sleep(interval);
  }
  return adapterError(
    integrationProblem("upstream", 502, "Detection timed out", {
      detail: "The detection provider did not return a result in time.",
    }),
  );
}

export function createPangramAdapter(config: PangramAdapterConfig): AiTextDetectionPort {
  return {
    async detect(input: DetectionInput): Promise<Dispatch<DetectionReport>> {
      return config.mode === "sync" ? detectSync(config, input) : detectAsync(config, input);
    },
  };
}
```

- [ ] **Step 2: Update the existing tests to the new config + add flow tests**

Replace the `adapter()` helper and add flow tests in `packages/ai-detection/test/pangram.test.ts`. First, update the helper so existing sync-shaped tests pass `mode: "sync"` + an instant `sleep`:

```typescript
function adapter(
  client: HttpClient,
  overrides: Partial<Parameters<typeof createPangramAdapter>[0]> = {},
) {
  return createPangramAdapter({
    http: client,
    apiKey: "test-key",
    baseUrl: "https://pangram.example",
    mode: "sync",
    now: () => AT,
    sleep: async () => {},
    ...overrides,
  });
}
```

The six existing tests already exercise the sync path (a single POST returning the terminal body) — they keep passing unchanged against `mode: "sync"`. Add async-flow tests:

```typescript
// A queue-backed HttpClient: each call returns the next scripted response; POST vs GET is asserted by
// the caller. Records the requests so we can assert the submit URL and the poll URL.
function scriptedClient(responses: HttpResponse[]): {
  client: HttpClient;
  requests: HttpRequest[];
} {
  const requests: HttpRequest[] = [];
  let i = 0;
  return {
    requests,
    client: {
      async request(req) {
        requests.push(req);
        const response = responses[i];
        i += 1;
        if (response === undefined) throw new Error("no scripted response");
        return response;
      },
    },
  };
}

describe("createPangramAdapter.detect — async task flow", () => {
  it("submits, polls past a pending status, and maps the terminal prediction", async () => {
    const { client, requests } = scriptedClient([
      jsonResponse(200, { task_id: "task-1" }),
      jsonResponse(200, { stage: "STAGE_PROCESSING" }),
      jsonResponse(200, { stage: "STAGE_SUCCESS", fraction_ai: 0.95, version: "3.3" }),
    ]);
    let slept = 0;
    const port = adapter(client, {
      mode: "async-task",
      sleep: async () => {
        slept += 1;
      },
    });
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.band).toBe("likely");
    expect(result.value.provenance.vendorVersion).toBe("3.3"); // version, not stage
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("https://pangram.example/task");
    expect(requests[1]?.method).toBe("GET");
    expect(requests[1]?.url).toBe("https://pangram.example/task/task-1");
    expect(slept).toBe(1); // waited once between the pending poll and the success poll
  });

  it("returns adapter-error when the task reports STAGE_FAILED", async () => {
    const { client } = scriptedClient([
      jsonResponse(200, { task_id: "task-2" }),
      jsonResponse(200, { stage: "STAGE_FAILED" }),
    ]);
    const port = adapter(client, { mode: "async-task" });
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("adapter-error");
    expect(result.problem?.status).toBe(502);
  });

  it("returns adapter-error when the submit response has no task_id", async () => {
    const { client } = scriptedClient([jsonResponse(200, { not_a_task: true })]);
    const port = adapter(client, { mode: "async-task" });
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("adapter-error");
  });

  it("times out (adapter-error) when the task never reaches a terminal stage", async () => {
    const pending = () => jsonResponse(200, { stage: "STAGE_PROCESSING" });
    const { client } = scriptedClient([
      jsonResponse(200, { task_id: "task-3" }),
      pending(),
      pending(),
    ]);
    const port = adapter(client, {
      mode: "async-task",
      sleep: async () => {},
      maxPollAttempts: 2,
    });
    const result = await port.detect({ text: "secret privileged content", firmId: FIRM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("adapter-error");
    expect(result.problem?.status).toBe(502);
    expect(JSON.stringify(result)).not.toContain("secret privileged content");
  });
});
```

Also, in the FIRST existing test (`maps a clean-AI response...`), update the provenance assertion: the terminal body `{ fraction_ai: 0.95, version: "v3", stage: "production" }` now maps `version` → `vendorVersion` and drops `stage`. Add:

```typescript
expect(result.value.provenance.vendorVersion).toBe("v3");
expect(result.value.provenance.vendorModel).toBeUndefined();
```

- [ ] **Step 3: Run the package suite, verify green**

Run: `pnpm --filter @magna-carta/ai-detection test`
Expected: PASS — all existing tests (adapted to `mode: "sync"`) + the new async-flow tests + the Task 1 parser tests + purity.

- [ ] **Step 4: Commit**

```bash
git add packages/ai-detection/src/adapters/pangram.ts packages/ai-detection/test/pangram.test.ts
git commit -m "feat(ai-detection): dual-mode Pangram adapter (async task-poll + sync) + provenance fix"
```

---

## Task 3: Worker wiring — mode + base URL + injected sleep

**Files:**

- Modify: `apps/worker/src/routes/files/ai-detection.ts`, `apps/worker/src/app.ts`, `apps/worker/wrangler.jsonc`

**Interfaces:**

- Consumes: `createPangramAdapter` with the new `mode`/`sleep`/poll config (Task 2).

**Reference — current adapter construction in `ai-detection.ts` (post-consent-and-key-gate):**

```typescript
const port = createPangramAdapter({
  http: fetchHttpClient(),
  apiKey,
  baseUrl: c.env.PANGRAM_BASE_URL ?? "https://text.api.pangram.com",
  now: () => new Date().toISOString(),
});
```

- [ ] **Step 1: Add the mode binding**

In `apps/worker/src/app.ts` `Bindings`, beside `PANGRAM_API_KEY` / `PANGRAM_BASE_URL`, add:

```typescript
  // Which Pangram surface the platform key is provisioned for: "async-task" (the external-api that
  // returns a task to poll) or "sync". Optional; defaults to "async-task". A public config value, not
  // a secret — bound via wrangler vars.
  PANGRAM_MODE?: "async-task" | "sync";
```

- [ ] **Step 2: Wire mode + per-mode base URL + a real sleep in the route**

In `apps/worker/src/routes/files/ai-detection.ts`, replace the adapter construction with:

```typescript
const mode = c.env.PANGRAM_MODE === "sync" ? ("sync" as const) : ("async-task" as const);
const defaultBaseUrl =
  mode === "sync" ? "https://text.api.pangram.com/v3" : "https://text.external-api.pangram.com";
const port = createPangramAdapter({
  http: fetchHttpClient(),
  apiKey,
  baseUrl: c.env.PANGRAM_BASE_URL ?? defaultBaseUrl,
  mode,
  now: () => new Date().toISOString(),
  // The poll delay lives here (the pure adapter is timer-free). A queued microtask timer is
  // enough — polling is I/O wait between fetches, not CPU.
  sleep: (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
});
```

Add the import if `createPangramAdapter` is not already imported (it is). No other route logic changes — the consent gate, the no-key 422, the failure mapping (`adapter-error` → 502), and the metering write are unchanged.

- [ ] **Step 3: Default the base URL var in wrangler**

In `apps/worker/wrangler.jsonc` `vars`, change the `PANGRAM_BASE_URL` value to the async external-api host and rely on `PANGRAM_MODE` defaulting to async:

```jsonc
"PANGRAM_BASE_URL": "https://text.external-api.pangram.com",
```

(If a `PANGRAM_MODE` var is added later for the sync surface, also set `PANGRAM_BASE_URL` to `https://text.api.pangram.com/v3`. Leave `PANGRAM_MODE` unset in wrangler for now — the route defaults to async.)

- [ ] **Step 4: Typecheck + run the route tests**

Run: `pnpm --filter @magna-carta/worker exec vp test run ai-detection-route`
Expected: PASS — the three existing route tests are unaffected (consent-off → 422; no permission → 403; consent-on-but-no-key → 422; still no network call, since the key is absent in tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/files/ai-detection.ts apps/worker/src/app.ts apps/worker/wrangler.jsonc
git commit -m "feat(worker): select Pangram mode + base URL; inject the poll sleep"
```

---

## Task 4: Docs + verification

**Files:**

- Create: `changelog.d/pangram-endpoint.md`, `docs/decisions/pending/pangram-endpoint-dual-mode.md`

- [ ] **Step 1: Changelog fragment**

Match the repo's fragment convention (frontmatter `category:` + body — read a sibling in `changelog.d/`). Content notes that AI-text detection now speaks the real Pangram v3 API (async task-poll + a sync option, selectable) — user-facing, no process refs.

- [ ] **Step 2: ADR fragment**

Create `docs/decisions/pending/pangram-endpoint-dual-mode.md` matching the sibling ADR format (read `docs/decisions/pending/ai-detection-pangram-adapter.md`). Decision: the adapter supports both Pangram surfaces (async `text.external-api.pangram.com` `/task`-poll and sync `text.api.pangram.com/v3`) behind a `PANGRAM_MODE` switch; async is the default; the poll delay is an injected `sleep` so the pure package stays timer-free; `version`→`vendorVersion` (the `stage` lifecycle field is never provenance).

- [ ] **Step 3: Full gate**

Run: `pnpm --filter @magna-carta/ai-detection test` (green), `pnpm --filter @magna-carta/ai-detection exec vitest run purity` (green — no new imports), `pnpm run lint:process-refs` (clean). Verify the pure package added no `setTimeout`/`Date.now()`/network import (the `sleep` and `now` are injected).

- [ ] **Step 4: Commit**

```bash
git add changelog.d/pangram-endpoint.md docs/decisions/pending/pangram-endpoint-dual-mode.md
git commit -m "docs(ai-detection): Pangram v3 endpoint reconciliation (dual-mode) fragments"
```

---

## Self-Review (plan author)

**Spec coverage:** async task-poll flow → Tasks 1-2; sync flow → Task 2; mode switch → Tasks 2-3; base URL fix (external-api / v3) → Tasks 2-3; `stage`→provenance bug fix → Task 2 (`toRawDetection`); injected timer-free `sleep` → Task 2 config + Task 3 wiring; poll timeout → Task 2; no-leak error handling preserved → Task 2 (`fetchJson`); docs → Task 4.

**Purity:** no new imports (all three parsers + the adapter use the existing allowlist); `setTimeout` lives only in the worker route (Task 3), `sleep`/`now` injected into the pure adapter. Task 4 Step 3 re-runs the purity test as the guard.

**Type consistency:** `PangramTaskStatus` discriminants (`success`/`failed`/`pending`/`malformed`) are produced in Task 1 and consumed in Task 2's poll loop identically. `parsePangramSubmit` returns `{ taskId }` (camelCase) — consumed as `submitted.taskId` in Task 2. `PangramAdapterConfig` fields (`mode`, `sleep`, `pollIntervalMs`, `maxPollAttempts`) defined in Task 2 and set in Task 3's construction. The sync-endpoint exact path is a binding (`PANGRAM_BASE_URL`), so if the test key reveals a different sync sub-path, it is a config change, not code.

**Open confirmation (settle with the test key):** which surface the key is provisioned for (async external-api vs sync `/v3`) — a `PANGRAM_MODE` + `PANGRAM_BASE_URL` selection, no code change. If async poll cadence needs tuning, `pollIntervalMs`/`maxPollAttempts` are config with sane defaults (750 ms × 16 ≈ 12 s).
