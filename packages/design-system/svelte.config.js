import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Plain Svelte package config (no SvelteKit — mirrors apps/web-worker/svelte.config.js minus `kit`).
// Required: without a package-level svelte config, svelte-check walks up to the repo-root
// vite.config.ts and fails ("No Svelte configuration found in vite config"), and Storybook's
// vite-plugin-svelte logs a "no Svelte config found" fallback on every boot. vitePreprocess
// keeps preprocessing identical to the app (Svelte 5 handles lang="ts" scripts natively;
// vitePreprocess covers style blocks, which the design system forbids anyway — token recipes
// live in components.css).
export default {
  preprocess: vitePreprocess(),
};
