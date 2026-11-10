<script module lang="ts">
  /*
   * Tree — Layout. A folder tree with the full WAI-ARIA tree view keyboard model, built without a
   * Bits primitive (bits-ui ships none). One controllable Primary (a populated matter tree, a couple
   * of folders open) shows the structure and the selected state; a hidden "Keyboard navigation"
   * story exercises the roving tabindex — Up/Down, Right/Left to expand/collapse/descend/ascend,
   * Home/End, and first-character typeahead — because those semantics ARE the behaviour and are not
   * visible on a static showcase. A second hidden story covers the seams a tree of things that are
   * not all folders needs: its own glyph per row, its own content at a row's end, and a caret that
   * opens a row without going to it. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor } from "storybook/test";
  import FileIcon from "@lucide/svelte/icons/file";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import Tree from "../lib/components/tree/index.ts";
  import type { TreeItemContext, TreeNode } from "../lib/components/tree/index.ts";

  const MATTERS: TreeNode[] = [
    {
      id: "matters",
      label: "Matters",
      children: [
        {
          id: "acme",
          label: "ACME v. Globex",
          children: [
            { id: "pleadings", label: "Pleadings" },
            {
              id: "discovery",
              label: "Discovery",
              children: [
                { id: "depositions", label: "Depositions" },
                { id: "exhibits", label: "Exhibits" },
              ],
            },
          ],
        },
        {
          id: "wayne",
          label: "Wayne Estate",
          children: [{ id: "correspondence", label: "Correspondence" }],
        },
      ],
    },
    { id: "templates", label: "Templates" },
  ];

  const { Story } = defineMeta({
    title: "Layout/Tree",
    component: Tree,
    args: { items: MATTERS, label: "Folders", expandedIds: ["matters", "acme"] },
  });

  type TreeStoryArgs = ComponentProps<typeof Tree>;
</script>

{#snippet template(args: TreeStoryArgs)}
  <div class="w-72">
    <Tree {...args} />
  </div>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    await step("Exposes a tree landmark named Folders", async () => {
      await expect(canvas.getByRole("tree", { name: "Folders" })).toBeInTheDocument();
    });
    await step("An expanded parent reports aria-expanded and reveals its children", async () => {
      await expect(canvas.getByRole("treeitem", { name: "Matters" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await expect(canvas.getByRole("treeitem", { name: "ACME v. Globex" })).toBeVisible();
    });
    await step("Exactly one treeitem is tabbable (roving tabindex)", async () => {
      const tabbable = canvas
        .getAllByRole("treeitem")
        .filter((item) => item.getAttribute("tabindex") === "0");
      await expect(tabbable).toHaveLength(1);
    });
    await step("Clicking a leaf selects it", async () => {
      const pleadings = canvas.getByRole("treeitem", { name: "Pleadings" });
      await expect(pleadings).toHaveAttribute("aria-selected", "false");
      await userEvent.click(pleadings);
      await waitFor(() => expect(pleadings).toHaveAttribute("aria-selected", "true"));
    });
    await step("Clicking an open parent collapses it", async () => {
      await userEvent.click(canvas.getByRole("treeitem", { name: "ACME v. Globex" }));
      await waitFor(() =>
        expect(canvas.getByRole("treeitem", { name: "ACME v. Globex" })).toHaveAttribute(
          "aria-expanded",
          "false",
        ),
      );
      await expect(canvas.queryByRole("treeitem", { name: "Pleadings" })).toBeNull();
    });
  }}
/>

<!-- The keyboard model — the roving tabindex and the arrow/typeahead semantics. Hidden from the
     sidebar and Docs page (it starts fully collapsed and drives everything from the keyboard), but
     still run by the test addon. -->
<Story
  name="Keyboard navigation"
  args={{ items: MATTERS, label: "Folders", expandedIds: [] }}
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    const root = canvas.getByRole("treeitem", { name: "Matters" });

    await step("Focus lands on the first treeitem", async () => {
      root.focus();
      await expect(root).toHaveFocus();
    });

    await step("Right expands a collapsed parent", async () => {
      await userEvent.keyboard("{ArrowRight}");
      await waitFor(() => expect(root).toHaveAttribute("aria-expanded", "true"));
      await expect(canvas.getByRole("treeitem", { name: "ACME v. Globex" })).toBeVisible();
    });

    await step("Right again descends to the first child", async () => {
      await userEvent.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect(canvas.getByRole("treeitem", { name: "ACME v. Globex" })).toHaveFocus(),
      );
    });

    await step("Down moves to the next visible node", async () => {
      await userEvent.keyboard("{ArrowDown}");
      await waitFor(() =>
        expect(canvas.getByRole("treeitem", { name: "Wayne Estate" })).toHaveFocus(),
      );
    });

    await step("Up moves back to the previous visible node", async () => {
      await userEvent.keyboard("{ArrowUp}");
      await waitFor(() =>
        expect(canvas.getByRole("treeitem", { name: "ACME v. Globex" })).toHaveFocus(),
      );
    });

    await step("Left ascends to the parent when the node is collapsed", async () => {
      await userEvent.keyboard("{ArrowLeft}");
      await waitFor(() => expect(root).toHaveFocus());
    });

    await step("End jumps to the last visible node, Home back to the first", async () => {
      await userEvent.keyboard("{End}");
      await waitFor(() =>
        expect(canvas.getByRole("treeitem", { name: "Templates" })).toHaveFocus(),
      );
      await userEvent.keyboard("{Home}");
      await waitFor(() => expect(root).toHaveFocus());
    });

    await step("Typeahead jumps to the next node whose label starts with the key", async () => {
      await userEvent.keyboard("w");
      await waitFor(() =>
        expect(canvas.getByRole("treeitem", { name: "Wayne Estate" })).toHaveFocus(),
      );
    });

    await step("Left collapses an expanded parent", async () => {
      root.focus();
      await userEvent.keyboard("{ArrowLeft}");
      await waitFor(() => expect(root).toHaveAttribute("aria-expanded", "false"));
      await expect(canvas.queryByRole("treeitem", { name: "ACME v. Globex" })).toBeNull();
    });

    await step("Enter selects the focused node", async () => {
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(root).toHaveAttribute("aria-selected", "true"));
    });
  }}
/>

<!-- The seams a tree of things that are not all folders needs, and the caret that opens without
     going. None of the three is visible on a static showcase. -->
{#snippet rowIcon(context: TreeItemContext)}
  {#if context.hasChildren}
    <FolderIcon class="mc-tree-item-icon" data-row-glyph="branch" aria-hidden="true" />
  {:else}
    <FileIcon class="mc-tree-item-icon" data-row-glyph="leaf" aria-hidden="true" />
  {/if}
{/snippet}

{#snippet rowTrailing(context: TreeItemContext)}
  <span data-row-count="">{context.node.children?.length ?? 0}</span>
{/snippet}

<!-- The count the row's end shows is part of the row's name, so a reader hears what a sighted
     reader sees and a speech user can say it. -->
{#snippet drawnRows(args: TreeStoryArgs)}
  <div class="w-72">
    <Tree
      {...args}
      icon={rowIcon}
      trailing={rowTrailing}
      itemLabel={(context) => `${context.node.label} ${context.node.children?.length ?? 0} items`}
    />
  </div>
{/snippet}

<Story
  name="Rows a caller draws"
  args={{ items: MATTERS, label: "Folders", expandedIds: ["matters"], expandOnActivate: false }}
  template={drawnRows}
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    const acme = canvas.getByRole("treeitem", { name: "ACME v. Globex 2 items" });

    await step("A caller's own glyph replaces the folder pair, on every row", async () => {
      await expect(acme.querySelector("[data-row-glyph]")).toHaveAttribute(
        "data-row-glyph",
        "branch",
      );
      await expect(
        canvas
          .getByRole("treeitem", { name: "Templates 0 items" })
          .querySelector("[data-row-glyph]"),
      ).toHaveAttribute("data-row-glyph", "leaf");
    });

    await step("A caller's own content sits at the row's end, and in its name", async () => {
      await expect(acme.querySelector("[data-row-count]")).toHaveTextContent("2");
      await expect(acme).toHaveAccessibleName("ACME v. Globex 2 items");
    });

    await step("The caret opens the row and selects nothing", async () => {
      const caret = acme.querySelector("[data-tree-twisty]") as HTMLElement;
      await userEvent.click(caret);
      await waitFor(() => expect(acme).toHaveAttribute("aria-expanded", "true"));
      await expect(acme).toHaveAttribute("aria-selected", "false");
    });

    await step("With expansion off the activate path, the row selects and stays open", async () => {
      await userEvent.click(canvas.getByText("ACME v. Globex"));
      await waitFor(() => expect(acme).toHaveAttribute("aria-selected", "true"));
      await expect(acme).toHaveAttribute("aria-expanded", "true");
    });

    await step("A row nothing is acting on carries no mark", async () => {
      await expect(acme).not.toHaveAttribute("data-tree-marked");
    });
  }}
/>
