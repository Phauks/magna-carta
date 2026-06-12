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

// One block per theme-and-mode permutation, derived from data: theme #2 is a
// one-element addition here. Light first: the first permutation doubles as the
// default set plugin-tailwind reads.
const themes = ["slate"];
const modes = ["light", "dark"];
const permutations = themes.flatMap((theme) =>
  modes.map((mode) => ({
    input: { theme, mode },
    prepare: (css) => `:root[data-theme="${theme}"]${mode === "dark" ? ".dark" : ""} {\n${css}\n}`,
  })),
);

export default defineConfig({
  // The resolver document is the single entry point; it pulls in every token file.
  tokens: "./resolver.json",
  outDir: "./generated/",
  plugins: [
    pluginCSS({
      filename: "tokens.css",
      variableName,
      permutations,
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
        // No `shadow` mapping either: elevation is hand-mapped in the template's
        // @theme inline block onto --mc-elevation-*, keeping it mode-responsive.
        spacing: ["space.*"],
        radius: ["radius.*"],
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
        // Tailwind v4 namespace names verified against the installed tailwindcss 4.3.0:
        // `duration-*` utilities resolve the --transition-duration-* theme keys and
        // `z-*` utilities resolve --z-index-* — NOT --duration-*/--z-*, which would emit
        // dead variables and no utilities.
        "transition-duration": ["duration.*"],
        "z-index": ["z.*"],
      },
    }),
  ],
});
