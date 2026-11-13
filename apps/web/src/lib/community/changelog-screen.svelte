<script lang="ts">
  /*
   * The public changelog on the community board: what changed in Magna Carta, in the words written
   * for the people who use it, newest first. Anyone can read it without signing in.
   *
   * It is the customer changelog (docs/public-changelog.md, assembled from the public half of each
   * changelog fragment), not the application's own Changelog screen, which lists every merged pull
   * request for the people building the product. The words are built into the bundle, so the page
   * makes no read and can only describe the build it is part of.
   */
  import Badge from "@magna-carta/design-system/badge";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import type { PublicChangelogRelease } from "@magna-carta/product-updates";
  import ChangelogInline from "$lib/product-updates/changelog-inline.svelte";
  import { parseChangelogText } from "$lib/product-updates/changelog-text.ts";
  import CommunityTopBar from "./community-top-bar.svelte";

  let {
    releases,
    viewerDisplayName,
    signInUrl = null,
    onSignOut,
  }: {
    releases: readonly PublicChangelogRelease[];
    viewerDisplayName: string | null;
    signInUrl?: string | null;
    onSignOut?: () => void;
  } = $props();
</script>

<div class="flex min-h-screen flex-col bg-surface-sunken text-text-default">
  <CommunityTopBar current="changelog" {viewerDisplayName} {signInUrl} {onSignOut} />
  <main class="flex flex-col gap-24 px-32 py-24">
    <div class="flex flex-wrap items-baseline gap-12">
      <h1 class="text-2xl font-semibold">Changelog</h1>
      <span class="text-sm text-text-muted">What changed in Magna Carta, newest first.</span>
    </div>
    <ol class="flex flex-col gap-16">
      {#each releases as release (release.date)}
        <li class="flex flex-col gap-12 rounded-lg border border-border-default bg-surface-default p-20">
          <h2 class="text-lg font-semibold"><time datetime={release.date}>{formatDate(release.date)}</time></h2>
          {#each release.categories as group (group.category)}
            <section class="flex flex-col gap-8">
              <div><Badge variant="neutral" caps>{group.category}</Badge></div>
              <ul class="flex flex-col gap-12">
                {#each group.entries as entry, index (index)}
                  <li class="flex flex-col gap-4 text-sm leading-relaxed">
                    {#each parseChangelogText(entry.text) as paragraph, paragraphIndex (paragraphIndex)}
                      <p><ChangelogInline nodes={paragraph} /></p>
                    {/each}
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </li>
      {/each}
    </ol>
  </main>
</div>
