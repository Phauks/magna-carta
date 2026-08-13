/*
 * The Documents surface's pure display decisions — kept out of the components so they are
 * unit-testable without a DOM, and so the list, the version history, and the detail panel cannot
 * drift into three answers for the same question.
 */
import type { BadgeVariant } from "@magna-carta/design-system/badge";
import type { ApiProblem, DocumentStatus, DocumentSummary } from "./document-api.ts";

/** Human-readable size: whole bytes below 1 KB, otherwise one decimal at the natural unit. */
export function formatDocumentSize(sizeBytes: number | null): string {
  if (sizeBytes === null) return "—";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kilobytes = sizeBytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  const megabytes = kilobytes / 1024;
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`;
  return `${(megabytes / 1024).toFixed(1)} GB`;
}

/**
 * Format an ISO 8601 timestamp for display. An unparseable value is returned unchanged rather than
 * hidden — showing exactly what the server sent is more honest than dropping a field we could not
 * parse. An absent one reads as an em dash, not as a blank cell.
 */
export function formatDocumentTimestamp(iso: string | null): string {
  if (iso === null || iso === "") return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * How a document's ingest outcome reads on the surface, or `null` for the ordinary clean document —
 * the common case wears no chip, so the two that need attention are the only ones that carry one.
 *
 * A rejected document is listed, deliberately: a document the scanner refused must say so where the
 * person put it, not vanish. It has no current version, so nothing can offer its bytes.
 */
export interface DocumentStatusPresentation {
  readonly label: string;
  readonly variant: BadgeVariant;
  /** The rejection reason, when the server gave one — shown beside the chip. */
  readonly detail: string | null;
}

export function documentStatusPresentation(
  document: Pick<DocumentSummary, "status" | "quarantineReason">,
): DocumentStatusPresentation | null {
  const status: DocumentStatus = document.status;
  if (status === "pending") return { label: "Processing", variant: "info", detail: null };
  if (status === "quarantined") {
    return { label: "Rejected", variant: "danger", detail: document.quarantineReason };
  }
  return null;
}

/** Whether the document has committed, clean bytes behind it — the gate on every content action. */
export function hasReadableContent(
  document: Pick<DocumentSummary, "status" | "currentVersionId">,
): boolean {
  return document.status === "clean" && document.currentVersionId !== null;
}

export type ProblemTone = "info" | "warning" | "danger";

export interface ProblemGuidance {
  tone: ProblemTone;
  title: string;
  message: string;
}

/**
 * Human guidance for a failed call, keyed by HTTP status. The server's own `detail` is preferred
 * where it sent one — it is written for the caller and knows things this table cannot, such as which
 * capability was missing — and this supplies the wording only where it did not.
 */
export function problemGuidance(problem: ApiProblem): ProblemGuidance {
  if (problem.status >= 500) {
    return {
      tone: "danger",
      title: "Something went wrong on our side",
      message:
        problem.detail ?? "The request did not complete. Quote the Error ID below to support.",
    };
  }
  switch (problem.status) {
    case 401:
      return {
        tone: "info",
        title: "You are not signed in",
        message: "Sign in again to see this matter's documents.",
      };
    case 403:
      return {
        tone: "warning",
        title: "You do not have permission",
        message: problem.detail ?? "Your account is not allowed to do this on this matter.",
      };
    case 404:
      return {
        tone: "warning",
        title: "Not found",
        message: problem.detail ?? "This document is no longer on the matter.",
      };
    case 409:
      return {
        tone: "warning",
        title: "Already in progress",
        message: problem.detail ?? "The same request is already running. Wait for it to finish.",
      };
    case 429:
      return {
        tone: "warning",
        title: "Too many requests",
        message: "You have done that several times in a short period. Wait a moment, then retry.",
      };
    default:
      return {
        tone: "warning",
        title: "That did not work",
        message: problem.detail ?? "The request was refused. Check the details and try again.",
      };
  }
}

/**
 * Documents newest-first — the question asked of a matter's documents far more often than any other
 * is "what came in last". The list endpoint already orders this way; sorting again here keeps a page
 * that has locally inserted a freshly created document in the same order as one that re-read.
 */
export function documentsNewestFirst(
  documents: readonly DocumentSummary[],
): readonly DocumentSummary[] {
  return [...documents].sort((left, right) => {
    if (left.createdAt === right.createdAt) return right.id.localeCompare(left.id);
    return right.createdAt.localeCompare(left.createdAt);
  });
}
