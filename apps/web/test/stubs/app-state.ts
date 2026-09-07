/*
 * `$app/state` for tests that mount a component. SvelteKit's plugin is deliberately absent from the
 * web test config (vitest.config.ts says why), so nothing provides the module — and a `.svelte` file
 * importing it fails at Vite's import analysis before `vi.mock` can step in. The alias in
 * vitest.config.ts points here instead, and a test sets the address it needs on `page` directly.
 *
 * Only the shape the app reads: the address and the route-level status and error. Everything else
 * is present so a component that spreads the page does not trip, and nothing here is reactive.
 */

export const page: {
  url: URL;
  params: Record<string, string>;
  route: { id: string | null };
  status: number;
  error: App.Error | null;
  data: Record<string, unknown>;
  form: unknown;
  state: Record<string, unknown>;
} = {
  url: new URL("https://magna-carta.test/"),
  params: {},
  route: { id: null },
  status: 200,
  error: null,
  data: {},
  form: null,
  state: {},
};

export const navigating = {
  from: null,
  to: null,
  type: null,
  willUnload: null,
  delta: null,
  complete: null,
};

/** The version poll's answer: no newer bundle, ever, in a test. */
export const updated = { current: false, check: async (): Promise<boolean> => false };
