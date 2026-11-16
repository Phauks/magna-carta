<script lang="ts">
  /*
   * Magnus's thinking on one answer, as the model's readable summary of it (the provider returns a
   * summary, never the raw reasoning). While the answer is pending the block is open and grows as
   * the summary arrives, kept scrolled to its newest line, in place of a bare "answering" note (the
   * owner's ruling, 2026-11-14). Once the answer settles it folds shut above the answer, and the
   * reader can open it again.
   */
  import Brain from "@lucide/svelte/icons/brain";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";

  let {
    thinking,
    pending,
  }: {
    /** The summary so far, or null before the model has returned any. */
    thinking: string | null;
    /** The answer is still being written. */
    pending: boolean;
  } = $props();

  let open = $state(false);
  let wasPending: boolean | null = null;
  let body = $state<HTMLElement | null>(null);

  /* Open while the answer is written, and fold shut the moment it settles. */
  $effect(() => {
    if (wasPending === pending) return;
    wasPending = pending;
    open = pending;
  });

  /* Keep the newest line in view while the summary grows. */
  $effect(() => {
    void thinking;
    if (pending && open && body !== null) body.scrollTop = body.scrollHeight;
  });
</script>

{#if thinking === null}
  {#if pending}
    <p class="flex items-center gap-8 text-sm text-text-muted" role="status">
      <Brain class="size-16" aria-hidden="true" />
      Magnus is thinking.
    </p>
  {/if}
{:else}
  <details class="group/thinking mb-4 flex flex-col gap-4" bind:open>
    <summary
      class="flex w-fit cursor-pointer list-none items-center gap-8 rounded-sm text-sm text-text-muted hover:text-text-default [&::-webkit-details-marker]:hidden"
    >
      <ChevronRight
        class="size-16 transition-transform group-open/thinking:rotate-90 motion-reduce:transition-none"
        aria-hidden="true"
      />
      <Brain class="size-16" aria-hidden="true" />
      {pending ? "Thinking" : "Thinking summary"}
    </summary>
    <div
      bind:this={body}
      class="mt-4 max-h-160 mc-scrollbar overflow-y-auto border-s-2 border-border-default ps-12 text-sm whitespace-pre-wrap text-text-muted"
    >
      {thinking}
    </div>
  </details>
{/if}
