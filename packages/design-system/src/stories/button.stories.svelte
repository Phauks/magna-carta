<script module lang="ts">
  /*
   * Button — Tier 1. One story per instance (matches the Alert/Badge model): a story per variant,
   * plus the Disabled state and the as-a-link case, so the autodocs Docs page shows each as its own
   * labelled block. The first story is the Docs page's controllable Primary — the Controls panel
   * drives both variant and size (so the sizes are explored there rather than as separate stories).
   * Behavior assertions ride the relevant stories' play functions. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, fn, userEvent } from "storybook/test";
  import Button from "../lib/components/button/index.ts";

  const { Story } = defineMeta({
    title: "Components/Button",
    component: Button,
    args: { variant: "primary", size: "default" },
    argTypes: {
      variant: { control: "select", options: ["primary", "secondary", "destructive", "ghost"] },
      size: { control: "select", options: ["sm", "default", "lg", "icon"] },
    },
  });

  type ButtonStoryArgs = ComponentProps<typeof Button>;
  const disabledClick = fn();
</script>

{#snippet template(args: ButtonStoryArgs)}
  <Button {...args}>Button</Button>
{/snippet}

<!-- One story per variant (the first is the Docs Primary; change variant + size via the Controls). -->
<Story
  name="Primary"
  args={{ variant: "primary" }}
  {template}
  play={async ({ canvas }) => {
    const control = canvas.getByRole("button", { name: "Button" });
    await expect(control.tagName).toBe("BUTTON");
    await expect(control).toHaveAttribute("type", "button");
    await userEvent.tab();
    await expect(control).toHaveFocus();
  }}
/>
<Story name="Secondary" args={{ variant: "secondary" }} {template} />
<Story name="Destructive" args={{ variant: "destructive" }} {template} />
<Story name="Ghost" args={{ variant: "ghost" }} {template} />

<!-- Disabled: its play proves the native disabled attribute blocks the click handler. -->
<Story
  name="Disabled"
  args={{ onclick: disabledClick }}
  play={async ({ canvas }) => {
    const control = canvas.getByRole("button", { name: "Disabled" });
    await expect(control).toBeDisabled();
    await userEvent.click(control, { pointerEventsCheck: 0 });
    await expect(disabledClick).not.toHaveBeenCalled();
  }}
>
  {#snippet template(args: ButtonStoryArgs)}
    <Button variant="primary" disabled onclick={args.onclick as () => void}>Disabled</Button>
  {/snippet}
</Story>

<!-- As a link: with an href the same control renders a real <a> (a button-styled CTA that navigates). -->
<Story
  name="As a link"
  play={async ({ canvas }) => {
    const control = canvas.getByRole("link", { name: "Open documentation" });
    await expect(control.tagName).toBe("A");
    await expect(control).toHaveAttribute("href", "#button-anchor-target");
    await expect(control).not.toHaveAttribute("type");
  }}
>
  {#snippet template()}
    <Button variant="primary" href="#button-anchor-target">Open documentation</Button>
  {/snippet}
</Story>
