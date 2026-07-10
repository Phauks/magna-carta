<script module lang="ts">
  /*
   * ContextMenu — Overlay (Bits UI), floating + portal. The right-click sibling of DropdownMenu:
   * Bits handles the portal, Floating UI positioning anchored to the pointer, the two-level wrapper,
   * full keyboard interaction (roving highlight, typeahead, Escape), outside-click dismissal, and
   * focus return. Styling is ours (the mc-context-menu-* recipes + the floating presence). Catalog:
   * a realistic file-row "Actions" menu — a Group + heading of plain Items (one disabled), a
   * Separator, a CheckboxItem, a RadioGroup of sort options, and a nested Sub menu. Behaviour rides
   * the play function (right-click opens at the pointer, arrow highlight, disabled skip, stateful
   * toggles keep the menu open, a plain item closes it, Escape). `open` is bindable — Bits owns it
   * after mount — so it is not a control; Bits' prop types explode into hundreds of attribute
   * controls, so the whitelist is empty. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
  import * as ContextMenu from "../lib/components/context-menu/index.ts";
  import ContextMenuRoot from "../lib/components/context-menu/context-menu-root.svelte";

  const { Story } = defineMeta({
    title: "Overlay/ContextMenu",
    component: ContextMenuRoot,
    parameters: {
      controls: { include: [] },
    },
  });

  type ContextMenuStoryArgs = ComponentProps<typeof ContextMenuRoot>;
</script>

{#snippet template(args: ContextMenuStoryArgs)}
  <ContextMenu.Root {...args}>
    <ContextMenu.Trigger
      class="flex items-center justify-center rounded-md border border-border-default bg-surface-raised p-8 text-sm text-text-muted"
    >
      Right-click this file row
    </ContextMenu.Trigger>
    <ContextMenu.Content class="min-w-48">
      <ContextMenu.Group>
        <ContextMenu.GroupHeading>File</ContextMenu.GroupHeading>
        <ContextMenu.Item>Open</ContextMenu.Item>
        <ContextMenu.Item>Rename</ContextMenu.Item>
        <ContextMenu.Item disabled>Delete</ContextMenu.Item>
      </ContextMenu.Group>
      <ContextMenu.Separator />
      <ContextMenu.CheckboxItem>Show hidden files</ContextMenu.CheckboxItem>
      <ContextMenu.Separator />
      <ContextMenu.RadioGroup value="name">
        <ContextMenu.GroupHeading>Sort by</ContextMenu.GroupHeading>
        <ContextMenu.RadioItem value="name">Name</ContextMenu.RadioItem>
        <ContextMenu.RadioItem value="modified">Modified</ContextMenu.RadioItem>
      </ContextMenu.RadioGroup>
      <ContextMenu.Separator />
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger>Move to</ContextMenu.SubTrigger>
        <ContextMenu.SubContent class="min-w-40">
          <ContextMenu.Item>Pleadings</ContextMenu.Item>
          <ContextMenu.Item>Correspondence</ContextMenu.Item>
        </ContextMenu.SubContent>
      </ContextMenu.Sub>
    </ContextMenu.Content>
  </ContextMenu.Root>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByText("Right-click this file row");
    const body = within(document.body);

    await step("Right-clicking the region opens the menu, portaled and visible", async () => {
      await fireEvent.contextMenu(trigger);
      const menu = await body.findByRole("menu");
      // The menu scale-fades in (mc-presence-scale-fade), starting at opacity 0, so poll until the
      // entrance settles rather than asserting on the first frame.
      await waitFor(() => expect(menu).toBeVisible());
      await expect(body.getByRole("menuitem", { name: "Open" })).toBeVisible();
    });

    await step("ArrowDown highlights the first item", async () => {
      await userEvent.keyboard("{ArrowDown}");
      await waitFor(() =>
        expect(body.getByRole("menuitem", { name: "Open" })).toHaveAttribute("data-highlighted"),
      );
    });

    await step("A disabled item is not selectable", async () => {
      await expect(body.getByRole("menuitem", { name: "Delete" })).toHaveAttribute("data-disabled");
    });

    await step("Toggling a checkbox item leaves the menu open (stateful toggle)", async () => {
      const showHidden = body.getByRole("menuitemcheckbox", { name: "Show hidden files" });
      await expect(showHidden).toHaveAttribute("aria-checked", "false");
      await userEvent.click(showHidden);
      await waitFor(() =>
        expect(body.getByRole("menuitemcheckbox", { name: "Show hidden files" })).toHaveAttribute(
          "aria-checked",
          "true",
        ),
      );
      await expect(body.getByRole("menu")).toBeVisible();
    });

    await step("Selecting a radio item moves the checked state and keeps the menu open", async () => {
      await expect(body.getByRole("menuitemradio", { name: "Name" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await userEvent.click(body.getByRole("menuitemradio", { name: "Modified" }));
      await waitFor(() =>
        expect(body.getByRole("menuitemradio", { name: "Modified" })).toHaveAttribute(
          "aria-checked",
          "true",
        ),
      );
      await expect(body.getByRole("menuitemradio", { name: "Name" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
      await expect(body.getByRole("menu")).toBeVisible();
    });

    await step("Selecting a plain item closes the menu", async () => {
      await userEvent.click(body.getByRole("menuitem", { name: "Open" }));
      await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
    });

    await step("Escape closes the menu", async () => {
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
      await fireEvent.contextMenu(trigger);
      await body.findByRole("menu");
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
    });
  }}
/>
