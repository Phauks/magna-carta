import { z } from "@hono/zod-openapi";

// The client for the platform's one PDF engine, which runs in the standalone sign worker
// (magna-carta-sign) and is reached over the SIGN_SERVICE binding.
//
// WHY IT IS NOT IN THIS WORKER. The engine is a pinned Rust crate compiled to WebAssembly, and a
// worker that imports it can only be built where that artefact has been produced — which is what makes
// this worker's build need a container toolchain rather than a TypeScript bundler. The sign worker
// already hosts the engine for the platform seal, so the execution moves there and this module is what
// speaks to it. The engine's HTTP shape is defined once, beside the engine, in
// `packages/pdf/src/service.ts`; this side only has to name the states.
//
// THREE STATES, NOT TWO, AND ONLY THE FIRST TWO ARE VERDICTS — the same rule the malware-scan wiring
// follows in `../files/scan-port-binding.ts`:
//
//   No binding at all → PdfEngineUnavailableError. There is no engine in this deployment. A static
//     fact: no retry and no redelivery produces one, so a caller treats it as terminal.
//   Bound and answering → the engine's own answer. `undefined` from these methods is the ENGINE's
//     verdict that it will not read these bytes (not a PDF, over a guard, encrypted, too many pages) —
//     a fact about the document, permanent for these bytes.
//   Bound and failing → PdfEngineFaultError. A 5xx, an unreachable service, a body that is not the
//     shape the contract promises. NOBODY LOOKED. This must never be reported as "this document has no
//     form fields" or "this PDF has no text": a caller that can retry retries, and a caller answering a
//     person says the engine is unreachable.

/** The sign service's HTTP surface, narrowed to the calls this module makes. */
export interface PdfServiceFetcher {
  fetch(request: Request): Promise<Response>;
}

/**
 * Raised when a PDF operation is asked for and no engine is bound — the sign worker is not deployed,
 * or the local test pool has no stub for it. Terminal: a redelivery cannot deploy a service, so a queue
 * consumer records the job failed rather than burning its attempts, and a route answers 503.
 */
export class PdfEngineUnavailableError extends Error {
  constructor() {
    super("pdf-engine-unavailable");
    this.name = "PdfEngineUnavailableError";
  }
}

/**
 * Raised when the engine is bound but would not answer — a 5xx, a transport failure, or a response
 * whose body is not the shape the contract promises. Transient: the operation is still doable, so a
 * queue consumer retries and a route answers 503 rather than handing a member an Error ID for an engine
 * that is simply not up.
 */
export class PdfEngineFaultError extends Error {
  constructor(detail: string) {
    super(`pdf-engine-fault: ${detail}`);
    this.name = "PdfEngineFaultError";
  }
}

/** One AcroForm field as the engine reports it. */
const formFieldSchema = z.object({
  name: z.string(),
  kind: z.string(),
  required: z.boolean(),
  page: z.number().nullable(),
  value: z.union([z.string(), z.boolean()]).nullable(),
  options: z.array(z.string()),
  readOnly: z.boolean(),
});

const formFieldsSchema = z.object({ fields: z.array(formFieldSchema) });

const textSchema = z.object({
  pages: z.array(
    z.object({
      pageIndex: z.number(),
      lines: z.array(z.object({ text: z.string() })),
      needsRecognition: z.boolean(),
    }),
  ),
});

export type PdfFormFieldReading = z.infer<typeof formFieldSchema>;
export type PdfTextReading = z.infer<typeof textSchema>;

/** The PDF operations document assembly needs, over whichever engine is reachable. */
export interface PdfFormEnginePort {
  /** The AcroForm field set, or undefined when the engine will not read these bytes. */
  readFields(bytes: Uint8Array): Promise<readonly PdfFormFieldReading[] | undefined>;
  /** The document with its removable surfaces stripped, or undefined when the engine refused it. */
  scrub(bytes: Uint8Array): Promise<Uint8Array | undefined>;
  /**
   * The filled document, or undefined when the engine refused it. `finish` is passed through, never
   * defaulted here: what a filed form is remains the caller's answer to give.
   */
  fill(
    bytes: Uint8Array,
    values: ReadonlyMap<string, string | boolean>,
    finish: "interactive" | "flattened",
  ): Promise<Uint8Array | undefined>;
}

/** Read a PDF's own text layer. Undefined when the engine will not read these bytes. */
export type PdfTextReader = (bytes: Uint8Array) => Promise<PdfTextReading | undefined>;

// Every call goes through here, so the three states are decided in exactly one place. A 200 is the
// engine's answer, a 422 is its refusal of these bytes, and everything else is a fault — including a
// transport failure, which is a service that did not answer rather than a document that could not be
// read.
async function call(
  service: PdfServiceFetcher,
  path: string,
  init: RequestInit,
): Promise<Response | undefined> {
  let response: Response;
  try {
    response = await service.fetch(new Request(`http://pdf${path}`, init));
  } catch (error) {
    throw new PdfEngineFaultError(error instanceof Error ? error.message : "request failed");
  }
  if (response.status === 200) return response;
  if (response.status === 422) return undefined;
  if (response.status >= 500) {
    throw new PdfEngineFaultError(`the engine returned status ${response.status}`);
  }
  // A 4xx other than the engine's refusal is this adapter and the service disagreeing about the
  // request, which no retry and no deploy fixes — left as a plain throw so it surfaces as the bug it
  // is rather than as an operational state anyone waits out.
  throw new Error(`pdf service returned status ${response.status}`);
}

async function bytesOf(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

// A body that does not parse is a fault, never an empty answer: an engine whose contract has drifted
// has told us nothing about the document, and "no fields" is a sentence with consequences.
function parsed<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new PdfEngineFaultError("the engine returned an unreadable body");
  return result.data;
}

function serviceBindingFormEngine(service: PdfServiceFetcher): PdfFormEnginePort {
  return {
    async readFields(bytes) {
      const response = await call(service, "/pdf/form/fields", { method: "POST", body: bytes });
      if (response === undefined) return undefined;
      return parsed(formFieldsSchema, await response.json()).fields;
    },
    async scrub(bytes) {
      const response = await call(service, "/pdf/form/scrub", { method: "POST", body: bytes });
      return response === undefined ? undefined : await bytesOf(response);
    },
    async fill(bytes, values, finish) {
      // Multipart keeps the document raw. It is the large part of this request, and base64 in a JSON
      // envelope would inflate every filled form by a third on a path that runs per assembled document.
      const body = new FormData();
      body.append("document", new Blob([bytes], { type: "application/pdf" }));
      body.append("values", JSON.stringify(Object.fromEntries(values)));
      const response = await call(service, `/pdf/form/fill?finish=${finish}`, {
        method: "POST",
        body,
      });
      return response === undefined ? undefined : await bytesOf(response);
    },
  };
}

// The no-engine port: the binding is absent, so every operation says so rather than answering. There
// is no honest fallback value here — "this PDF has no fields" and "nothing looked at this PDF" are
// different sentences, and only one of them is true.
const unavailableFormEngine: PdfFormEnginePort = {
  readFields: () => Promise.reject(new PdfEngineUnavailableError()),
  scrub: () => Promise.reject(new PdfEngineUnavailableError()),
  fill: () => Promise.reject(new PdfEngineUnavailableError()),
};

/**
 * Resolve the PDF form engine. Selected when the SIGN_SERVICE binding is present; absent before the
 * sign worker is deployed and in any test environment that binds no stub, where the no-engine port
 * refuses honestly rather than fabricating a reading.
 */
export function resolvePdfFormEnginePort(
  service: PdfServiceFetcher | undefined,
): PdfFormEnginePort {
  return service === undefined ? unavailableFormEngine : serviceBindingFormEngine(service);
}

/**
 * Resolve the PDF text-layer reader, or `undefined` when no engine is bound.
 *
 * Undefined rather than a refusing reader on purpose: this reader is ONE ROUTE of composite text
 * extraction, and a deployment without it simply has one fewer way to read a document — the caller
 * falls through to the routes it does have, exactly as it does for a document this reader cannot read.
 * The distinction that matters is with the third state: an engine that is bound and will not answer
 * throws, because a document nobody read must never be recorded as a document with no text.
 */
export function resolvePdfTextReader(
  service: PdfServiceFetcher | undefined,
): PdfTextReader | undefined {
  if (service === undefined) return undefined;
  return async (bytes) => {
    const response = await call(service, "/pdf/text", { method: "POST", body: bytes });
    if (response === undefined) return undefined;
    return parsed(textSchema, await response.json());
  };
}
