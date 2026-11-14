<script lang="ts">
  /*
   * The community board's own top bar. The board is a separate site on its own host, publicly
   * readable, so it carries the brand lockup with "Community" beside it (the same lockup the public
   * status page wears) instead of the application's shell, and its navigation is the board's
   * places.
   */
  import BrandMark from "@magna-carta/design-system/brand-mark";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import Button from "@magna-carta/design-system/button";
  import Lightbulb from "@lucide/svelte/icons/lightbulb";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Columns3 from "@lucide/svelte/icons/columns-3";
  import Newspaper from "@lucide/svelte/icons/newspaper";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import { displayInitials } from "@magna-carta/community/display";
  import { page } from "$app/state";
  import { boardPath } from "./board-paths.ts";
  import * as Alert from "@magna-carta/design-system/alert";
  import { optionalBoardSession } from "./board-session.svelte.ts";

  export type CommunityPlace = "requests" | "questions" | "roadmap" | "known-issues" | "changelog" | "moderation";

  let {
    current,
    viewerDisplayName,
    signInUrl = null,
    onSignOut,
  }: {
    current: CommunityPlace | null;
    /** The signed-in member's board name, or null for a reader who has not signed in. */
    viewerDisplayName: string | null;
    /** The app's page that signs a member in here; null while it is not known yet. */
    signInUrl?: string | null;
    onSignOut?: () => void;
  } = $props();

  // The live board's notices, under the header. Absent in the developer console's gallery, which
  // renders these screens with no board session behind them.
  const board = optionalBoardSession();
  const signInExpired = $derived(
    page.url.searchParams.get("sign-in") === "expired" && board?.session?.signedIn !== true,
  );
  const readOnly = $derived(board?.session?.boardState === "read-only");
  // The team's queue is a place only the team has; everyone else never sees the link.
  const isTeam = $derived(board?.session?.profile?.isTeam === true);

  const PLACES = [
    { place: "requests", label: "Requests", icon: Lightbulb, path: "/" },
    { place: "questions", label: "Questions", icon: CircleHelp, path: "/questions" },
    { place: "roadmap", label: "Roadmap", icon: Columns3, path: "/roadmap" },
    { place: "known-issues", label: "Known Issues", icon: TriangleAlert, path: "/known-issues" },
    { place: "changelog", label: "Changelog", icon: Newspaper, path: "/changelog" },
  ] as const;
</script>

<header class="border-b border-border-default bg-surface-default">
  <div class="flex items-center gap-24 px-32 py-12">
    <div class="flex items-center gap-8">
      <BrandMark />
      <FieldLabel>Community</FieldLabel>
    </div>
    <nav aria-label="Community" class="flex items-center gap-4">
      {#each PLACES as entry (entry.place)}
        {@const Icon = entry.icon}
        <a
          href={boardPath(entry.path, page.url.hostname)}
          aria-current={entry.place === current ? "page" : undefined}
          class="flex items-center gap-8 rounded-md px-12 py-4 text-sm font-medium text-text-muted hover:bg-surface-sunken hover:text-text-default aria-[current=page]:bg-surface-selected aria-[current=page]:text-text-default"
        >
          <Icon class="size-16" aria-hidden="true" />
          {entry.label}
        </a>
      {/each}
      {#if isTeam}
        <a
          href={boardPath("/moderation", page.url.hostname)}
          aria-current={current === "moderation" ? "page" : undefined}
          class="flex items-center gap-8 rounded-md px-12 py-4 text-sm font-medium text-text-muted hover:bg-surface-sunken hover:text-text-default aria-[current=page]:bg-surface-selected aria-[current=page]:text-text-default"
        >
          <ShieldCheck class="size-16" aria-hidden="true" />
          Moderation
        </a>
      {/if}
    </nav>
    <div class="ml-auto flex items-center gap-12">
      {#if viewerDisplayName === null}
        {#if signInUrl !== null}
          <Button variant="secondary" size="sm" href={signInUrl}>Sign In</Button>
        {/if}
      {:else}
        <span class="text-sm text-text-muted">{viewerDisplayName}</span>
        <Avatar.Root>
          <Avatar.Fallback>{displayInitials(viewerDisplayName)}</Avatar.Fallback>
        </Avatar.Root>
        {#if onSignOut !== undefined}
          <Button variant="ghost" size="sm" onclick={onSignOut}>Sign Out</Button>
        {/if}
      {/if}
    </div>
  </div>
</header>
{#if signInExpired || readOnly}
  <div class="flex flex-col gap-8 px-32 pt-16">
    {#if signInExpired}
      <Alert.Root variant="warning">
        <p>
          That sign-in link has already been used or has run out. Each one works once, for a minute.
          {#if signInUrl !== null}
            <a class="font-semibold text-text-link" href={signInUrl}>Sign in again</a>.
          {/if}
        </p>
      </Alert.Root>
    {/if}
    {#if readOnly}
      <Alert.Root variant="info">
        <p>The board is read-only for now. You can read everything, and nothing can be posted or voted on.</p>
      </Alert.Root>
    {/if}
  </div>
{/if}
