/*
 * Ambient app types. `App.Error` is the shape every error surface reads off `page.error`, so the
 * Error ID the client boundary mints is declared here rather than cast at each surface.
 *
 * Written as a plain ambient declaration — no imports, no `export {}` — because that is what makes
 * it merge with the `App` namespace SvelteKit already declares globally. Wrapped in `declare global`
 * inside a module, it silently does not merge, and every reader of `errorId` fails to compile while
 * the file looks correct.
 */
declare namespace App {
  interface Error {
    message: string;
    /**
     * The handle a person can quote. `error_…` when the platform minted one and it reached the
     * client; `client_…` when the failure never got that far — a crash inside a component, an
     * unhandled rejection — and the client minted its own so the failure is still reportable.
     */
    errorId?: string;
  }
}
