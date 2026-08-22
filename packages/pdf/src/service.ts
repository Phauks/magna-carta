// The PDF engine's HTTP surface — the shape a worker that does NOT host this WebAssembly speaks to
// one that does.
//
// The engine is a pinned Rust crate compiled to WebAssembly, and a bundle that imports it can only be
// built where that artefact has been produced. Workers that merely need a PDF operation therefore
// reach the engine over a service binding instead of importing it, and this module is the one
// implementation of what crosses that binding. It lives beside the engine on purpose: a second copy
// of the request shapes — in the hosting worker, or in a caller's test stub — is a contract two
// places can disagree about, and nothing would notice until a filled form came back wrong.
//
// It is deliberately NARROW AND BYTE-ORIENTED. The document goes over as raw bytes and comes back as
// raw bytes; nothing here decides anything about the document. Which box gets which value, and
// whether a filed form is interactive or flattened, are answered by the caller and arrive as
// parameters — this side fills what it is told to fill, so moving execution across a binding does not
// become a second engine with opinions of its own.
//
// THREE ANSWERS, and the caller depends on being able to tell them apart:
//   200 — the engine ran and this is its answer.
//   422 — the engine ran and REFUSED these bytes: not a PDF, over a guard, encrypted, too many pages.
//         A verdict about the document, permanent for these bytes.
//   400 — the request itself is malformed. A caller/service disagreement, which no retry fixes.
// Anything else (a 5xx from the runtime, an unreachable service) is NOT a verdict, and a caller must
// never read it as one.

import {
  ensureReady,
  extractPdfText,
  fillForm,
  readForm,
  sanitizeDocument,
  type FormFillValues,
} from "./index.ts";

/** Every path this handler owns sits under here, so a host worker can route its own surface first. */
export const PDF_SERVICE_PATH_PREFIX = "/pdf/";

/** One AcroForm field, narrowed to what a caller filling or cataloguing a form needs. */
export interface PdfServiceFormField {
  readonly name: string;
  readonly kind: string;
  readonly required: boolean;
  readonly page: number | null;
  readonly value: string | boolean | null;
  readonly options: readonly string[];
  readonly readOnly: boolean;
}

/** The body of a successful `POST /pdf/form/fields`. */
export interface PdfServiceFormFieldsResponse {
  readonly fields: readonly PdfServiceFormField[];
}

/** One page of a document's own text layer, narrowed to what composite extraction reads. */
export interface PdfServiceTextPage {
  readonly pageIndex: number;
  readonly lines: readonly { readonly text: string }[];
  readonly needsRecognition: boolean;
}

/** The body of a successful `POST /pdf/text`. */
export interface PdfServiceTextResponse {
  readonly pages: readonly PdfServiceTextPage[];
}

/** The multipart part names `POST /pdf/form/fill` reads. */
const FILL_DOCUMENT_PART = "document";
const FILL_VALUES_PART = "values";

function refused(): Response {
  // No detail. The engine's message is about the caller's document and this service holds no context
  // to redact it against, so the fact that the bytes were refused is the whole answer.
  return Response.json({ error: "unreadable" }, { status: 422 });
}

function malformed(detail: string): Response {
  return Response.json({ error: "bad-request", detail }, { status: 400 });
}

function pdfResponse(bytes: Uint8Array): Response {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
}

async function requestBytes(request: Request): Promise<Uint8Array> {
  return new Uint8Array(await request.arrayBuffer());
}

async function handleText(request: Request): Promise<Response> {
  const bytes = await requestBytes(request);
  let extracted;
  try {
    extracted = await extractPdfText(bytes);
  } catch {
    return refused();
  }
  const body: PdfServiceTextResponse = {
    pages: extracted.pages.map((page) => ({
      pageIndex: page.pageIndex,
      lines: page.lines.map((line) => ({ text: line.text })),
      needsRecognition: page.needsRecognition,
    })),
  };
  return Response.json(body);
}

async function handleFormFields(request: Request): Promise<Response> {
  const bytes = await requestBytes(request);
  let fields;
  try {
    fields = await readForm(bytes);
  } catch {
    return refused();
  }
  const body: PdfServiceFormFieldsResponse = {
    fields: fields.map((field) => ({
      name: field.name,
      kind: field.kind,
      required: field.required,
      page: field.page,
      value: field.value,
      options: field.options,
      readOnly: field.readOnly,
    })),
  };
  return Response.json(body);
}

async function handleFormScrub(request: Request): Promise<Response> {
  const bytes = await requestBytes(request);
  try {
    return pdfResponse((await sanitizeDocument(bytes)).pdf);
  } catch {
    return refused();
  }
}

async function handleFormFill(request: Request, url: URL): Promise<Response> {
  // The finish is REQUIRED on the wire, with no default here, for the same reason the caller's own
  // filler takes it as a required parameter: what a filed form is — still fillable, or permanently
  // flattened — is the caller's answer to give, and flattening cannot be undone. A request that
  // omits it is refused rather than quietly filled one way.
  const finish = url.searchParams.get("finish");
  if (finish !== "interactive" && finish !== "flattened") {
    return malformed("finish must be interactive or flattened");
  }

  // Multipart rather than a JSON envelope: the document is the large part of this request and it
  // stays raw bytes, where base64 in JSON would inflate every filled form by a third.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return malformed("expected a multipart body");
  }
  const document = form.get(FILL_DOCUMENT_PART);
  const rawValues = form.get(FILL_VALUES_PART);
  if (typeof document === "string" || document === null || typeof rawValues !== "string") {
    return malformed(`expected a ${FILL_DOCUMENT_PART} file part and a ${FILL_VALUES_PART} part`);
  }

  let values: FormFillValues;
  try {
    values = parseFillValues(rawValues);
  } catch {
    return malformed(`${FILL_VALUES_PART} must be a JSON object of strings and booleans`);
  }

  const bytes = new Uint8Array(await document.arrayBuffer());
  try {
    return pdfResponse((await fillForm(bytes, values, { flatten: finish === "flattened" })).pdf);
  } catch {
    return refused();
  }
}

// The values are the caller's own field-to-value map, and they are checked here rather than trusted:
// a key whose value is neither a string nor a boolean is not a fill the engine has a meaning for, and
// passing it through would let a malformed request reach the engine as if it were a document problem.
function parseFillValues(raw: string): FormFillValues {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("not an object");
  }
  const values: FormFillValues = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== "string" && typeof value !== "boolean") throw new Error("bad value");
    values[name] = value;
  }
  return values;
}

/**
 * Serve one PDF-engine request. Returns `undefined` when the path is not one this handler owns, so the
 * hosting worker routes its own surface first and answers its own 404.
 *
 * `wasm` is the engine module the host bundled — it has to be handed in explicitly under Workers,
 * where there is no URL to fetch it from. Initialization is cached by the engine itself, so passing it
 * on every request costs nothing after the first.
 */
export async function handlePdfServiceRequest(
  request: Request,
  wasm: WebAssembly.Module,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PDF_SERVICE_PATH_PREFIX)) return undefined;
  if (request.method !== "POST") {
    return Response.json({ error: "method-not-allowed" }, { status: 405 });
  }

  await ensureReady(wasm);

  switch (url.pathname) {
    case "/pdf/text":
      return await handleText(request);
    case "/pdf/form/fields":
      return await handleFormFields(request);
    case "/pdf/form/scrub":
      return await handleFormScrub(request);
    case "/pdf/form/fill":
      return await handleFormFill(request, url);
    default:
      return Response.json({ error: "not-found" }, { status: 404 });
  }
}
