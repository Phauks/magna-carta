<script lang="ts">
  /*
   * The information tabs beside the website shell: everything a capture reports about the suspect
   * page other than its picture. The tab strip and its bordered panel read as one structured unit
   * — the panel box hangs off the strip's hairline — and the structure renders from page load:
   * with no capture the panels sit empty, while a capture is running they hold placeholder rows,
   * and a completed capture fills them. Each panel is a fixed-height scroll region so switching
   * tabs never reflows the column. Everything here stays inert: the extracted text renders as
   * escaped preformatted text, and every address renders as text — an outbound link or a redirect
   * hop is a button that asks the page to capture that address in the same isolated flow, never an
   * anchor, so nothing can navigate the member's own browser.
   */
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import { sortedHeaders, type SafeWebsiteView } from "./safe-browse.ts";

  let {
    view = null,
    capturing = false,
    onopenaddress,
  }: {
    /** The completed capture on show, or null while there is nothing to report. */
    view?: SafeWebsiteView | null;
    /** Whether a capture is running — the panels hold placeholder rows. */
    capturing?: boolean;
    /** Asks the page to capture this address through the same safe flow. */
    onopenaddress?: (url: string) => void;
  } = $props();

  const headers = $derived(view === null ? [] : sortedHeaders(view.responseHeaders));
</script>

<Tabs.Root value="redirects" class="gap-0">
  <div class="mc-scrollbar overflow-x-auto">
    <Tabs.List class="w-max min-w-full">
      <Tabs.Trigger value="redirects">Redirects</Tabs.Trigger>
      <Tabs.Trigger value="page-text">Page Text</Tabs.Trigger>
      <Tabs.Trigger value="links">Links</Tabs.Trigger>
      <Tabs.Trigger value="headers">Headers</Tabs.Trigger>
    </Tabs.List>
  </div>

  <Tabs.Content value="redirects">
    <div class="rounded-b-md border border-t-0 border-border-default">
      <div class="mc-scrollbar aspect-square overflow-y-auto p-12">
        {#if capturing}
          {@render loadingRows()}
        {:else if view !== null}
          <dl class="flex flex-col divide-y divide-border-default">
            {@render addressField("Requested URL", view.requestedUrl)}
            {@render addressField("Final URL", view.finalUrl)}
            {#if view.title}
              <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
                {@render fieldLabel("Page Title")}
                <dd class="min-w-0 text-sm break-words text-text-default">{view.title}</dd>
              </div>
            {/if}
            <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
              {@render fieldLabel("Redirect Chain")}
              <dd class="min-w-0">
                {#if view.redirectChain.length > 0}
                  <ol class="flex flex-col divide-y divide-border-default">
                    {#each view.redirectChain as hop, index (index)}
                      <li class="flex items-baseline gap-8 py-4 first:pt-0 last:pb-0">
                        <span class="shrink-0 text-xs text-text-muted">{hop.status}</span>
                        {@render addressButton(hop.url)}
                      </li>
                    {/each}
                  </ol>
                {:else}
                  <p class="text-sm text-text-muted">
                    The address answered directly, with no redirects.
                  </p>
                {/if}
              </dd>
            </div>
          </dl>
        {/if}
      </div>
    </div>
  </Tabs.Content>

  <Tabs.Content value="page-text">
    <div class="rounded-b-md border border-t-0 border-border-default">
      <div class="mc-scrollbar aspect-square overflow-y-auto p-12">
        {#if capturing}
          {@render loadingRows()}
        {:else if view !== null}
          {#if view.markdown}
            <pre
              class="font-mono text-sm break-words whitespace-pre-wrap text-text-default">{view.markdown}</pre>
          {:else}
            <p class="text-sm text-text-muted">The capture returned no page text.</p>
          {/if}
        {/if}
      </div>
    </div>
  </Tabs.Content>

  <Tabs.Content value="links">
    <div class="rounded-b-md border border-t-0 border-border-default">
      <div class="mc-scrollbar aspect-square overflow-y-auto p-12">
        {#if capturing}
          {@render loadingRows()}
        {:else if view !== null}
          {#if view.links.length > 0}
            <p
              class="mb-8 text-xs text-text-muted uppercase"
              style="letter-spacing: var(--mc-tracking-caps)"
            >
              {view.links.length === 1
                ? "1 outbound address"
                : `${view.links.length} outbound addresses`}
            </p>
            <ul class="flex flex-col divide-y divide-border-default">
              {#each view.links as link, index (index)}
                <li class="min-w-0 py-8 first:pt-0 last:pb-0">
                  {@render addressButton(link)}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-sm text-text-muted">The page links out to no addresses.</p>
          {/if}
        {/if}
      </div>
    </div>
  </Tabs.Content>

  <Tabs.Content value="headers">
    <div class="rounded-b-md border border-t-0 border-border-default">
      <div class="mc-scrollbar aspect-square overflow-y-auto p-12">
        {#if capturing}
          {@render loadingRows()}
        {:else if view !== null}
          {#if headers.length > 0}
            <dl class="flex flex-col divide-y divide-border-default">
              {#each headers as [name, value] (name)}
                <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
                  <dt class="min-w-0 font-mono text-xs break-all text-text-muted">{name}</dt>
                  <dd class="min-w-0 font-mono text-sm break-all text-text-default">{value}</dd>
                </div>
              {/each}
            </dl>
          {:else}
            <p class="text-sm text-text-muted">The response carried no headers.</p>
          {/if}
        {/if}
      </div>
    </div>
  </Tabs.Content>
</Tabs.Root>

{#snippet fieldLabel(label: string)}
  <dt class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
    {label}
  </dt>
{/snippet}

{#snippet addressField(label: string, value: string)}
  <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
    {@render fieldLabel(label)}
    <dd class="min-w-0 font-mono text-sm break-all text-text-default">{value}</dd>
  </div>
{/snippet}

<!-- An address the member can open in the viewer: a button that asks the page for a new capture,
     styled as the mono text it is, and never an anchor — nothing here navigates their browser. -->
{#snippet addressButton(url: string)}
  <button
    type="button"
    class="min-w-0 cursor-pointer text-left font-mono text-sm break-all text-text-default hover:underline disabled:cursor-not-allowed disabled:text-text-muted"
    disabled={capturing || onopenaddress === undefined}
    onclick={() => onopenaddress?.(url)}
  >
    {url}
  </button>
{/snippet}

{#snippet loadingRows()}
  <div class="flex flex-col gap-8">
    <Skeleton class="h-16 w-3/4" />
    <Skeleton class="h-16 w-full" />
    <Skeleton class="h-16 w-1/2" />
  </div>
{/snippet}
