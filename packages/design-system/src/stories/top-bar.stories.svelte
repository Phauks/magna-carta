<script module lang="ts">
  /*
   * TopBar — the app shell's horizontal chrome band (Tier 1 parts; the app assembles the slots).
   * The showcase composes the launch shape: the command-palette trigger + the trailing actions
   * region (gilt +New, an alerts icon affordance, the user avatar). The timer slot is a SEAM —
   * it arrives with the Time slice, so no story fakes it. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import Bell from "@lucide/svelte/icons/bell";
  import Plus from "@lucide/svelte/icons/plus";
  import * as Avatar from "../lib/components/avatar/index.ts";
  import Button from "../lib/components/button/index.ts";
  import * as TopBar from "../lib/components/top-bar/index.ts";
  import TopBarRoot from "../lib/components/top-bar/top-bar.svelte";

  const { Story } = defineMeta({
    title: "Layout/TopBar",
    component: TopBarRoot,
    parameters: {
      controls: { include: [] },
    },
  });
</script>

<Story
  name="Default"
  play={async ({ canvas, step }) => {
    await step("The bar is a banner landmark with the palette trigger", async () => {
      await expect(canvas.getByRole("banner")).toBeInTheDocument();
      const trigger = canvas.getByRole("button", { name: /Search or jump to anything/ });
      await expect(trigger).toHaveAttribute("type", "button");
    });

    await step("The shortcut keycap rides the trigger", async () => {
      await expect(canvas.getByText("Ctrl K")).toBeInTheDocument();
    });

    await step("Actions carry accessible names", async () => {
      await expect(canvas.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    });
  }}
>
  {#snippet template()}
    <TopBar.Root>
      <TopBar.Search shortcut="Ctrl K" class="max-w-md grow">
        Search or jump to anything
      </TopBar.Search>
      <TopBar.Actions>
        <Button variant="accent" size="sm">
          <Plus class="size-16" aria-hidden="true" />
          New
        </Button>
        <TopBar.IconButton aria-label="Notifications">
          <Bell class="size-20" aria-hidden="true" />
        </TopBar.IconButton>
        <Avatar.Root>
          <Avatar.Fallback>TG</Avatar.Fallback>
        </Avatar.Root>
      </TopBar.Actions>
    </TopBar.Root>
  {/snippet}
</Story>
