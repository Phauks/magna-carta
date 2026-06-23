import { type EngineResolver, runConversion } from "./execute.ts";
import type { FormatId } from "./format.ts";
import { availableConversions } from "./pathfinding.ts";
import { FORMATS, getFormat } from "./registry.ts";

// A minimal structural view of a browser File — name + optional MIME type + the bytes. Avoids a hard
// dependency on the DOM `File` type so these helpers run unchanged in Node, Workers, and browsers.
export interface FileLike {
  readonly name: string;
  readonly type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

// What the caller knows about a file before reading it (detection only needs the name + MIME type).
type FileDescriptor = { readonly name: string; readonly type?: string };

// A converted file ready to download, or a typed failure. Mirrors the runner's failure reasons and
// adds `unknown-source-format` for a file whose type the registry does not recognize.
export type FileConversionResult =
  | { readonly ok: true; readonly blob: Blob; readonly filename: string }
  | {
      readonly ok: false;
      readonly reason:
        | "unknown-source-format"
        | "unsupported-edge"
        | "engine-not-implemented"
        | "adapter-error";
      readonly detail?: string;
    };

function extensionOf(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

// Map a file to a registered FormatId: prefer its MIME type, fall back to its filename extension.
export function detectFormat(file: FileDescriptor): FormatId | undefined {
  const mediaType = file.type?.toLowerCase();
  if (mediaType) {
    const byType = FORMATS.find((format) => format.mediaType === mediaType);
    if (byType) return byType.id;
  }
  const extension = extensionOf(file.name);
  if (extension) {
    const byExtension = FORMATS.find((format) => format.extensions.includes(extension));
    if (byExtension) return byExtension.id;
  }
  return undefined;
}

// The target formats reachable from this file — the data-driven "Convert to…" options. Empty when the
// source format is not recognized.
export function availableTargets(file: FileDescriptor): readonly FormatId[] {
  const from = detectFormat(file);
  return from === undefined ? [] : availableConversions(from);
}

function renameTo(name: string, to: FormatId): string {
  const extension = getFormat(to)?.extensions[0] ?? to;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${extension}`;
}

// Detect the source format, run the conversion, and wrap the result as a downloadable Blob with a
// sensibly-renamed filename. Never throws — an unrecognized source and every conversion failure come
// back as a typed result.
export async function convertFile(
  file: FileLike,
  to: FormatId,
  resolve?: EngineResolver,
): Promise<FileConversionResult> {
  const from = detectFormat(file);
  if (from === undefined) {
    return {
      ok: false,
      reason: "unknown-source-format",
      detail: `unrecognized file type for ${file.name}`,
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await runConversion(from, to, bytes, resolve);
  if (!result.ok) return result;
  return {
    ok: true,
    // Uint8Array.from yields an ArrayBuffer-backed view, which a BlobPart requires (the runner's
    // bytes are typed Uint8Array<ArrayBufferLike>).
    blob: new Blob([Uint8Array.from(result.bytes)], { type: result.mediaType }),
    filename: renameTo(file.name, to),
  };
}
