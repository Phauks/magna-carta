import init, { PdfDocument as WasmDocument } from "./pkg/pdf_core.js";

// Optional wasm bytes for environments (Node/Vitest) where fetch is unavailable.
// Pass the result of `readFileSync(wasmPath)` — the loader handles both Buffer and Uint8Array.
let ready: Promise<unknown> | undefined;

export async function ensureReady(wasmInput?: BufferSource | WebAssembly.Module): Promise<void> {
  if (ready === undefined) {
    ready = wasmInput !== undefined ? init({ module_or_path: wasmInput }) : init();
  }
  await ready;
}

export interface PageSize {
  widthPt: number;
  heightPt: number;
}

export interface RenderedPage {
  data: Uint8Array;
  width: number;
  height: number;
  encoding: "rgba8" | "png";
}

export interface RenderOptions {
  dpi?: number;
  encodePng?: boolean;
}

/** A parsed PDF document. Call `free()` (or use `using`) to release wasm memory. */
export class PdfDocument {
  private constructor(private readonly handle: WasmDocument) {}

  static async load(
    bytes: Uint8Array,
    wasmInput?: BufferSource | WebAssembly.Module,
  ): Promise<PdfDocument> {
    await ensureReady(wasmInput);
    try {
      return new PdfDocument(WasmDocument.load(bytes));
    } catch (error) {
      mapGuardError(error);
    }
  }

  get pageCount(): number {
    return this.handle.pageCount;
  }

  pageSize(index: number): PageSize {
    const s = this.handle.pageSize(index);
    try {
      return { widthPt: s.widthPt, heightPt: s.heightPt };
    } finally {
      s.free();
    }
  }

  renderPage(index: number, opts: RenderOptions = {}): RenderedPage {
    const png = opts.encodePng ?? false;
    const r = this.handle.renderPage(index, opts.dpi ?? 150, png);
    try {
      return { data: r.data, width: r.width, height: r.height, encoding: png ? "png" : "rgba8" };
    } finally {
      r.free();
    }
  }

  free(): void {
    this.handle.free();
  }

  [Symbol.dispose](): void {
    this.free();
  }
}

export async function loadDocument(
  bytes: Uint8Array,
  wasmInput?: BufferSource | WebAssembly.Module,
): Promise<PdfDocument> {
  try {
    return await PdfDocument.load(bytes, wasmInput);
  } catch (error) {
    mapGuardError(error);
  }
}

export interface RedactionRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RedactionRegion {
  page: number;
  rect: RedactionRect;
  reason?: string;
}

export interface RedactionOptions {
  /** Raster resolution for flattened pages. Defaults to 300 (the legal-production standard). */
  dpi?: number;
  /** If supplied, redaction also verifies these strings are absent from the output. */
  redactedText?: string[];
  /** Document-level surfaces to scrub. Omitted means all surfaces are scrubbed (redaction is sanitized-by-default); pass individual `false` flags to retain a surface. */
  scrub?: ScrubOptions;
  /**
   * Redaction route. Default `"flatten"`.
   *
   * - `"flatten"` — rasterises every affected page to a pixel image. Original text, fonts,
   *   and vector graphics do not survive. All redacted pages become non-searchable images.
   * - `"surgery"` — excises only the glyphs whose centres fall within the redaction rectangle
   *   from the page content stream, leaving the rest of the page as selectable PDF text.
   *   Surgery is attempted per page and falls back to `"flatten"` for any page it cannot
   *   confirm clear. The result is never less safe than `"flatten"`: a page is only reported
   *   as surgered when the outcome gate finds no glyph centre remaining inside any redaction
   *   rectangle on that page.
   */
  mode?: "flatten" | "surgery";
}

export interface RedactionResult {
  pdf: Uint8Array;
  /** All page indices (0-based) where content was redacted, regardless of route. */
  pagesRedacted: number[];
  /** Page indices (0-based) where text-preserving surgery succeeded. Present in both modes; empty when `mode` is `"flatten"`. */
  pagesSurgered: number[];
  /** Page indices (0-based) where the page was rasterised to an image. Includes all flatten-mode pages and any surgery-mode page that fell back. */
  pagesFlattened: number[];
}

import { redactDocument as wasmRedact } from "./pkg/pdf_core.js";

/**
 * Redact regions from a PDF by flattening each affected page to an image with
 * opaque boxes, then verifying no redacted text survives. Throws if the
 * verification gate fails (no unsafe PDF is ever returned).
 */
export async function redactDocument(
  bytes: Uint8Array,
  regions: RedactionRegion[],
  opts: RedactionOptions = {},
): Promise<RedactionResult> {
  await ensureReady();
  try {
    return wasmRedact(bytes, regions, opts) as RedactionResult;
  } catch (error) {
    mapGuardError(error);
  }
}

export interface ScrubOptions {
  /** Info dictionary + XMP metadata. Default true. */
  metadata?: boolean;
  /** Embedded files, file-attachment annotations, portfolio. Default true. */
  attachments?: boolean;
  /** AcroForm XFA dataset. Default true. */
  xfa?: boolean;
  /** Clear form field values (keeps a blank form). Default true. */
  formFieldValues?: boolean;
  /** Tagged-PDF structure tree (ActualText/Alt). Default true. */
  structureTree?: boolean;
  /** Bookmarks and named destinations. Default true. */
  outlines?: boolean;
  /** Optional-content (layer) configuration. Default true. */
  optionalContent?: boolean;
}

export interface SanitizeResult {
  pdf: Uint8Array;
}

import { sanitizeDocument as wasmSanitize } from "./pkg/pdf_core.js";

/**
 * Remove document-level surfaces where sensitive content can hide (metadata,
 * attachments, form values, structure tree, bookmarks, optional-content). Every
 * surface is removed by default; pass `false` for a surface to retain it. Throws
 * if verification finds a scrubbed surface surviving (no document is returned).
 */
export async function sanitizeDocument(
  bytes: Uint8Array,
  opts: ScrubOptions = {},
): Promise<SanitizeResult> {
  await ensureReady();
  try {
    return wasmSanitize(bytes, opts) as SanitizeResult;
  } catch (error) {
    mapGuardError(error);
  }
}

export interface DetectionFinding {
  category:
    | "coveredText"
    | "invisibleText"
    | "whiteoutText"
    | "removableAnnotation"
    | "hiddenLayer"
    | "metadataLeak"
    | "orphanedText";
  severity: "critical" | "high" | "medium" | "low" | "info";
  page: number | null;
  region: { x0: number; y0: number; x1: number; y1: number } | null;
  recoveredText: string;
  detail: string;
}

export interface DetectionReport {
  findings: DetectionFinding[];
  summary: { critical: number; high: number; medium: number; low: number; info: number };
  pagesScanned: number;
  glyphsExamined: number;
  pagesUnreadable: number[];
}

import {
  readForm as wasmReadForm,
  fillForm as wasmFillForm,
  flattenForm as wasmFlattenForm,
} from "./pkg/pdf_core.js";
import { stampBates as wasmStampBates } from "./pkg/pdf_core.js";
import { detectDocument as wasmDetect } from "./pkg/pdf_core.js";

/** One of the six corners or edges where a Bates label can be placed. */
export type BatesPosition =
  | "bottomRight"
  | "bottomLeft"
  | "bottomCenter"
  | "topRight"
  | "topLeft"
  | "topCenter";

/**
 * One of the twelve standard PDF Type 1 text fonts available for Bates labels.
 * All twelve are built-in standard fonts that every conforming PDF viewer supplies
 * without font embedding. Custom or uploaded fonts are not supported.
 */
export type BatesFont =
  | "helvetica"
  | "helvetica-bold"
  | "helvetica-oblique"
  | "helvetica-boldoblique"
  | "times-roman"
  | "times-bold"
  | "times-italic"
  | "times-bolditalic"
  | "courier"
  | "courier-bold"
  | "courier-oblique"
  | "courier-boldoblique";

/** Options for `stampBates`. All fields are optional; defaults match `BatesOptions::default()` in the engine. */
export interface BatesStampOptions {
  /** Text prepended before the zero-padded number, e.g. `"SMITH-"`. Default `""`. */
  prefix?: string;
  /** Text appended after the zero-padded number, e.g. `"-CONF"`. Default `""`. */
  suffix?: string;
  /** Number assigned to the first page. Default `1`. */
  startNumber?: number;
  /**
   * Inclusive upper bound on the last Bates number that may be stamped.
   * When set, the call throws if stamping the document would assign any number
   * beyond this ceiling. The check occurs before any page is modified.
   * Absent or `undefined` means no ceiling is enforced.
   */
  stopNumber?: number;
  /** Minimum digit width; shorter numbers are zero-padded to this width. Default `6`. */
  padding?: number;
  /** Corner or edge where the label is drawn. Default `"bottomRight"`. */
  position?: BatesPosition;
  /**
   * Typeface for the stamp label. Must be one of the twelve built-in standard PDF
   * Type 1 text fonts — custom or uploaded fonts are not supported in this version.
   * Default `"helvetica"`.
   */
  font?: BatesFont;
  /** Distance in points from the nearest page edge. Default `18`. */
  marginPt?: number;
  /** Font size in points. Default `8`. */
  fontSizePt?: number;
}

/**
 * The result of `stampBates`. `start` and `end` are the inclusive Bates numbers
 * assigned to the first and last pages of the document.
 */
export interface BatesStampResult {
  /** The stamped PDF bytes. */
  pdf: Uint8Array;
  /** Bates number on the first page (inclusive). */
  start: number;
  /** Bates number on the last page (inclusive). */
  end: number;
  /** Number of pages stamped. */
  pageCount: number;
}

/**
 * Stamp sequential Bates labels onto every page of a PDF.
 *
 * **Additive overlay — not redaction.** This function adds selectable PDF text
 * to each page using the chosen built-in font. It does not remove, flatten,
 * rasterise, or modify any existing page content. Use `redactDocument` to
 * permanently remove content.
 *
 * The label on each page is `prefix` followed by the page's Bates number
 * zero-padded to `padding` digits, then `suffix`. The first page receives
 * `startNumber`; each subsequent page increments by one. If `stopNumber` is set
 * and stamping would exceed it, the call throws before modifying any page.
 */
export async function stampBates(
  bytes: Uint8Array,
  options: BatesStampOptions = {},
): Promise<BatesStampResult> {
  await ensureReady();
  try {
    return wasmStampBates(bytes, options) as BatesStampResult;
  } catch (error) {
    mapGuardError(error);
  }
}

/**
 * Scan a PDF for failed redactions — recoverable text that is covered, invisible,
 * whitened-out, in metadata, or orphaned. Returns findings ranked by severity.
 * Read-only: the input is never modified. An empty `findings` list means nothing
 * was detected, not a guarantee that the document is safe.
 */
export async function detectDocument(bytes: Uint8Array): Promise<DetectionReport> {
  await ensureReady();
  try {
    return wasmDetect(bytes) as DetectionReport;
  } catch (error) {
    mapGuardError(error);
  }
}

// ── Forms ─────────────────────────────────────────────────────────────────────
//
// NOTE: Forms are not redaction. readForm/fillForm/flattenForm read and write
// visible field values. They do not remove hidden content, metadata, or any
// other surface from the document. Use redactDocument/sanitizeDocument for that.

/** The interactive role of a form field. */
export type FieldKind =
  | "text"
  | "checkbox"
  | "radio"
  | "choice"
  | "pushButton"
  | "signature"
  | "unknown";

/** A resolved interactive form field with all inherited PDF attributes applied. */
export interface FormField {
  /** Fully-qualified dot-joined field name (ancestor /T values joined with "."). */
  name: string;
  /** Interactive role of the field. */
  kind: FieldKind;
  /** Current field value, or null when the field has no value set. */
  value: string | boolean | null;
  /** /Opt display entries for Choice fields; on-state export names for Radio groups. */
  options: string[];
  /** True when the field's read-only flag (/Ff bit 1) is set. */
  readOnly: boolean;
  /**
   * True when the field's required flag (/Ff bit 2) is set — the form itself says
   * this field has to be answered. Inherited down the field tree, so a required
   * group makes its terminal descendants required.
   */
  required: boolean;
  /** 0-based page index of the first widget annotation, or null if unknown. */
  page: number | null;
  /** Bounding box of the first widget in display points [llx, lly, urx, ury], or null. */
  rect: [number, number, number, number] | null;
}

/**
 * Values to fill into form fields. Keys are fully-qualified field names.
 * Use a string for text, choice, and radio fields; use a boolean for checkboxes.
 */
export type FormFillValues = Record<string, string | boolean>;

/** Options for `fillForm`. */
export interface FormFillOptions {
  /**
   * When `true`, widget appearances are baked into page content and the AcroForm
   * dictionary is dropped. When `false` (the default), the form remains interactive.
   */
  flatten?: boolean;
}

/** The output of `fillForm` and `flattenForm`. */
export interface FormFillResult {
  /** The output PDF bytes. */
  pdf: Uint8Array;
}

/**
 * Enumerate all interactive form fields in a PDF.
 *
 * Returns an array of `FormField` objects with resolved names, kinds, current
 * values, options, page locations, and bounding boxes. The four fillable kinds
 * are `"text"`, `"checkbox"`, `"radio"`, and `"choice"`. `"pushButton"` and
 * `"signature"` fields are enumerated but their values are read-only in this
 * version.
 *
 * **Forms are not redaction.** This function reads field metadata only; it never
 * modifies the input bytes. Use `redactDocument`/`sanitizeDocument` to remove
 * content.
 */
export async function readForm(bytes: Uint8Array): Promise<FormField[]> {
  await ensureReady();
  try {
    return wasmReadForm(bytes) as FormField[];
  } catch (error) {
    mapGuardError(error);
  }
}

/**
 * Fill interactive form fields by name and optionally flatten the form.
 *
 * `values` maps fully-qualified field names to fill values: pass a string for
 * text, choice, and radio fields; pass a boolean for checkboxes. Extra keys that
 * do not match any field are silently ignored.
 *
 * Text and choice fills generate a Helvetica appearance, so the value renders in
 * any viewer. Checkbox and radio fills set only the field value and the widget's
 * selected state (`/V` and `/AS`) and render through the field's existing on/off
 * state appearances — a checkbox or radio widget that carries no state appearance
 * streams is filled at the value level but is not given a generated appearance.
 *
 * When `options.flatten` is `true`, widget appearances are baked into page content
 * and the AcroForm dictionary is dropped, producing a flat static PDF. When
 * `false` (the default), the form remains interactive with the new values set.
 *
 * **Forms are not redaction.** Filling sets visible field values. Flattening makes
 * those values permanent static content. Neither operation removes hidden content,
 * metadata, or other surfaces — use `redactDocument`/`sanitizeDocument` for that.
 */
export async function fillForm(
  bytes: Uint8Array,
  values: FormFillValues,
  options?: FormFillOptions,
): Promise<FormFillResult> {
  await ensureReady();
  try {
    return wasmFillForm(bytes, values, options ?? {}) as FormFillResult;
  } catch (error) {
    mapGuardError(error);
  }
}

/**
 * Flatten all interactive form fields into static page content.
 *
 * Each widget's current appearance is drawn into the page via a `Do` operator,
 * page resources are merged non-destructively, widget annotations are removed,
 * and the `/AcroForm` dictionary is dropped. The result is permanent static
 * content renderable by any PDF viewer without form support.
 *
 * **Forms are not redaction.** Flattening bakes visible form values into page
 * content. It does not remove hidden content, metadata, or other surfaces — use
 * `redactDocument`/`sanitizeDocument` for that.
 */
export async function flattenForm(bytes: Uint8Array): Promise<FormFillResult> {
  await ensureReady();
  try {
    return wasmFlattenForm(bytes) as FormFillResult;
  } catch (error) {
    mapGuardError(error);
  }
}

// ── Security: inspect / unlock / protect ────────────────────────────────────────
//
// Runs entirely in this module (WebAssembly): the password and document bytes never
// leave the caller's process. The password is never included in a thrown error.

import {
  inspectSecurity as wasmInspectSecurity,
  decryptDocument as wasmDecryptDocument,
  secureDocument as wasmSecureDocument,
} from "./pkg/pdf_core.js";

/**
 * A document's advisory permission policy. PDF permission bits are honoured only by
 * cooperating viewers and can be stripped by any tool that opens the document — the
 * open password plus the cipher is the only real confidentiality control.
 */
export interface SecurityPermissions {
  print: boolean;
  printHighRes: boolean;
  copy: boolean;
  modify: boolean;
  annotate: boolean;
  fillForms: boolean;
  assemble: boolean;
  accessibilityCopy: boolean;
}

/** What a document's security looks like, read without opening it. */
export interface SecurityInfo {
  encrypted: boolean;
  handler: "standard" | "publicKey" | "none";
  algorithm: "rc4" | "aes128" | "aes256" | "unknown" | "none";
  /** True when an open (user) password is required to view the document. */
  hasUserPassword: boolean;
  /** The permission policy, or `null` when it could not be read (an open-password-free doc). */
  permissions: SecurityPermissions | null;
}

/** Options for {@link secureDocument}. */
export interface SecureOptions {
  /** Required. Governs permission changes. */
  ownerPassword: string;
  /** Optional open password. Omit (or empty) for a document that opens without a prompt. */
  userPassword?: string;
  /** Omitted bits default to allowed. */
  permissions?: Partial<SecurityPermissions>;
  /** Default true. */
  encryptMetadata?: boolean;
  /** Default `"aes256"`. `"aes128"` is for older readers only; never RC4. */
  algorithm?: "aes256" | "aes128";
}

/** Thrown by {@link decryptDocument} when the password does not open the document. */
export class WrongPasswordError extends Error {
  readonly code = "wrong-password" as const;
  constructor() {
    super("The password did not unlock the document.");
    this.name = "WrongPasswordError";
  }
}

/** Thrown by any operation when the decompression-bomb guard rejects the input
 * (oversize, or a stream that inflates past the engine's caps). */
export class DecompressionBombError extends Error {
  readonly code = "decompression-bomb" as const;
  constructor() {
    super("The document was rejected as a potential decompression bomb.");
    this.name = "DecompressionBombError";
  }
}

/** Re-throw the engine's guard token as a typed error; pass anything else through. */
function mapGuardError(error: unknown): never {
  if (error instanceof Error && error.message === "decompression-bomb") {
    throw new DecompressionBombError();
  }
  throw error;
}

/**
 * Classify a PDF's security without a password. Lets a caller prompt for a password
 * only when one is needed and refuse an unsupported (public-key) handler.
 */
export async function inspectSecurity(bytes: Uint8Array): Promise<SecurityInfo> {
  await ensureReady();
  try {
    return wasmInspectSecurity(bytes) as SecurityInfo;
  } catch (error) {
    mapGuardError(error);
  }
}

/**
 * Unlock a password-protected PDF, returning the plaintext bytes. An unencrypted input
 * is returned unchanged. Throws {@link WrongPasswordError} for a bad password (distinct
 * from a parse failure) so the caller can re-prompt. Unlocks with a *known* password
 * only — it does not recover or guess passwords.
 */
export async function decryptDocument(
  bytes: Uint8Array,
  password: string,
): Promise<{ pdf: Uint8Array }> {
  await ensureReady();
  try {
    return wasmDecryptDocument(bytes, password) as { pdf: Uint8Array };
  } catch (error) {
    // The engine signals a bad password with this exact token and never echoes the
    // password; re-throw as a typed error the UI can act on.
    if (error instanceof Error && error.message === "wrong-password") {
      throw new WrongPasswordError();
    }
    mapGuardError(error);
  }
}

/**
 * Protect a PDF, returning the encrypted bytes. Writes AES-256 by default and never
 * RC4. `ownerPassword` is required; an omitted/empty `userPassword` produces a document
 * that opens without a prompt but still carries the owner password and permissions.
 */
export async function secureDocument(
  bytes: Uint8Array,
  options: SecureOptions,
): Promise<{ pdf: Uint8Array }> {
  await ensureReady();
  try {
    return wasmSecureDocument(bytes, options) as { pdf: Uint8Array };
  } catch (error) {
    mapGuardError(error);
  }
}

// ── Generate / assembly: merge, split, rotate, watermark ────────────────────────
//
// All run client-side in WebAssembly; the document bytes never leave the process.
// merge / rotate / watermark are visible, reversible operations — they do not remove
// hidden content or metadata (use redactDocument / sanitizeDocument for that).

import {
  mergeDocuments as wasmMergeDocuments,
  splitDocument as wasmSplitDocument,
  rotatePages as wasmRotatePages,
  watermarkDocument as wasmWatermarkDocument,
} from "./pkg/pdf_core.js";

/** Combine the pages of several PDFs into one, in order, carrying each input's outlines,
 * form fields, and named destinations across. */
export async function mergeDocuments(documents: Uint8Array[]): Promise<{ pdf: Uint8Array }> {
  await ensureReady();
  try {
    return wasmMergeDocuments(documents) as { pdf: Uint8Array };
  } catch (error) {
    mapGuardError(error);
  }
}

/** An inclusive, 0-based page range. */
export interface PageRange {
  start: number;
  end: number;
}

/** Split a PDF into one independent document per page range. */
export async function splitDocument(
  bytes: Uint8Array,
  ranges: PageRange[],
): Promise<{ pdfs: Uint8Array[] }> {
  await ensureReady();
  try {
    return wasmSplitDocument(bytes, ranges) as { pdfs: Uint8Array[] };
  } catch (error) {
    mapGuardError(error);
  }
}

/** Rotate pages clockwise by 90, 180, or 270 degrees, relative to each page's existing
 * rotation. Omit `pages` to rotate every page; otherwise pass 0-based indices. */
export async function rotatePages(
  bytes: Uint8Array,
  rotation: 90 | 180 | 270,
  pages?: number[],
): Promise<{ pdf: Uint8Array }> {
  await ensureReady();
  try {
    return wasmRotatePages(bytes, rotation, pages) as { pdf: Uint8Array };
  } catch (error) {
    mapGuardError(error);
  }
}

/** A text watermark drawn in one of the built-in standard fonts. */
export interface WatermarkTextContent {
  kind: "text";
  text: string;
  /** One of the twelve standard fonts; defaults to `"helvetica"`. */
  font?: BatesFont;
  /** Default 48. */
  fontSizePt?: number;
  /** RGB 0..1; default light grey. */
  color?: [number, number, number];
}

/** An image/logo watermark (PNG or JPEG). */
export interface WatermarkImageContent {
  kind: "image";
  bytes: Uint8Array;
  /** Mark width as a fraction of the page width; default 0.3. */
  scale?: number;
}

export type WatermarkContent = WatermarkTextContent | WatermarkImageContent;

export interface WatermarkOptions {
  content: WatermarkContent;
  /** Fill/stroke alpha 0..1; default 0.3. */
  opacity?: number;
  /** Clockwise rotation of the mark in degrees; default 45 (diagonal). */
  rotationDeg?: number;
  /** A single centred mark or a tiled repeat; default `"center"`. */
  placement?: "center" | "tiled";
  /** The 0-based pages to mark; omit to mark every page. A page past the end is an error. */
  pages?: number[];
}

/**
 * Stamp an additive watermark — diagonal text ("CONFIDENTIAL"/"DRAFT") or an image/logo —
 * onto every page, or onto `options.pages` alone. Additive: it draws on top and removes nothing (use redactDocument /
 * sanitizeDocument to remove content).
 */
export async function watermarkDocument(
  bytes: Uint8Array,
  options: WatermarkOptions,
): Promise<{ pdf: Uint8Array }> {
  await ensureReady();
  try {
    return wasmWatermarkDocument(bytes, options) as { pdf: Uint8Array };
  } catch (error) {
    mapGuardError(error);
  }
}

// ── PAdES seal ──────────────────────────────────────────────────────────────
//
// The engine owns the PDF structure; the CMS is opaque. A seal is three host-side steps:
// prepare (reserve the signature dict + /Contents, compute /ByteRange), sign the byte range
// off-engine (never here — the key stays host-side), then embed the CMS. `createSealEngine`
// packages these as the `SealEngine` the `@magna-carta/signing` `sealDocument` orchestrator drives.

import {
  prepareSignature as wasmPrepareSignature,
  embedSignature as wasmEmbedSignature,
} from "./pkg/pdf_core.js";

export interface SealOptions {
  /** `/Name` — the seal/signer name. */
  name?: string;
  /** `/Reason`. */
  reason?: string;
  /** `/Location`. */
  location?: string;
  /** `/ContactInfo`. */
  contactInfo?: string;
  /** `/M` — a PDF date string, e.g. `"D:20260718120000Z"`. */
  signingTime?: string;
  /** Bytes reserved for the CMS; `/Contents` holds twice this in hex. Defaults to 16 KiB. */
  contentsCapacity?: number;
}

export interface PreparedSeal {
  /** The incremental-updated PDF (input preserved as its prefix), with a zero-filled `/Contents`. */
  document: Uint8Array;
  /** `[0, gapStart, gapEnd, suffixLength]` — the signed bytes are the two spans it names. */
  byteRange: readonly [number, number, number, number];
  /** The reserved hex-digit span, strictly between the `<` and `>` of `/Contents`. */
  contentsSpan: readonly [number, number];
}

/** The PDF-structure operations `@magna-carta/signing`'s `sealDocument` needs. */
export interface SealEngine {
  prepare(pdf: Uint8Array, options: SealOptions): Promise<PreparedSeal>;
  signedBytes(prepared: PreparedSeal): Uint8Array;
  embed(prepared: PreparedSeal, cmsDer: Uint8Array): Promise<Uint8Array>;
}

/**
 * Append the signature structure and reserve `/Contents`, preserving the input as the prefix of
 * the returned document. No cryptography — the reserved gap is filled later by `embedSignature`.
 */
export async function prepareSignature(
  bytes: Uint8Array,
  options: SealOptions = {},
  wasmInput?: BufferSource | WebAssembly.Module,
): Promise<PreparedSeal> {
  await ensureReady(wasmInput);
  try {
    return wasmPrepareSignature(bytes, options) as PreparedSeal;
  } catch (error) {
    mapGuardError(error);
  }
}

/**
 * Splice a detached CMS (DER) into a prepared document's reserved `/Contents`, returning the sealed
 * PDF. Throws if the CMS is larger than the reservation. The `/ByteRange` — and the digest the CMS
 * signs — is untouched.
 */
export async function embedSignature(
  document: Uint8Array,
  contentsSpan: readonly [number, number],
  cmsDer: Uint8Array,
  wasmInput?: BufferSource | WebAssembly.Module,
): Promise<Uint8Array> {
  await ensureReady(wasmInput);
  try {
    return wasmEmbedSignature(document, contentsSpan, cmsDer);
  } catch (error) {
    mapGuardError(error);
  }
}

/**
 * The seal engine backed by this WASM module. `prepare` and `embed` run in the engine; `signedBytes`
 * is a pure slice of the prepared document (the two `/ByteRange` spans), so it needs no engine call.
 */
export function createSealEngine(wasmInput?: BufferSource | WebAssembly.Module): SealEngine {
  return {
    prepare: (pdf, options) => prepareSignature(pdf, options, wasmInput),
    signedBytes(prepared) {
      const [, gapStart, gapEnd, suffixLength] = prepared.byteRange;
      const out = new Uint8Array(gapStart + suffixLength);
      out.set(prepared.document.subarray(0, gapStart), 0);
      out.set(prepared.document.subarray(gapEnd, gapEnd + suffixLength), gapStart);
      return out;
    },
    embed: (prepared, cmsDer) =>
      embedSignature(prepared.document, prepared.contentsSpan, cmsDer, wasmInput),
  };
}

import { extractPdfText as wasmExtractPdfText } from "./pkg/pdf_core.js";

/** One reconstructed line of a page's own text layer, in reading order. */
export interface ExtractedPdfLine {
  text: string;
}

/** What one page of a PDF holds, and whether recognition still has work to do on it. */
export interface ExtractedPdfPage {
  /** Zero-based, as the recognition engine reports it. */
  pageIndex: number;
  /** The page's own text. Empty for a page whose words exist only as pixels. */
  lines: ExtractedPdfLine[];
  /**
   * True when the page's words are pixels a recognizer has to read. A page that is mostly
   * raster with at most a sliver of text — a scan, stamped or not — is true; a page drawn as
   * text is false however sparse its text, because its own text layer already beats anything
   * recognition could read off a picture of it.
   */
  needsRecognition: boolean;
  /** The share of the page (0 to 1) covered by text a reader can see. Invisible text is excluded. */
  textCoverage: number;
  /** The share of the page (0 to 1) covered by raster images — what tells a scan from a drawing. */
  rasterCoverage: number;
}

export interface ExtractedPdfText {
  pages: ExtractedPdfPage[];
}

/**
 * Read a PDF's own text layer, page by page. This is the native half of composite text
 * extraction: it returns the characters the author wrote, exactly, for every page that has
 * them, and reports the pages that have none so a caller can send just those to recognition.
 *
 * A document of any ordinary length is read whole: the page ceiling is 50,000, far above a real
 * filing or production, because a document refused here has its words left out of search.
 *
 * Throws `DecompressionBombError` for a document the guard refuses, and a plain `Error`
 * (`"document has too many pages"`) for one declaring more pages than that ceiling — page count
 * is declared in the file, so the walk has to end somewhere.
 */
export async function extractPdfText(
  bytes: Uint8Array,
  wasmInput?: BufferSource | WebAssembly.Module,
): Promise<ExtractedPdfText> {
  await ensureReady(wasmInput);
  try {
    return wasmExtractPdfText(bytes) as ExtractedPdfText;
  } catch (error) {
    mapGuardError(error);
  }
}
