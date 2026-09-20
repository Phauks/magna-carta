/*
 * `$app/navigation` for tests that mount a component. The twin of ./app-state.ts, and here for the
 * same reason: SvelteKit's plugin is deliberately absent from the web test config
 * (vitest.config.ts says why), so nothing resolves the module — and a `.svelte` file importing it
 * fails at Vite's IMPORT ANALYSIS, before `vi.mock` can step in. So the alias is what makes such a
 * component mountable at all; a test that cares where a component went reads `navigations`.
 *
 * Nothing here navigates. A test asserting a destination asserts on what was recorded, and a test
 * that does not care is unaffected by a component going somewhere.
 */

/** Every address `goto` was asked for, in order. A test clears it in its own setup. */
export const navigations: string[] = [];

export function goto(url: string | URL): Promise<void> {
  navigations.push(String(url));
  return Promise.resolve();
}

export function invalidate(): Promise<void> {
  return Promise.resolve();
}

export function invalidateAll(): Promise<void> {
  return Promise.resolve();
}

export function preloadData(): Promise<{ type: "loaded"; status: number; data: unknown }> {
  return Promise.resolve({ type: "loaded", status: 200, data: {} });
}

export function preloadCode(): Promise<void> {
  return Promise.resolve();
}

export function pushState(): void {}

export function replaceState(): void {}

export function beforeNavigate(): void {}

export function afterNavigate(): void {}

export function onNavigate(): void {}

export function disableScrollHandling(): void {}
