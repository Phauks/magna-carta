<script module lang="ts">
  /*
   * Command — Tier 4 (Bits UI), composition-heavy: a filterable command palette. A search Input
   * (role="combobox") filters a listbox of Items; Bits owns the filtering, the roving keyboard
   * highlight (aria-activedescendant), and the listbox/option a11y. The matcher is a seam — Root
   * defaults to a plain case-insensitive substring match and a caller can swap in a richer scorer.
   * Items fire commands (onSelect), so Command is an Overlay of actions (catalog taxonomy), not an
   * Input. The list height is layout (max-h-96 here); a hidden story filters 500 items at scale.
   * svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, fn, userEvent, waitFor } from "storybook/test";
  import * as Command from "../lib/components/command/index.ts";
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

<!-- A realistic palette: two action groups (one item disabled), a separator, and an empty state. -->
<Story
  name="Default"
  play={async ({ canvas, step }) => {
    const input = canvas.getByRole("combobox");

    await step("Lists every command before any query", async () => {
      await expect(canvas.getByRole("option", { name: "New matter" })).toBeVisible();
      await expect(canvas.getByRole("option", { name: "Go to billing" })).toBeVisible();
    });

    await step("Typing filters the list and auto-highlights the first match", async () => {
      await userEvent.type(input, "matter");
      await waitFor(() => expect(canvas.queryByRole("option", { name: "Go to billing" })).toBeNull());
      await expect(canvas.getByRole("option", { name: "New matter" })).toBeVisible();
      // Command keeps the first enabled match highlighted as you type (the active descendant).
      await waitFor(() =>
        expect(canvas.getByRole("option", { name: "New matter" })).toHaveAttribute("data-selected"),
      );
    });

    await step("A disabled command is not selectable", async () => {
      await expect(canvas.getByRole("option", { name: "Close matter" })).toHaveAttribute(
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
      // Bits re-creates the list node when the query crosses empty/non-empty, so query fresh.
      await expect(await canvas.findByText("No results found.")).toBeVisible();
    });

    await step("Clearing the query restores the full list", async () => {
      // Leave the palette populated: it is the showcase state, and an empty listbox (no option
      // children) trips axe's aria-required-children — the "No results" message above is the
      // accessible feedback for that transient state.
      await userEvent.clear(input);
      await waitFor(() =>
        expect(canvas.getByRole("option", { name: "Go to billing" })).toBeVisible(),
      );
    });
  }}
>
  {#snippet template(args: CommandStoryArgs)}
    <Command.Root {...args} label="Command menu" class="max-w-md">
      <Command.Input placeholder="Type a command or search…" />
      <!-- No max-height here: the short palette fits without scrolling. A scrolling listbox driven by
           aria-activedescendant has no tabbable content, which trips axe's scrollable-region-focusable
           (keyboard users still reach every row via the arrow keys); the at-scale story bounds height. -->
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
      <Command.List class="max-h-96">
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
