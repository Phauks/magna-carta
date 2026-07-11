/*
 * The post-sign-in return destination — pure, so its open-redirect guard is unit-tested rather than
 * only reasoned about. The login page reads `next` off the query string and hands the raw value
 * here; only a LOCAL same-origin path is honoured, so a crafted `next` can never bounce a
 * just-authenticated user off-site. Kept beside the login route (its only caller) as a plain module,
 * following the tools-view-preference split (pure `.ts` for the logic, `.svelte` for the surface).
 */

/** Where sign-in lands when there is no usable return path. */
export const DEFAULT_RETURN_PATH = "/home";

/**
 * The safe destination after sign-in: `next` when it is a local same-origin path, otherwise the
 * default. Everything that could leave the origin is rejected:
 * - an absolute URL (`https://evil…`, `javascript:…`) — does not start with `/`;
 * - a protocol-relative path (`//host`) — the browser reads `host` as the authority;
 * - a backslash-authority trick (`/\host`) — some browsers normalize `\` to `/`, making it `//host`.
 * A leading single `/` that is none of those addresses this origin, so it is returned unchanged
 * (query and fragment preserved).
 */
export function safeReturnPath(next: string | null): string {
  if (next === null || !next.startsWith("/")) return DEFAULT_RETURN_PATH;
  if (next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_RETURN_PATH;
  return next;
}
