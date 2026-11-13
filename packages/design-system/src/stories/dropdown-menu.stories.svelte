<script module lang="ts">
  /*
   * DropdownMenu — Tier 3 (Bits UI), floating + portal. A menu of actions anchored to its trigger,
   * opened by a press, a key, a tap, or a mouse pointer resting on the trigger; Bits handles the
   * portal, Floating UI positioning, the two-level wrapper, full keyboard interaction (roving
   * highlight, typeahead, Escape), outside-click dismissal, and focus return, and Root's hover
   * controller (hover-open.ts) adds the pointer. Styling is ours (the mc-dropdown-menu-* recipes +
   * the floating presence). Catalog: one realistic matter "Actions" menu — a Group + heading of
   * plain Items (one disabled), a Separator, a CheckboxItem, a RadioGroup of sort options, and a
   * nested Sub menu. Behaviour rides the play functions: Default covers the pressed menu (open,
   * arrow highlight, disabled skip, stateful toggles keep the menu open, a plain item closes it,
   * Escape with focus return); Opens on hover covers the pointed one (a rest opens it without
   * moving focus, it follows the pointer into the panel, a press on its trigger keeps it, leaving
   * closes it). `open` is bindable — Bits owns it after mount — so it is the initial state, not a
   * control; Bits' prop types explode into hundreds of attribute controls, so the whitelist is
   * empty. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import * as DropdownMenu from "../lib/components/dropdown-menu/index.ts";
  import DropdownMenuRoot from "../lib/components/dropdown-menu/dropdown-menu-root.svelte";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";

  const { Story } = defineMeta({
    title: "Overlay/DropdownMenu",
    component: DropdownMenuRoot,
    parameters: {
      controls: { include: [] },
    },
  });

  type DropdownMenuStoryArgs = ComponentProps<typeof DropdownMenuRoot>;
</script>

<!-- The trigger sits at the right of a padded canvas, where a menu trigger usually is: the panel
     opens end-aligned to it and grows toward the start, which is what the Default story measures
     (flush against the viewport edge, Bits would hold the panel the collision padding in). -->
{#snippet template(args: DropdownMenuStoryArgs)}
  <div class="flex justify-end p-24">
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
      <DropdownMenu.CheckboxItem>Show closed</DropdownMenu.CheckboxItem>
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
  </div>
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
      // The menu scale-fades in (mc-presence-scale-fade), starting at opacity 0, so poll until
      // the entrance settles rather than asserting on the first frame.
      await waitFor(() => expect(menu).toBeVisible());
      await expect(body.getByRole("menuitem", { name: "Edit" })).toBeVisible();
    });

    await step("It opens end-aligned to the trigger, its end edge on the trigger's", async () => {
      // The component's default, written nowhere in this story.
      const menu = body.getByRole("menu");
      await expect(menu).toHaveAttribute("data-align", "end");
      await waitFor(() => {
        const panel = menu.getBoundingClientRect();
        const control = trigger.getBoundingClientRect();
        expect(Math.abs(panel.right - control.right)).toBeLessThanOrEqual(1);
      });
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

    await step("Toggling a checkbox item leaves the menu open (stateful toggle)", async () => {
      const showClosed = body.getByRole("menuitemcheckbox", { name: "Show closed" });
      await expect(showClosed).toHaveAttribute("aria-checked", "false");
      await userEvent.click(showClosed);
      await waitFor(() =>
        expect(body.getByRole("menuitemcheckbox", { name: "Show closed" })).toHaveAttribute(
          "aria-checked",
          "true",
        ),
      );
      // The menu stays mounted — closeOnSelect defaults to false on the wrapper.
      await expect(body.getByRole("menu")).toBeVisible();
    });

    await step("Selecting a radio item leaves the menu open and moves the checked state", async () => {
      await expect(body.getByRole("menuitemradio", { name: "Most recent" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await userEvent.click(body.getByRole("menuitemradio", { name: "Name" }));
      await waitFor(() =>
        expect(body.getByRole("menuitemradio", { name: "Name" })).toHaveAttribute(
          "aria-checked",
          "true",
        ),
      );
      await expect(body.getByRole("menuitemradio", { name: "Most recent" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
      await expect(body.getByRole("menu")).toBeVisible();
    });

    await step("Selecting a plain item closes the menu", async () => {
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

<Story
  name="Opens on hover"
  {template}
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "Actions" });
    const body = within(document.body);
    // Long enough for the hover controller's close linger to have fired if it were going to.
    const pastTheLinger = () => new Promise((resolve) => setTimeout(resolve, 400));

    await step("A pointer resting on the trigger opens the menu without moving focus", async () => {
      await userEvent.hover(trigger);
      const menu = await body.findByRole("menu");
      await waitFor(() => expect(menu).toBeVisible());
      expect(menu.contains(document.activeElement)).toBe(false);
      await expect(trigger).not.toHaveFocus();
    });

    await step("Moving from the trigger into the panel keeps it open", async () => {
      await userEvent.hover(body.getByRole("menuitem", { name: "Duplicate" }));
      await pastTheLinger();
      await expect(body.getByRole("menu")).toBeVisible();
    });

    await step("A press on the trigger keeps a hover-opened menu open rather than toggling it", async () => {
      await userEvent.click(trigger);
      await pastTheLinger();
      await expect(body.getByRole("menu")).toBeVisible();
    });

    await step("Leaving the trigger and the panel closes the menu after a linger", async () => {
      await userEvent.unhover(trigger);
      await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
    });

    await step("A menu opened from the keyboard is not hover's to close", async () => {
      trigger.focus();
      await userEvent.keyboard("{Enter}");
      await body.findByRole("menu");
      await userEvent.hover(trigger);
      await userEvent.unhover(trigger);
      await pastTheLinger();
      await expect(body.getByRole("menu")).toBeVisible();
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
    });
  }}
/>

{#snippet iconOnly(args: DropdownMenuStoryArgs)}
  <div class="flex justify-end p-24">
    <DropdownMenu.Root {...args}>
      <DropdownMenu.Trigger class="mc-button mc-button-ghost mc-button-md" aria-label="More">
        <Ellipsis class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content class="min-w-48">
        <DropdownMenu.Item>Copy Link</DropdownMenu.Item>
        <DropdownMenu.Item>Print</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
{/snippet}

<Story
  name="An icon-only trigger opens only when pressed"
  tags={["!dev", "!autodocs"]}
  template={iconOnly}
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "More" });
    const body = within(document.body);
    // Long enough for the hover controller's open delay to have fired if it were going to.
    const pastTheDelay = () => new Promise((resolve) => setTimeout(resolve, 400));

    await step("A pointer resting on a trigger with no words opens nothing", async () => {
      await userEvent.hover(trigger);
      await pastTheDelay();
      expect(body.queryByRole("menu")).toBeNull();
    });

    await step("A press opens it", async () => {
      await userEvent.click(trigger);
      const menu = await body.findByRole("menu");
      await waitFor(() => expect(menu).toBeVisible());
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
    });
  }}
/>
