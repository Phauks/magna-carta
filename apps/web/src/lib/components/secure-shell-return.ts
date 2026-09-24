/*
 * Where the Secure Shell's Close goes: the in-app screen the member came from, or Home.
 *
 * Pure, so the node pool can pin it without rendering Svelte; secure-shell.svelte hands it the
 * navigation that brought the member into the surface and keeps the answer.
 *
 * A FULL PAGE LOAD HAS NO ORIGIN, AND SVELTEKIT DOES NOT SAY SO THE WAY ITS TYPES DO. The entry
 * navigation (`type: "enter"`) runs before the client has recorded any URL, and in the pinned
 * SvelteKit its `from` is an object whose `url` is null — although `NavigationTarget.url` is typed
 * as always a `URL`. Reading `from?.url.pathname` there threw on every direct load of an account
 * page. So the entry navigation is answered by its type, before `from` is read at all, and the
 * `url` is still read as possibly absent for any other shape the runtime may produce.
 */

/** The fields of a SvelteKit navigation this decision reads. */
export interface ShellEntryNavigation {
  readonly type: string;
  readonly from: { readonly url: URL | null } | null;
}

/** Where Close goes when the member arrived with no in-app screen behind them. */
export const SECURE_SHELL_FALLBACK_RETURN = "/home";

export function secureShellReturnTarget(navigation: ShellEntryNavigation): string {
  if (navigation.type === "enter") return SECURE_SHELL_FALLBACK_RETURN;
  const origin = navigation.from?.url?.pathname;
  return origin === undefined || origin === "" ? SECURE_SHELL_FALLBACK_RETURN : origin;
}
