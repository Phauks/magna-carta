<script module lang="ts">
  /*
   * Sidebar — Tier 4 / app shell. The global navigation rail of page-archetypes Layout A: a fixed
   * <nav> landmark with grouped destinations that collapses to an icon rail (the Trigger flips it;
   * Sidebar.Root shares the state via context). In the rail the labels go sr-only — the link keeps
   * its accessible name — and a Tooltip surfaces the name visually on hover/focus. This story is the
   * first archetype-composition proof; the destination registry, RBAC filtering, and top bar are
   * feature-slice concerns, not the structural chrome shown here. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, waitFor } from "storybook/test";
  import House from "@lucide/svelte/icons/house";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Calendar from "@lucide/svelte/icons/calendar";
  import Users from "@lucide/svelte/icons/users";
  import Clock from "@lucide/svelte/icons/clock";
  import ReceiptText from "@lucide/svelte/icons/receipt-text";
  import Settings from "@lucide/svelte/icons/settings";
  import Network from "@lucide/svelte/icons/network";
  import Globe from "@lucide/svelte/icons/globe";
  import Shield from "@lucide/svelte/icons/shield";
  import Gauge from "@lucide/svelte/icons/gauge";
  import Badge from "../lib/components/badge/badge.svelte";
  import BrandMark from "../lib/components/brand-mark/brand-mark.svelte";
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
  // A cluster's fold — the rail's second level. Held by the consumer, exactly as the app holds it
  // as a member preference; the part only draws the chevron and reports the press.
  let toolsOpen = $state(true);
</script>

<Story
  name="App shell"
  play={async ({ canvas, canvasElement, step }) => {
    const nav = canvas.getByRole("navigation", { name: "Primary" });

    await step("The active destination is marked as the current page", async () => {
      await expect(canvas.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    });

    await step("The trigger says Collapse, and collapsing switches to the icon rail", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Collapse sidebar" }));
      // Collapse runs through a View Transition, so the state flip is deferred to the transition's
      // capture step — wait for it rather than asserting synchronously.
      await waitFor(() => expect(nav).toHaveAttribute("data-state", "collapsed"));
      const expand = canvas.getByRole("button", { name: "Expand sidebar" });
      await expect(expand).toHaveAttribute("aria-expanded", "false");
      // The label went sr-only, so the link is still findable by its accessible name.
      await expect(canvas.getByRole("link", { name: "Matters" })).toBeInTheDocument();
      // Regression: the brand mark keeps its full size in the rail — the header once shrank its
      // icon to a ~2px sliver when it was left flex-shrinkable. The gold glyph must hold width.
      const brandGlyph = canvasElement.querySelector(".mc-sidebar-header .mc-brand-mark-glyph");
      await expect(brandGlyph).toBeInTheDocument();
      await expect(brandGlyph!.getBoundingClientRect().width).toBeGreaterThan(10);
    });

    await step("A cluster folds its rows away and brings them back", async () => {
      // A cluster is a FOLD, never a screen: pressing it opens the rows beneath rather than
      // navigating, which is what tells it apart from the destination rows it sits among.
      await expect(canvas.getByRole("link", { name: "WHOIS Lookup" })).toBeInTheDocument();
      await userEvent.click(canvas.getByRole("button", { name: "Hide Internet" }));
      await expect(canvas.queryByRole("link", { name: "WHOIS Lookup" })).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Show Internet" }));
      await expect(canvas.getByRole("link", { name: "WHOIS Lookup" })).toBeInTheDocument();
    });

    await step("The trigger now says Expand, and expanding restores the labelled rail", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Expand sidebar" }));
      await waitFor(() => expect(nav).toHaveAttribute("data-state", "expanded"));
      await expect(canvas.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    // In the labelled rail, not the icon rail: the icon rail shows no labels or marks at all.
    await step("A long label truncates and its trailing mark stays", async () => {
      // The mark used to ride inside the label, which has the row's overflow: every long row hid
      // it. The trailing column is sized to its contents and never shrinks.
      const mark = canvas.getByText("Soon");
      await expect(mark).toBeVisible();
      await expect(mark.getBoundingClientRect().width).toBeGreaterThan(0);
    });
  }}
>
  {#snippet template()}
    <Tooltip.Provider>
      <div class="flex overflow-hidden">
        <Sidebar.Root bind:collapsed aria-label="Primary">
          <Sidebar.Header>
            <!-- The wordmark hides by color in the rail (brand-mark.css keys on the sidebar's
                 data-state), so the header keeps its height and the accessible name persists. -->
            <BrandMark />
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

            <!-- A group whose rows fold into a SUB-MENU. The cluster row carries the glyph, the
                 name and the chevron; its members tuck beneath it behind an indent and a hairline.
                 Nothing is reached THROUGH the cluster — pressing it opens the rows. -->
            <Sidebar.Group>
              <Sidebar.GroupLabel>Tools</Sidebar.GroupLabel>
              <Sidebar.Menu>
                <Sidebar.MenuItem>
                  <Sidebar.MenuTrigger
                    expanded={toolsOpen}
                    tooltip="Internet"
                    aria-label={toolsOpen ? "Hide Internet" : "Show Internet"}
                    onclick={() => (toolsOpen = !toolsOpen)}
                  >
                    {#snippet icon()}<Network class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                    Internet
                  </Sidebar.MenuTrigger>
                  {#if toolsOpen}
                    <Sidebar.MenuSub>
                      <Sidebar.MenuItem>
                        <Sidebar.MenuButton href="#whois" tooltip="WHOIS Lookup">
                          {#snippet icon()}<Globe class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                          WHOIS Lookup
                        </Sidebar.MenuButton>
                      </Sidebar.MenuItem>
                      <Sidebar.MenuItem>
                        <Sidebar.MenuButton href="#speed" tooltip="Network Speed Test">
                          {#snippet icon()}<Gauge class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                          Network Speed Test
                        </Sidebar.MenuButton>
                      </Sidebar.MenuItem>
                    </Sidebar.MenuSub>
                  {/if}
                </Sidebar.MenuItem>
                <!-- The longest label the rail carries, with a mark beside it: the label takes the
                     ellipsis and the mark holds its column. -->
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton href="#safe-website-viewer" tooltip="Safe Website Viewer">
                    {#snippet icon()}<Shield class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                    Safe Website Viewer
                    {#snippet trailing()}<Badge variant="outline">Soon</Badge>{/snippet}
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

        <!-- Named so the work canvas resizes as its own view-transition group (geometry morph) rather
             than crossfading with the page root when the rail collapses. -->
        <div class="grow bg-surface-default p-16" style="view-transition-name: mc-app-canvas">
          <p class="text-muted">Matters, Contacts, and the rest of the app render here.</p>
        </div>
      </div>
    </Tooltip.Provider>
  {/snippet}
</Story>
