<script lang="ts">
  /*
   * One document, under three candidate headers. The document, the canvas beneath it and every
   * state it can be in are shared; the only thing that varies between two specimens is `variant`,
   * which is the whole point of the comparison.
   *
   * WHAT THE HEADER HAS TO DO. On this screen the app's rail and the app's top bar are gone, so a
   * single band carries what both of them carried plus what the document's own header carried:
   * the way out, the document's identity, whether the work is reaching storage, and whether this
   * member may write at all. Two facts make the arrangement tractable and both are easy to miss.
   * First, leaving the document restores the shell, so a way back needs to reach exactly ONE app
   * screen and the rest of the app follows from there; what a band must earn is the ability to
   * reach somewhere else WITHOUT leaving, which is a weaker need and is what the command palette
   * is for. Second, the band is the only chrome on the screen, so it is where identity belongs,
   * and the canvas underneath it stays a work surface.
   *
   * WHAT IS REAL HERE AND WHAT IS A FOOTPRINT. The bands are assembled from the shipping
   * components: the chrome band and its parts, the breadcrumb, the badges, the Soon affordance,
   * the dropdown menu, and the screen header itself in the second variant. The app menu renders
   * the real destination registry, so a reader is looking at the firm's own destinations rather
   * than a list written here. What is deliberately a footprint is the cluster of trays: the
   * notification bell, the two transfer registers and the Time Sheet handle are rendered as the
   * chrome controls they are, without their live reads, because a gallery about where a control
   * sits should not be making authenticated requests and a screenshot pass should not depend on
   * what the firm's queue happens to hold. The build chip is the real one, since it reads nothing
   * until it is opened.
   *
   * THE SAVE READOUT IS NOT WIRED TO ANYTHING, AND THAT IS STATED ON THE PAGE. The editor writes
   * the file itself and does not report its save state to the host today, so this readout is under
   * review as a shape rather than shipping behaviour; the specimen drives it from a prop so all
   * three of its answers can be looked at.
   *
   * Nothing here ships as it stands. The bands are candidates; the shipping screen is the real
   * edit route, which this leaves alone.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Breadcrumb from "@magna-carta/design-system/breadcrumb";
  import type { BreadcrumbEntry } from "@magna-carta/design-system/breadcrumb";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import * as TopBar from "@magna-carta/design-system/top-bar";
  import BrandMark from "@magna-carta/design-system/brand-mark";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Separator from "@magna-carta/design-system/separator";
  import { SoonAffordance } from "@magna-carta/design-system/maturity";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import Bell from "@lucide/svelte/icons/bell";
  import Check from "@lucide/svelte/icons/check";
  import CloudUpload from "@lucide/svelte/icons/cloud-upload";
  import Download from "@lucide/svelte/icons/download";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Search from "@lucide/svelte/icons/search";
  import Share2 from "@lucide/svelte/icons/share-2";
  import Timer from "@lucide/svelte/icons/timer";
  import Upload from "@lucide/svelte/icons/upload";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { matterFilesBack } from "$lib/screen/screen-header.ts";
  import {
    DESTINATION_GROUPS,
    visibleDestinations,
    type Destination,
  } from "$lib/navigation/destinations.ts";
  import { grantedPermissions } from "$lib/tools/tool-permissions.ts";
  import {
    formatDocumentSize,
    formatDocumentTimestamp,
  } from "$lib/documents/document-presentation.ts";
  import VersionChip from "$lib/versions/version-chip.svelte";
  import {
    bandState,
    SAVE_STATE_WORDS,
    SPECIMEN_DOCUMENT,
    SPECIMEN_ELAPSED,
    SPECIMEN_PAGE_LINES,
    type EditorSeat,
    type HeaderVariant,
    type SaveState,
  } from "./specimen-document.ts";

  let {
    variant,
    seat = "editing",
    saveState = "saved",
    onMeasure,
  }: {
    variant: HeaderVariant;
    /** Whether this member holds the write seat, or is reading while somebody else writes. */
    seat?: EditorSeat;
    /** What the band says about the work reaching storage. */
    saveState?: SaveState;
    /** The band's own measured height, reported so the page can compare the three by fact. */
    onMeasure?: (points: number) => void;
  } = $props();

  const file = SPECIMEN_DOCUMENT;

  /*
   * The way back is the shipping one: the matter's Files section, named by the matter, with the
   * document revealed. It is built by the same function the edit route calls, so a specimen cannot
   * invent a destination or word it differently from the screen it is standing in for.
   */
  const filesBack = matterFilesBack(file.matterId, file.matterTitle, file.fileId);

  const notice = $derived(bandState(seat, saveState));
  /** The save readout shows only where there is a save to report: a read-only seat writes nothing. */
  const showsSaveReadout = $derived(seat === "editing" && saveState !== "disconnected");
  const citation = $derived(
    `Version ${String(file.versionNumber)} · ${formatDocumentSize(file.sizeBytes)} · ${formatDocumentTimestamp(file.updatedAt)}`,
  );

  /*
   * The path, as the third variant's way back. Every rung before the document is a link, so the
   * matter's files, the matter itself and the docket above it are each one press away; the leaf is
   * the document and carries no link, which is what the breadcrumb marks as the current page.
   */
  const pathEntries: BreadcrumbEntry[] = $derived([
    { label: "Matters", href: "/matters" },
    { label: file.matterTitle, href: `/matters/${file.matterId}/overview` },
    { label: "Files", href: filesBack.href },
    ...file.folderPath.map((folder) => ({ label: folder, href: filesBack.href })),
    { label: file.name },
  ]);

  /** The app's own destinations, grouped as the rail groups them. */
  const destinationGroups = $derived(
    DESTINATION_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      destinations: visibleDestinations(grantedPermissions()).filter(
        (destination: Destination) => destination.group === group.id,
      ),
    })).filter((group) => group.destinations.length > 0),
  );

  let bandHeight = $state(0);
  $effect(() => {
    onMeasure?.(bandHeight);
  });
</script>

<!-- The app's destinations, as the menu that stands in for the rail. The rows are inert in the
     gallery: pressing one would leave the page the comparison is on. -->
{#snippet destinationItems()}
  {#each destinationGroups as group (group.id)}
    <DropdownMenu.Group>
      <DropdownMenu.GroupHeading>{group.label}</DropdownMenu.GroupHeading>
      {#each group.destinations as destination (destination.id)}
        {@const Icon = destination.icon}
        <DropdownMenu.Item disabled={!destination.shipped}>
          <Icon class="size-16" aria-hidden="true" />
          {destination.label}
          {#if !destination.shipped}
            <Badge variant="neutral" class="ms-auto">Soon</Badge>
          {/if}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Group>
  {/each}
{/snippet}

<!-- The save readout. Two words and a glyph, at the small step, because it is read at a glance and
     never acted on. -->
{#snippet saveReadout(muted: string)}
  <span class="flex flex-none items-center gap-4 text-xs {muted}">
    {#if saveState === "saving"}
      <RefreshCw class="size-12" aria-hidden="true" />
    {:else}
      <Check class="size-12" aria-hidden="true" />
    {/if}
    {SAVE_STATE_WORDS[saveState]}
  </span>
{/snippet}

<!-- A state that is not the ordinary one: the badge names it, and the sentence beside it says what
     it means. The sentence truncates before the badge does, so the mark survives a narrow canvas. -->
{#snippet stateNote(muted: string)}
  {#if notice !== null}
    <span class="flex min-w-0 items-center gap-8">
      <Badge variant={notice.variant}>{notice.badge}</Badge>
      <span class="truncate text-xs {muted}">{notice.sentence}</span>
    </span>
  {/if}
{/snippet}

<!-- The document canvas: a stand-in page under the band, so the band is judged against a real
     proportion of document rather than against nothing. -->
{#snippet canvas()}
  <div class="flex min-h-0 flex-1 justify-center bg-surface-sunken p-16">
    <div class="w-full max-w-2xl bg-surface-raised p-24 shadow-elevation-1">
      <p class="mb-12 text-center text-sm font-semibold text-text-default">
        MOTION TO COMPEL PRODUCTION
      </p>
      {#each SPECIMEN_PAGE_LINES as line, position (position)}
        <p class="text-xs leading-relaxed text-text-muted">{line}</p>
      {/each}
    </div>
  </div>
{/snippet}

<div
  class="flex flex-col overflow-hidden rounded-md border border-border-default bg-surface-default"
  style="block-size: var(--mc-size-record-context)"
>
  <div bind:clientHeight={bandHeight} class="flex-none">
    {#if variant === "continuous-chrome"}
      <!--
        ONE: the app's own chrome band, with the document seated in it.

        The band is the top bar, at the top bar's own height and register, and nothing the top bar
        carried is given up. The mark leads it and goes Home, exactly as it does at the head of the
        rail; the named link beside it goes to the matter's files. The document's name takes the
        width the search field used to hold, and the search falls back to the glyph and the chord.
      -->
      <TopBar.Root class="ps-12">
        <a href="/home" aria-label="Magna Carta — Home" class="flex-none rounded-md">
          <BrandMark />
        </a>
        <!-- No rule between the mark and the way back: the separator is drawn in the work
             surface's border tone and would read as a bright line across the ink. The band's own
             spacing separates them. -->
        <!-- The way back, named. It is a chrome-register link rather than the product's own back
             control, because that control is drawn for the light work surface and has no ink
             register: see the note on the gallery page. -->
        <TopBar.Link href={filesBack.href} class="flex-none gap-4">
          <ArrowLeft class="size-12" aria-hidden="true" />
          <FolderOpen class="size-12" aria-hidden="true" />
          {filesBack.label}
        </TopBar.Link>
        <span class="flex min-w-0 flex-1 items-baseline gap-8">
          <span class="truncate text-sm font-medium text-chrome-text-strong" title={file.name}>
            {file.name}
          </span>
          <span class="hidden truncate text-xs text-chrome-text-muted lg:inline">{citation}</span>
        </span>
        {#if showsSaveReadout}
          {@render saveReadout("text-chrome-text-muted")}
        {/if}
        {@render stateNote("text-chrome-text-muted")}
        <TopBar.Actions>
          <Tooltip.Root>
            <Tooltip.Trigger class="mc-top-bar-icon-button" aria-label="Search">
              <Search class="size-16" aria-hidden="true" />
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">Search</Tooltip.Content>
          </Tooltip.Root>
          <SoonAffordance reason="the client portal's document sharing">
            {#snippet control(soon)}
              <TopBar.IconButton {...soon} aria-label="Share">
                <Share2 class="size-16" aria-hidden="true" />
              </TopBar.IconButton>
            {/snippet}
          </SoonAffordance>
          <VersionChip />
          <Tooltip.Root>
            <Tooltip.Trigger class="mc-top-bar-icon-button" aria-label="Notifications">
              <Bell class="size-16" aria-hidden="true" />
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">Notifications</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger
              class="mc-top-bar-icon-button gap-4 text-xs tabular-nums"
              aria-label="Time Sheet"
            >
              <Timer class="size-16" aria-hidden="true" />
              {SPECIMEN_ELAPSED}
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">Time Sheet</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger class="mc-top-bar-icon-button" aria-label="Uploads">
              <Upload class="size-16" aria-hidden="true" />
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">Uploads</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger class="mc-top-bar-icon-button" aria-label="Downloads">
              <Download class="size-16" aria-hidden="true" />
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">Downloads</Tooltip.Content>
          </Tooltip.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class="mc-top-bar-icon-button rounded-full p-4"
              aria-label="Account menu"
            >
              <Avatar.Root>
                <Avatar.Fallback>MC</Avatar.Fallback>
              </Avatar.Root>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
              {@render destinationItems()}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </TopBar.Actions>
      </TopBar.Root>
    {:else if variant === "document-masthead"}
      <!--
        TWO: the document's own header, kept, and the app folded into it.

        Nothing new is invented. This is the screen header every other screen states itself
        through, in its compact density, with the app's few survivors seated in its action row.
        The document keeps the display serif and its citation line; the way back is the product's
        own back control, naming the matter. What the band costs is height, and it costs the most
        of the three.
      -->
      <ScreenHeader
        title={file.name}
        back={filesBack}
        density="compact"
        class="border-b border-border-default px-16 pb-8 pt-12"
      >
        {#snippet meta()}
          {#if showsSaveReadout}
            {@render saveReadout("text-text-muted")}
            <Masthead.MetaSeparator />
          {/if}
          <span>{citation}</span>
        {/snippet}
        {#snippet actions()}
          {@render stateNote("text-text-muted")}
          <SoonAffordance reason="the client portal's document sharing">
            {#snippet control(soon)}
              <Button variant="secondary" size="sm" {...soon}>
                <Share2 class="size-16" aria-hidden="true" />
                Share
              </Button>
            {/snippet}
          </SoonAffordance>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button variant="ghost" size="icon-sm" aria-label="Search" {...props}>
                  <Search class="size-16" aria-hidden="true" />
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">Search</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button variant="ghost" size="sm" aria-label="Time Sheet" {...props}>
                  <Timer class="size-16" aria-hidden="true" />
                  <span class="tabular-nums">{SPECIMEN_ELAPSED}</span>
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">Time Sheet</Tooltip.Content>
          </Tooltip.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class="{buttonClasses({ variant: 'ghost', size: 'icon' })} rounded-full p-4"
              aria-label="Account menu"
            >
              <Avatar.Root class="size-24">
                <Avatar.Fallback>MC</Avatar.Fallback>
              </Avatar.Root>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
              {@render destinationItems()}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {/snippet}
      </ScreenHeader>
    {:else}
      <!--
        THREE: the path is the header.

        The thinnest of the three, and the only one where the way back is a ladder rather than a
        link: every rung between the docket and this document is on the row, so the matter, its
        files and the folder the document sits in are each one press away. The document's name is
        the leaf, which the breadcrumb already refuses to shrink or truncate. The app's three
        registers merge into one tray, and the Time Sheet handle stays out on the row.
      -->
      <div
        class="flex items-center gap-8 border-b border-border-default bg-surface-default px-12 py-4"
      >
        <DropdownMenu.Root>
          <Tooltip.Root>
            <Tooltip.Trigger>
              <!-- The hover names the control, and the tooltip and the menu share ONE button
                   through the tooltip trigger's child snippet: two elements would be two
                   controls. It is the notification bell's own arrangement. -->
              {#snippet child({ props })}
                <DropdownMenu.Trigger
                  {...props}
                  class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
                  aria-label="Go to"
                >
                  <LayoutGrid class="size-16" aria-hidden="true" />
                </DropdownMenu.Trigger>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">Go to</Tooltip.Content>
          </Tooltip.Root>
          <DropdownMenu.Content align="start" style="min-inline-size: var(--mc-size-popover)">
            {@render destinationItems()}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
        <Breadcrumb items={pathEntries} class="min-w-0 flex-1" maxItems={5} />
        {#if showsSaveReadout}
          {@render saveReadout("text-text-muted")}
        {/if}
        {@render stateNote("text-text-muted")}
        <span class="flex-none text-xs text-text-muted">Version {file.versionNumber}</span>
        <Separator orientation="vertical" class="h-16 flex-none" />
        <SoonAffordance reason="the client portal's document sharing">
          {#snippet control(soon)}
            <Button variant="ghost" size="icon-sm" aria-label="Share" {...soon}>
              <Share2 class="size-16" aria-hidden="true" />
            </Button>
          {/snippet}
        </SoonAffordance>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button variant="ghost" size="icon-sm" aria-label="Search" {...props}>
                <Search class="size-16" aria-hidden="true" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content side="bottom">Search</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button variant="ghost" size="sm" aria-label="Time Sheet" {...props}>
                <Timer class="size-16" aria-hidden="true" />
                <span class="tabular-nums">{SPECIMEN_ELAPSED}</span>
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content side="bottom">Time Sheet</Tooltip.Content>
        </Tooltip.Root>
        <DropdownMenu.Root>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <DropdownMenu.Trigger
                  {...props}
                  class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
                  aria-label="Trays"
                >
                  <CloudUpload class="size-16" aria-hidden="true" />
                </DropdownMenu.Trigger>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">Trays</Tooltip.Content>
          </Tooltip.Root>
          <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
            <DropdownMenu.Group>
              <DropdownMenu.GroupHeading>Trays</DropdownMenu.GroupHeading>
              <DropdownMenu.Item>
                <Bell class="size-16" aria-hidden="true" />
                Notifications
              </DropdownMenu.Item>
              <DropdownMenu.Item>
                <Upload class="size-16" aria-hidden="true" />
                Uploads
              </DropdownMenu.Item>
              <DropdownMenu.Item>
                <Download class="size-16" aria-hidden="true" />
                Downloads
              </DropdownMenu.Item>
              <DropdownMenu.Item>
                <GitCommitHorizontal class="size-16" aria-hidden="true" />
                Build Information
              </DropdownMenu.Item>
            </DropdownMenu.Group>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class="{buttonClasses({ variant: 'ghost', size: 'icon-sm' })} rounded-full p-4"
            aria-label="Account menu"
          >
            <Avatar.Root class="size-24">
              <Avatar.Fallback>MC</Avatar.Fallback>
            </Avatar.Root>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
            {@render destinationItems()}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    {/if}
  </div>

  {@render canvas()}
</div>
