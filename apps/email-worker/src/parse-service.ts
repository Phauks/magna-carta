import {
  EmailError,
  ensureReady,
  extractPart,
  parseMessage,
  type EmailErrorCode,
} from "@magna-carta/email";

// The parse engine's HTTP surface. This worker is the inbound mail entrance, so it is where the
// engine that reads mail belongs — the app worker calls it over a service binding instead of
// bundling a second copy of the WebAssembly build into its own deploy.
//
// There is no public route to any of this: wrangler.jsonc sets workers_dev false and declares no
// routes, so the service binding is the only way in and is the trust boundary, exactly as it is for
// apps/recovery-worker and apps/scan-worker.

/**
 * What `ensureReady` initialises the engine from.
 *
 * **The `.wasm` import itself is in index.ts, not here, and that is not tidiness.** A bare
 * `import … from "…_bg.wasm"` is a bundler feature: Wrangler turns it into a `WebAssembly.Module`,
 * and Vite's node pool refuses it outright ("ESM integration proposal for Wasm is not supported").
 * Naming it in this module would make the module unimportable by its own unit tests. So the
 * composition root owns the bundler-specific import and hands the result in, and the tests hand in
 * the same artefact's bytes read off disk — the wiring differs, the engine does not.
 */
export type EngineWasmInput = Uint8Array | ArrayBuffer | WebAssembly.Module;

// Every part-extraction request names its part with this query parameter. Pinned identically in the
// app worker's adapter — a Worker cannot import from another Worker, so change one and change both
// in the same commit.
const PART_INDEX_PARAMETER = "index";

/**
 * Status codes are the contract, and the three are not interchangeable: 200 carries the result, 422
 * carries a stable code about the submitted MESSAGE, and any 5xx means this service could not
 * answer at all. The caller maps them to a result, a verdict, and a retryable fault respectively,
 * so collapsing any two here silently turns an outage into a verdict about somebody's mail.
 */
function refusal(code: EmailErrorCode): Response {
  return new Response(JSON.stringify({ code }), {
    status: 422,
    headers: { "content-type": "application/json" },
  });
}

/**
 * `POST /parse` — read one `.eml` or `.msg` from the raw request body and return its
 * `ParsedMessage` as JSON. Metadata and body text only: the engine describes attachment parts
 * without materialising any of their bytes.
 *
 * The bytes are held for the duration of the call and nothing is written or logged — this worker
 * has no store of its own for them and must not grow one.
 */
export async function handleParse(request: Request, wasm: EngineWasmInput): Promise<Response> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) {
    return new Response("the request body carried no message bytes", { status: 400 });
  }
  await ensureReady(wasm);
  try {
    return Response.json(await parseMessage(bytes));
  } catch (thrown) {
    // The engine's stable codes are a fixed vocabulary that carries no message content, which is
    // why they can cross the wire. An unrecognised throw is not the engine refusing a message — it
    // is this service failing — so it becomes a 5xx rather than a verdict.
    if (thrown instanceof EmailError) return refusal(thrown.code);
    throw thrown;
  }
}

/**
 * `POST /extract-part?index=N` — materialise one part's bytes from the raw message in the request
 * body and return them as `application/octet-stream`.
 *
 * The part is named by its position in the `parts` array the parse returned, which is the engine's
 * own addressing. An index the message does not produce is `partNotFound`, a verdict; a part past
 * the engine's decode cap is `limitExceeded`, also a verdict — the caller records an oversize
 * outcome for it rather than failing the whole message.
 */
export async function handleExtractPart(
  request: Request,
  wasm: EngineWasmInput,
): Promise<Response> {
  const raw = new URL(request.url).searchParams.get(PART_INDEX_PARAMETER);
  const index = raw === null ? Number.NaN : Number(raw);
  if (!Number.isInteger(index) || index < 0) {
    return new Response(`${PART_INDEX_PARAMETER} must be a non-negative integer`, { status: 400 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) {
    return new Response("the request body carried no message bytes", { status: 400 });
  }
  await ensureReady(wasm);
  try {
    const part = await extractPart(bytes, index);
    return new Response(part, {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
  } catch (thrown) {
    if (thrown instanceof EmailError) return refusal(thrown.code);
    throw thrown;
  }
}

/**
 * Route a service-binding request to the engine, or return 404.
 *
 * Extracted from index.ts so the routing can be tested without the Email Routing handler beside it.
 */
export async function routeEngineRequest(
  request: Request,
  wasm: EngineWasmInput,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/parse") {
    return handleParse(request, wasm);
  }
  if (request.method === "POST" && url.pathname === "/extract-part") {
    return handleExtractPart(request, wasm);
  }
  if (request.method === "GET" && url.pathname === "/ready") {
    return new Response("ok", { status: 200 });
  }
  return new Response("Not Found", { status: 404 });
}
