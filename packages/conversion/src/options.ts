import type { ConversionEdge, FormatId } from "./format.ts";
import { findPath } from "./pathfinding.ts";

/**
 * A member's choices for one conversion, beyond the two formats. Every field is optional, and an
 * absent one leaves the copy exactly as a plain conversion would make it.
 *
 * Only what an engine honours end to end is here. The raster engine (containers/raster/src/
 * convert.rs, `ConvertOptions`) reads all three; no other engine reads any, so a target reached
 * through any other engine accepts none and a request carrying one is refused rather than
 * converted without it.
 */
export interface ConversionOptions {
  /** Shrink the image so its longest side is at most this many pixels. Never enlarges. */
  readonly maxDimension?: number;
  /** JPEG quality, 1 to 100. Only a JPEG target accepts it. */
  readonly quality?: number;
  /** Drop the colour and keep the lightness. */
  readonly grayscale?: boolean;
}

export type ConversionOptionName = keyof ConversionOptions;

/** The bounds the raster engine enforces; the ceiling is its own decode limit. */
export const MAX_DIMENSION_LIMITS = { minimum: 16, maximum: 40_000 } as const;
export const QUALITY_LIMITS = { minimum: 1, maximum: 100 } as const;
/** The JPEG quality the raster engine writes when none is asked for. */
export const DEFAULT_QUALITY = 75;

/**
 * The options a conversion accepts, decided by the engine of its FINAL hop: options are applied
 * there and nowhere earlier, because the final hop is the one that writes the copy the member
 * asked for. Empty when there is no path, or when the final engine reads no options.
 */
export function acceptedOptions(from: FormatId, to: FormatId): readonly ConversionOptionName[] {
  const path = findPath(from, to);
  if (!path.ok) return [];
  return acceptedOptionsForEdge(path.path[path.path.length - 1]);
}

function acceptedOptionsForEdge(edge: ConversionEdge | undefined): readonly ConversionOptionName[] {
  if (edge === undefined) return [];
  switch (edge.engineId) {
    case "libvips":
      return edge.to === "jpeg"
        ? ["maxDimension", "quality", "grayscale"]
        : ["maxDimension", "grayscale"];
    case "image-pdf":
      return ["maxDimension", "grayscale"];
    default:
      return [];
  }
}

/** The options that were actually asked for: a field left undefined, or grayscale false, is not. */
export function askedOptions(options: ConversionOptions | undefined): ConversionOptionName[] {
  if (options === undefined) return [];
  const asked: ConversionOptionName[] = [];
  if (options.maxDimension !== undefined) asked.push("maxDimension");
  if (options.quality !== undefined) asked.push("quality");
  if (options.grayscale === true) asked.push("grayscale");
  return asked;
}

/** The asked-for options this conversion cannot honour. Empty means the request is honourable. */
export function refusedOptions(
  from: FormatId,
  to: FormatId,
  options: ConversionOptions | undefined,
): ConversionOptionName[] {
  const accepted = acceptedOptions(from, to);
  return askedOptions(options).filter((name) => !accepted.includes(name));
}

/** The options with nothing in them dropped, or undefined when nothing was asked for at all. */
export function compactOptions(
  options: ConversionOptions | undefined,
): ConversionOptions | undefined {
  if (options === undefined) return undefined;
  const compact: { -readonly [Name in ConversionOptionName]?: ConversionOptions[Name] } = {};
  if (options.maxDimension !== undefined) compact.maxDimension = options.maxDimension;
  if (options.quality !== undefined) compact.quality = options.quality;
  if (options.grayscale === true) compact.grayscale = true;
  return Object.keys(compact).length === 0 ? undefined : compact;
}

/**
 * The request headers an engine reads the options from. The header names are the raster engine's
 * (containers/raster/src/lib.rs); an option left out sends no header.
 */
export function optionHeaders(options: ConversionOptions | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options?.maxDimension !== undefined)
    headers["x-max-dimension"] = String(options.maxDimension);
  if (options?.quality !== undefined) headers["x-quality"] = String(options.quality);
  if (options?.grayscale === true) headers["x-grayscale"] = "true";
  return headers;
}
