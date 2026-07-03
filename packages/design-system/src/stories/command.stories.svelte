<script module lang="ts">
  /*
   * Command — Tier 4 (Bits UI), composition-heavy: a filterable command palette. A search Input
   * (role="combobox") filters a listbox of Items; Bits owns the filtering, the roving keyboard
   * highlight (aria-activedescendant), and the listbox/option a11y. The matcher is a seam — Root
   * defaults to a plain case-insensitive substring match and a caller can swap in a richer scorer.
   *
   * A command palette has no open/close of its own — it is the inner content of a Dialog (the Cmd+K
   * pattern), which supplies the trigger, the focus trap, and dismissal on outside-click/Escape. The
   * Default story shows that composition (the Dialog chrome hosts a border-less Command); the hidden
   * at-scale story renders the bare palette to filter 500 rows. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, fn, userEvent, waitFor, within } from "storybook/test";
  import * as Command from "../lib/components/command/index.ts";
  import * as Dialog from "../lib/components/dialog/index.ts";
  import CommandRoot from "../lib/components/command/command-root.svelte";

  const { Story } = defineMeta({
    title: "Overlay/Command",
    component: CommandRoot,
    parameters: {
      controls: { include: [] },
    },
  });

  type CommandStoryArgs = ComponentProps<typeof CommandRoot>;

  const runNewMatter = fn();

  // 500 rows for the at-scale filter story.
  const MANY = Array.from({ length: 500 }, (_, index) => `Item ${index + 1}`);
</script>

<!-- The Cmd+K pattern: a trigger opens a Dialog hosting the palette; outside-click/Escape closes it. -->
<Story
  name="Command menu"
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "Open command menu" });
    const body = within(document.body);

    await step("Opening the dialog reveals the palette", async () => {
      await userEvent.click(trigger);
      await body.findByRole("dialog");
      // The dialog scale-fades in, so poll until the entrance settles.
      await waitFor(() => expect(body.getByRole("option", { name: "New matter" })).toBeVisible());
    });

    const input = body.getByRole("combobox");

    await step("Typing filters the list and auto-highlights the first match", async () => {
      await userEvent.type(input, "matter");
      await waitFor(() => expect(body.queryByRole("option", { name: "Go to billing" })).toBeNull());
      await waitFor(() =>
        expect(body.getByRole("option", { name: "New matter" })).toHaveAttribute("data-selected"),
      );
    });

    await step("A disabled command is not selectable", async () => {
      await expect(body.getByRole("option", { name: "Close matter" })).toHaveAttribute(
        "data-disabled",
      );
    });

    await step("Enter runs the highlighted command", async () => {
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(runNewMatter).toHaveBeenCalled());
    });

    await step("A query that matches nothing shows the empty state", async () => {
      await userEvent.clear(input);
      await userEvent.type(input, "zzzzz");
      await expect(await body.findByText("No results found.")).toBeVisible();
    });

    await step("Clicking outside closes the palette", async () => {
      // The body carries pointer-events:none while the dialog is open, so click the overlay scrim
      // (the dismiss surface) rather than the body.
      const overlay = document.querySelector(".mc-dialog-overlay");
      await userEvent.click(overlay as Element);
      await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
    });
  }}
>
  {#snippet template(args: CommandStoryArgs)}
    <Dialog.Root>
      <Dialog.Trigger class="mc-button mc-button-secondary mc-button-md">
        Open command menu
      </Dialog.Trigger>
      <Dialog.Content showClose={false} class="overflow-hidden p-0">
        <Dialog.Title class="sr-only">Command menu</Dialog.Title>
        <Command.Root {...args} label="Command menu" class="border-0 bg-transparent">
          <Command.Input placeholder="Type a command or search…" />
          <Command.List>
            <Command.Viewport>
              <Command.Empty>No results found.</Command.Empty>
              <Command.Group>
                <Command.GroupHeading>Matters</Command.GroupHeading>
                <Command.GroupItems>
                  <Command.Item onSelect={runNewMatter}>New matter</Command.Item>
                  <Command.Item>Open matter</Command.Item>
                  <Command.Item disabled>Close matter</Command.Item>
                </Command.GroupItems>
              </Command.Group>
              <Command.Separator />
              <Command.Group>
                <Command.GroupHeading>Navigation</Command.GroupHeading>
                <Command.GroupItems>
                  <Command.Item>Go to dashboard</Command.Item>
                  <Command.Item>Go to billing</Command.Item>
                </Command.GroupItems>
              </Command.Group>
            </Command.Viewport>
          </Command.List>
        </Command.Root>
      </Dialog.Content>
    </Dialog.Root>
  {/snippet}
</Story>

<!-- Behaviour: filtering stays correct over 500 items. Hidden from the catalog, still run by tests. -->
<Story
  name="At scale"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    const input = canvas.getByRole("combobox");

    await step("Renders the full list, then narrows to a single match", async () => {
      await expect(canvas.getByRole("option", { name: "Item 1" })).toBeVisible();
      await userEvent.type(input, "499");
      await waitFor(() => expect(canvas.queryByRole("option", { name: "Item 1" })).toBeNull());
      await expect(canvas.getByRole("option", { name: "Item 499" })).toBeVisible();
    });
  }}
>
  {#snippet template(args: CommandStoryArgs)}
    <Command.Root {...args} label="Large command list" class="max-w-md">
      <Command.Input placeholder="Filter…" />
      <Command.List>
        <Command.Viewport>
          <Command.Empty>No results found.</Command.Empty>
          {#each MANY as label (label)}
            <Command.Item>{label}</Command.Item>
          {/each}
        </Command.Viewport>
      </Command.List>
    </Command.Root>
  {/snippet}
</Story>
