/*
 * Storybook 10 catalog configuration — the owner's primary review surface for the component build
 * (spec: "Catalog, testing & enforcement", docs/specs/2026-06-10-design-system-foundation-design.md).
 *
 * Framework is @storybook/svelte-vite (this is a plain Vite package, not a SvelteKit app).
 * Storybook runs its own Vite here: the repo overrides `vite` to @voidzero-dev/vite-plus-core
 * (pnpm-workspace.yaml `overrides`), which is the Vite 8 distribution re-published under the
 * Vite+ name — it exports the real Vite API and `version` ("8.0.16"), so Storybook's builder
 * accepts it unmodified (plan "Decided up front" 9; verified empirically by `storybook build`).
 */
import type { StorybookConfig } from "@storybook/svelte-vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

const config: StorybookConfig = {
  framework: "@storybook/svelte-vite",
  stories: ["../src/stories/**/*.stories.svelte"],
  addons: [
    // Native Svelte story files (.stories.svelte, defineMeta API).
    "@storybook/addon-svelte-csf",
    // Axe per story; parameters.a11y.test = "error" in preview.ts makes violations FAIL tests.
    "@storybook/addon-a11y",
    // Runs stories as browser-mode Vitest tests (the "storybook" project in ../vitest.config.ts).
    "@storybook/addon-vitest",
  ],
  async viteFinal(viteConfiguration) {
    viteConfiguration.plugins ??= [];
    // The Svelte compiler plugin. @storybook/svelte-vite does NOT register it — upstream assumes
    // the project's own vite.config.ts provides it, and this package deliberately has no
    // vite.config.ts (vp's lint pass loads every workspace vite.config.ts from the repo root;
    // see the apps/web/vite.config.ts cwd-guard comment). Without it, every .svelte file —
    // including Storybook's own PreviewRender.svelte — reaches the bundler raw and the build
    // fails with parse errors. It must be UNSHIFTED, not pushed: the framework's docgen plugin
    // and addon-svelte-csf's story transform both expect already-COMPILED output (they call
    // this.parse on JavaScript), and within the same enforce bucket Vite runs plugins in array
    // order — exactly the upstream layout, where svelte() sits in the project's base config
    // ahead of everything the Storybook presets append.
    viteConfiguration.plugins.unshift(svelte());
    // Tailwind v4 processing inside Storybook's own Vite (and inside the addon-vitest browser
    // project, which applies this same viteFinal): compiles .storybook/preview.css — the
    // Tailwind entry that imports tokens + theme mapping + component recipes in the canonical
    // order (mirrors apps/web/src/app.css).
    viteConfiguration.plugins.push(tailwindcss());
    return viteConfiguration;
  },
};

export default config;
