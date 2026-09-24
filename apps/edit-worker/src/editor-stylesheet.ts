/*
 * The platform's own stylesheet inside the editor: served by this worker on the editor's origin,
 * and linked into the editor page as it streams through.
 *
 * WHY A STYLESHEET, AND WHY HERE. The editor draws the platform's back button on its own bar, and
 * the message that puts it there decides nothing about where it lands or how its icon is coloured:
 * the editor appends a host's buttons after its own and shows the icon exactly as given, so the
 * button arrived last on the bar with a black arrow among the editor's own white icons in dark
 * mode. The editor's page allows styles from its own origin and nowhere else (`style-src 'self'`),
 * and nothing inline, so the one way to style what the editor draws is a stylesheet on that
 * origin, which this worker IS. The rules are the platform's and change with the platform's
 * screens, so they live in the worker rather than in the image, on the same reasoning as the
 * embedding policy.
 *
 * WHAT THE RULES DO. The editor's shortcuts bar is one table row of cells; laying the row out as a
 * flex line lets the host's cell be ordered first, which puts the back button where a way back
 * belongs. In the editor's dark theme its own icons are separate light drawings; the host's icon is
 * one drawing, so it is inverted there, which is the editor's own device for the images it cannot
 * redraw. And the bar draws no words at all (its builder switches labels off for every button and
 * keeps the text as the tooltip), so the matter's number the host sends as the button's label is
 * drawn beside the icon from that tooltip attribute, cut to a fixed width with an ellipsis; the
 * editor's own tooltip shows the whole number on hover. A rule that does not match (a future
 * editor renaming its classes) leaves the button where the editor put it, coloured and worded as
 * the editor drew it: nothing here can break the editor.
 *
 * Only the editor page gains the link; assets, refusals and the WebSocket upgrade are handed back
 * exactly as the container answered them (editor-branding.ts says why the upgrade check comes
 * first and needs no header).
 */
import { isEditorPage } from "./editor-branding.ts";

/**
 * Where the stylesheet is served on the editor's origin. Under a path coolwsd never serves
 * (`/browser/`, `/cool/`, `/hosting/` are its), so the worker can answer it before the container
 * is asked and a container that is not up yet cannot make the page's styles fail.
 */
export const EDITOR_STYLESHEET_PATH = "/magna-carta/editor.css";

/** The class the editor puts on every button a host inserts, on the shortcuts bar. */
const HOST_BUTTON_CLASS = "integrator-shortcut";

/**
 * How much of the matter's number shows beside the arrow before the ellipsis. Twelve characters
 * fits the firm's numbering shapes ("2026-CV-0012") and keeps the bar's own buttons in reach;
 * the whole number is one hover away.
 */
export const BACK_LABEL_CHARACTERS = 12;

/** The attribute the editor keeps a bar button's words in, since it draws no label there. */
const TOOLTIP_ATTRIBUTE = "data-cooltip";

export const EDITOR_STYLESHEET = `/* Magna Carta: the platform's presence on the editor's bar. */
.notebookbar-shortcuts-bar > table > tbody > tr {
  display: flex;
  align-items: center;
}
.notebookbar-shortcuts-bar td.cell:has(> .${HOST_BUTTON_CLASS}) {
  order: -1;
}
html[data-theme='dark'] .notebookbar-shortcuts-bar .${HOST_BUTTON_CLASS} img {
  filter: invert(0.9);
}
.notebookbar-shortcuts-bar .${HOST_BUTTON_CLASS} {
  display: flex;
  align-items: center;
}
.notebookbar-shortcuts-bar .${HOST_BUTTON_CLASS}::after {
  content: attr(${TOOLTIP_ATTRIBUTE});
  display: inline-block;
  max-inline-size: ${String(BACK_LABEL_CHARACTERS)}ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-inline-end: 4px;
  font-size: 12px;
  line-height: 1;
}
#magna-carta-build {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-block-start: 1em;
}
#magna-carta-build .mc-about-label {
  font-weight: bold;
}
#magna-carta-build .mc-about-row {
  display: flex;
  gap: 8px;
}
#magna-carta-build .mc-about-key {
  min-inline-size: 7em;
  opacity: 0.75;
}
#magna-carta-build a {
  color: inherit;
  text-decoration: underline;
}
`;

/** The one element edit: the link, appended to the page's head. */
export const HEAD_SELECTOR = "head";
export const STYLESHEET_LINK = `<link rel="stylesheet" href="${EDITOR_STYLESHEET_PATH}">`;

export const stylesheetLinkHandler = {
  element(element: { append(content: string, options: { html: boolean }): unknown }): void {
    element.append(STYLESHEET_LINK, { html: true });
  },
};

/** The slice of the runtime's streaming HTML rewriter this module drives; a test stands in for it. */
export interface HeadRewriter {
  on(selector: string, handler: typeof stylesheetLinkHandler): HeadRewriter;
  transform(response: Response): Response;
}

/** Whether a request on a document's origin is for the stylesheet rather than for the editor. */
export function isStylesheetRequest(request: Request): boolean {
  return request.method === "GET" && new URL(request.url).pathname === EDITOR_STYLESHEET_PATH;
}

/**
 * The stylesheet itself. Cached briefly: the page links it on every open, a deploy changes it, and
 * an hour is the longest a stale copy can outlive the worker that served it.
 */
export function stylesheetResponse(): Response {
  return new Response(EDITOR_STYLESHEET, {
    status: 200,
    headers: {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

/**
 * The container's answer with the stylesheet linked where it is the editor page, and the answer
 * itself, by identity, everywhere else. The rewriter is the runtime's `HTMLRewriter` unless a
 * caller supplies its own, which is how the node test pool exercises the decision.
 */
export function withEditorStylesheet(
  response: Response,
  rewriter: () => HeadRewriter = () => new HTMLRewriter() as unknown as HeadRewriter,
): Response {
  if (!isEditorPage(response)) return response;
  return rewriter().on(HEAD_SELECTOR, stylesheetLinkHandler).transform(response);
}
