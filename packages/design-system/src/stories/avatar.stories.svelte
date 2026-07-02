<script module lang="ts">
  /*
   * Avatar — Tier 2 (Bits UI), multi-part. The showcase is a composed instance: an image avatar
   * (with an initials fallback for load/error) beside a fallback-only avatar. No meaningful root
   * controls, so the controls panel is empty (Bits components must still set controls.include — see
   * CLAUDE.md). svelte-csf needs a directly imported component for `component`. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import * as Avatar from "../lib/components/avatar/index.ts";
  import AvatarRoot from "../lib/components/avatar/avatar.svelte";

  const { Story } = defineMeta({
    title: "Data Display/Avatar",
    component: AvatarRoot,
    parameters: {
      controls: { include: [] },
    },
  });
</script>

{#snippet template()}
  <div class="flex items-center gap-3">
    <Avatar.Root>
      <Avatar.Image
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%23475569'/%3E%3C/svg%3E"
        alt="Ada Chambers"
      />
      <Avatar.Fallback>AC</Avatar.Fallback>
    </Avatar.Root>
    <Avatar.Root>
      <Avatar.Fallback>RB</Avatar.Fallback>
    </Avatar.Root>
  </div>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    await step("Fallback-only avatar shows its initials", async () => {
      // No image to resolve, so the fallback renders immediately.
      await expect(canvas.getByText("RB")).toBeInTheDocument();
    });
  }}
/>
