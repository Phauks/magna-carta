<script module lang="ts">
  /*
   * DropdownMenu — Tier 3 (Bits UI), floating + portal. A click-triggered menu of actions anchored
   * to its trigger; Bits handles the portal, Floating UI positioning, the two-level wrapper, full
   * keyboard interaction (roving highlight, typeahead, Escape), outside-click dismissal, and focus
   * return. Styling is ours (the mc-dropdown-menu-* recipes + the floating presence). Catalog: one
   * realistic matter "Actions" menu — a Group + heading of plain Items (one disabled), a Separator,
   * a CheckboxItem, a RadioGroup of sort options, and a nested Sub menu. Behaviour rides the play
   * function (open, arrow highlight, disabled skip, select-closes, Escape with focus return). `open`
   * is bindable — Bits owns it after mount — so it is the initial state, not a control; Bits' prop
   * types explode into hundreds of attribute controls, so the whitelist is empty. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import * as DropdownMenu from "../lib/components/dropdown-menu/index.ts";
  import DropdownMenuRoot from "../lib/components/dropdown-menu/dropdown-menu-root.svelte";

  const { Story } = defineMeta({
    title: "Overlay/DropdownMenu",
    component: DropdownMenuRoot,
    parameters: {
      controls: { include: [] },
    },
  });

  type DropdownMenuStoryArgs = ComponentProps<typeof DropdownMenuRoot>;
</script>

{#snippet template(args: DropdownMenuStoryArgs)}
  <DropdownMenu.Root {...args}>
    <DropdownMenu.Trigger class="mc-button mc-button-secondary mc-button-md"
      >Actions</DropdownMenu.Trigger
    >
    <DropdownMenu.Content class="min-w-48">
      <DropdownMenu.Group>
        <DropdownMenu.GroupHeading>Matter</DropdownMenu.GroupHeading>
        <DropdownMenu.Item>Edit</DropdownMenu.Item>
        <DropdownMenu.Item>Duplicate</DropdownMenu.Item>
        <DropdownMenu.Item disabled>Archive</DropdownMenu.Item>
      </DropdownMenu.Group>
      <DropdownMenu.Separator />
      <DropdownMenu.CheckboxItem closeOnSelect={false}>Show closed</DropdownMenu.CheckboxItem>
      <DropdownMenu.Separator />
      <DropdownMenu.RadioGroup value="recent">
        <DropdownMenu.GroupHeading>Sort by</DropdownMenu.GroupHeading>
        <DropdownMenu.RadioItem value="recent">Most recent</DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="name">Name</DropdownMenu.RadioItem>
      </DropdownMenu.RadioGroup>
      <DropdownMenu.Separator />
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger>Move to</DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent class="min-w-40">
          <DropdownMenu.Item>Active</DropdownMenu.Item>
          <DropdownMenu.Item>On hold</DropdownMenu.Item>
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "Actions" });
    const body = within(document.body);

    await step("Clicking the trigger opens the menu, portaled and visible", async () => {
      await userEvent.click(trigger);
      const menu = await body.findByRole("menu");
      await expect(menu).toBeVisible();
      await expect(body.getByRole("menuitem", { name: "Edit" })).toBeVisible();
    });

    await step("ArrowDown highlights the first item", async () => {
      await userEvent.keyboard("{ArrowDown}");
      await waitFor(() =>
        expect(body.getByRole("menuitem", { name: "Edit" })).toHaveAttribute("data-highlighted"),
      );
    });

    await step("A disabled item is not selectable", async () => {
      await expect(body.getByRole("menuitem", { name: "Archive" })).toHaveAttribute("data-disabled");
    });

    await step("Selecting an item closes the menu", async () => {
      await userEvent.click(body.getByRole("menuitem", { name: "Edit" }));
      await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
    });

    await step("Escape closes the menu and returns focus to the trigger", async () => {
      // After the previous close, Bits leaves a brief pointer-events guard on the body until the
      // exit settles — wait for it to clear before re-opening, or the click can't land.
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
      await userEvent.click(trigger);
      await body.findByRole("menu");
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
      await expect(trigger).toHaveFocus();
    });
  }}
/>
