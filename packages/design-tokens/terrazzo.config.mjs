import { defineConfig } from "@terrazzo/cli";
import pluginCSS from "@terrazzo/plugin-css";
import pluginTailwind from "@terrazzo/plugin-tailwind";

/**
 * Every generated CSS custom property is namespaced `--mc-` and uses the full
 * token path with dashes (e.g. `surface.default` becomes `--mc-surface-default`).
 */
function variableName(token) {
  return `--mc-${token.id.replace(/\./g, "-")}`;
}

export default defineConfig({
  // The resolver document is the single entry point; it pulls in every token file.
  tokens: "./resolver.json",
  outDir: "./generated/",
  plugins: [
    pluginCSS({
      filename: "tokens.css",
      variableName,
      // One block per theme-and-mode permutation. Light first: the first
      // permutation doubles as the default set plugin-tailwind reads.
      permutations: [
        {
          input: { theme: "slate", mode: "light" },
          prepare: (css) => `:root[data-theme="slate"] {\n${css}\n}`,
        },
        {
          input: { theme: "slate", mode: "dark" },
          prepare: (css) => `:root[data-theme="slate"].dark {\n${css}\n}`,
        },
      ],
    }),
    pluginTailwind({
      // Resolved relative to outDir, hence the leading "../".
      template: "../tailwind.template.css",
      filename: "tailwind-theme.css",
      theme: {
        // No `color` mapping: the plugin inlines resolved alias targets (primitives),
        // which would freeze semantic color utilities to light mode. Semantic colors
        // are hand-mapped in tailwind.template.css via @theme inline instead, and
        // primitive ramps are deliberately not exposed as Tailwind utilities.
        spacing: ["space.*"],
        radius: ["radius.*"],
        shadow: ["elevation.*"],
        font: {
          sans: "font.sans",
          mono: "font.mono",
        },
        text: {
          xs: "text.xs",
          sm: "text.sm",
          md: "text.md",
          lg: "text.lg",
          xl: "text.xl",
          "2xl": "text.2xl",
        },
        "font-weight": {
          regular: "weight.regular",
          medium: "weight.medium",
          semibold: "weight.semibold",
        },
        leading: {
          tight: "leading.tight",
          normal: "leading.normal",
          relaxed: "leading.relaxed",
        },
        tracking: {
          tight: "tracking.tight",
          normal: "tracking.normal",
        },
        ease: {
          standard: "easing.standard",
          decelerate: "easing.decelerate",
          accelerate: "easing.accelerate",
        },
      },
    }),
  ],
});
