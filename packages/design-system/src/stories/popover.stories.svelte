<script module lang="ts">
  /*
   * Popover — Tier 3 (Bits UI), floating + portal. A click-triggered panel anchored to its trigger;
   * Bits handles the portal, Floating UI positioning, the two-level wrapper, outside-click + Escape
   * dismissal, and focus return. Styling is ours (the mc-popover-content recipe + the floating
   * presence). Catalog: one composed showcase — an "Add note" panel with a heading, a textarea, and
   * an Add (Popover.Close) button. Behaviour rides the play function (open, positioned, Escape close
   * with focus return, Close-button dismiss). `open` is bindable — Bits owns it after mount — so it
   * is the initial state, not a control; Bits' prop types explode into hundreds of attribute
   * controls, so the whitelist is empty. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import * as Popover from "../lib/components/popover/index.ts";
  import PopoverRoot from "../lib/components/popover/popover-root.svelte";

  const { Story } = defineMeta({
    title: "Overlay/Popover",
    component: PopoverRoot,
    parameters: {
      controls: { include: [] },
    },
  });

  type PopoverStoryArgs = ComponentProps<typeof PopoverRoot>;
</script>

<!-- The trigger sits at the right of a padded canvas, where a popover trigger usually is: the
     panel opens end-aligned to it and grows toward the start, which the play function measures
     (flush against the viewport edge, Bits would hold the panel the collision padding in). -->
{#snippet template(args: PopoverStoryArgs)}
  <div class="flex justify-end p-24">
  <Popover.Root {...args}>
    <Popover.Trigger class="mc-button mc-button-secondary mc-button-md">Add note</Popover.Trigger>
    <Popover.Content class="w-72">
      <div class="flex flex-col gap-12">
        <p class="text-sm font-semibold">Add a note to this matter</p>
        <textarea
          class="mc-textarea"
          rows={3}
          placeholder="Spoke with the client about disbursements…"
        ></textarea>
        <div class="flex justify-end">
          <Popover.Close class="mc-button mc-button-primary mc-button-md">Add</Popover.Close>
        </div>
      </div>
    </Popover.Content>
  </Popover.Root>
  </div>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "Add note" });
    const body = within(document.body);

    await step("Clicking the trigger opens the popover, positioned and visible", async () => {
      await userEvent.click(trigger);
      // The content is portaled to the body, so query there.
      const heading = await body.findByText("Add a note to this matter");
      // The panel scale-fades in (mc-presence-scale-fade), starting at opacity 0, so poll until
      // the entrance settles rather than asserting on the first frame.
      await waitFor(() => expect(heading).toBeVisible());
    });

    await step("It opens end-aligned to the trigger, its end edge on the trigger's", async () => {
      // The component's default, written nowhere in this story. The panel is the element carrying
      // Bits' placement attributes; the heading is inside it.
      const panel = body.getByText("Add a note to this matter").closest<HTMLElement>("[data-align]");
      expect(panel).not.toBeNull();
      await expect(panel as HTMLElement).toHaveAttribute("data-align", "end");
      await waitFor(() => {
        const box = (panel as HTMLElement).getBoundingClientRect();
        const control = trigger.getBoundingClientRect();
        expect(Math.abs(box.right - control.right)).toBeLessThanOrEqual(1);
      });
    });

    await step("Escape closes the popover and returns focus to the trigger", async () => {
      await userEvent.keyboard("{Escape}");
      // Bits keeps the panel mounted until the exit presence settles, so wait for removal.
      await waitFor(() => expect(body.queryByText("Add a note to this matter")).toBeNull());
      await expect(trigger).toHaveFocus();
    });

    await step("A caller's Add (Popover.Close) button closes the popover", async () => {
      await userEvent.click(trigger);
      await body.findByText("Add a note to this matter");
      await userEvent.click(body.getByRole("button", { name: "Add" }));
      await waitFor(() => expect(body.queryByText("Add a note to this matter")).toBeNull());
    });
  }}
/>
