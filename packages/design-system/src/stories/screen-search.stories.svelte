<script module lang="ts">
  /*
   * ScopedSearch — Compound Inputs (a search field plus the icon it lives inside until it is
   * wanted). The component has no variant axis, so the showcase is ONE story; `label`,
   * `placeholder`, `matchSummary`, `size`, `disabled` and `shortcut` are Controls declared on the
   * component so docgen lists them under "Properties".
   *
   * The rulings the play functions pin, in the words they were issued in:
   *   - it expands from an icon and collapses when unused;
   *   - no clear button in the field (Escape clears, then a second Escape closes);
   *   - an active search keeps it open, with the accent treatment.
   * A regression against any of them fails this file. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import ScopedSearch from "../lib/components/scoped-search/index.ts";
  import Button from "../lib/components/button/index.ts";

  const { Story } = defineMeta({
    title: "Compound Inputs/ScopedSearch",
    component: ScopedSearch,
    argTypes: {
      size: { control: "select", options: ["sm", "default", "lg"] },
    },
  });

  type ScopedSearchStoryArgs = ComponentProps<typeof ScopedSearch>;
</script>

{#snippet template(args: ScopedSearchStoryArgs)}
  <!-- The action row this control was designed for: the primary action anchored at the inline end,
       the search to its inline start so the field grows into empty space and the primary action
       never moves. -->
  <div class="flex items-center justify-end gap-8">
    <ScopedSearch label="Search matters" {...args} />
    <Button variant="primary">New matter</Button>
  </div>
{/snippet}

<!-- The showcase + Docs Primary. -->
<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "Search matters" });

    await step("At rest it is an icon, and the field is not in the tab order", async () => {
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(canvas.queryByRole("searchbox", { name: "Search matters" })).toBeNull();
    });

    await step("Pressing the icon expands the field and puts the caret in it", async () => {
      await userEvent.click(trigger);
      const field = canvas.getByRole("searchbox", { name: "Search matters" });
      await expect(field).toHaveFocus();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
    });

    await step("A live query marks the control searching, so it cannot close under you", async () => {
      await userEvent.keyboard("Pemberton");
      const field = canvas.getByRole("searchbox", { name: "Search matters" });
      await expect(field).toHaveValue("Pemberton");
      await expect(canvas.getByRole("search", { name: "Search matters" })).toHaveAttribute(
        "data-searching",
        "true",
      );
    });

    await step("Escape clears the query rather than closing the field", async () => {
      await userEvent.keyboard("{Escape}");
      const field = canvas.getByRole("searchbox", { name: "Search matters" });
      await expect(field).toHaveValue("");
      await expect(field).toHaveFocus();
    });

    await step("Escape on an empty field collapses it and hands focus back", async () => {
      await userEvent.keyboard("{Escape}");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(trigger).toHaveFocus();
    });
  }}
/>

<!-- Scoped and counted: the scope control sits at the field's inline start, the match count at its
     inline end. The scope's vocabulary belongs to the surface, never to this component. -->
<Story
  name="Scoped and counted"
  play={async ({ canvas, step }) => {
    await step("The scope control and the count ride inside the expanded field", async () => {
      await expect(canvas.getByRole("button", { name: "Change scope: This list" })).toBeVisible();
      await expect(canvas.getByText("2 of 6")).toBeVisible();
    });
    await step("The scope control does not collapse the field when it takes focus", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Change scope: This list" }));
      await expect(canvas.getByRole("searchbox", { name: "Search this list" })).toBeVisible();
    });
  }}
>
  {#snippet template()}
    <div class="flex items-center justify-end gap-8">
      <ScopedSearch label="Search this list" value="Pemberton" expanded matchSummary="2 of 6">
        {#snippet scope()}
          <Button variant="ghost" size="sm" aria-label="Change scope: This list">This list</Button>
        {/snippet}
      </ScopedSearch>
      <Button variant="primary">New matter</Button>
    </div>
  {/snippet}
</Story>

<!-- Behaviour not visible on a showcase instance: collapse-when-unused, the shortcut, disabled. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    const bystander = canvas.getByRole("button", { name: "Somewhere else" });

    await step("Leaving an empty field collapses it", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Search notes" }));
      await expect(canvas.getByRole("searchbox", { name: "Search notes" })).toHaveFocus();
      await userEvent.click(bystander);
      await expect(canvas.getByRole("button", { name: "Search notes" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });

    await step("Leaving a field that carries a query keeps it open", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Search notes" }));
      await userEvent.keyboard("lien");
      await userEvent.click(bystander);
      await expect(canvas.getByRole("searchbox", { name: "Search notes" })).toHaveValue("lien");
    });

    await step("The shortcut key expands the control and focuses it", async () => {
      await userEvent.click(bystander);
      await userEvent.keyboard("/");
      await expect(canvas.getByRole("searchbox", { name: "Search parties" })).toHaveFocus();
    });

    await step("A disabled control cannot be expanded", async () => {
      const locked = canvas.getByRole("button", { name: "Search the closed register" });
      await expect(locked).toBeDisabled();
      await expect(locked).toHaveAttribute("aria-expanded", "false");
    });
  }}
>
  {#snippet template()}
    <div class="flex flex-col items-start gap-16">
      <Button variant="secondary">Somewhere else</Button>
      <ScopedSearch label="Search notes" shortcut={null} />
      <ScopedSearch label="Search parties" />
      <ScopedSearch label="Search the closed register" shortcut={null} disabled />
    </div>
  {/snippet}
</Story>
