<script module lang="ts">
  /*
   * Resizable — Tier 4 / app shell. Split panes on paneforge for per-view layouts (a folder tree, a
   * list + detail rail) — distinct from the fixed Sidebar. paneforge owns the drag, keyboard resize,
   * and the role="separator" handle; the look is ours. `direction` is the variant axis. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import * as Resizable from "../lib/components/resizable/index.ts";
  import ResizablePaneGroup from "../lib/components/resizable/resizable-pane-group.svelte";

  const { Story } = defineMeta({
    title: "Layout/Resizable",
    component: ResizablePaneGroup,
    args: { direction: "horizontal" },
    argTypes: {
      direction: { control: "select", options: ["horizontal", "vertical"] },
    },
    parameters: {
      controls: { include: ["direction"] },
    },
  });

  type ResizableArgs = { direction: "horizontal" | "vertical" };
</script>

<!-- A list + detail split: drag (or keyboard-resize) the handle to repartition the two panes. -->
<Story
  name="Split panes"
  play={async ({ canvas, step }) => {
    await step("A draggable separator sits between the panes", async () => {
      const separators = canvas.getAllByRole("separator");
      await expect(separators.length).toBeGreaterThan(0);
      await expect(separators[0]).toHaveAttribute("aria-valuenow");
    });
  }}
>
  {#snippet template(args: ResizableArgs)}
    <div class="h-96 w-full">
      <Resizable.PaneGroup direction={args.direction}>
        <Resizable.Pane defaultSize={30} minSize={15}>
          <div class="p-16">List</div>
        </Resizable.Pane>
        <Resizable.Handle withHandle />
        <Resizable.Pane defaultSize={70} minSize={30}>
          <div class="p-16">Detail</div>
        </Resizable.Pane>
      </Resizable.PaneGroup>
    </div>
  {/snippet}
</Story>
