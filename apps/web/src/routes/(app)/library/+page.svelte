<script lang="ts">
  /*
   * The App Library — the full catalog of every Magna Carta destination: shipped, announced
   * Soon, and future. The sidebar shows what a member has STARRED; this page is where the
   * whole inventory lives and where stars are granted and withdrawn. Reached from the
   * sidebar's Customize mode and the palette, never pushed into the sidebar itself (its
   * registry row is defaultStarred false — a catalog you consult, not a place you work).
   *
   * Starring applies INSTANTLY — this is a personal preference surface, not firm policy, so
   * there is no draft or save flow. Pinned rows (Home, Matters, Settings) carry a locked star:
   * always available, never removable. Everything here stays palette-searchable regardless of
   * stars — hiding must never remove capability (the invariant lives with the preference
   * store).
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import Badge from "@magna-carta/design-system/badge";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import Star from "@lucide/svelte/icons/star";
  import {
    DESTINATION_GROUPS,
    DESTINATIONS,
    type Destination,
  } from "$lib/navigation/destinations.ts";
  import { isStarred, setStarred } from "$lib/navigation/sidebar-preferences.svelte.ts";

  // The catalog lists EVERYTHING in canonical order — including future rows the sidebar and
  // palette do not surface yet: the library is the honest inventory.
  const groups = DESTINATION_GROUPS.map((group) => ({
    ...group,
    destinations: DESTINATIONS.filter((destination) => destination.group === group.id),
  })).filter((group) => group.destinations.length > 0);

  function toggleStar(destination: Destination): void {
    setStarred(destination.id, !isStarred(destination));
  }
</script>

<svelte:head>
  <title>App Library · Magna Carta</title>
</svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Eyebrow>Library</Masthead.Eyebrow>
    <Masthead.Title>App Library</Masthead.Title>
    <Masthead.Meta>
      <span>Every Magna Carta app — star what belongs in your sidebar.</span>
    </Masthead.Meta>
  </Masthead.Heading>
</Masthead.Root>

<div class="flex flex-col gap-32" style="max-inline-size: var(--mc-size-prose)">
  {#each groups as group (group.id)}
    <section class="flex flex-col">
      <!-- The registry's unlabelled top group gets a name here: a catalog needs headings even
           where the sidebar reads fine without one. -->
      <h2
        class="border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        {group.label ?? "Core"}
      </h2>
      <ul class="flex flex-col divide-y divide-border-default border-b border-border-strong">
        {#each group.destinations as destination (destination.id)}
          {@const Icon = destination.icon}
          {@const starred = isStarred(destination)}
          <li class="flex items-center gap-16 py-12">
            <Icon class="size-20 shrink-0 text-text-muted" aria-hidden="true" />
            <div class="flex min-w-0 grow flex-col gap-4">
              <div class="flex items-center gap-8">
                <p class="text-md font-medium">{destination.label}</p>
                {#if !destination.shipped}
                  <Badge variant="neutral">Soon</Badge>
                {/if}
              </div>
              <p class="text-sm text-text-muted">{destination.description}</p>
            </div>
            {#if destination.pinned === true}
              <!-- The locked star: pinned rows cannot leave the sidebar, and the label states
                   that as a fact rather than offering a dead toggle. -->
              <div class="flex shrink-0 items-center gap-8">
                <span class="text-xs text-text-muted">Always available</span>
                <Star
                  class="size-16 fill-current"
                  style="color: var(--mc-accent-default)"
                  aria-hidden="true"
                />
              </div>
            {:else}
              <Tooltip.Root>
                <Tooltip.Trigger
                  class={buttonClasses({ variant: "ghost", size: "icon" })}
                  aria-label={starred
                    ? `Remove ${destination.label} from your sidebar`
                    : `Add ${destination.label} to your sidebar`}
                  aria-pressed={starred}
                  onclick={() => toggleStar(destination)}
                >
                  <Star
                    class="size-16 {starred ? 'fill-current' : ''}"
                    style={starred ? "color: var(--mc-accent-default)" : ""}
                    aria-hidden="true"
                  />
                </Tooltip.Trigger>
                <Tooltip.Content>
                  {starred ? "In your sidebar" : "Add to sidebar"}
                </Tooltip.Content>
              </Tooltip.Root>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>
