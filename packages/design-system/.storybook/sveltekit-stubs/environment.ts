/* $app/environment stub — the design-system Storybook is plain Vite, not SvelteKit, so superforms'
   `import { browser } from "$app/environment"` is aliased here (see .storybook/main.ts). */
export const browser = true;
export const dev = false;
export const building = false;
export const version = "storybook";
