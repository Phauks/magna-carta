/*
 * The editor's page, without the editor vendor's logo in its corner.
 *
 * The editor draws its logo when the page's hidden `init-logo-url` field is empty, and hides it when
 * that field reads the word `none` (its own rule, in the editor's page script). The community build
 * of the image leaves the field empty and offers no setting that fills it, so the worker in front
 * of the container fills it: one attribute on one element of one page, rewritten as the page
 * streams through. Nothing is injected, because the page's own policy allows no inline style or
 * script; the field is the editor's own switch, and this only throws it.
 *
 * Only the editor page is touched: a response that is not HTML, not a 200, or carries a WebSocket
 * is handed back exactly as the container answered it. The upgrade in particular must never be
 * rebuilt (embedding-policy.ts says why), which is why that check comes first and needs no header.
 */

/** The hidden field the editor reads its logo URL from, and the value that means "draw none". */
export const LOGO_FIELD_SELECTOR = "input#init-logo-url";
export const NO_LOGO = "none";

/** The one element edit: the field's value becomes the editor's own word for "no logo". */
export const logoFieldHandler = {
  element(element: { setAttribute(name: string, value: string): unknown }): void {
    element.setAttribute("value", NO_LOGO);
  },
};

/** The slice of the runtime's streaming HTML rewriter this module drives; a test stands in for it. */
export interface PageRewriter {
  on(selector: string, handler: typeof logoFieldHandler): PageRewriter;
  transform(response: Response): Response;
}

/** Whether a container answer is the editor page: a successful HTML document, not an upgrade. */
export function isEditorPage(response: Response): boolean {
  if ((response as { webSocket?: unknown }).webSocket != null || response.status === 101) {
    return false;
  }
  if (response.status !== 200) return false;
  const type = response.headers.get("content-type") ?? "";
  return type.toLowerCase().startsWith("text/html");
}

/**
 * The container's answer with the logo field switched off where it is the editor page, and the
 * answer itself, by identity, everywhere else. The rewriter is the runtime's `HTMLRewriter` unless a
 * caller supplies its own, which is how the node test pool exercises the decision.
 */
export function withoutEditorLogo(
  response: Response,
  rewriter: () => PageRewriter = () => new HTMLRewriter() as unknown as PageRewriter,
): Response {
  if (!isEditorPage(response)) return response;
  return rewriter().on(LOGO_FIELD_SELECTOR, logoFieldHandler).transform(response);
}
