/*
 * Making one new document from an arrangement plan (`page-arrangement.ts`), with the firm's own
 * engine. Runs inside the operations worker; kept apart from it so it can be tested against the
 * real engine without a worker.
 */
import { mergeDocuments, rotatePages, splitDocument } from "@magna-carta/pdf";
import type { ArrangementPlan } from "./page-arrangement.ts";

/**
 * Files whose pages were inserted are joined onto the end of the original first, in the order they
 * were inserted, because that is where the plan numbers their pages. With nothing inserted the
 * original is worked on as it stands, so a plain rearrangement never pays for a join.
 *
 * Then the turns, because the engine turns a page relative to how it already sits; then the runs
 * cut out and joined in order. A single run needs no join, which is the common case of turning
 * pages without moving any.
 */
export async function arrangeDocument(
  original: Uint8Array,
  plan: ArrangementPlan,
  additions: readonly Uint8Array[] = [],
): Promise<Uint8Array> {
  let turned =
    additions.length === 0 ? original : (await mergeDocuments([original, ...additions])).pdf;
  for (const turn of plan.turns) {
    turned = (await rotatePages(turned, turn.angle, [...turn.pages])).pdf;
  }
  const ranges = plan.runs.map((run) => ({ start: run.start, end: run.end }));
  const pieces = (await splitDocument(turned, ranges)).pdfs;
  const only = pieces.length === 1 ? pieces[0] : undefined;
  return only ?? (await mergeDocuments(pieces)).pdf;
}
