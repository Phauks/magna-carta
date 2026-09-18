/*
 * File Analysis: every open finding on the matter, counted by SEVERITY rather than by how many
 * files have anything at all — "three files have something" and "one error, two info" are different
 * facts and only the second one tells a reader what to do next.
 *
 * An issue is per FILE PER KIND, which is what makes ignoring one an honest judgement rather than
 * silencing a file: a reader who has decided a missing document type does not matter on an exhibit
 * has said nothing about that exhibit's scan. Every ignore is individually reversible.
 */
import { claimedFileCategory, sniffedFileCategory } from "@magna-carta/design-system/file-icon";
import type { MatterFile } from "./matter-file-api.ts";
import { ISSUE_KINDS, type IssueKind, type SeverityBandKey } from "./file-manager-vocabulary.ts";

/** One finding: which file, which kind. The pair is its identity everywhere. */
export interface Issue {
  readonly fileId: string;
  readonly kind: IssueKind;
}

export function issueKey(issue: Issue): string {
  return `${issue.fileId}:${issue.kind}`;
}

/**
 * Every open issue on one file. The order is worst first, so the first entry is the one that
 * decides which band the file's card reads in.
 */
export function issuesOnFile(file: MatterFile): IssueKind[] {
  const found: IssueKind[] = [];
  if (file.status === "quarantined" || file.scanVerdict === "flagged") found.push("signature");
  if (mismatched(file)) found.push("mismatch");
  if (file.status === "pending" || file.currentVersionId === null) found.push("noVersion");
  else if (file.scanVerdict === null || file.scanVerdict === "unscanned") found.push("unscanned");
  return found.toSorted((left, right) => ISSUE_KINDS[left].rank - ISSUE_KINDS[right].rank);
}

/**
 * Whether the claimed type and what the bytes actually read as disagree. The host sniffs the bytes,
 * so where the extension says one thing and the sniff says another the file is not what its name
 * claims — which is a fact worth stating, not a fact worth hiding. The icon beside the name draws
 * the CLAIM, on purpose, so this finding is the only place the disagreement is said; a check that
 * stayed quiet would leave the row reading as the name's word alone.
 *
 * The comparison is at the level of kind, in the design system's own file-type vocabulary, so the
 * two sides are graded by the one mapping the icon and the File Type column already use rather than
 * by a second list kept here. Three rules fall out of that:
 *
 * - A name with NO extension claims nothing, so nothing can contradict it.
 * - A name whose extension nobody recognizes IS a claim — one the bytes can contradict. A Word
 *   document renamed to end in ".do" is a Word document with a name that says otherwise.
 * - A sniff the vocabulary has no kind for (the sniffer recognized nothing, or a container format
 *   it cannot see inside — legacy Office files all read as one compound-file type) is no reading,
 *   and no reading contradicts nothing. Plain text has no signature at all, so a text or code file
 *   never sniffs, and never false-alarms here.
 */
function mismatched(file: MatterFile): boolean {
  if (file.sniffedContentType === null) return false;
  const claimed = claimedFileCategory(file.name);
  if (claimed === undefined) return false;
  const read = sniffedFileCategory(file.sniffedContentType);
  return read !== undefined && read !== claimed;
}

/** Every open issue across the matter, in file order. */
export function allIssues(files: readonly MatterFile[]): Issue[] {
  return files.flatMap((file) =>
    issuesOnFile(file).map((kind) => ({ fileId: file.id, kind }) as const),
  );
}

/** How many issues fall in each band, over exactly the issues handed in. */
export function countsByBand(issues: readonly Issue[]): Record<SeverityBandKey, number> {
  const counts: Record<SeverityBandKey, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[ISSUE_KINDS[issue.kind].band] += 1;
  return counts;
}

/** How many issues of each kind, so the kind pills say something true of what is on screen. */
export function countsByKind(issues: readonly Issue[]): Map<IssueKind, number> {
  const counts = new Map<IssueKind, number>();
  for (const issue of issues) counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1);
  return counts;
}

/**
 * One report, and it is the text BOTH the copy and the download produce, so what somebody pastes
 * into an email and what they attach to it can never disagree.
 */
export function issueReportText(
  files: readonly MatterFile[],
  issues: readonly Issue[],
  where: (file: MatterFile) => string,
): string {
  const byFile = new Map<string, IssueKind[]>();
  for (const issue of issues) {
    byFile.set(issue.fileId, [...(byFile.get(issue.fileId) ?? []), issue.kind]);
  }
  const lines: string[] = ["File Analysis", ""];
  for (const file of files) {
    const kinds = byFile.get(file.id);
    if (kinds === undefined || kinds.length === 0) continue;
    lines.push(`${file.name} — ${where(file)}`);
    for (const kind of kinds) lines.push(`  ${ISSUE_KINDS[kind].label}`);
    if (file.quarantineReason !== null) lines.push(`  ${file.quarantineReason}`);
    lines.push("");
  }
  return lines.join("\n");
}
