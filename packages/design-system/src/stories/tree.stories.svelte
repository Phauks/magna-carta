<script module lang="ts">
  /*
   * Tree — Layout. A folder tree with the full WAI-ARIA tree view keyboard model, built without a
   * Bits primitive (bits-ui ships none). One controllable Primary (a populated matter tree, a couple
   * of folders open) shows the structure and the selected state; a hidden "Keyboard navigation"
   * story exercises the roving tabindex — Up/Down, Right/Left to expand/collapse/descend/ascend,
   * Home/End, and first-character typeahead — because those semantics ARE the behaviour and are not
   * visible on a static showcase. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor } from "storybook/test";
  import Tree from "../lib/components/tree/index.ts";
  import type { TreeNode } from "../lib/components/tree/index.ts";

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
