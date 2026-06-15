<script module lang="ts">
  /*
   * AlertDialog — Tier 3 (Bits UI), modal + portal + focus trap, a deliberate confirm/cancel
   * decision surface. The panel shows on the trigger; Bits handles the portal, the focus trap,
   * scroll lock, Escape, and the ARIA wiring (role="alertdialog", Title → aria-labelledby,
   * Description → aria-describedby). Unlike Dialog there is NO corner ✕ and no outside-click close —
   * the user must pick Cancel or Action. Styling is ours (the mc-alert-dialog* recipes + the floating
   * presence); the Cancel and Action are caller-styled mc-button variants. Catalog: one composed
   * showcase — a destructive "delete this document?" confirmation. Cancel and Escape close via Bits;
   * Action does NOT self-close (it is where the caller runs the confirm work), so the showcase binds
   * `open` and closes it on the Action's onclick. Behaviour rides the play function (open, Escape
   * close + focus return, Cancel close + focus return, Action close). `open` is bound here; Bits'
   * prop types explode into hundreds of attribute controls, so the whitelist is empty. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import * as AlertDialog from "../lib/components/alert-dialog/index.ts";
  import AlertDialogRoot from "../lib/components/alert-dialog/alert-dialog-root.svelte";

  const { Story } = defineMeta({
    title: "Overlay/AlertDialog",
    component: AlertDialogRoot,
    parameters: {
      controls: { include: [] },
    },
  });

  type AlertDialogStoryArgs = ComponentProps<typeof AlertDialogRoot>;
</script>

<script lang="ts">
  // Bound open state so the Action can close the panel on confirm (Bits' Action does not self-close).
  let open = $state(false);
</script>

{#snippet template(args: AlertDialogStoryArgs)}
  <!--
    `open` is bound so the Action can close the panel on confirm. Bits' AlertDialog.Action — unlike
    Cancel — does NOT close on its own: it is where the caller runs the confirm work and then decides
    to close, so the close is wired here on its onclick. Cancel and Escape close via Bits.
  -->
  <AlertDialog.Root bind:open {...args}>
    <AlertDialog.Trigger class="mc-button mc-button-secondary mc-button-md">
      Delete document
    </AlertDialog.Trigger>
    <AlertDialog.Content>
      <AlertDialog.Title>Delete this document?</AlertDialog.Title>
      <AlertDialog.Description>
        Deleting Statement-of-Claim.pdf removes it from the matter and from safe custody. This cannot
        be undone.
      </AlertDialog.Description>
      <div class="mc-card-footer justify-end">
        <AlertDialog.Cancel class="mc-button mc-button-ghost mc-button-md">Cancel</AlertDialog.Cancel>
        <AlertDialog.Action
          class="mc-button mc-button-destructive mc-button-md"
          onclick={() => (open = false)}
        >
          Delete
        </AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Root>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "Delete document" });
    const body = within(document.body);

    // While an alert dialog is open Bits locks the page (`pointer-events: none` on the body),
    // released when the exit presence settles. Between reopens, wait for the trigger to be
    // interactive again so the next click lands on a live target rather than the still-locked page.
    const reopen = async () => {
      await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
      await userEvent.click(trigger);
      await body.findByRole("alertdialog");
    };

    await step("Opening via the trigger shows the alert dialog, labelled and described", async () => {
      await userEvent.click(trigger);
      const dialog = await body.findByRole("alertdialog");
      await expect(dialog).toBeVisible();
      // Bits wires Title → aria-labelledby and Description → aria-describedby; resolve both.
      await expect(dialog).toHaveAccessibleName("Delete this document?");
      await expect(dialog).toHaveAccessibleDescription(/removes it from the matter/);
    });

    await step("Escape closes the alert dialog and returns focus to the trigger", async () => {
      await userEvent.keyboard("{Escape}");
      // Bits keeps the panel mounted until the exit presence settles, so wait for removal.
      await waitFor(() => expect(body.queryByRole("alertdialog")).toBeNull());
      await expect(trigger).toHaveFocus();
    });

    await step("Cancel closes the alert dialog and returns focus to the trigger", async () => {
      await reopen();
      await userEvent.click(body.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(body.queryByRole("alertdialog")).toBeNull());
      await expect(trigger).toHaveFocus();
    });

    await step("Action (the confirm) closes the alert dialog", async () => {
      await reopen();
      await userEvent.click(body.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(body.queryByRole("alertdialog")).toBeNull());
    });
  }}
/>
