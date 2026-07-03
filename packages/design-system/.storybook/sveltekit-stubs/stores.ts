/* $app/stores stub for the non-SvelteKit Storybook (aliased in .storybook/main.ts). Minimal page +
   navigating stores so superforms' `import { navigating, page } from "$app/stores"` resolves. */
import { readable } from "svelte/store";

export const page = readable({
  url: new URL("http://localhost/"),
  params: {},
  route: { id: null },
  status: 200,
  error: null,
  data: {},
  form: undefined,
  state: {},
});

export const navigating = readable(null);
export const updated = Object.assign(readable(false), {
  check: async (): Promise<boolean> => false,
});
