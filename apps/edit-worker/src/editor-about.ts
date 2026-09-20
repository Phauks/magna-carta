/*
 * The platform's build, stated inside the editor's own About dialog.
 *
 * The editor is the whole screen while a document is open, and its Help menu has an About dialog
 * that names the editor's versions (coolwsd, LOKit). Nothing there said which build of the
 * platform was serving the document, and the app's version panel is a screen away. So the worker
 * in front of the container adds one block to that dialog as the page streams through: the build
 * this worker was built from. Every Worker in one deploy reports the same commit
 * (@magna-carta/build-identity), so this worker's identity IS the platform's build for the deploy
 * that served the page, and the app's version panel is where the rest (each service, its
 * timestamps) is read.
 *
 * The block is appended to the container the editor fills with its own version rows, after them,
 * so the editor's script (which appends its rows and moves one existing element) never meets it.
 * A development build says so rather than inventing a version. Only the editor page is touched;
 * assets, refusals and the WebSocket upgrade are handed back exactly as the container answered
 * (editor-branding.ts says why the upgrade check comes first and needs no header).
 */
import {
  BUILD_IDENTITY,
  isDevelopmentBuildIdentity,
  type BuildIdentity,
} from "@magna-carta/build-identity/build-identity";
import { isEditorPage } from "./editor-branding.ts";

/** The About dialog's info container: the editor's version rows go inside; ours goes after them. */
export const ABOUT_INFO_SELECTOR = "#about-dialog-info-container";

/** The id of the block, for the stylesheet and for anyone reading the page. */
export const BUILD_BLOCK_ID = "magna-carta-build";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** "2026-09-19T21:04:11.000Z" as "2026-09-19 21:04 UTC": the date a person reads, not a timestamp. */
function readableInstant(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return match === null ? iso : `${match[1]} ${match[2]} UTC`;
}

/** The block's lines: what build, when it was committed, when it was built. */
export function buildLines(identity: BuildIdentity): readonly string[] {
  if (isDevelopmentBuildIdentity(identity)) return ["Magna Carta: development build"];
  const lines = [`Magna Carta build ${identity.commit}`];
  if (identity.commitTime !== null) lines.push(`Committed ${readableInstant(identity.commitTime)}`);
  if (identity.buildTime !== null) lines.push(`Built ${readableInstant(identity.buildTime)}`);
  return lines;
}

/** The block as HTML, in the dialog's own row class so it takes the dialog's type and spacing. */
export function buildBlockHtml(identity: BuildIdentity): string {
  const rows = buildLines(identity)
    .map((line) => `<div dir="ltr">${escapeHtml(line)}</div>`)
    .join("");
  return `<div id="${BUILD_BLOCK_ID}" class="about-dialog-info-div">${rows}</div>`;
}

/** The one element edit: the block, appended after the editor's own version rows. */
export function buildBlockHandler(identity: BuildIdentity) {
  return {
    element(element: { append(content: string, options: { html: boolean }): unknown }): void {
      element.append(buildBlockHtml(identity), { html: true });
    },
  };
}

/** The slice of the runtime's streaming HTML rewriter this module drives; a test stands in for it. */
export interface AboutRewriter {
  on(selector: string, handler: ReturnType<typeof buildBlockHandler>): AboutRewriter;
  transform(response: Response): Response;
}

/**
 * The container's answer with the platform's build in its About dialog where it is the editor
 * page, and the answer itself, by identity, everywhere else.
 */
export function withBuildIdentity(
  response: Response,
  identity: BuildIdentity = BUILD_IDENTITY,
  rewriter: () => AboutRewriter = () => new HTMLRewriter() as unknown as AboutRewriter,
): Response {
  if (!isEditorPage(response)) return response;
  return rewriter().on(ABOUT_INFO_SELECTOR, buildBlockHandler(identity)).transform(response);
}
