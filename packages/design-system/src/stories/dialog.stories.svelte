<script module lang="ts">
  /*
   * Dialog — Tier 3 exemplar (Bits UI), modal + portal + focus trap. The panel shows on the
   * trigger; Bits handles the portal, the focus trap, scroll lock, Escape, and the ARIA wiring
   * (Title → aria-labelledby, Description → aria-describedby). Styling is ours (the mc-dialog*
   * recipes + the floating presence). Catalog: one composed showcase — a "close this matter?"
   * confirmation with a Cancel (Dialog.Close) and a confirm Button in the footer. Behaviour rides
   * the play function (open, Escape close, overlay close, the default corner Close, focus return).
   * `open` is bindable — Bits owns it after mount — so it is the initial state, not a control;
   * Bits' prop types explode into hundreds of attribute controls, so the whitelist is empty.
   * svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import * as Dialog from "../lib/components/dialog/index.ts";
  import DialogRoot from "../lib/components/dialog/dialog-root.svelte";
  import Button from "../lib/components/button/index.ts";

  const { Story } = defineMeta({
    title: "Overlay/Dialog",
    component: DialogRoot,
    parameters: {
      controls: { include: [] },
    },
  });

  type DialogStoryArgs = ComponentProps<typeof DialogRoot>;
</script>

{#snippet template(args: DialogStoryArgs)}
  <Dialog.Root {...args}>
    <Dialog.Trigger class="mc-button mc-button-secondary mc-button-md">Close matter</Dialog.Trigger>
    <Dialog.Content>
      <Dialog.Title>Close this matter?</Dialog.Title>
      <Dialog.Description>
        Closing ACME-2026-014 archives its time entries and stops new work being recorded against
        it. You can reopen it later.
      </Dialog.Description>
      <div class="mc-card-footer justify-end">
        <Dialog.Close class="mc-button mc-button-ghost mc-button-md">Cancel</Dialog.Close>
        <Button variant="destructive">Close matter</Button>
      </div>
    </Dialog.Content>
  </Dialog.Root>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "Close matter" });
    const body = within(document.body);

    // While a dialog is open Bits locks the page (`pointer-events: none` on the body), released
    // when the exit presence settles. Between reopens, wait for the trigger to be interactive
    // again so the next click lands on a live target rather than the still-locked page.
    const reopen = async () => {
      await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
      await userEvent.click(trigger);
      await body.findByRole("dialog");
    };

    await step("Opening via the trigger shows the dialog, labelled and described", async () => {
      await userEvent.click(trigger);
      const dialog = await body.findByRole("dialog");
      await expect(dialog).toBeVisible();
      // Bits wires Title → aria-labelledby and Description → aria-describedby; resolve both.
      await expect(dialog).toHaveAccessibleName("Close this matter?");
      await expect(dialog).toHaveAccessibleDescription(/archives its time entries/);
    });

    await step("Escape closes the dialog and returns focus to the trigger", async () => {
      await userEvent.keyboard("{Escape}");
      // Bits keeps the panel mounted until the exit presence settles, so wait for removal.
      await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
      await expect(trigger).toHaveFocus();
    });

    await step("The default corner Close button closes the dialog", async () => {
      await reopen();
      await userEvent.click(body.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
      await expect(trigger).toHaveFocus();
    });

    await step("A caller's Cancel (Dialog.Close) closes the dialog", async () => {
      await reopen();
      await userEvent.click(body.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
    });
  }}
/>
