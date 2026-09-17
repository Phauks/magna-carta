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
import { editorKindOf } from "$lib/documents/editable-documents.ts";
import { readMatterFile, type MatterFile } from "$lib/file-manager/matter-file-api.ts";
import { resolveMatterRecord, type MatterRecord } from "$lib/matters/matter-record.ts";
import type { PageLoad } from "./$types";

/**
 * What the page renders from: the document and its matter, or the failure that stood in the way.
 *
 * `shell: "none"` is the page telling the app layout to draw no rail, no top bar and no screen
 * header around it (the owner's direction: when a document is open, the editor is the whole
 * screen, and the way to act on the platform from inside it is the editor's own controls, built
 * next). It is declared here, in the load, because it is a fact about what this address renders
 * rather than a state the page reaches: the layout reads it before the page mounts, so the shell
 * never draws and then disappears. It is set only when the editor will render — a failure, a
 * withheld file and a format with no editor keep the shell, because each of those is a message
 * that needs the way back around it.
 */
export type DocumentEditPageData =
  | {
      readonly file: MatterFile;
      readonly matter: MatterRecord | undefined;
      readonly failure?: undefined;
      readonly shell?: "none";
    }
  | {
      readonly failure: Failure;
      readonly file?: undefined;
      readonly matter?: undefined;
      readonly shell?: undefined;
    };

export const load: PageLoad = async ({ fetch, params }): Promise<DocumentEditPageData> => {
  const result = await readMatterFile(fetch, params.id);
  if (result.kind === "problem" && result.problem.status === 404) {
    error(404, "Not Found");
  }
  if (result.kind !== "ok") return { failure: result.failure };
  const matter = await resolveMatterRecord(fetch, result.value.matterId);
  const file = result.value;
  const rendersEditor = editorKindOf(file) !== null && file.scanVerdict !== "flagged";
  return rendersEditor ? { file, matter, shell: "none" } : { file, matter };
};
