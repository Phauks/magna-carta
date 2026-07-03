<script module lang="ts">
  /*
   * Sheet — Tier 3 (Bits UI), a Dialog that slides in from a screen edge (a drawer). Built on the
   * SAME Dialog primitives: Bits handles the portal, the focus trap, scroll lock, Escape, and the
   * ARIA wiring (Title → aria-labelledby, Description → aria-describedby). Styling is ours (the
   * mc-sheet* recipes + the floating slide presence). Catalog: one composed showcase — an "Edit
   * matter details" drawer with a Cancel (Sheet.Close) and a Save Button in the footer — and a
   * `side` control so the catalog is an interactive playground for all four edges. Behaviour rides
   * the play function (open, Escape close, the default corner Close, focus return, Cancel). `open`
   * is bindable — Bits owns it after mount — so it is the initial state, not a control. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import * as Sheet from "../lib/components/sheet/index.ts";
  import SheetContent from "../lib/components/sheet/sheet-content.svelte";
  import Button from "../lib/components/button/index.ts";

  const { Story } = defineMeta({
    title: "Overlay/Sheet",
    component: SheetContent,
    parameters: {
      controls: { include: ["side"] },
    },
    argTypes: {
      side: {
        control: "select",
        options: ["top", "right", "bottom", "left"],
      },
    },
    args: {
      side: "right",
    },
  });

  type SheetStoryArgs = ComponentProps<typeof SheetContent>;
</script>

{#snippet template(args: SheetStoryArgs)}
  <Sheet.Root>
    <Sheet.Trigger class="mc-button mc-button-secondary mc-button-md">Edit details</Sheet.Trigger>
    <Sheet.Content {...args}>
      <Sheet.Title>Edit matter details</Sheet.Title>
      <Sheet.Description>
        Update the file reference, responsible fee earner, and status for ACME-2026-014. Changes
        apply once you save.
      </Sheet.Description>
      <p class="mc-sheet-description">
        This drawer slides in from the selected edge. Use it for focused side tasks — filters,
        quick edits, details — without leaving the page behind it.
      </p>
      <div class="mc-card-footer justify-end">
        <Sheet.Close class="mc-button mc-button-ghost mc-button-md">Cancel</Sheet.Close>
        <Button variant="primary">Save changes</Button>
      </div>
    </Sheet.Content>
  </Sheet.Root>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "Edit details" });
    const body = within(document.body);

    // While a sheet is open Bits locks the page (`pointer-events: none` on the body), released when
    // the exit presence settles. Between reopens, wait for the trigger to be interactive again so
    // the next click lands on a live target rather than the still-locked page.
    const reopen = async () => {
      await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
      await userEvent.click(trigger);
      await body.findByRole("dialog");
    };

    await step("Opening via the trigger shows the sheet, labelled and described", async () => {
      await userEvent.click(trigger);
      const sheet = await body.findByRole("dialog");
      await expect(sheet).toBeVisible();
      // Bits wires Title → aria-labelledby and Description → aria-describedby; resolve both.
      await expect(sheet).toHaveAccessibleName("Edit matter details");
      await expect(sheet).toHaveAccessibleDescription(/Update the file reference/);
    });

    await step("Escape closes the sheet and returns focus to the trigger", async () => {
      await userEvent.keyboard("{Escape}");
      // Bits keeps the panel mounted until the exit presence settles, so wait for removal.
      await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
      await expect(trigger).toHaveFocus();
    });

    await step("The default corner Close button closes the sheet", async () => {
      await reopen();
      await userEvent.click(body.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
      await expect(trigger).toHaveFocus();
    });

    await step("A caller's Cancel (Sheet.Close) closes the sheet", async () => {
      await reopen();
      await userEvent.click(body.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
    });
  }}
/>
