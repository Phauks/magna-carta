/*
 * The Documents surface's honest inventory of what runs and what does not.
 *
 * Same rule as the sign-in surface's unbuilt-capability list (apps/web/src/lib/auth/unbuilt-capabilities.ts):
 * a control is never rendered as though it worked. The difference here is that nothing on this
 * surface is unbuilt — every step of the loop has a real route behind it — but one step depends on a
 * runtime that is a DEPLOY-time activation, so it is live in production and inert on a developer's
 * machine. That distinction is what this module records, so the screen states it instead of showing
 * a blank frame and letting the person conclude the feature is broken.
 *
 * Verified against apps/worker/src/editing/CLAUDE.md, apps/worker/src/editing/edit-session-route.ts,
 * and apps/magna-carta-edit/. Delete an entry when its runtime lands; every consumer follows.
 */

export interface LoopStep {
  /** A stable key so a surface can ask about one step without matching on prose. */
  id: string;
  /** What the person is trying to do. */
  label: string;
  /**
   * `live` — works wherever the app runs. `deployed-only` — the routes are real and are called for
   * real, but the runtime that finishes the job exists only in a deployed environment.
   */
  reach: "live" | "deployed-only";
  /** One sentence: what actually happens when this step is taken, stated without euphemism. */
  behaviour: string;
}

export const DOCUMENT_LOOP_STEPS: readonly LoopStep[] = [
  {
    id: "list",
    label: "See the matter's documents",
    reach: "live",
    behaviour:
      "Reads the matter's document rows, including the ones still being scanned and the ones the scanner rejected.",
  },
  {
    id: "create-upload",
    label: "Add a document from a file",
    reach: "live",
    behaviour:
      "Runs the full four-step upload: the host reserves a version and signs a URL, the bytes go straight to object storage, and the scan gate decides whether they are servable.",
  },
  {
    id: "create-template",
    label: "Build a document from a template",
    reach: "live",
    behaviour:
      "Submits a real assembly job against the firm's template catalogue and polls it; the produced document enters the matter through the same upload and scan path as any other.",
  },
  {
    id: "create-template-pdf",
    label: "Build that document as a PDF",
    reach: "deployed-only",
    behaviour:
      "The job is submitted for real and asks for a PDF, which the host produces by converting the merged document through the office suite before filing it. That suite runs in a container the convert worker owns, which is a deploy step; where it is not reachable the job fails and says so rather than quietly filing a Word document instead.",
  },
  {
    id: "edit-in-browser",
    label: "Edit a document in the browser",
    reach: "deployed-only",
    behaviour:
      "The editing session is opened for real — the document moves to co-editing, the open is audited, and a signed single-document token is minted. The editor itself is served by a per-document container in the magna-carta-edit worker, which is a deploy step; on a developer's machine that origin answers nothing, so the frame stays empty.",
  },
  {
    id: "save-version",
    label: "Save a new version",
    reach: "live",
    behaviour:
      "Puts the edited bytes back onto the same document through the upload ceremony, which cuts a new immutable version and moves the document's current pointer to it.",
  },
  {
    id: "version-history",
    label: "See the versions",
    reach: "live",
    behaviour:
      "Reads the document's committed versions, newest first, with the size and hash of each.",
  },
];

export function loopStep(id: string): LoopStep {
  const found = DOCUMENT_LOOP_STEPS.find((step) => step.id === id);
  if (found === undefined) {
    throw new Error(`No document loop step is registered under "${id}".`);
  }
  return found;
}
