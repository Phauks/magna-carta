<script module lang="ts">
  /*
   * Sidebar — Tier 4 / app shell. The global navigation rail of page-archetypes Layout A: a fixed
   * <nav> landmark with grouped destinations that collapses to an icon rail (the Trigger flips it;
   * Sidebar.Root shares the state via context). In the rail the labels go sr-only — the link keeps
   * its accessible name — and a Tooltip surfaces the name visually on hover/focus. This story is the
   * first archetype-composition proof; the destination registry, RBAC filtering, and top bar are the
   * feature-slice concerns (§1.2), not the structural chrome shown here. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, within } from "storybook/test";
  import House from "@lucide/svelte/icons/house";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Calendar from "@lucide/svelte/icons/calendar";
  import Users from "@lucide/svelte/icons/users";
  import Clock from "@lucide/svelte/icons/clock";
  import Landmark from "@lucide/svelte/icons/landmark";
  import ReceiptText from "@lucide/svelte/icons/receipt-text";
  import Settings from "@lucide/svelte/icons/settings";
  import * as Sidebar from "../lib/components/sidebar/index.ts";
  import * as Tooltip from "../lib/components/tooltip/index.ts";
  import SidebarRoot from "../lib/components/sidebar/sidebar.svelte";

  const { Story } = defineMeta({
    title: "Layout/Sidebar",
    component: SidebarRoot,
    parameters: {
      // Collapse is driven by the Trigger (the real UX), not a live control.
      controls: { include: [] },
    },
  });
</script>

<script lang="ts">
  // Held here so the brand label and the play assertions can read the same state the Trigger flips.
  let collapsed = $state(false);
</script>

<Story
  name="App shell"
  play={async ({ canvas, step }) => {
    const nav = canvas.getByRole("navigation", { name: "Primary" });

    await step("The active destination is marked as the current page", async () => {
      await expect(canvas.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    });

    await step("The trigger says Collapse, and collapsing switches to the icon rail", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Collapse sidebar" }));
      await expect(nav).toHaveAttribute("data-state", "collapsed");
      const expand = canvas.getByRole("button", { name: "Expand sidebar" });
      await expect(expand).toHaveAttribute("aria-expanded", "false");
      // The label went sr-only, so the link is still findable by its accessible name.
      await expect(canvas.getByRole("link", { name: "Matters" })).toBeInTheDocument();
    });

    await step("The trigger now says Expand, and expanding restores the labelled rail", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Expand sidebar" }));
      await expect(nav).toHaveAttribute("data-state", "expanded");
      await expect(canvas.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });
  }}
>
  {#snippet template()}
    <Tooltip.Provider>
      <div class="flex overflow-hidden">
        <Sidebar.Root bind:collapsed aria-label="Primary">
          <Sidebar.Header>
            <Landmark class="mc-sidebar-icon" aria-hidden="true" />
            <!-- Transparent (not sr-only) in the rail so the brand keeps its height — the header stays
                 the same size, so collapsing never shifts the icons below it — and fades with the rest. -->
            <span
              class="font-semibold transition-colors duration-normal {collapsed
                ? 'text-transparent'
                : 'text-default'}"
            >
              Magna Carta
            </span>
          </Sidebar.Header>

          <Sidebar.Content>
            <Sidebar.Group>
              <Sidebar.GroupLabel>Top</Sidebar.GroupLabel>
              <Sidebar.Menu>
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton href="#home" tooltip="Home" isActive aria-current="page">
                    {#snippet icon()}<House class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                    Home
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton href="#matters" tooltip="Matters">
                    {#snippet icon()}<FolderOpen class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                    Matters
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton href="#calendar" tooltip="Calendar">
                    {#snippet icon()}<Calendar class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                    Calendar
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton href="#contacts" tooltip="Contacts">
                    {#snippet icon()}<Users class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                    Contacts
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
              </Sidebar.Menu>
            </Sidebar.Group>

            <Sidebar.Group>
              <Sidebar.GroupLabel>Money</Sidebar.GroupLabel>
              <Sidebar.Menu>
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton href="#time" tooltip="Time">
                    {#snippet icon()}<Clock class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                    Time
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton href="#billing" tooltip="Billing">
                    {#snippet icon()}<ReceiptText class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                    Billing
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
              </Sidebar.Menu>
            </Sidebar.Group>
          </Sidebar.Content>

          <Sidebar.Footer>
            <Sidebar.Menu>
              <Sidebar.MenuItem>
                <Sidebar.MenuButton href="#settings" tooltip="Settings">
                  {#snippet icon()}<Settings class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                  Settings
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
            </Sidebar.Menu>
            <Sidebar.Trigger />
          </Sidebar.Footer>
        </Sidebar.Root>

        <div class="grow p-16">
          <p class="text-muted">Matters, Contacts, and the rest of the app render here.</p>
        </div>
      </div>
    </Tooltip.Provider>
  {/snippet}
</Story>
