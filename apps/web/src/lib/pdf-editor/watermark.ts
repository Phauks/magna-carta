/*
 * The watermark a reader sets up before marking a PDF: a word such as CONFIDENTIAL, or the firm's
 * logo, drawn faintly across the pages.
 *
 * The engine (`watermarkDocument` in `@magna-carta/pdf`) draws the mark on top of each page and
 * takes nothing away, so a watermark labels a copy; it hides nothing. This module holds what the
 * reader chose, checks it before the engine is asked, and turns it into the engine's options. The
 * marked document is a new file beside the original, because the mark is for one audience and the
 * firm's own copy stays clean.
 */
import type { WatermarkOptions } from "@magna-carta/pdf";
import { batesFont, printableInStandardFonts, type BatesTypeface } from "./bates.ts";

/** The words most marks say. "Other" lets the reader write their own. */
export const WATERMARK_PRESETS = [
  "CONFIDENTIAL",
  "ATTORNEYS' EYES ONLY",
  "PRIVILEGED & CONFIDENTIAL",
  "DRAFT",
  "COPY",
] as const;

/**
 * The colours offered, each as the engine's RGB and the preview's design token. A short closed
 * list, because a watermark is meant to be read past, and a free colour picker invites one that is
 * not.
 */
export const WATERMARK_COLOURS = [
  { value: "grey", label: "Grey", rgb: [0.5, 0.5, 0.5], previewClass: "text-text-muted" },
  { value: "red", label: "Red", rgb: [0.75, 0.1, 0.1], previewClass: "text-status-danger" },
  { value: "blue", label: "Blue", rgb: [0.1, 0.25, 0.65], previewClass: "text-status-info" },
] as const satisfies readonly {
  value: string;
  label: string;
  rgb: readonly [number, number, number];
  previewClass: string;
}[];

export type WatermarkColour = (typeof WATERMARK_COLOURS)[number]["value"];

export interface WatermarkSettings {
  readonly kind: "text" | "image";
  readonly text: string;
  readonly typeface: BatesTypeface;
  readonly sizePt: number;
  readonly colour: WatermarkColour;
  /** How much of the mark shows, from 0.05 to 1. */
  readonly opacity: number;
  /** Clockwise, in degrees: 45 is the usual diagonal. */
  readonly rotation: 0 | 45 | 90;
  readonly placement: "center" | "tiled";
  /** The logo's width as a share of the page's. */
  readonly imageScale: number;
  /** Which pages to mark, as a reader writes them: "1-3, 7". Empty means every page. */
  readonly pages: string;
}

export const DEFAULT_WATERMARK: WatermarkSettings = {
  kind: "text",
  text: "CONFIDENTIAL",
  typeface: "sans",
  sizePt: 60,
  colour: "grey",
  opacity: 0.3,
  rotation: 45,
  placement: "center",
  imageScale: 0.3,
  pages: "",
};

export const WATERMARK_LIMITS = {
  sizePt: { min: 12, max: 160 },
  textLength: 60,
  opacity: { min: 0.05, max: 1 },
  imageScale: { min: 0.05, max: 1 },
} as const;

/**
 * Read a page list as a reader writes it, "1-3, 7", into zero-based page indices in order, each
 * once. Empty means every page, returned as null. A page past the end or a range written
 * backwards is refused with the reason, because marking the wrong pages is worse than asking.
 */
export function parsePageList(
  text: string,
  pageCount: number,
): { readonly pages: readonly number[] | null } | { readonly problem: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { pages: null };
  const chosen = new Set<number>();
  for (const piece of trimmed.split(",")) {
    const part = piece.trim();
    if (part === "") continue;
    const match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part);
    if (match === null) return { problem: `"${part}" isn't a page or a range like 2-5.` };
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < 1) return { problem: "Pages are counted from 1." };
    if (to < from) return { problem: `${part} runs backwards. Write it as ${to}-${from}.` };
    if (to > pageCount) {
      return { problem: `This document has ${pageCount === 1 ? "1 page" : `${pageCount} pages`}.` };
    }
    for (let page = from; page <= to; page += 1) chosen.add(page - 1);
  }
  if (chosen.size === 0) return { pages: null };
  return { pages: [...chosen].toSorted((first, second) => first - second) };
}

/** What is wrong with the settings, field by field. Empty means the engine can be asked. */
export function watermarkProblems(
  settings: WatermarkSettings,
  pageCount: number,
  hasImage: boolean,
): Partial<Record<keyof WatermarkSettings, string>> {
  const problems: Partial<Record<keyof WatermarkSettings, string>> = {};
  if (settings.kind === "text") {
    const text = settings.text.trim();
    if (text === "") problems.text = "Enter the words to print.";
    else if (text.length > WATERMARK_LIMITS.textLength) {
      problems.text = `Keep it to ${WATERMARK_LIMITS.textLength} characters.`;
    } else if (!printableInStandardFonts(text)) {
      problems.text =
        "This has a character the watermark can't print. Use letters, numbers and punctuation.";
    }
    if (
      !(
        settings.sizePt >= WATERMARK_LIMITS.sizePt.min &&
        settings.sizePt <= WATERMARK_LIMITS.sizePt.max
      )
    ) {
      problems.sizePt = `Use ${WATERMARK_LIMITS.sizePt.min} to ${WATERMARK_LIMITS.sizePt.max} points.`;
    }
  } else if (!hasImage) {
    problems.kind = "Choose a PNG or JPEG image.";
  }
  const pages = parsePageList(settings.pages, pageCount);
  if ("problem" in pages) problems.pages = pages.problem;
  return problems;
}

/** The engine's options for these settings. Call only once `watermarkProblems` is empty. */
export function watermarkOptions(
  settings: WatermarkSettings,
  pageCount: number,
  image: Uint8Array | null,
): WatermarkOptions {
  const colour =
    WATERMARK_COLOURS.find((one) => one.value === settings.colour) ?? WATERMARK_COLOURS[0];
  const pages = parsePageList(settings.pages, pageCount);
  return {
    content:
      settings.kind === "image" && image !== null
        ? { kind: "image", bytes: image, scale: settings.imageScale }
        : {
            kind: "text",
            text: settings.text.trim(),
            font: batesFont(settings.typeface),
            fontSizePt: settings.sizePt,
            color: [...colour.rgb],
          },
    opacity: settings.opacity,
    rotationDeg: settings.rotation,
    placement: settings.placement,
    ...("pages" in pages && pages.pages !== null ? { pages: [...pages.pages] } : {}),
  };
}

/** "Smith.pdf" marked CONFIDENTIAL -> "Smith (Confidential).pdf"; with a logo, "(Watermarked)". */
export function watermarkedCopyName(originalName: string, settings: WatermarkSettings): string {
  const dot = originalName.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < originalName.length - 1;
  const stem = hasExtension ? originalName.slice(0, dot) : originalName;
  const extension = hasExtension ? originalName.slice(dot) : ".pdf";
  const words = settings.kind === "text" ? settings.text.trim() : "";
  const label =
    words === "" || words.length > 30
      ? "Watermarked"
      : words
          .toLowerCase()
          .replace(
            /(^|[\s'&-])([a-z])/g,
            (_, before: string, letter: string) => `${before}${letter.toUpperCase()}`,
          )
          .replace(/[\\/:*?"<>|]/g, "-");
  return `${stem} (${label})${extension}`;
}
