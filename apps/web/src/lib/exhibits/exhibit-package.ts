/*
 * Making a set's exhibit list, and its exhibit package, as PDFs saved to the matter's files.
 *
 * The list is the caption, the set's name, and a table of every exhibit, withdrawn ones greyed.
 * The package is one PDF: the list, then for each exhibit still in the set a cover sheet ("EXHIBIT
 * A", or "EXHIBIT 1" for a numbered set) and the exhibit's own pages. Bates numbers are stamped on
 * every page of it unless the member turns them off, taken from the matter's register so they never
 * repeat a number already stamped on the matter, and the list then shows where each exhibit's pages
 * fall. An exhibit that is not a PDF the engine can open is left out of the package, listed, and
 * named in the outcome.
 *
 * The composing, joining and stamping run in `exhibit-package.worker.ts`. Each file is read at its
 * current version.
 */
import { formatDate } from "@magna-carta/design-system/formatters";
import { zonedReading } from "@magna-carta/civil-time/time-zone";
import {
  exhibitCoverDocument,
  exhibitListDocument,
  type ExhibitListEntry,
} from "@magna-carta/exhibits/list-document";
import type { HouseDocument } from "@magna-carta/house-document";
import type { BatesStampOptions } from "@magna-carta/pdf";
import { mattersCourtCase } from "@magna-carta/api-client";
import { readDocumentBytes } from "$lib/documents/document-bytes.ts";
import { PDF_VIEWER_MAX_BYTES } from "$lib/documents/pdf-pages.ts";
import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
import { viewerTimeZone } from "$lib/dates";
import { uploadIntoFolder } from "$lib/file-manager/file-upload.ts";
import { recordBatesStampedFile, takeBatesRange } from "$lib/bates/bates-api.ts";
import type { ExhibitSetDetail, ExhibitSetMember } from "./exhibits-api.ts";

/** The worker's two asks: measure the pages, then build with the numbers taken. */
export type PackageWorkerRequest =
  | {
      readonly kind: "measure";
      readonly list: HouseDocument;
      readonly documents: readonly ArrayBuffer[];
    }
  | {
      readonly kind: "build";
      readonly list: HouseDocument;
      /** One cover per document, in order. Empty for the list alone. */
      readonly covers: readonly HouseDocument[];
      readonly documents: readonly ArrayBuffer[];
      readonly bates: BatesStampOptions | null;
    };

export type PackageWorkerReply =
  | {
      readonly kind: "measured";
      readonly listPages: number;
      /** Null for a document the engine cannot open: not a PDF, or locked with a password. */
      readonly pageCounts: readonly (number | null)[];
    }
  | { readonly kind: "built"; readonly pdf: ArrayBuffer; readonly listPages: number }
  | { readonly kind: "failed"; readonly reason: string };

export interface PackageContext {
  readonly matterId: string;
  readonly matterTitle: string;
  readonly set: ExhibitSetDetail;
  /** Where the PDF is saved: the folder the set follows, or the matter's top level. */
  readonly folderId: string | null;
}

export interface BatesChoice {
  readonly prefix: string;
  readonly digits: number;
}

export type PackageOutcome =
  | {
      readonly kind: "saved";
      readonly fileId: string;
      readonly name: string;
      /** The captions of the exhibits left out because they could not be opened as PDFs. */
      readonly leftOut: readonly string[];
      /** The Bates numbers stamped, first and last, when the package was stamped. */
      readonly bates: { readonly first: string; readonly last: string } | null;
    }
  /** The PDF was made but the matter did not take it. The bytes are offered; nothing was saved. */
  | {
      readonly kind: "notSaved";
      readonly name: string;
      readonly url: string;
      readonly leftOut: readonly string[];
    }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "refused"; readonly failure: StatedFailure };

/** A Bates label, as the engine prints it. */
function label(prefix: string, number: number, digits: number): string {
  return `${prefix}${String(number).padStart(digits, "0")}`;
}

function rangeText(prefix: string, first: number, last: number, digits: number): string {
  const start = label(prefix, first, digits);
  return first === last ? start : `${start} to ${label(prefix, last, digits)}`;
}

/** A name a file may carry: characters a file name may not hold become a hyphen. */
function fileNameSafe(text: string): string {
  return text.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function work(request: PackageWorkerRequest): Promise<PackageWorkerReply> {
  const worker = new Worker(new URL("./exhibit-package.worker.ts", import.meta.url), {
    type: "module",
  });
  const transfer = request.documents.map((bytes) => bytes);
  return new Promise<PackageWorkerReply>((resolve) => {
    worker.addEventListener("message", (event: MessageEvent<PackageWorkerReply>) => {
      worker.terminate();
      resolve(event.data);
    });
    worker.addEventListener("error", () => {
      worker.terminate();
      resolve({ kind: "failed", reason: "Couldn't make the PDF on this device. Try again." });
    });
    worker.postMessage(request, transfer);
  });
}

async function caseNumberOf(matterId: string): Promise<string | null> {
  try {
    const { data } = await mattersCourtCase({ fetch, path: { id: matterId }, throwOnError: true });
    return data.courtCase?.caseNumber ?? null;
  } catch {
    // The caption reads well without it; a list is never refused for want of a case number.
    return null;
  }
}

function preparedOn(): string {
  return formatDate(zonedReading(Date.now(), viewerTimeZone()).civilDate);
}

function entryOf(
  member: ExhibitSetMember,
  bates: string | null,
  pageCount: number | null = member.pageCount,
): ExhibitListEntry {
  return {
    label: member.label,
    title: member.titleAsIssued ?? member.title,
    withdrawn: member.status === "withdrawn",
    pageCount,
    bates,
  };
}

function listDocument(
  context: PackageContext,
  caseNumber: string | null,
  entries: readonly ExhibitListEntry[],
): HouseDocument {
  return exhibitListDocument({
    matterTitle: context.matterTitle,
    caseNumber,
    setName: context.set.name,
    noun: context.set.scheme.noun,
    preparedOn: preparedOn(),
    created: new Date().toISOString(),
    entries,
  });
}

async function save(
  context: PackageContext,
  pdf: ArrayBuffer,
  name: string,
): Promise<{ kind: "saved"; fileId: string } | { kind: "notSaved"; url: string }> {
  const file = new File([pdf], name, { type: "application/pdf" });
  const saved = await uploadIntoFolder({
    fetchImpl: fetch,
    matterId: context.matterId,
    folderId: context.folderId,
    file,
    name,
  });
  if (saved.kind === "committed" || saved.kind === "settling") {
    return { kind: "saved", fileId: saved.fileId };
  }
  return { kind: "notSaved", url: URL.createObjectURL(file) };
}

/** The exhibit list alone: every exhibit, with any Bates range it was recorded with. */
export async function makeExhibitList(context: PackageContext): Promise<PackageOutcome> {
  const caseNumber = await caseNumberOf(context.matterId);
  const entries = context.set.members.map((member) =>
    entryOf(
      member,
      member.batesBegin === null
        ? null
        : member.batesEnd === null || member.batesEnd === member.batesBegin
          ? member.batesBegin
          : `${member.batesBegin} to ${member.batesEnd}`,
    ),
  );
  const reply = await work({
    kind: "build",
    list: listDocument(context, caseNumber, entries),
    covers: [],
    documents: [],
    bates: null,
  });
  if (reply.kind !== "built") {
    return {
      kind: "failed",
      message: reply.kind === "failed" ? reply.reason : "Couldn't make the PDF.",
    };
  }
  const name = `${fileNameSafe(context.set.name)} - Exhibit List.pdf`;
  const saved = await save(context, reply.pdf, name);
  return saved.kind === "saved"
    ? { kind: "saved", fileId: saved.fileId, name, leftOut: [], bates: null }
    : { kind: "notSaved", name, url: saved.url, leftOut: [] };
}

/**
 * The package: the list, then a cover sheet and the pages of each exhibit still in the set, with
 * Bates numbers on every page unless `bates` is null.
 */
export async function makeExhibitPackage(
  context: PackageContext,
  bates: BatesChoice | null,
): Promise<PackageOutcome> {
  const caseNumber = await caseNumberOf(context.matterId);
  const active = context.set.members.filter((member) => member.status === "active");

  // Read every exhibit. One that cannot be read at all is left out like one that is not a PDF.
  const read: (ArrayBuffer | null)[] = [];
  for (const member of active) {
    const outcome = await readDocumentBytes(fetch, member.fileId, null, PDF_VIEWER_MAX_BYTES);
    read.push(outcome.kind === "ok" ? outcome.bytes : null);
  }
  const placeholder = bates === null ? null : label(bates.prefix, 0, bates.digits);
  const draftEntries = context.set.members.map((member) =>
    entryOf(member, placeholder === null ? null : `${placeholder} to ${placeholder}`),
  );
  const measured = await work({
    kind: "measure",
    list: listDocument(context, caseNumber, draftEntries),
    documents: read.map((bytes) => (bytes === null ? new ArrayBuffer(0) : bytes.slice(0))),
  });
  if (measured.kind !== "measured") {
    return {
      kind: "failed",
      message: measured.kind === "failed" ? measured.reason : "Couldn't make the PDF.",
    };
  }

  const included: { member: ExhibitSetMember; bytes: ArrayBuffer; pages: number }[] = [];
  const leftOut: string[] = [];
  for (const [index, member] of active.entries()) {
    const bytes = read[index];
    const pages = measured.pageCounts[index];
    if (bytes === null || bytes === undefined || pages === null || pages === undefined) {
      leftOut.push(member.caption);
    } else {
      included.push({ member, bytes, pages });
    }
  }
  if (included.length === 0) {
    return {
      kind: "failed",
      message:
        "None of this set's exhibits is a PDF that can be opened, so there is nothing to put in a package.",
    };
  }

  // One page per list page, then a cover and the exhibit's pages for each exhibit.
  const totalPages = measured.listPages + included.reduce((sum, entry) => sum + 1 + entry.pages, 0);
  let firstNumber = 0;
  let rangeId: string | null = null;
  if (bates !== null) {
    const taken = await takeBatesRange(fetch, context.matterId, {
      prefix: bates.prefix,
      digits: bates.digits,
      pageCount: totalPages,
      purpose: "exhibitPackage",
      exhibitSetId: context.set.id,
    });
    if (taken.kind !== "ok") {
      return {
        kind: "refused",
        failure: stated(
          taken.failure,
          "The Bates numbers couldn't be taken from this matter's log.",
          "Couldn't connect, so nothing was made.",
        ),
      };
    }
    firstNumber = taken.value.firstNumber;
    rangeId = taken.value.id;
  }

  // Where each exhibit's own pages fall, after the list and its cover sheet.
  const rangeOf = new Map<string, string>();
  // The pages counted here are the pages in the package, which a list should show even when the
  // exhibit's own record has not counted them yet.
  const pagesOf = new Map(included.map((entry) => [entry.member.id, entry.pages]));
  const leftOutIds = new Set(
    active
      .filter((member) => !included.some((entry) => entry.member.id === member.id))
      .map((member) => member.id),
  );
  let next = firstNumber + measured.listPages;
  for (const entry of included) {
    const first = next + 1;
    const last = first + entry.pages - 1;
    if (bates !== null)
      rangeOf.set(entry.member.id, rangeText(bates.prefix, first, last, bates.digits));
    next = last + 1;
  }
  const entries = context.set.members.map((member) =>
    entryOf(
      member,
      bates === null
        ? null
        : (rangeOf.get(member.id) ?? (leftOutIds.has(member.id) ? "Not included" : null)),
      pagesOf.get(member.id) ?? member.pageCount,
    ),
  );

  const built = await work({
    kind: "build",
    list: listDocument(context, caseNumber, entries),
    covers: included.map((entry) =>
      exhibitCoverDocument(entry.member.caption, entry.member.titleAsIssued ?? entry.member.title),
    ),
    documents: included.map((entry) => entry.bytes),
    bates:
      bates === null
        ? null
        : {
            prefix: bates.prefix,
            startNumber: firstNumber,
            padding: bates.digits,
            position: "bottomRight",
            font: "helvetica-bold",
            fontSizePt: 8,
            marginPt: 18,
          },
  });
  if (built.kind !== "built") {
    return {
      kind: "failed",
      message: built.kind === "failed" ? built.reason : "Couldn't make the PDF.",
    };
  }
  const lastNumber = firstNumber + totalPages - 1;
  const stampedRange =
    bates === null
      ? null
      : {
          first: label(bates.prefix, firstNumber, bates.digits),
          last: label(bates.prefix, lastNumber, bates.digits),
        };
  const name =
    stampedRange === null
      ? `${fileNameSafe(context.set.name)} - Exhibit Package.pdf`
      : `${fileNameSafe(context.set.name)} - Exhibit Package (${fileNameSafe(stampedRange.first)} to ${fileNameSafe(stampedRange.last)}).pdf`;
  const saved = await save(context, built.pdf, name);
  if (saved.kind !== "saved") return { kind: "notSaved", name, url: saved.url, leftOut };
  if (rangeId !== null)
    await recordBatesStampedFile(fetch, context.matterId, rangeId, saved.fileId);
  return { kind: "saved", fileId: saved.fileId, name, leftOut, bates: stampedRange };
}
