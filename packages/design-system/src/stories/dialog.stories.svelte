<script module lang="ts">
  /*
   * Dialog — Tier 3 exemplar (Bits UI), modal + portal + focus trap. The panel shows on the
   * trigger; Bits handles the portal, the focus trap, scroll lock, Escape, and the ARIA wiring
   * (Title → aria-labelledby, Description → aria-describedby). Styling is ours (the mc-dialog*
   * recipes + the floating presence). Catalog: a "matter details" CONTENT dialog — a Title, a
   * Description, and a few read-only detail rows, with no competing Cancel: the corner ✕, Escape,
   * and an outside click are its dismiss (a confirmation is AlertDialog's job, not this). A second
   * story demonstrates showClose={false} with a footer Dialog.Close acting as the dismiss instead.
   * Behaviour rides the play function (open, Escape close, the default corner Close, focus return).
   * `open` is bindable — Bits owns it after mount — so it is the initial state, not a control;
   * Bits' prop types explode into hundreds of attribute controls, so the whitelist is empty.
   * svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import * as Dialog from "../lib/components/dialog/index.ts";
  import DialogRoot from "../lib/components/dialog/dialog-root.svelte";

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
    <Dialog.Trigger class="mc-button mc-button-secondary mc-button-md">View details</Dialog.Trigger>
    <Dialog.Content>
      <Dialog.Title>Matter details</Dialog.Title>
      <Dialog.Description>
        A read-only summary of ACME-2026-014. The corner ✕, Escape, and an outside click dismiss it.
      </Dialog.Description>
      <dl class="flex flex-col gap-8">
        <div class="flex justify-between gap-8">
          <dt class="text-text-muted">Client</dt>
          <dd>Acme Holdings Pty Ltd</dd>
        </div>
        <div class="flex justify-between gap-8">
          <dt class="text-text-muted">Status</dt>
          <dd>Open</dd>
        </div>
        <div class="flex justify-between gap-8">
          <dt class="text-text-muted">Responsible attorney</dt>
          <dd>Dana Okoye</dd>
        </div>
      </dl>
    </Dialog.Content>
  </Dialog.Root>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "View details" });
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
      // The panel scale-fades in (mc-presence-scale-fade), starting at opacity 0, so poll until
      // the entrance settles rather than asserting on the first frame.
      await waitFor(() => expect(dialog).toBeVisible());
      // Bits wires Title → aria-labelledby and Description → aria-describedby; resolve both.
      await expect(dialog).toHaveAccessibleName("Matter details");
      await expect(dialog).toHaveAccessibleDescription(/read-only summary/);
    });

    await step("The corner ✕ (Close) dismisses it and returns focus to the trigger", async () => {
      await userEvent.click(body.getByRole("button", { name: "Close" }));
      // Bits keeps the panel mounted until the exit presence settles, so wait for removal.
      await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
      await expect(trigger).toHaveFocus();
    });

    await step("Escape closes the dialog and returns focus to the trigger", async () => {
      await reopen();
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
      await expect(trigger).toHaveFocus();
    });
  }}
/>

<Story
  name="WithoutCloseButton"
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "View details" });
    const body = within(document.body);

    await step("With showClose={false} there is no corner ✕; the footer Done dismisses", async () => {
      await userEvent.click(trigger);
      const dialog = await body.findByRole("dialog");
      // The panel scale-fades in (mc-presence-scale-fade), starting at opacity 0, so poll until
      // the entrance settles rather than asserting on the first frame.
      await waitFor(() => expect(dialog).toBeVisible());
      // showClose={false} renders no built-in Close, so the only button is the footer Done.
      await expect(body.queryByRole("button", { name: "Close" })).toBeNull();
      await userEvent.click(body.getByRole("button", { name: "Done" }));
      await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
      await expect(trigger).toHaveFocus();
    });
  }}
>
  <Dialog.Root>
    <Dialog.Trigger class="mc-button mc-button-secondary mc-button-md">View details</Dialog.Trigger>
    <Dialog.Content showClose={false}>
      <Dialog.Title>Matter details</Dialog.Title>
      <Dialog.Description>
        With the close prop disabled the built-in ✕ is suppressed; an explicit footer action
        dismisses instead.
      </Dialog.Description>
      <div class="mc-card-footer justify-end">
        <Dialog.Close class="mc-button mc-button-secondary mc-button-md">Done</Dialog.Close>
      </div>
    </Dialog.Content>
  </Dialog.Root>
</Story>
