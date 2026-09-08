<script lang="ts">
  /*
   * The review workspace — one corpus, and everything a person does to it.
   *
   * IT IS OUTSIDE THE MATTER'S CHROME ON PURPOSE, and the reason is two built controls rather than
   * a preference about layout. The matter header carries a consolidated search on every section by
   * construction — that is the mechanical guarantee its own design relies on — and that search must
   * never reach a review set: the search index's split catalog is keyed by corpus precisely so a
   * matter search is structurally unable to name material another party produced. Rendered inside
   * the matter layout, this workspace would therefore sit under a search field aimed at a different
   * corpus from the documents on screen, which is a control that can be in the wrong position. The
   * matter's one create control has the same problem: its label is decided by the section registry
   * before a section mounts.
   *
   * The reader may also hold no matter access at all. A review set's access list is separate from
   * who works the matter, so a reviewer cleared for one production and nothing else can be standing
   * here — which is why the matter is named on the meta line as a FACT and is not a link. A link
   * into a matter they cannot open would produce a 404 they could not interpret.
   *
   * THE WAY BACK IS THE REGISTER, named rather than drawn, so the header resolves its label and
   * glyph from the sidebar's own registry and cannot call the destination something the sidebar
   * calls something else. It also does the work an eyebrow would have done and the header rules
   * forbid: a reader arriving on a name in the display serif learns what kind of thing it is from
   * the Discovery they came back through, and from the state and count on the meta line.
   */
  import Badge from "@magna-carta/design-system/badge";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import WorkspaceNav from "$lib/discovery/workspace-nav.svelte";
  import { reviewSetStateEntry } from "$lib/discovery/discovery-vocabulary.ts";
  import type { ReviewSet } from "$lib/discovery/discovery-api.ts";
  import type { Snippet } from "svelte";

  let { data, children }: { data: { reviewSet: ReviewSet }; children: Snippet } = $props();

  const reviewSet = $derived(data.reviewSet);
  const state = $derived(reviewSetStateEntry(reviewSet.state));
</script>

<svelte:head><title>{reviewSet.name} · Discovery · Magna Carta</title></svelte:head>

<div class="flex h-full flex-col gap-16">
  <ScreenHeader title={reviewSet.name} back="discovery">
    {#snippet meta()}
      <Badge variant={state.tone} title={state.meaning}>{state.label}</Badge>
      <span class="tabular-nums">
        {reviewSet.documentCount.toLocaleString()}
        {reviewSet.documentCount === 1 ? "document" : "documents"}
      </span>
    {/snippet}
  </ScreenHeader>

  <WorkspaceNav reviewSetId={reviewSet.id} />

  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-16">
    {@render children()}
  </div>
</div>
