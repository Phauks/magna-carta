/* $app/state stub for the non-SvelteKit Storybook (aliased in .storybook/main.ts). superforms reads
   `page` and `navigating` from "$app/state"; the catalog never navigates, so these are the values a
   page at rest has: an empty page at the root, and no navigation in flight. */
export const page = {
  url: new URL("http://localhost/"),
  params: {},
  route: { id: null },
  status: 200,
  error: null,
  data: {},
  form: undefined,
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

export const updated = { current: false, check: async (): Promise<boolean> => false };
