/*
 * Compose a new PDF from content: headings, paragraphs, pictures, tables and labelled fields,
 * flowed onto pages with a header and footer line. The engine is crates/pdf-compose-core compiled
 * to WebAssembly; this module is its typed front door and the only thing a caller imports.
 *
 * The document is plain data, so the same value composes in a browser, in a Worker and (through the
 * crate itself) natively. Pictures travel beside it as bytes and are named by position, so a
 * photograph is never serialized as text.
 */
import init, { composeDocument as composeDocumentInEngine } from "./pkg/pdf_compose_core.js";

let ready: Promise<unknown> | undefined;

/**
 * Load the engine. In a browser the module fetches its own `.wasm`; a Worker or a test passes the
 * compiled module or its bytes. Safe to call more than once: the engine loads a single time.
 */
export async function ensureReady(wasmInput?: BufferSource | WebAssembly.Module): Promise<void> {
  if (ready === undefined) {
    ready = wasmInput === undefined ? init() : init({ module_or_path: wasmInput });
  }
  await ready;
}

export type ComposeAlignment = "start" | "center" | "end";

/** One line repeated on every page. `{page}` and `{pages}` are replaced with the page's number and the page count. */
export interface ComposeRunningLine {
  readonly left?: string;
  readonly center?: string;
  readonly right?: string;
}

/** A named paper size, or exact dimensions in points (1/72 inch) through `width` and `height`. */
export interface ComposePage {
  readonly paper?: "letter" | "a4";
  readonly landscape?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly marginTop?: number;
  readonly marginRight?: number;
  readonly marginBottom?: number;
  readonly marginLeft?: number;
}

export interface ComposeSpan {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
}

export interface ComposeColumn {
  readonly heading?: string;
  readonly alignment?: ComposeAlignment;
  /** The column's share of the table's width. Omitted on any column, every column is sized from its content. */
  readonly weight?: number;
}

export type ComposeBlock =
  | { readonly type: "title"; readonly text: string }
  | { readonly type: "heading"; readonly level?: 1 | 2 | 3; readonly text: string }
  | {
      readonly type: "paragraph";
      readonly text?: string;
      readonly spans?: readonly ComposeSpan[];
      readonly alignment?: ComposeAlignment;
    }
  | {
      readonly type: "image";
      /** The picture's position in the `images` list passed beside the document. */
      readonly image: number;
      /** Drawn width in points. Omitted, the picture is drawn at its natural size and fitted to the page. */
      readonly width?: number;
      readonly alignment?: ComposeAlignment;
      readonly caption?: string;
    }
  | {
      readonly type: "table";
      readonly columns: readonly ComposeColumn[];
      readonly rows: readonly (readonly string[])[];
    }
  | {
      readonly type: "fields";
      readonly fields: readonly { readonly label: string; readonly value: string }[];
    }
  | { readonly type: "rule" }
  | { readonly type: "space"; readonly height: number }
  | { readonly type: "pageBreak" };

export interface ComposeDocument {
  /** Recorded in the file's metadata. It is not drawn: add a `title` block to show one. */
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  /** A BCP 47 tag such as `en-US`. */
  readonly language?: string;
  /** When the document was made, in Coordinated Universal Time. The engine reads no clock. */
  readonly created?: {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour?: number;
    readonly minute?: number;
    readonly second?: number;
  };
  readonly page?: ComposePage;
  readonly header?: ComposeRunningLine;
  readonly footer?: ComposeRunningLine;
  readonly blocks: readonly ComposeBlock[];
}

export interface ComposedPdf {
  readonly pdf: Uint8Array;
  readonly pageCount: number;
  /**
   * Every character the bundled fonts could not draw (they cover Latin, Greek and Cyrillic). Each
   * was drawn as an empty box, so a caller that cannot accept one checks that this is empty.
   */
  readonly missingCharacters: readonly string[];
}

/**
 * Compose `document` into a PDF. `images` holds the encoded file (PNG, JPEG, GIF, WebP, BMP or
 * TIFF) of each picture an image block names. Rejects with the engine's own message, which never
 * quotes the document's content, when the document is malformed or a picture cannot be read.
 */
export async function composeDocument(
  document: ComposeDocument,
  images: readonly Uint8Array[] = [],
): Promise<ComposedPdf> {
  await ensureReady();
  const composed = composeDocumentInEngine(JSON.stringify(document), [...images]);
  try {
    return {
      pdf: composed.takePdf(),
      pageCount: composed.pageCount,
      missingCharacters: [...composed.missingCharacters],
    };
  } finally {
    composed.free();
  }
}
