<script module lang="ts">
  /*
   * Button — Tier 1. Catalog model: ONE story per variant (the visual axis worth seeing at a
   * glance). Every other prop — size, disabled, href, type — is a Control, not a story (so the
   * model is consistent: nothing orthogonal to the variant gets its own story). `disabled` and
   * `href` come from the native attribute spread, so they are declared in argTypes explicitly to
   * surface them as Controls. The component's own logic is covered by a hidden, test-only story.
   * svelte-csf v5.
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
      // disabled + href are declared (with JSDoc) on the component, so docgen surfaces them under
      // "Properties" with their descriptions — no story-level argTypes needed for them.
    },
  });

  type ButtonStoryArgs = ComponentProps<typeof Button>;
  const disabledClick = fn();
</script>

{#snippet template(args: ButtonStoryArgs)}
  <Button {...args}>Button</Button>
{/snippet}

<!-- One story per variant — the visual showcase. The first is the Docs-page Primary; size,
     disabled, href, and type are explored in the Controls panel rather than as separate stories. -->
<Story name="Primary" args={{ variant: "primary" }} {template} />
<Story name="Secondary" args={{ variant: "secondary" }} {template} />
<Story name="Destructive" args={{ variant: "destructive" }} {template} />
<Story name="Ghost" args={{ variant: "ghost" }} {template} />

<!-- Behaviour: the component's own logic (submit-proof type, disabled blocking the handler, href
     rendering a real <a>). Tagged out of the sidebar and the Docs page, but still run by the test
     addon — so it stays covered without cluttering the catalog. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas }) => {
    const action = canvas.getByRole("button", { name: "Action" });
    await expect(action.tagName).toBe("BUTTON");
    await expect(action).toHaveAttribute("type", "button");
    const disabled = canvas.getByRole("button", { name: "Disabled" });
    await expect(disabled).toBeDisabled();
    await userEvent.click(disabled, { pointerEventsCheck: 0 });
    await expect(disabledClick).not.toHaveBeenCalled();
    const link = canvas.getByRole("link", { name: "Open documentation" });
    await expect(link.tagName).toBe("A");
    await expect(link).not.toHaveAttribute("type");
  }}
>
  {#snippet template()}
    <div class="flex gap-3">
      <Button variant="primary">Action</Button>
      <Button variant="primary" disabled onclick={disabledClick}>Disabled</Button>
      <Button variant="primary" href="#button-anchor-target">Open documentation</Button>
    </div>
  {/snippet}
</Story>
