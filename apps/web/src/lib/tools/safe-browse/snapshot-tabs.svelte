<script lang="ts">
  /*
   * The information tabs beside the website shell: everything a capture reports about the suspect
   * page other than its picture. Each panel is a fixed-height scroll region so switching tabs
   * never reflows the column and a tall payload (a long extracted text, a hundred headers) scrolls
   * inside its panel rather than stretching the page. Everything here stays inert: the extracted
   * text renders as escaped preformatted text, and every address — redirect hops and outbound
   * links alike — renders as text only, never as an anchor.
   */
  import * as Tabs from "@magna-carta/design-system/tabs";
  import { sortedHeaders, type SafeWebsiteView } from "./safe-browse.ts";

  let { view }: { view: SafeWebsiteView } = $props();

  const headers = $derived(sortedHeaders(view.responseHeaders));
</script>

<Tabs.Root value="redirects">
  <div class="mc-scrollbar overflow-x-auto">
    <Tabs.List class="w-max">
      <Tabs.Trigger value="redirects">Redirects</Tabs.Trigger>
      <Tabs.Trigger value="page-text">Page Text</Tabs.Trigger>
      <Tabs.Trigger value="links">Links</Tabs.Trigger>
      <Tabs.Trigger value="headers">Headers</Tabs.Trigger>
    </Tabs.List>
  </div>

  <Tabs.Content value="redirects">
    <div class="mc-scrollbar aspect-square overflow-y-auto">
      <dl class="flex flex-col gap-12">
        {@render addressField("Requested URL", view.requestedUrl)}
        {@render addressField("Final URL", view.finalUrl)}
        {#if view.title}
          <div class="flex flex-col gap-4">
            {@render fieldLabel("Page Title")}
            <dd class="min-w-0 text-sm break-words text-text-default">{view.title}</dd>
          </div>
        {/if}
        <div class="flex flex-col gap-4">
          {@render fieldLabel("Redirect Chain")}
          <dd class="min-w-0">
            {#if view.redirectChain.length > 0}
              <ol class="flex flex-col gap-4 text-sm text-text-default">
                {#each view.redirectChain as hop, index (index)}
                  <li class="flex items-baseline gap-8">
                    <span class="shrink-0 text-xs text-text-muted">{hop.status}</span>
                    <span class="min-w-0 font-mono break-all">{hop.url}</span>
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
    </div>
  </Tabs.Content>

  <Tabs.Content value="page-text">
    <div class="mc-scrollbar aspect-square overflow-y-auto">
      {#if view.markdown}
        <pre
          class="font-mono text-sm break-words whitespace-pre-wrap text-text-default">{view.markdown}</pre>
      {:else}
        <p class="text-sm text-text-muted">The capture returned no page text.</p>
      {/if}
    </div>
  </Tabs.Content>

  <Tabs.Content value="links">
    <div class="mc-scrollbar aspect-square overflow-y-auto">
      {#if view.links.length > 0}
        <p
          class="mb-8 text-xs text-text-muted uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          {view.links.length === 1 ? "1 outbound address" : `${view.links.length} outbound addresses`}
        </p>
        <ul class="flex flex-col gap-4">
          {#each view.links as link, index (index)}
            <li class="min-w-0 font-mono text-sm break-all text-text-default">{link}</li>
          {/each}
        </ul>
      {:else}
        <p class="text-sm text-text-muted">The page links out to no addresses.</p>
      {/if}
    </div>
  </Tabs.Content>

  <Tabs.Content value="headers">
    <div class="mc-scrollbar aspect-square overflow-y-auto">
      {#if headers.length > 0}
        <dl class="flex flex-col gap-8">
          {#each headers as [name, value] (name)}
            <div class="flex flex-col gap-4">
              <dt class="min-w-0 font-mono text-xs break-all text-text-muted">{name}</dt>
              <dd class="min-w-0 font-mono text-sm break-all text-text-default">{value}</dd>
            </div>
          {/each}
        </dl>
      {:else}
        <p class="text-sm text-text-muted">The response carried no headers.</p>
      {/if}
    </div>
  </Tabs.Content>
</Tabs.Root>

{#snippet fieldLabel(label: string)}
  <dt class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
    {label}
  </dt>
{/snippet}

{#snippet addressField(label: string, value: string)}
  <div class="flex flex-col gap-4">
    {@render fieldLabel(label)}
    <dd class="min-w-0 font-mono text-sm break-all text-text-default">{value}</dd>
  </div>
{/snippet}
