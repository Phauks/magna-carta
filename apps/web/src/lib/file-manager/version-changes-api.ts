/*
 * The changes one version of a document recorded: every insertion, deletion and formatting change
 * the document's own marks carry, each with the author the mark names and the member that name
 * resolved to at the cut, in document order.
 *
 * The `files.versionChanges` operation, reached through the generated client rather than a
 * hand-written path, on the pattern of $lib/documents/editing-policy-api.ts: the contract is
 * generated and diff-gated, and a module mirroring it by hand is a drift surface nothing keeps
 * honest. The outcome is the three every read renders (ok, a refusal the server described, nothing
 * answered), assembled from the failure the client's own interceptor already recorded — so a
 * refusal here is reported once, structurally, like every other call the app makes.
 */
import { filesVersionChanges, type FileVersionChangeItem } from "@magna-carta/api-client";
import { failureOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

/**
 * One change mark. `authorName` is the name the document holds; `authorCurrentName` is what the
 * firm calls that member today, null where the name resolved to nobody or to a member who has
 * left. `text` is the words, with a paragraph break as "\n"; `textTruncated` says the words were
 * cut at the server's cap. `part` names the package part ("word/document.xml", "word/header1.xml")
 * and `paragraphIndex` the paragraph within it, from zero.
 */
export type VersionChange = FileVersionChangeItem;

/**
 * The generated operation's answer as an outcome. With `throwOnError` off the client hands back
 * either the data or the error its interceptor assembled; `failureOf` reads the failure out of the
 * latter, and a failure with no problem is one nothing answered.
 */
function outcomeOf<T>(result: { data?: T; error?: unknown }): ApiOutcome<T> {
  if (result.data !== undefined) return { kind: "ok", value: result.data };
  const failure = failureOf(result.error);
  return failure.problem === null
    ? { kind: "transport", failure }
    : { kind: "problem", problem: failure.problem, failure };
}

/** A version's changes, in document order. Bounded at the server's cap; an empty list is honest. */
export async function readVersionChanges(
  fetchImpl: typeof fetch,
  fileId: string,
  versionId: string,
): Promise<ApiOutcome<readonly VersionChange[]>> {
  const outcome = outcomeOf(
    await filesVersionChanges({ fetch: fetchImpl, path: { id: fileId, versionId } }),
  );
  return outcome.kind === "ok" ? { kind: "ok", value: outcome.value.data } : outcome;
}
