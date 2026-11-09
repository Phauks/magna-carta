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

// One block per theme-and-mode permutation, derived from data: a new theme is a
// one-element addition here (and a resolver context). Chancery first: the flagship,
// whose light permutation doubles as the default set plugin-tailwind reads.
const themes = ["chancery", "verdigris", "parchment", "oxblood", "aubergine", "slate"];
const modes = ["light", "dark"];
const themeModePermutations = themes.flatMap((theme) =>
  modes.map((mode) => ({
    input: { theme, mode },
    prepare: (css) => `:root[data-theme="${theme}"]${mode === "dark" ? ".dark" : ""} {\n${css}\n}`,
  })),
);

// The motion axis re-points the duration ladder only (theme- and mode-invariant), so each level
// is ONE small overlay block scoped to the duration namespace — emitted AFTER the theme x mode
// blocks so it wins the duration variables at equal (0,2,0) specificity. "full" is the primitive
// truth and needs no overlay.
const motionPermutations = ["reduced", "off"].map((motion) => ({
  input: { theme: "chancery", mode: "light", motion },
  include: ["duration.*"],
  prepare: (css) => `:root[data-motion="${motion}"] {\n${css}\n}`,
}));

// Same shape for the density axis: compact re-points the density.* aliases only (dimensions are
// theme- and mode-invariant); "comfortable" is the semantic truth and needs no overlay.
const densityPermutations = ["compact"].map((density) => ({
  input: { theme: "chancery", mode: "light", density },
  include: ["density.*"],
  prepare: (css) => `:root[data-density="${density}"] {\n${css}\n}`,
}));

// Same shape for the typeface axis: each non-default reading face re-points font.sans only (a font
// stack is theme-, mode- and density-invariant); "atkinson" is the primitive truth and needs no
// overlay.
const typefacePermutations = ["lexend", "opendyslexic", "serif", "system"].map((typeface) => ({
  input: { theme: "chancery", mode: "light", typeface },
  include: ["font.sans"],
  prepare: (css) => `:root[data-typeface="${typeface}"] {\n${css}\n}`,
}));

const permutations = [
  ...themeModePermutations,
  ...densityPermutations,
  ...motionPermutations,
  ...typefacePermutations,
];

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
        // No `sans` here: the plugin would inline the resolved stack, freezing font-sans (and the
        // document's default face, which Tailwind's base layer reads from it) to Atkinson. The
        // reading face is a user axis (:root[data-typeface=…] re-points --mc-font-sans), so sans
        // is hand-mapped in tailwind.template.css's @theme inline block onto the variable.
        font: {
          mono: "font.mono",
        },
        // Tailwind's text-* SIZE utilities map to the font-size.* primitives; the token group is
        // named font-size so its variables (--mc-font-size-*) cannot collide with the semantic
        // text COLOR roles (--mc-text-*).
        text: {
          xs: "font-size.xs",
          sm: "font-size.sm",
          md: "font-size.md",
          lg: "font-size.lg",
          xl: "font-size.xl",
          "2xl": "font-size.2xl",
          "3xl": "font-size.3xl",
        },
        // weight.display is deliberately NOT mapped: the display register enters only through
        // the Masthead component (same reasoning as font.display staying unmapped).
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
          settle: "easing.settle",
          travel: "easing.travel",
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
