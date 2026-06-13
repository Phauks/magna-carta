<script module lang="ts">
  /*
   * Button — the Tier 1 exemplar story (the normative pattern sibling components copy).
   *
   * Stories cover every variant x size, plus disabled and href (anchor) cases. They triple as
   * browser-mode behavior tests (the play functions below) and per-story axe checks
   * (.storybook/preview.ts sets a11y.test = "error", so violations fail). Visual styling comes
   * entirely from the mc-button recipe in src/lib/styles/components.css.
   *
   * defineMeta + Story is the svelte-csf v5 API (@storybook/addon-svelte-csf). Each Story's
   * `name` must be a STATIC literal string (the addon analyses it at compile time), so the
   * variant x size matrix is enumerated explicitly rather than generated in a loop. A single
   * shared `template` snippet renders the styled Button with the story's args and a label child.
   * Behavior assertions use expect/userEvent/fn from storybook/test (Storybook 10's bundled
   * test utilities).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, fn, userEvent } from "storybook/test";
  import Button from "../lib/components/button/index.ts";
  import type { ButtonSize } from "../lib/components/button/variants.ts";

  const { Story } = defineMeta({
    title: "Components/Button",
    component: Button,
    args: { variant: "primary", size: "default" },
    argTypes: {
      variant: {
        control: "select",
        options: ["primary", "secondary", "destructive", "ghost", "link"],
      },
      size: { control: "select", options: ["sm", "default", "lg", "icon"] },
    },
  });

  // The template snippet's args are the Button's own props (svelte-csf infers this type from
  // `component` above), so annotate snippets with it for type-safe story authoring.
  type ButtonStoryArgs = ComponentProps<typeof Button>;

  /** The visible label for a cell: icon sizes show a single glyph, the rest a word. */
  function cellLabel(size: ButtonSize | undefined): string {
    return size === "icon" ? "B" : "Button";
  }
</script>

<!-- Shared template: the styled Button with the story's args and a label child. -->
{#snippet template(args: ButtonStoryArgs)}
  <Button {...args}>{cellLabel(args.size)}</Button>
{/snippet}

<!-- Variant x size matrix — names are static literals (svelte-csf requirement). -->
<Story name="Primary / sm" args={{ variant: "primary", size: "sm" }} {template} />
<!-- The native-element, type, and focus-receipt checks ride this representative matrix cell's
     play function (run automatically) rather than separate behavior-only stories. -->
<Story
  name="Primary / default"
  args={{ variant: "primary", size: "default" }}
  {template}
  play={async ({ canvas }) => {
    const control = canvas.getByRole("button", { name: "Button" });
    await expect(control.tagName).toBe("BUTTON");
    // A bare action button must declare type=button so it never acts as a form submit.
    await expect(control).toHaveAttribute("type", "button");
    // Focus RECEIPT only — not the :focus-visible heuristic (runner-dependent; VRT owns the ring).
    await userEvent.tab();
    await expect(control).toHaveFocus();
  }}
/>
<Story name="Primary / lg" args={{ variant: "primary", size: "lg" }} {template} />
<Story name="Primary / icon" args={{ variant: "primary", size: "icon" }} {template} />

<Story name="Secondary / sm" args={{ variant: "secondary", size: "sm" }} {template} />
<Story name="Secondary / default" args={{ variant: "secondary", size: "default" }} {template} />
<Story name="Secondary / lg" args={{ variant: "secondary", size: "lg" }} {template} />
<Story name="Secondary / icon" args={{ variant: "secondary", size: "icon" }} {template} />

<Story name="Destructive / sm" args={{ variant: "destructive", size: "sm" }} {template} />
<Story name="Destructive / default" args={{ variant: "destructive", size: "default" }} {template} />
<Story name="Destructive / lg" args={{ variant: "destructive", size: "lg" }} {template} />
<Story name="Destructive / icon" args={{ variant: "destructive", size: "icon" }} {template} />

<Story name="Ghost / sm" args={{ variant: "ghost", size: "sm" }} {template} />
<Story name="Ghost / default" args={{ variant: "ghost", size: "default" }} {template} />
<Story name="Ghost / lg" args={{ variant: "ghost", size: "lg" }} {template} />
<Story name="Ghost / icon" args={{ variant: "ghost", size: "icon" }} {template} />

<Story name="Link / sm" args={{ variant: "link", size: "sm" }} {template} />
<Story name="Link / default" args={{ variant: "link", size: "default" }} {template} />
<Story name="Link / lg" args={{ variant: "link", size: "lg" }} {template} />
<Story name="Link / icon" args={{ variant: "link", size: "icon" }} {template} />

<!-- Disabled: the recipe greys the control; its play proves the native disabled attribute blocks
     the click handler (not merely the recipe's pointer-events:none). -->
<Story
  name="Disabled"
  args={{ variant: "primary", size: "default", onclick: fn() }}
  play={async ({ canvas, args }) => {
    const control = canvas.getByRole("button", { name: "Disabled" });
    await expect(control).toBeDisabled();
    // pointerEventsCheck: 0 bypasses userEvent's own guard so the click reaches the element.
    await userEvent.click(control, { pointerEventsCheck: 0 });
    await expect(args.onclick).not.toHaveBeenCalled();
  }}
>
  {#snippet template(args: ButtonStoryArgs)}
    <Button {...args} disabled onclick={args.onclick as () => void}>Disabled</Button>
  {/snippet}
</Story>

<!-- Given an `href`, the same styled control renders as a real <a> instead of a <button> — so a
     primary call-to-action can navigate. (Distinct from the `link` VARIANT above, which is the
     underlined text-link look.) The play asserts it is an anchor with the href and no button type. -->
<Story
  name="As a link (href renders an anchor)"
  args={{ variant: "primary", size: "default" }}
  play={async ({ canvas }) => {
    const control = canvas.getByRole("link", { name: "Open documentation" });
    await expect(control.tagName).toBe("A");
    await expect(control).toHaveAttribute("href", "#button-anchor-target");
    await expect(control).not.toHaveAttribute("type");
  }}
>
  {#snippet template(args: ButtonStoryArgs)}
    <Button {...args} href="#button-anchor-target">Open documentation</Button>
  {/snippet}
</Story>
