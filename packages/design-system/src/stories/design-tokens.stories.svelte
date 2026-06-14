<script module lang="ts">
  /*
   * The token board — the catalog's front page and the pipeline smoke test.
   *
   * Every sample is styled with Tailwind utilities generated from the semantic token mapping
   * (bg-action-primary, shadow-elevation-1, text-2xl, ...), NOT raw var() colors, so rendering
   * this story exercises the whole chain: tokens.css custom properties -> tailwind-theme.css
   * @theme mapping -> Tailwind compilation inside Storybook's Vite -> theme x mode toolbar
   * (data-theme + .dark on the preview <html>). If any link breaks, the board renders unstyled.
   *
   * The one deliberate exception: the primitive neutral/brand ramps. Those are intentionally
   * NOT mapped to Tailwind utilities (components must use semantic names), so the board shows
   * them via direct `var(--mc-color-...)` references — still token references, no literals.
   *
   * Each swatch entry carries its FULL literal utility classes: Tailwind's source scanner reads
   * literal class strings, so a computed `bg-${name}` would emit no CSS.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";

  const { Story } = defineMeta({
    title: "Foundations/Design Tokens",
  });

  const surfaceSwatches = [
    { token: "surface-default", classes: "bg-surface-default" },
    { token: "surface-raised", classes: "bg-surface-raised" },
    { token: "surface-sunken", classes: "bg-surface-sunken" },
    { token: "surface-overlay", classes: "bg-surface-overlay" },
  ];

  const textSamples = [
    { token: "text-default", classes: "text-text-default" },
    { token: "text-muted", classes: "text-text-muted" },
    { token: "text-subtle", classes: "text-text-subtle" },
    { token: "text-link", classes: "text-text-link" },
  ];

  const borderSwatches = [
    { token: "border-default", classes: "border-border-default" },
    { token: "border-strong", classes: "border-border-strong" },
    { token: "border-focus", classes: "border-border-focus" },
  ];

  const statusChips = [
    { token: "status-info", classes: "bg-status-info text-status-info-foreground" },
    { token: "status-success", classes: "bg-status-success text-status-success-foreground" },
    { token: "status-warning", classes: "bg-status-warning text-status-warning-foreground" },
    { token: "status-danger", classes: "bg-status-danger text-status-danger-foreground" },
  ];

  const elevationCards = [
    { token: "elevation-0", classes: "shadow-elevation-0" },
    { token: "elevation-1", classes: "shadow-elevation-1" },
    { token: "elevation-2", classes: "shadow-elevation-2" },
    { token: "elevation-3", classes: "shadow-elevation-3" },
  ];

  // Primitive ramp steps as emitted by the token generator (see generated/tokens.css).
  const rampSteps = [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  const ramps = ["neutral", "brand"];

  const typeScale = [
    { token: "text-xs", classes: "text-xs" },
    { token: "text-sm", classes: "text-sm" },
    { token: "text-md", classes: "text-md" },
    { token: "text-lg", classes: "text-lg" },
    { token: "text-xl", classes: "text-xl" },
    { token: "text-2xl", classes: "text-2xl" },
  ];

  const fontWeights = [
    { token: "weight-regular", classes: "font-regular" },
    { token: "weight-medium", classes: "font-medium" },
    { token: "weight-semibold", classes: "font-semibold" },
  ];
</script>

<Story name="Token Board" asChild>
  <main
    aria-label="Design token board"
    class="bg-surface-default text-text-default font-sans flex min-h-screen flex-col gap-32 p-32"
  >
    <h2 class="text-2xl font-semibold tracking-tight">Design tokens</h2>

    <section class="flex flex-col gap-12">
      <h3 class="text-lg font-medium">Surfaces</h3>
      <div class="flex flex-wrap gap-12">
        {#each surfaceSwatches as swatch (swatch.token)}
          <div
            class="border-border-default rounded-md border p-16 {swatch.classes} flex flex-col gap-4"
          >
            <span class="text-sm font-medium">{swatch.token}</span>
            <code class="text-text-subtle font-mono text-xs">.{swatch.classes}</code>
          </div>
        {/each}
      </div>
    </section>

    <section class="flex flex-col gap-12">
      <h3 class="text-lg font-medium">Text</h3>
      <ul class="flex flex-col gap-4">
        {#each textSamples as sample (sample.token)}
          <li class="text-md {sample.classes}">
            {sample.token} — the quick brown fox jumps over the lazy dog
          </li>
        {/each}
        <!-- text-inverse needs a dark backdrop in light mode; text-default-as-background provides one on-token. -->
        <li class="bg-text-default text-text-inverse text-md rounded-sm px-8 py-4">
          text-inverse — the quick brown fox jumps over the lazy dog
        </li>
      </ul>
    </section>

    <section class="flex flex-col gap-12">
      <h3 class="text-lg font-medium">Actions</h3>
      <div class="flex flex-wrap items-center gap-12">
        <button
          type="button"
          class="bg-action-primary text-action-primary-foreground hover:bg-action-primary-hover active:bg-action-primary-active focus-visible:outline-focus-ring rounded-md px-16 py-8 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-0"
        >
          Primary action
        </button>
        <button
          type="button"
          class="bg-action-secondary text-action-secondary-foreground hover:bg-action-secondary-hover border-border-default focus-visible:outline-focus-ring rounded-md border px-16 py-8 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-0"
        >
          Secondary action
        </button>
        <button
          type="button"
          class="bg-action-destructive text-action-destructive-foreground hover:bg-action-destructive-hover focus-visible:outline-focus-ring rounded-md px-16 py-8 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-0"
        >
          Destructive action
        </button>
        <button
          type="button"
          disabled
          class="bg-action-disabled text-action-disabled-foreground rounded-md px-16 py-8 text-sm font-medium"
        >
          Disabled action
        </button>
        <!-- The focus state made always-visible for review (a real control only shows it on
             :focus-visible): the current treatment is a flush MERGED EDGE — the border and the
             ring both take the focus-ring colour at zero offset, one shape, not a detached ring. -->
        <span
          class="border-focus-ring outline-focus-ring rounded-md border px-16 py-8 text-sm outline-2 outline-offset-0"
        >
          focus-ring
        </span>
      </div>
    </section>

    <section class="flex flex-col gap-12">
      <h3 class="text-lg font-medium">Borders</h3>
      <div class="flex flex-wrap gap-12">
        {#each borderSwatches as swatch (swatch.token)}
          <div class="rounded-md border-2 {swatch.classes} bg-surface-default px-16 py-8">
            <code class="font-mono text-xs">{swatch.token}</code>
          </div>
        {/each}
      </div>
    </section>

    <section class="flex flex-col gap-12">
      <h3 class="text-lg font-medium">Status</h3>
      <div class="flex flex-wrap gap-12">
        {#each statusChips as chip (chip.token)}
          <span class="{chip.classes} rounded-full px-12 py-4 text-sm font-medium">
            {chip.token}
          </span>
        {/each}
      </div>
    </section>

    <section class="flex flex-col gap-12">
      <h3 class="text-lg font-medium">Elevation</h3>
      <div class="flex flex-wrap gap-24">
        {#each elevationCards as card (card.token)}
          <div class="bg-surface-raised rounded-lg {card.classes} flex flex-col gap-4 p-16">
            <span class="text-sm font-medium">{card.token}</span>
            <code class="text-text-subtle font-mono text-xs">.{card.classes}</code>
          </div>
        {/each}
      </div>
    </section>

    <section class="flex flex-col gap-12">
      <h3 class="text-lg font-medium">Primitive ramps</h3>
      <p class="text-text-muted text-sm">
        Deliberately not Tailwind utilities — components must use semantic names; shown here via
        direct token references.
      </p>
      {#each ramps as ramp (ramp)}
        <div class="flex flex-col gap-4">
          <code class="text-text-subtle font-mono text-xs">--mc-color-{ramp}-*</code>
          <div class="flex flex-wrap gap-8">
            {#each rampSteps as step (step)}
              <div class="flex flex-col items-center gap-4">
                <div
                  class="border-border-default size-40 rounded-sm border"
                  style="background-color: var(--mc-color-{ramp}-{step})"
                ></div>
                <span class="text-text-subtle text-xs">{step}</span>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </section>

    <section class="flex flex-col gap-12">
      <h3 class="text-lg font-medium">Type scale</h3>
      <ul class="flex flex-col gap-8">
        {#each typeScale as size (size.token)}
          <li class="{size.classes} leading-normal">
            {size.token} — the quick brown fox jumps over the lazy dog
          </li>
        {/each}
      </ul>
      <div class="flex flex-wrap gap-24">
        {#each fontWeights as weight (weight.token)}
          <span class="text-md {weight.classes}">{weight.token}</span>
        {/each}
        <span class="text-md font-mono">font-mono — 0123456789</span>
        <span class="text-md tracking-tight">tracking-tight</span>
        <span class="text-md leading-tight">leading-tight</span>
      </div>
    </section>
  </main>
</Story>
