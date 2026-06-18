<script module lang="ts">
  /*
   * App Shell — the canonical composition (page-archetypes Layout A): the dark "ink" chrome (the brand
   * corner + sidebar on the left, the top bar across the work column) FRAMING a light, calm work canvas.
   * The brand sits in the top-LEFT corner; the top bar starts to its right, over the work column. The
   * identity lives in the chrome — the gold brand mark, the gold active destination, the gilt "New" CTA
   * — so the work surface (the matters table) stays quiet. A composition proof (like
   * support/matters-table), not a single component; the real top-bar parts (command palette,
   * notifications, the running timer) are feature-slice concerns.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ColumnDef } from "@tanstack/table-core";
  import House from "@lucide/svelte/icons/house";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Calendar from "@lucide/svelte/icons/calendar";
  import Users from "@lucide/svelte/icons/users";
  import Clock from "@lucide/svelte/icons/clock";
  import ReceiptText from "@lucide/svelte/icons/receipt-text";
  import Scale from "@lucide/svelte/icons/scale";
  import Settings from "@lucide/svelte/icons/settings";
  import Search from "@lucide/svelte/icons/search";
  import Plus from "@lucide/svelte/icons/plus";
  import Bell from "@lucide/svelte/icons/bell";
  import * as Sidebar from "../lib/components/sidebar/index.ts";
  import * as Tooltip from "../lib/components/tooltip/index.ts";
  import Button from "../lib/components/button/index.ts";
  import * as Avatar from "../lib/components/avatar/index.ts";
  import { facetFilterFn } from "../lib/components/data-table/index.ts";
  import MattersTable from "./support/matters-table.svelte";

  const { Story } = defineMeta({
    title: "Layout/App Shell",
    parameters: { controls: { include: [] }, layout: "fullscreen" },
  });

  type Matter = { reference: string; client: string; status: string; opened: Date; fees: number };
  const CLIENTS = ["Pemberton, J.", "Calloway Family", "Northwind LLC", "Boone, T.", "Doyle, K."];
  const STATUSES = ["Open", "Pending", "Closed"];
  const MATTERS: Matter[] = Array.from({ length: 12 }, (_, index) => ({
    reference: `2026-0${120 - index}`,
    client: CLIENTS[index % CLIENTS.length]!,
    status: STATUSES[index % STATUSES.length]!,
    opened: new Date(Date.UTC(2026, (index * 5) % 12, ((index * 11) % 27) + 1)),
    fees: ((index * 31) % 80) * 250,
  }));
  const columns: ColumnDef<Matter>[] = [
    { accessorKey: "reference", header: "Matter", filterFn: "includesString", meta: { filter: "text" } },
    { accessorKey: "client", header: "Client", filterFn: facetFilterFn, meta: { filter: "facet" } },
    { accessorKey: "status", header: "Status", filterFn: facetFilterFn, meta: { filter: "facet" } },
    { accessorKey: "opened", header: "Opened", meta: { type: "date" } },
    { accessorKey: "fees", header: "Trust", meta: { type: "money", currency: "USD" } },
  ];
</script>

<Story name="Matters">
  {#snippet template()}
    <Tooltip.Provider>
      <!-- Horizontal split: the sidebar (brand corner + nav) is the full-height left column; the top
           bar + work canvas are the right column, so the top bar starts to the RIGHT of the brand. -->
      <div class="flex h-screen overflow-hidden bg-surface-default">
        <Sidebar.Root aria-label="Primary">
          <Sidebar.Header>
            <Scale class="mc-sidebar-icon text-chrome-accent" aria-hidden="true" />
            <span class="font-semibold whitespace-nowrap text-chrome-text-strong">Magna Carta</span>
          </Sidebar.Header>
          <Sidebar.Content>
            <Sidebar.Group>
              <Sidebar.GroupLabel>Top</Sidebar.GroupLabel>
              <Sidebar.Menu>
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton href="#home" tooltip="Home">
                    {#snippet icon()}<House class="mc-sidebar-icon" aria-hidden="true" />{/snippet}
                    Home
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton href="#matters" tooltip="Matters" isActive aria-current="page">
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

        <div class="flex grow flex-col overflow-hidden">
          <!-- Top bar — chrome, starting to the right of the brand corner. Its height matches the brand
               header (min-block-size control-lg) so their bottom hairlines line up into one row. -->
          <header
            class="flex items-center gap-12 border-b border-chrome-border bg-chrome-surface px-16"
            style="min-block-size: var(--mc-control-lg)"
          >
            <button
              type="button"
              class="flex grow items-center gap-8 rounded-md border border-chrome-border bg-chrome-surface-hover px-12 py-8 text-sm text-chrome-text-muted max-w-md"
            >
              <Search class="size-16" aria-hidden="true" />
              <span class="grow text-start">Search or jump to anything</span>
              <!-- A quiet chrome keycap (muted warm text + a hairline), not the light-ground Keyboard
                   keycap, which renders white and shouts on the dark ink. -->
              <kbd
                class="rounded-sm border border-chrome-border px-4 font-sans text-xs text-chrome-text-muted"
                >⌘K</kbd
              >
            </button>
            <div class="grow"></div>
            <Button variant="accent" size="sm">
              <Plus class="size-16" aria-hidden="true" />
              New
            </Button>
            <button
              type="button"
              aria-label="Notifications"
              class="flex items-center justify-center rounded-md p-8 text-chrome-text-muted transition-colors duration-fast hover:bg-chrome-surface-hover hover:text-chrome-text-strong"
            >
              <Bell class="size-20" aria-hidden="true" />
            </button>
            <Avatar.Root>
              <Avatar.Fallback>TG</Avatar.Fallback>
            </Avatar.Root>
          </header>

          <!-- Work canvas — light and calm. Page header + the matters table; identity recedes here. -->
          <main class="grow overflow-auto p-24">
            <div class="mb-16 flex items-baseline gap-12">
              <h1 class="text-2xl font-semibold text-default">Matters</h1>
              <span class="text-sm text-muted">8 open · 42 total</span>
            </div>
            <MattersTable data={MATTERS} {columns} caption="Open matters" />
          </main>
        </div>
      </div>
    </Tooltip.Provider>
  {/snippet}
</Story>
