/*
 * What a PDF is, read cheaply: its pages and their size, its form, its password, and whether its
 * pages already carry Bates labels. The File Workbench's PDF tab shows it; the PDF Editor's worker
 * makes it (`pdf-operations.worker.ts`, the `summarize` operation).
 *
 * Made inside the worker, so the page text the Bates labels are looked for in never crosses to the
 * page: only the labels found, and how many pages carry them, come back.
 */
import type { FormField, SecurityInfo } from "@magna-carta/pdf";
import type { PdfPageSize } from "$lib/documents/pdf-pages.ts";

/** The labels found on the pages: the first and last, in page order, and how many pages carry one. */
export interface BatesLabelsFound {
  readonly first: string;
  readonly last: string;
  readonly pagesLabelled: number;
}

export interface PdfSummary {
  /** A password is needed to open it. Nothing past the protection can be read until it is unlocked. */
  readonly needsPassword: boolean;
  /** Encrypted at all: a password to open, or one that only sets limits on what a reader may do. */
  readonly encrypted: boolean;
  /**
   * The permissions a reader is asked to honour. Empty where none are withheld, and also where the
   * engine cannot read them, which it cannot without the permissions password.
   */
  readonly limits: readonly PermissionName[];
  /** Page sizes in document order. Empty when it needs a password. */
  readonly pages: readonly PdfPageSize[];
  /** The form, or null when it has none. */
  readonly form: { readonly fields: number; readonly filled: number } | null;
  readonly bates: BatesLabelsFound | null;
}

/** The permissions a document can withhold, as a reader says them. */
export type PermissionName = "printing" | "copying" | "editing" | "comments" | "filling forms";

/** Which permissions the document withholds, in a fixed order. */
export function withheldPermissions(
  security: Pick<SecurityInfo, "encrypted" | "permissions">,
): PermissionName[] {
  const permissions = security.permissions;
  if (!security.encrypted || permissions === null) return [];
  const withheld: PermissionName[] = [];
  if (!permissions.print) withheld.push("printing");
  if (!permissions.copy) withheld.push("copying");
  if (!permissions.modify) withheld.push("editing");
  if (!permissions.annotate) withheld.push("comments");
  if (!permissions.fillForms) withheld.push("filling forms");
  return withheld;
}

/** The form's fields that take an answer, and how many hold one. Buttons and signatures are not counted. */
export function summarizeForm(
  fields: readonly Pick<FormField, "kind" | "value">[],
): PdfSummary["form"] {
  const answerable = fields.filter(
    (field) => field.kind !== "pushButton" && field.kind !== "signature",
  );
  if (answerable.length === 0) return null;
  return {
    fields: answerable.length,
    filled: answerable.filter(
      (field) => field.value !== null && field.value !== "" && field.value !== false,
    ).length,
  };
}

/*
 * A Bates label is a prefix of capitals and digits, perhaps a separator, then a run of at least four
 * digits: SMITH000123, ABC-0001, DEF_000045. It sits alone at the start or the end of a line near
 * the top or the foot of a page. A page reference elsewhere in the text is not a label, so only the
 * first and last few lines of a page are looked at.
 */
const LABEL = /^([A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*[-_ ]?)(\d{4,10})$/;
const EDGE_LINES = 3;

interface Candidate {
  readonly prefix: string;
  readonly number: number;
  readonly label: string;
}

function candidatesOn(lines: readonly string[]): Candidate[] {
  const edge =
    lines.length <= EDGE_LINES * 2
      ? lines
      : [...lines.slice(0, EDGE_LINES), ...lines.slice(-EDGE_LINES)];
  const found: Candidate[] = [];
  for (const line of edge) {
    const words = line
      .trim()
      .split(/\s+/)
      .filter((word) => word !== "");
    if (words.length === 0) continue;
    // The label alone on the line, or as its first or last word, or the last two words when a
    // space separates the prefix from the number.
    const tries = new Set([
      words.join(" "),
      words[0] ?? "",
      words.at(-1) ?? "",
      words.slice(-2).join(" "),
    ]);
    for (const attempt of tries) {
      const match = LABEL.exec(attempt);
      if (match === null) continue;
      const [, prefix = "", digits = ""] = match;
      found.push({ prefix: prefix.trim(), number: Number(digits), label: attempt });
    }
  }
  return found;
}

/**
 * The Bates labels a document's pages carry, from each page's own text lines, or null when none
 * do. One prefix has to be on at least half the pages, numbered upward page by page; anything less
 * is a stray reference, and reporting labels that are not there is worse than missing some.
 */
export function findBatesLabels(pages: readonly (readonly string[])[]): BatesLabelsFound | null {
  if (pages.length === 0) return null;
  const byPrefix = new Map<string, Candidate[]>();
  for (const lines of pages) {
    const seen = new Set<string>();
    for (const candidate of candidatesOn(lines)) {
      if (seen.has(candidate.prefix)) continue;
      seen.add(candidate.prefix);
      byPrefix.set(candidate.prefix, [...(byPrefix.get(candidate.prefix) ?? []), candidate]);
    }
  }
  let best: Candidate[] | null = null;
  for (const run of byPrefix.values()) {
    const rising = run.every(
      (one, index) => index === 0 || one.number > (run[index - 1]?.number ?? 0),
    );
    if (!rising) continue;
    if (best === null || run.length > best.length) best = run;
  }
  if (best === null || best.length * 2 < pages.length) return null;
  const first = best[0];
  const last = best.at(-1);
  if (first === undefined || last === undefined) return null;
  return { first: first.label, last: last.label, pagesLabelled: best.length };
}
