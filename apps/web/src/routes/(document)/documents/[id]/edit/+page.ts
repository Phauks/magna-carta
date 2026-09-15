/*
 * Resolves the document behind /documents/[id]/edit: the file record the editor needs (its name,
 * its matter, its size, its version, its safety verdict) and the matter's title for the way back.
 *
 * A 404 is the one refusal that means "there is nothing here to edit": the route answers it for a
 * file that is pending only, rejected or deleted, and the group's own not-found screen is the right
 * answer to a wrong address. Any other failure is returned rather than thrown, so the screen can
 * state it with Retry beside it — the same posture the (app) layout takes when nothing answers.
 *
 * The matter may resolve to nothing (no session, no such matter, no Worker behind a frontend-only
 * dev server). That costs the way back its title and nothing else, so the page falls back to a
 * plain word rather than refusing to open the document.
 */
import { error } from "@sveltejs/kit";
import type { Failure } from "$lib/api/problem.ts";
import { readMatterFile, type MatterFile } from "$lib/file-manager/matter-file-api.ts";
import { resolveMatterRecord, type MatterRecord } from "$lib/matters/matter-record.ts";
import type { PageLoad } from "./$types";

/** What the page renders from: the document and its matter, or the failure that stood in the way. */
export type DocumentEditPageData =
  | {
      readonly file: MatterFile;
      readonly matter: MatterRecord | undefined;
      readonly failure?: undefined;
    }
  | { readonly failure: Failure; readonly file?: undefined; readonly matter?: undefined };

export const load: PageLoad = async ({ fetch, params }): Promise<DocumentEditPageData> => {
  const result = await readMatterFile(fetch, params.id);
  if (result.kind === "problem" && result.problem.status === 404) {
    error(404, "Not Found");
  }
  if (result.kind !== "ok") return { failure: result.failure };
  const matter = await resolveMatterRecord(fetch, result.value.matterId);
  return { file: result.value, matter };
};
